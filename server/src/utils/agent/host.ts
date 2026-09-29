import { IncomingMessage, Server, createServer } from 'node:http';
import { AddressInfo, Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import {
  AGENT_HOST_MAX_FILE_BYTES,
  AGENT_HOST_MAX_MESSAGE_BYTES,
  AGENT_HOST_PATH,
  AGENT_HOST_PROTOCOL,
  AGENT_HOST_SECRET_MIN_LENGTH,
  AgentHostCommand,
  ServerMessage,
  getBearerToken,
  isSecretValid,
  parseMessage,
  readLines,
  sendMessage,
} from 'src/utils/agent/host-protocol.js';
import {
  AgentFile,
  AgentLaunch,
  AgentProcess,
  AgentWorkdirs,
  buildAgentEnv,
  isSafeFileName,
  isSafeId,
  listAgentFiles,
  readAgentFile,
  spawnAgent,
} from 'src/utils/agent/process.js';

// The agent host: starts ACP agent processes for the server and relays their stdio over the network (see
// src/utils/agent/host-protocol.ts). It runs in the gallery-agents container (src/bin/agent-host.ts), so that the
// agents are kept away from the library, the database and the server's environment. Node built-ins only.

export type AgentHostOptions = {
  /** the shared secret the server authenticates with, at least AGENT_HOST_SECRET_MIN_LENGTH characters */
  secret: string;
  /** where the working directories of the agents are created */
  workRoot: string;
  /** the most agents running at once */
  maxAgents?: number;
  /** an agent is stopped after this long without ACP messages either way */
  idleTimeoutMs?: number;
  /** the host pings the server this often; a connection that stays silent for 3 pings is closed */
  heartbeatMs?: number;
  /** the time the server has to send `start` after connecting */
  startTimeoutMs?: number;
  /** the commands agents may be started with; empty allows any */
  allowedCommands?: string[];
  /** where `passEnv` variables come from */
  env?: NodeJS.ProcessEnv;
  mcpStdioBridge?: AgentHostCommand;
  log?: (level: 'log' | 'warn', message: string) => void;
};

type HostedAgent = {
  id: string;
  name: string;
  process?: AgentProcess;
  cwd?: string;
  lastActivity: number;
  /** resolves when the agent exited and its working directory is removed */
  finished?: Promise<void>;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isLaunch = (value: unknown): value is AgentLaunch => {
  const profile = value as Partial<AgentLaunch> | undefined;
  return (
    !!profile &&
    typeof profile.name === 'string' &&
    typeof profile.command === 'string' &&
    profile.command.length > 0 &&
    isStringArray(profile.args) &&
    isStringArray(profile.passEnv) &&
    Array.isArray(profile.env) &&
    profile.env.every((item) => typeof item?.name === 'string' && typeof item.value === 'string')
  );
};

const reject = (socket: Duplex, status: number, reason: string) => {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
};

export class AgentHost {
  private server: Server;
  private agents = new Map<string, HostedAgent>();
  private sockets = new Set<Duplex>();
  private workdirs: AgentWorkdirs;
  private options: Required<Omit<AgentHostOptions, 'mcpStdioBridge'>> & Pick<AgentHostOptions, 'mcpStdioBridge'>;

  constructor(options: AgentHostOptions) {
    if (options.secret.length < AGENT_HOST_SECRET_MIN_LENGTH) {
      throw new Error(`The agent host secret must be at least ${AGENT_HOST_SECRET_MIN_LENGTH} characters long`);
    }

    this.options = {
      maxAgents: 8,
      idleTimeoutMs: 60 * 60_000,
      heartbeatMs: 30_000,
      startTimeoutMs: 10_000,
      allowedCommands: [],
      env: process.env,
      log: (level, message) => console[level](message),
      ...options,
    };
    this.workdirs = new AgentWorkdirs(options.workRoot);
    this.server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
        return;
      }
      res.writeHead(404).end();
    });
    this.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) =>
      this.onUpgrade(req, socket, head),
    );
  }

  /** the number of agents running */
  get size() {
    return this.agents.size;
  }

  async listen(port: number, host = '0.0.0.0') {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    return (this.server.address() as AddressInfo).port;
  }

  /** Stops accepting connections and stops every agent */
  async close() {
    const closed = new Promise<void>((resolve) => this.server.close(() => resolve()));
    const exits = this.agents
      .values()
      .map((agent) => agent.finished)
      .toArray();
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await Promise.all([...exits, closed]);
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on('error', () => {});
    const path = new URL(req.url ?? '/', 'http://agent-host').pathname;
    if (path !== AGENT_HOST_PATH || req.headers.upgrade?.toLowerCase() !== AGENT_HOST_PROTOCOL) {
      reject(socket, 404, 'Not Found');
      return;
    }

    if (!isSecretValid(this.options.secret, getBearerToken(req.headers.authorization))) {
      this.options.log('warn', `Rejected a connection from ${req.socket.remoteAddress}: wrong secret`);
      reject(socket, 401, 'Unauthorized');
      return;
    }

    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: ${AGENT_HOST_PROTOCOL}\r\nConnection: Upgrade\r\n\r\n`);
    if (head.length > 0) {
      socket.unshift(head);
    }
    this.serve(socket);
  }

  private serve(socket: Duplex) {
    this.sockets.add(socket);
    if (socket instanceof Socket) {
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 15_000);
    }

    const { heartbeatMs, idleTimeoutMs, startTimeoutMs } = this.options;
    let agent: HostedAgent | undefined;
    let starting = false;
    let lastReceived = Date.now();

    const fail = (message: string) => {
      sendMessage(socket, { type: 'error', message });
      socket.end();
    };

    const startTimer = setTimeout(() => fail('No start message'), startTimeoutMs);
    const heartbeat = setInterval(() => {
      if (Date.now() - lastReceived > 3 * heartbeatMs) {
        this.options.log('warn', `The server stopped answering; stopping agent ${agent?.id ?? '(not started)'}`);
        socket.destroy();
        return;
      }
      if (agent?.process && Date.now() - agent.lastActivity > idleTimeoutMs) {
        this.options.log('log', `Stopping idle agent ${agent.id}`);
        sendMessage(socket, { type: 'error', message: 'The agent was stopped after being idle' });
        void agent.process.kill();
      }
      sendMessage(socket, { type: 'ping' });
    }, heartbeatMs);

    // the HTTP server allows half-open connections: a server that ends its side is gone
    socket.on('end', () => socket.destroy());
    socket.on('close', () => {
      clearTimeout(startTimer);
      clearInterval(heartbeat);
      this.sockets.delete(socket);
      // the server is gone: so is the agent
      void agent?.process?.kill();
    });

    readLines(
      socket,
      (line) => {
        lastReceived = Date.now();
        const message = parseMessage<ServerMessage>(line);
        if (!message || message.type === 'pong') {
          return;
        }

        if (!agent) {
          if (message.type !== 'start' || starting) {
            fail('Expected a start message');
            return;
          }
          starting = true;
          clearTimeout(startTimer);
          this.start(socket, message)
            .then((started) => {
              agent = started;
              if (socket.destroyed) {
                void started.process?.kill();
              }
            })
            .catch((error: Error) => fail(error.message));
          return;
        }

        this.onMessage(socket, agent, message);
      },
      {
        maxBytes: AGENT_HOST_MAX_MESSAGE_BYTES,
        onError: (error) => {
          this.options.log('warn', `Closing the connection of agent ${agent?.id ?? '(not started)'}: ${error.message}`);
          socket.destroy();
        },
      },
    );
  }

  private onMessage(socket: Duplex, agent: HostedAgent, message: ServerMessage) {
    const { process: child, cwd } = agent;
    if (!child || !cwd) {
      return;
    }

    switch (message.type) {
      case 'acp': {
        agent.lastActivity = Date.now();
        if (child.isAlive() && !child.stdin.write(JSON.stringify(message.message) + '\n')) {
          socket.pause();
          child.stdin.once('drain', () => socket.resume());
        }
        break;
      }

      case 'list': {
        listAgentFiles(cwd)
          .then((names) => sendMessage(socket, { type: 'result', requestId: message.requestId, names }))
          .catch((error: Error) =>
            sendMessage(socket, { type: 'result', requestId: message.requestId, error: error.message }),
          );
        break;
      }

      case 'read': {
        readAgentFile(cwd, message.name, AGENT_HOST_MAX_FILE_BYTES)
          .then((data) =>
            sendMessage(socket, { type: 'result', requestId: message.requestId, data: data.toString('base64') }),
          )
          .catch((error: Error) =>
            sendMessage(socket, { type: 'result', requestId: message.requestId, error: error.message }),
          );
        break;
      }

      case 'kill': {
        void child.kill();
        break;
      }

      case 'start': {
        sendMessage(socket, { type: 'error', message: 'The agent was started already' });
        break;
      }

      case 'pong': {
        break;
      }
    }
  }

  private async start(socket: Duplex, message: Extract<ServerMessage, { type: 'start' }>): Promise<HostedAgent> {
    const { id, workdir, profile } = message;
    if (!isSafeId(id) || !isSafeId(workdir)) {
      throw new Error('Invalid agent or working directory id');
    }
    if (!isLaunch(profile)) {
      throw new Error('Invalid agent profile');
    }

    const { allowedCommands, maxAgents, env, log, mcpStdioBridge } = this.options;
    if (allowedCommands.length > 0 && !allowedCommands.includes(profile.command)) {
      throw new Error(
        `The agent host doesn't run "${profile.command}" (allowed: ${allowedCommands.join(', ')}; see AGENT_HOST_COMMANDS)`,
      );
    }
    if (this.agents.has(id)) {
      throw new Error(`Agent ${id} is running already`);
    }
    if (this.agents.size >= maxAgents) {
      throw new Error(`The agent host is running ${maxAgents} agents already (see AGENT_HOST_MAX_AGENTS)`);
    }

    const files: AgentFile[] = [];
    let size = 0;
    for (const file of Array.isArray(message.files) ? message.files : []) {
      if (!isSafeFileName(file?.name) || typeof file.data !== 'string') {
        throw new Error('Invalid file');
      }
      const data = Buffer.from(file.data, 'base64');
      size += data.length;
      if (size > AGENT_HOST_MAX_FILE_BYTES) {
        throw new Error('The files of the agent are too large');
      }
      files.push({ name: file.name, data });
    }

    const agent: HostedAgent = { id, name: profile.name, lastActivity: Date.now() };
    // reserved before the first await, so that the limit holds for agents starting at the same time
    this.agents.set(id, agent);

    let release: (() => Promise<void>) | undefined;
    try {
      const dir = await this.workdirs.create(workdir, files);
      release = dir.release;
      if (socket.destroyed) {
        throw new Error('The server closed the connection');
      }

      const child = spawnAgent({
        command: profile.command,
        args: profile.args,
        cwd: dir.path,
        env: buildAgentEnv(profile, env),
      });
      agent.process = child;
      agent.cwd = dir.path;

      readLines(
        child.stdout,
        (line) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            // not a JSON-RPC message; ACP agents only write messages to stdout
            return;
          }
          agent.lastActivity = Date.now();
          if (!sendMessage(socket, { type: 'acp', message: parsed }) && !socket.destroyed) {
            child.stdout.pause();
            socket.once('drain', () => child.stdout.resume());
          }
        },
        {
          maxBytes: AGENT_HOST_MAX_MESSAGE_BYTES,
          onError: (error) => {
            log('warn', `Stopping agent ${id}: ${error.message}`);
            void child.kill();
          },
        },
      );

      agent.finished = child.exited.then(async (info) => {
        log('log', `Agent ${id} (${profile.name}, pid ${child.pid}) exited (${info.signal ?? info.code})`);
        this.agents.delete(id);
        await release?.().catch(() => {});
        sendMessage(socket, { type: 'exit', ...info });
        socket.end();
      });

      log('log', `Started agent ${id} (${profile.name}, pid ${child.pid}) in ${dir.path}`);
      sendMessage(socket, { type: 'ready', pid: child.pid, cwd: dir.path, mcpStdioBridge });
      return agent;
    } catch (error) {
      if (!agent.process) {
        this.agents.delete(id);
        await release?.().catch(() => {});
      }
      throw error;
    }
  }
}
