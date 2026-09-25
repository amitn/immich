import * as acp from '@agentclientprotocol/sdk';
import { Injectable } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { serverVersion } from 'src/constants.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { AgentProfile } from 'src/utils/agent/config.js';

export type AcpSessionNotification = acp.SessionNotification;
export type AcpSessionUpdate = acp.SessionUpdate;
export type AcpPermissionRequest = acp.RequestPermissionRequest;
export type AcpPermissionResponse = acp.RequestPermissionResponse;
export type AcpContentBlock = acp.ContentBlock;
export type AcpMcpServer = acp.McpServer;
export type AcpInitializeResponse = acp.InitializeResponse;
export type AcpPromptResponse = acp.PromptResponse;
export type AcpToolCallUpdate = acp.ToolCallUpdate;

/** Environment variables every agent process gets from the server environment, when set. */
const BASE_ENV = ['PATH', 'HOME', 'LANG', 'TZ'];
/** Never forwarded through `passEnv`, even when configured */
const BLOCKED_ENV = /^(DB_|REDIS_|IMMICH_|TYPESENSE_|MACHINE_LEARNING_)/;
const STDERR_LIMIT = 16 * 1024;
const KILL_GRACE_MS = 5000;
const INITIALIZE_TIMEOUT_MS = 60_000;

export type AcpExitInfo = { code: number | null; signal: NodeJS.Signals | null; stderr: string };

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
  /** working directory of the process, see `createWorkdir` */
  cwd: string;
  handlers: AcpClientHandlers;
};

export type AcpSessionOptions = {
  cwd: string;
  mcpServers: AcpMcpServer[];
  _meta?: Record<string, unknown>;
};

/** A running ACP agent process with an initialized connection. */
export interface AcpAgent {
  readonly pid: number | undefined;
  readonly cwd: string;
  readonly initialize: AcpInitializeResponse;
  newSession(options: AcpSessionOptions): Promise<{ sessionId: string }>;
  loadSession(sessionId: string, options: AcpSessionOptions): Promise<void>;
  /** runs one prompt turn; resolves when the turn ends */
  prompt(sessionId: string, prompt: AcpContentBlock[]): Promise<AcpPromptResponse>;
  cancel(sessionId: string): Promise<void>;
  /** SIGTERM (to the process group), then SIGKILL after a grace period; resolves when the process is gone */
  kill(): Promise<void>;
  isAlive(): boolean;
}

export type McpTokenContext = { userId: string; sessionId: string | null };

/** The stdio <-> HTTP MCP bridge, for agents without MCP over HTTP support */
export const MCP_STDIO_BRIDGE = fileURLToPath(new URL('../bin/agent-mcp-stdio.js', import.meta.url));

/** The `mcpServers` entry that connects an agent to the Immich MCP endpoint. */
export const buildMcpServers = (
  initialize: AcpInitializeResponse,
  { name, url, token }: { name: string; url: string; token: string },
): AcpMcpServer[] => {
  if (initialize.agentCapabilities?.mcpCapabilities?.http) {
    return [{ type: 'http', name, url, headers: [{ name: 'Authorization', value: `Bearer ${token}` }] }];
  }

  return [
    {
      name,
      command: process.execPath,
      args: [MCP_STDIO_BRIDGE],
      env: [
        { name: 'IMMICH_MCP_URL', value: url },
        { name: 'IMMICH_MCP_TOKEN', value: token },
      ],
    },
  ];
};

/** PATH, HOME, LANG and TZ, the variables named in `passEnv`, and `env`. Nothing else from the server. */
export const buildAgentEnv = (profile: AgentProfile, source: NodeJS.ProcessEnv = process.env) => {
  const env: Record<string, string> = {};
  for (const name of [...BASE_ENV, ...profile.passEnv.filter((name) => !BLOCKED_ENV.test(name))]) {
    const value = source[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }

  for (const { name, value } of profile.env) {
    env[name] = value;
  }

  return env;
};

/**
 * Starts ACP (Agent Client Protocol) agent processes and manages their connections.
 *
 * The API is generic: a caller picks the profile, prepares a working directory (optionally with input files), runs
 * prompt turns and reads results back from the directory. Agent processes get a scrubbed environment and no fs or
 * terminal client capabilities.
 */
@Injectable()
export class AcpRepository {
  private mcpTokens = new Map<string, McpTokenContext>();

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

  getWorkdir(id: string) {
    return join(tmpdir(), 'immich-agent', id);
  }

  /** Creates an empty working directory, removing anything left over from before */
  async createWorkdir(id: string) {
    const dir = this.getWorkdir(id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  async removeWorkdir(dir: string) {
    await rm(dir, { recursive: true, force: true });
  }

  async start({ profile, cwd, handlers }: AcpStartOptions): Promise<AcpAgent> {
    const child = spawn(profile.command, profile.args, {
      cwd,
      env: buildAgentEnv(profile),
      stdio: ['pipe', 'pipe', 'pipe'],
      // own process group, so the whole tree (adapter + CLI) can be killed
      detached: true,
    });

    // a dead process surfaces as an exit and a closed connection
    child.stdin.on('error', () => {});

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_LIMIT);
    });

    const exited = new Promise<AcpExitInfo>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal, stderr }));
      child.once('error', (error) => resolve({ code: null, signal: null, stderr: `${stderr}\n${error.message}` }));
    });

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );

    const connection = acp
      .client({ name: 'immich' })
      .onNotification(acp.methods.client.session.update, ({ params }) => handlers.onUpdate(params))
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => handlers.onPermission(params))
      .connect(stream);

    void exited.then((info) => {
      connection.close();
      this.logger.debug(`Agent ${profile.name} (pid ${child.pid}) exited (${info.signal ?? info.code})`);
      handlers.onExit?.(info);
    });

    const kill = () => this.kill(child, exited);

    let timeout: NodeJS.Timeout | undefined;
    try {
      const initialize = await Promise.race([
        connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'immich', title: 'Immich', version: serverVersion.toString() },
        }),
        exited.then(({ code, signal, stderr }) => {
          throw new Error(`Agent ${profile.name} exited during initialization (${signal ?? code}): ${stderr.trim()}`);
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Agent ${profile.name} did not initialize in time`)),
            INITIALIZE_TIMEOUT_MS,
          );
        }),
      ]);

      return {
        pid: child.pid,
        cwd,
        initialize,
        isAlive: () => child.exitCode === null && child.signalCode === null,
        kill,
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
      await kill();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async kill(child: ChildProcess, exited: Promise<AcpExitInfo>) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    const signal = (name: NodeJS.Signals) => {
      try {
        // negative pid: the whole process group
        process.kill(-child.pid!, name);
      } catch {
        child.kill(name);
      }
    };

    signal('SIGTERM');
    const timeout = setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS);
    await exited;
    clearTimeout(timeout);
  }
}
