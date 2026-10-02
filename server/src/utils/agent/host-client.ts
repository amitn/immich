import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import {
  AGENT_HOST_MAX_MESSAGE_BYTES,
  AGENT_HOST_PATH,
  AGENT_HOST_PROTOCOL,
  AgentHostCommand,
  HostMessage,
  parseMessage,
  readLines,
  sendMessage,
} from 'src/utils/agent/host-protocol.js';
import { AgentExitInfo, AgentFile, AgentLaunch, KILL_GRACE_MS } from 'src/utils/agent/process.js';

// The server side of the agent host protocol (see src/utils/agent/host-protocol.ts): starts an agent on the agent
// host and relays its ACP messages.

export type AgentHostTarget = { url: string; secret: string };

export type RemoteAgentOptions = {
  /** unique per agent process */
  id: string;
  /** names the working directory */
  workdir: string;
  profile: AgentLaunch;
  files?: AgentFile[];
  /** the time to connect and start the agent */
  timeoutMs?: number;
};

/** An agent process on the agent host */
export type RemoteAgent = {
  readonly pid: number | undefined;
  /** the working directory, as the agent sees it */
  readonly cwd: string;
  readonly mcpStdioBridge: AgentHostCommand | undefined;
  /** the ACP messages the agent writes */
  readonly readable: ReadableStream<unknown>;
  /** the ACP messages for the agent */
  readonly writable: WritableStream<unknown>;
  readonly exited: Promise<AgentExitInfo>;
  isAlive(): boolean;
  kill(): Promise<void>;
  listFiles(): Promise<string[]>;
  readFile(name: string): Promise<Buffer>;
};

const connect = (target: AgentHostTarget, timeoutMs: number) => {
  let url: URL;
  try {
    url = new URL(AGENT_HOST_PATH, target.url);
  } catch {
    throw new Error(`Invalid agent host URL: ${target.url}`);
  }

  const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
    headers: {
      Connection: 'Upgrade',
      Upgrade: AGENT_HOST_PROTOCOL,
      Authorization: `Bearer ${target.secret}`,
    },
  });

  return new Promise<Duplex>((resolve, reject) => {
    const timer = setTimeout(() => request.destroy(new Error('timed out')), timeoutMs);
    request.on('upgrade', (_, socket, head) => {
      clearTimeout(timer);
      if (head.length > 0) {
        socket.unshift(head);
      }
      resolve(socket);
    });
    request.on('response', (response) => {
      clearTimeout(timer);
      response.resume();
      reject(
        new Error(
          response.statusCode === 401
            ? 'The agent host rejected the secret; check AGENT_HOST_SECRET on the server and the agent host'
            : `The agent host at ${target.url} answered ${response.statusCode}`,
        ),
      );
    });
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Unable to reach the agent host at ${target.url}: ${error.message}`));
    });
    request.end();
  });
};

/** Starts an agent on the agent host; resolves once the agent process runs */
export const startRemoteAgent = async (
  target: AgentHostTarget,
  { id, workdir, profile, files = [], timeoutMs = 30_000 }: RemoteAgentOptions,
): Promise<RemoteAgent> => {
  const socket = await connect(target, timeoutMs);
  socket.on('error', () => {});
  if (socket instanceof Socket) {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15_000);
  }

  let controller!: ReadableStreamDefaultController<unknown>;
  const readable = new ReadableStream<unknown>({
    start: (value) => {
      controller = value;
    },
  });

  let done = false;
  let lastError: string | undefined;
  const { promise: exited, resolve: resolveExit } = Promise.withResolvers<AgentExitInfo>();
  const {
    promise: ready,
    resolve: onReady,
    reject: onFailed,
  } = Promise.withResolvers<Extract<HostMessage, { type: 'ready' }>>();
  // settles after a timeout too
  ready.catch(() => {});

  let nextRequestId = 1;
  const pending = new Map<number, { resolve: (message: HostMessage) => void; reject: (error: Error) => void }>();

  const finish = (info: AgentExitInfo) => {
    if (done) {
      return;
    }
    done = true;
    // the exit first: requests that fail because the connection closes should fail with it (see AcpRepository.start)
    resolveExit(info);
    onFailed(new Error(info.stderr.trim() || `The agent host stopped the agent ${profile.name}`));
    const error = new Error(`The agent ${profile.name} is not running`);
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
    try {
      controller.close();
    } catch {
      // already closed
    }
    socket.destroy();
  };

  readLines(
    socket,
    (line) => {
      const message = parseMessage<HostMessage>(line);
      switch (message?.type) {
        case 'ready': {
          onReady(message);
          break;
        }
        case 'acp': {
          if (!done) {
            controller.enqueue(message.message);
          }
          break;
        }
        case 'result': {
          pending.get(message.requestId)?.resolve(message);
          pending.delete(message.requestId);
          break;
        }
        case 'exit': {
          finish({ code: message.code, signal: message.signal, stderr: message.stderr });
          break;
        }
        case 'error': {
          lastError = message.message;
          onFailed(new Error(message.message));
          break;
        }
        case 'ping': {
          sendMessage(socket, { type: 'pong' });
          break;
        }
        case undefined: {
          // not a message
          break;
        }
      }
    },
    { maxBytes: AGENT_HOST_MAX_MESSAGE_BYTES, onError: (error) => socket.destroy(error) },
  );

  socket.on('close', () =>
    finish({ code: null, signal: null, stderr: lastError ?? 'The connection to the agent host was closed' }),
  );

  const writable = new WritableStream<unknown>({
    write: (message) => {
      if (done || sendMessage(socket, { type: 'acp', message })) {
        return;
      }
      return new Promise<void>((resolve) => {
        const resume = () => {
          socket.off('drain', resume);
          socket.off('close', resume);
          resolve();
        };
        socket.on('drain', resume);
        socket.on('close', resume);
      });
    },
  });

  const call = async (message: { type: 'list' } | { type: 'read'; name: string }) => {
    if (done) {
      throw new Error(`The agent ${profile.name} is not running`);
    }
    const requestId = nextRequestId++;
    const result = new Promise<HostMessage>((resolve, reject) => pending.set(requestId, { resolve, reject }));
    sendMessage(socket, { ...message, requestId });
    const response = (await result) as Extract<HostMessage, { type: 'result' }>;
    if (response.error) {
      throw new Error(response.error);
    }
    return response;
  };

  const kill = async () => {
    if (done) {
      await exited;
      return;
    }
    sendMessage(socket, { type: 'kill' });
    // the host kills the agent when the connection ends, too
    const timer = setTimeout(() => socket.destroy(), KILL_GRACE_MS + 5000);
    await exited;
    clearTimeout(timer);
  };

  sendMessage(socket, {
    type: 'start',
    id,
    workdir,
    profile: {
      name: profile.name,
      command: profile.command,
      args: profile.args,
      env: profile.env,
      passEnv: profile.passEnv,
    },
    files: files.map(({ name, data }) => ({ name, data: data.toString('base64') })),
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    const { pid, cwd, mcpStdioBridge } = await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`The agent host did not start ${profile.name} in time`)), timeoutMs);
      }),
    ]);

    return {
      pid,
      cwd,
      mcpStdioBridge,
      readable,
      writable,
      exited,
      isAlive: () => !done,
      kill,
      listFiles: async () => {
        const { names } = await call({ type: 'list' });
        return names ?? [];
      },
      readFile: async (name) => {
        const { data } = await call({ type: 'read', name });
        return Buffer.from(data ?? '', 'base64');
      },
    };
  } catch (error) {
    socket.destroy();
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
