import * as acp from '@agentclientprotocol/sdk';
import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { serverVersion } from 'src/constants.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { AgentProfile } from 'src/utils/agent/config.js';
import { AgentHostTarget, startRemoteAgent } from 'src/utils/agent/host-client.js';
import { AgentHostCommand } from 'src/utils/agent/host-protocol.js';
import {
  AgentExitInfo,
  AgentFile,
  AgentWorkdirs,
  buildAgentEnv,
  listAgentFiles,
  readAgentFile,
  spawnAgent,
} from 'src/utils/agent/process.js';

export type AcpSessionNotification = acp.SessionNotification;
export type AcpSessionUpdate = acp.SessionUpdate;
export type AcpPermissionRequest = acp.RequestPermissionRequest;
export type AcpPermissionResponse = acp.RequestPermissionResponse;
export type AcpContentBlock = acp.ContentBlock;
export type AcpMcpServer = acp.McpServer;
export type AcpInitializeResponse = acp.InitializeResponse;
export type AcpPromptResponse = acp.PromptResponse;
export type AcpToolCallUpdate = acp.ToolCallUpdate;
export type AcpExitInfo = AgentExitInfo;
export type AcpFile = AgentFile;

const INITIALIZE_TIMEOUT_MS = 60_000;
/** The largest file read back from a working directory */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

export type AcpClientHandlers = {
  /** `session/update` notifications, in the order they are received */
  onUpdate: (notification: AcpSessionNotification) => void | Promise<void>;
  /** `session/request_permission` requests */
  onPermission: (request: AcpPermissionRequest) => Promise<AcpPermissionResponse>;
  /** the process exited, including after `kill()` */
  onExit?: (info: AcpExitInfo) => void;
};

export type AcpStartOptions = {
  profile: AgentProfile;
  /**
   * Names the working directory of the agent. The same id gives the same path, so agents that key stored sessions by
   * their working directory can load them again. The directory is created empty (with `files`), and removed when the
   * agent stops, unless a newer agent got the same one.
   */
  workdir: string;
  /** files put into the working directory before the agent starts */
  files?: AcpFile[];
  handlers: AcpClientHandlers;
};

export type AcpSessionOptions = {
  cwd: string;
  mcpServers: AcpMcpServer[];
  _meta?: Record<string, unknown>;
};

/** A running ACP agent process with an initialized connection, on this server or on the agent host. */
export interface AcpAgent {
  readonly pid: number | undefined;
  /** the working directory, as the agent sees it */
  readonly cwd: string;
  /** whether the agent runs on the agent host (see `getAgentHost`) */
  readonly remote: boolean;
  /** runs the MCP stdio bridge where the agent runs */
  readonly mcpStdioBridge: AgentHostCommand | undefined;
  readonly initialize: AcpInitializeResponse;
  newSession(options: AcpSessionOptions): Promise<{ sessionId: string }>;
  loadSession(sessionId: string, options: AcpSessionOptions): Promise<void>;
  /** runs one prompt turn; resolves when the turn ends */
  prompt(sessionId: string, prompt: AcpContentBlock[]): Promise<AcpPromptResponse>;
  cancel(sessionId: string): Promise<void>;
  /** the names of the files in the working directory */
  listFiles(): Promise<string[]>;
  /** a file of the working directory (symbolic links are not followed) */
  readFile(name: string): Promise<Buffer>;
  /** SIGTERM (to the process group), then SIGKILL after a grace period; resolves when the process is gone */
  kill(): Promise<void>;
  isAlive(): boolean;
}

export type McpTokenContext = { userId: string; sessionId: string | null };

/** The stdio <-> HTTP MCP bridge, for agents without MCP over HTTP support */
export const MCP_STDIO_BRIDGE = fileURLToPath(new URL('../bin/agent-mcp-stdio.js', import.meta.url));
const LOCAL_MCP_STDIO_BRIDGE: AgentHostCommand = { command: process.execPath, args: [MCP_STDIO_BRIDGE] };

