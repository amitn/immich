#!/usr/bin/env node
/**
 * The agent host of the AI assistant: runs the ACP agents (Claude Code, Codex) for the server in their own container
 * (gallery-agents), and relays their Agent Client Protocol messages to the server over the network. See
 * src/utils/agent/host.ts.
 *
 * Environment:
 *   AGENT_HOST_SECRET        the secret shared with the server (required, at least 32 characters)
 *   AGENT_HOST_PORT          the port to listen on (default 2285)
 *   AGENT_HOST_MAX_AGENTS    the most agents running at once (default 8)
 *   AGENT_HOST_IDLE_MINUTES  stop an agent after this many minutes without messages (default 60)
 *   AGENT_HOST_COMMANDS      the commands agents may be started with, comma-separated (default: any)
 *
 * `agent-host --health` checks that the agent host of this container answers, for the container health check.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_HOST_DEFAULT_PORT } from 'src/utils/agent/host-protocol.js';
import { AgentHost } from 'src/utils/agent/host.js';

const readInt = (name: string, fallback: number) => {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    console.error(`${name} must be a positive number`);
    process.exit(1);
  }
  return parsed;
};

const port = readInt('AGENT_HOST_PORT', AGENT_HOST_DEFAULT_PORT);

const health = async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
    process.exit(response.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
};

const main = async () => {
  const secret = process.env.AGENT_HOST_SECRET ?? '';
  // agents get a scrubbed environment anyway; this keeps the secret out of anything else the host starts
  delete process.env.AGENT_HOST_SECRET;

  const host = new AgentHost({
    secret,
    workRoot: join(tmpdir(), 'gallery-agents'),
    maxAgents: readInt('AGENT_HOST_MAX_AGENTS', 8),
    idleTimeoutMs: readInt('AGENT_HOST_IDLE_MINUTES', 60) * 60_000,
    allowedCommands: (process.env.AGENT_HOST_COMMANDS ?? '')
      .split(',')
      .map((command) => command.trim())
      .filter(Boolean),
    // next to this file, in the image and in the server's dist folder
    mcpStdioBridge: {
      command: process.execPath,
      args: [fileURLToPath(new URL('agent-mcp-stdio.js', import.meta.url))],
    },
  });

  const listening = await host.listen(port);
  console.log(`Agent host listening on port ${listening}`);

  const stop = (signal: string) => {
    console.log(`${signal}: stopping the agents`);
    void host.close().then(() => process.exit(0));
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
};

if (process.argv.includes('--health')) {
  void health();
} else {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
}
