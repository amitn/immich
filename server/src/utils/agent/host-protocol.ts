import { createHash, timingSafeEqual } from 'node:crypto';
import type { Duplex, Readable } from 'node:stream';
import type { AgentLaunch } from 'src/utils/agent/process.js';

// The protocol between the server and the agent host (src/bin/agent-host.ts). Node built-ins only, like
// src/utils/agent/process.ts.
//
// The server opens one connection per agent: an HTTP request to AGENT_HOST_PATH that upgrades to AGENT_HOST_PROTOCOL,
// authenticated with the shared secret (`Authorization: Bearer <secret>`). After the upgrade, both sides send
// newline-delimited JSON messages. The first one is `start`, which names the agent (a random id per agent process)
// and its working directory; the host answers with `ready` or `error`. Then `acp` messages carry the Agent Client
// Protocol messages of the agent's stdio, unchanged. The connection ends when the agent exits (`exit`), and the host
// kills the agent when the connection ends.

export const AGENT_HOST_PATH = '/v1/agents';
export const AGENT_HOST_PROTOCOL = 'gallery-agent-host.v1';
export const AGENT_HOST_DEFAULT_PORT = 2285;
/** The shortest secret the agent host accepts */
export const AGENT_HOST_SECRET_MIN_LENGTH = 32;
/** The longest message: ACP messages carry base64 images of several MB */
export const AGENT_HOST_MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
/** The most bytes of files sent with `start`, and read with `read` */
export const AGENT_HOST_MAX_FILE_BYTES = 32 * 1024 * 1024;

export type AgentHostFile = { name: string; data: string /* base64 */ };
export type AgentHostCommand = { command: string; args: string[] };

export type ServerMessage =
  | {
      type: 'start';
      /** unique per agent process */
      id: string;
      /** names the working directory (the same one for every agent of a chat) */
      workdir: string;
      profile: AgentLaunch;
      files: AgentHostFile[];
    }
  | { type: 'acp'; message: unknown }
  | { type: 'list'; requestId: number }
  | { type: 'read'; requestId: number; name: string }
  | { type: 'kill' }
  | { type: 'pong' };

export type HostMessage =
  | {
      type: 'ready';
      pid: number | undefined;
      /** the working directory, as the agent sees it */
      cwd: string;
      /** runs src/bin/agent-mcp-stdio.ts on the host, for agents without MCP over HTTP */
      mcpStdioBridge?: AgentHostCommand;
    }
  | { type: 'acp'; message: unknown }
  | { type: 'result'; requestId: number; names?: string[]; data?: string; error?: string }
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null; stderr: string }
  | { type: 'error'; message: string }
  | { type: 'ping' };

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** Compares a presented secret with the expected one in constant time */
export const isSecretValid = (expected: string, presented: string | undefined) => {
  if (presented === undefined) {
    return false;
  }
  return timingSafeEqual(sha256(expected), sha256(presented));
};

export const getBearerToken = (authorization: string | undefined) => {
  const [scheme, token] = authorization?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
};

/** Writes one message; false when the socket is gone, or its buffer is full (wait for `drain`) */
export const sendMessage = (socket: Duplex, message: ServerMessage | HostMessage) => {
  if (socket.destroyed || !socket.writable) {
    return false;
  }
  return socket.write(JSON.stringify(message) + '\n');
};

/**
 * Calls `onLine` with every non-empty line of `stream` (newline-delimited). Fails with `onError` when a line is
 * longer than `maxBytes`.
 */
export const readLines = (
  stream: Readable | NodeJS.ReadableStream,
  onLine: (line: string) => void,
  { maxBytes, onError }: { maxBytes: number; onError: (error: Error) => void },
) => {
  let chunks: Buffer[] = [];
  let length = 0;
  let failed = false;

  stream.on('data', (chunk: Buffer | string) => {
    if (failed) {
      return;
    }

    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    let start = 0;
    let index = buffer.indexOf(10, start);
    while (index !== -1) {
      const part = buffer.subarray(start, index);
      if (length + part.length > maxBytes) {
        failed = true;
        chunks = [];
        onError(new Error(`Message larger than ${maxBytes} bytes`));
        return;
      }
      const line = chunks.length > 0 ? Buffer.concat([...chunks, part]).toString() : part.toString();
      chunks = [];
      length = 0;
      start = index + 1;
      if (line.trim()) {
        onLine(line);
      }
      index = buffer.indexOf(10, start);
    }

    if (start < buffer.length) {
      const rest = buffer.subarray(start);
      length += rest.length;
      if (length > maxBytes) {
        failed = true;
        chunks = [];
        onError(new Error(`Message larger than ${maxBytes} bytes`));
        return;
      }
      chunks.push(rest);
    }
  });
};

/** Parses a message line: an object with a string `type`, or undefined */
export const parseMessage = <T extends { type: string }>(line: string): T | undefined => {
  try {
    const value = JSON.parse(line) as unknown;
    if (value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string') {
      return value as T;
    }
  } catch {
    // ignored
  }
  return undefined;
};