/** The `mcpServers` entry that connects an agent to the Immich MCP endpoint. */
export const buildMcpServers = (
  { initialize, mcpStdioBridge }: Pick<AcpAgent, 'initialize' | 'mcpStdioBridge'>,
  { name, url, token }: { name: string; url: string; token: string },
): AcpMcpServer[] => {
  if (initialize.agentCapabilities?.mcpCapabilities?.http) {
    return [{ type: 'http', name, url, headers: [{ name: 'Authorization', value: `Bearer ${token}` }] }];
  }

  if (!mcpStdioBridge) {
    throw new Error('The agent only supports MCP over stdio, and its agent host has no MCP bridge');
  }

  return [
    {
      name,
      command: mcpStdioBridge.command,
      args: mcpStdioBridge.args,
      env: [
        { name: 'IMMICH_MCP_URL', value: url },
        { name: 'IMMICH_MCP_TOKEN', value: token },
      ],
    },
  ];
};

/**
 * Where a profile's agent runs: on the agent host of AGENT_HOST_URL (the gallery-agents container), or undefined for
 * a process of the server. `host: auto` (or none) uses the agent host when AGENT_HOST_URL is set.
 */
export const getAgentHost = (
  profile: AgentProfile,
  env: NodeJS.ProcessEnv = process.env,
): AgentHostTarget | undefined => {
  const host = profile.host ?? 'auto';
  const url = env.AGENT_HOST_URL;
  if (host === 'local' || (host === 'auto' && !url)) {
    return;
  }
  if (!url) {
    throw new Error(`The agent ${profile.name} runs on the agent host, but AGENT_HOST_URL is not set`);
  }
  const secret = env.AGENT_HOST_SECRET;
  if (!secret) {
    throw new Error('AGENT_HOST_URL is set, but AGENT_HOST_SECRET is not');
  }
  return { url, secret };
};

type AgentChannel = Pick<
  AcpAgent,
  'pid' | 'cwd' | 'remote' | 'mcpStdioBridge' | 'isAlive' | 'kill' | 'listFiles' | 'readFile'
> & {
  stream: acp.Stream;
  exited: Promise<AcpExitInfo>;
};

/**
 * Starts ACP (Agent Client Protocol) agent processes and manages their connections: as processes of the server, or on
 * the agent host (see `getAgentHost`), which runs them in their own container.
 *
 * The API is generic: a caller picks the profile, names the working directory (optionally with input files), runs
 * prompt turns and reads results back from the directory. Agent processes get a scrubbed environment and no fs or
 * terminal client capabilities.
 */
@Injectable()
export class AcpRepository {
  private mcpTokens = new Map<string, McpTokenContext>();
  private workdirs = new AgentWorkdirs(join(tmpdir(), 'immich-agent'));

  constructor(private logger: LoggingRepository) {
    this.logger.setContext(AcpRepository.name);
  }

  /**
   * Issues a bearer token for the Immich MCP endpoint (`/api/agent/mcp`); tool calls made with it run as `userId`.
   * Tokens only live in memory. Revoke them when the agent process stops.
   */
  issueMcpToken(context: McpTokenContext) {
    const token = randomBytes(32).toString('base64url');
    this.mcpTokens.set(token, context);
    return token;
  }

  getMcpToken(token: string): McpTokenContext | undefined {
    return this.mcpTokens.get(token);
  }

  revokeMcpToken(token: string) {
    this.mcpTokens.delete(token);
  }

  /** The working directory `id` of an agent of this server */
  getWorkdir(id: string) {
    return this.workdirs.getPath(id);
  }

  /** The MCP URL for an agent, when `agent.mcpUrl` is empty */
  getDefaultMcpUrl(agent: Pick<AcpAgent, 'remote'>, port: number) {
    if (!agent.remote) {
      return `http://127.0.0.1:${port}/api/agent/mcp`;
    }
    const url = process.env.AGENT_MCP_URL;
    if (!url) {
      throw new Error(
        'The agent runs on the agent host: set the MCP URL in the assistant settings (or AGENT_MCP_URL) to the address the agent host reaches the server at',
      );
    }
    return url;
  }

  private async open({ profile, workdir, files = [] }: AcpStartOptions): Promise<AgentChannel> {
    const target = getAgentHost(profile);
    if (target) {
      const remote = await startRemoteAgent(target, { id: randomUUID(), workdir, profile, files });
      return {
        pid: remote.pid,
        cwd: remote.cwd,
        remote: true,
        mcpStdioBridge: remote.mcpStdioBridge,
        stream: {
          readable: remote.readable as acp.Stream['readable'],
          writable: remote.writable as acp.Stream['writable'],
        },
        exited: remote.exited,
        isAlive: () => remote.isAlive(),
        kill: () => remote.kill(),
        listFiles: () => remote.listFiles(),
        readFile: (name) => remote.readFile(name),
      };
    }

    const dir = await this.workdirs.create(workdir, files);
    const child = spawnAgent({
      command: profile.command,
      args: profile.args,
      cwd: dir.path,
      env: buildAgentEnv(profile, process.env),
    });
    const exited = child.exited.then(async (info) => {
      await dir.release().catch(() => {});
      return info;
    });

    return {
      pid: child.pid,
      cwd: dir.path,
      remote: false,
      mcpStdioBridge: LOCAL_MCP_STDIO_BRIDGE,
      stream: acp.ndJsonStream(
        Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>,
      ),
      exited,
      isAlive: () => child.isAlive(),
      kill: async () => {
        await child.kill();
        await exited;
      },
      listFiles: () => listAgentFiles(dir.path),
      readFile: (name) => readAgentFile(dir.path, name, MAX_FILE_BYTES),
    };
  }

  async start(options: AcpStartOptions): Promise<AcpAgent> {
    const { profile, handlers } = options;
    const channel = await this.open(options);
    const where = channel.remote ? 'on the agent host' : '';

    const connection = acp
      .client({ name: 'immich' })
      .onNotification(acp.methods.client.session.update, ({ params }) => handlers.onUpdate(params))
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => handlers.onPermission(params))
      .connect(channel.stream);

    // before the exit handler below closes the connection: an agent that exits fails initialization with its stderr
    const exitedEarly = channel.exited.then(({ code, signal, stderr }) => {
      throw new Error(`Agent ${profile.name} exited during initialization (${signal ?? code}): ${stderr.trim()}`);
    });

    void channel.exited.then((info) => {
      connection.close();
      this.logger.debug(`Agent ${profile.name} (pid ${channel.pid}${where}) exited (${info.signal ?? info.code})`);
      handlers.onExit?.(info);
    });

    let timeout: NodeJS.Timeout | undefined;
    try {
      const initialize = await Promise.race([
        connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'immich', title: 'Immich', version: serverVersion.toString() },
        }),
        exitedEarly,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Agent ${profile.name} did not initialize in time`)),
            INITIALIZE_TIMEOUT_MS,
          );
        }),
      ]);

      return {
        pid: channel.pid,
        cwd: channel.cwd,
        remote: channel.remote,
        mcpStdioBridge: channel.mcpStdioBridge,
        initialize,
        isAlive: channel.isAlive,
        kill: channel.kill,
        listFiles: channel.listFiles,
        readFile: channel.readFile,
        newSession: ({ cwd, mcpServers, _meta }) =>
          connection.agent.request(acp.methods.agent.session.new, { cwd, mcpServers, _meta }),
        loadSession: async (sessionId, { cwd, mcpServers, _meta }) => {
          await connection.agent.request(acp.methods.agent.session.load, { sessionId, cwd, mcpServers, _meta });
        },
        prompt: (sessionId, prompt) =>
          connection.agent.request(acp.methods.agent.session.prompt, { sessionId, prompt }),
        cancel: (sessionId) => connection.agent.notify(acp.methods.agent.session.cancel, { sessionId }),
      };
    } catch (error) {
      await channel.kill();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
