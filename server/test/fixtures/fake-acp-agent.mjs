#!/usr/bin/env node
// A scripted ACP agent for tests, built on the SDK's agent side. No LLM involved.
//
// On each prompt it:
//   1. streams two text chunks
//   2. asks for permission to run `Bash` and reports the outcome as text (`bash:<optionId>`)
//   3. if the prompt has a `call:{"name": ..., "arguments": ...}` line: reports a `mcp__immich__<name>` tool call,
//      asks for permission, calls the tool on the `immich` MCP server (http) and reports the result
//   4. ends the turn with a final text chunk
// A prompt containing `@env` makes it report the names of its environment variables (`env:A,B,C`).
// A prompt containing `@wait` makes it wait for `session/cancel` before ending the turn.
import * as acp from '@agentclientprotocol/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';

const sessions = new Map();

const text = (client, sessionId, value) =>
  client.notify(acp.methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } },
  });

const callTool = async (session, name, args) => {
  const server = session.mcpServers.find((server) => server.name === 'immich');
  if (!server || server.type !== 'http') {
    throw new Error('No immich MCP server');
  }

  const client = new Client({ name: 'fake-acp-agent', version: '1.0.0' });
  const headers = Object.fromEntries(server.headers.map(({ name, value }) => [name, value]));
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
  try {
    const { tools } = await client.listTools();
    if (!tools.some((tool) => tool.name === name)) {
      throw new Error(`Unknown tool ${name}`);
    }
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
};

const prompt = async ({ params, client }) => {
  const session = sessions.get(params.sessionId);
  const { sessionId } = params;
  const input = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
  session.cancelled = false;

  await text(client, sessionId, 'Hello');
  await text(client, sessionId, ' world');

  if (/@env\b/.test(input)) {
    await text(client, sessionId, `\nenv:${Object.keys(process.env).toSorted().join(',')}`);
  }

  const bash = await client.request(acp.methods.client.session.requestPermission, {
    sessionId,
    toolCall: {
      toolCallId: 'call_bash',
      title: 'rm -rf /',
      name: 'Bash',
      kind: 'execute',
      rawInput: { command: 'ls' },
    },
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  });
  await text(client, sessionId, `\nbash:${bash.outcome.outcome === 'selected' ? bash.outcome.optionId : 'cancelled'}`);

  const call = input
    .split('\n')
    .find((line) => line.startsWith('call:'))
    ?.slice('call:'.length);
  if (call) {
    const { name, arguments: args } = JSON.parse(call);
    const toolCallId = `call_${randomUUID()}`;
    const title = `mcp__immich__${name}`;
    await client.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId,
        title,
        name: title,
        kind: 'other',
        status: 'pending',
        rawInput: args,
      },
    });

    const permission = await client.request(acp.methods.client.session.requestPermission, {
      sessionId,
      toolCall: { toolCallId, title, name: title, rawInput: args },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });

    if (permission.outcome.outcome === 'selected' && permission.outcome.optionId === 'allow') {
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' },
      });
      const result = await callTool(session, name, args);
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: result.isError ? 'failed' : 'completed',
          content: result.content
            .filter((item) => item.type === 'text')
            .map((item) => ({ type: 'content', content: { type: 'text', text: item.text } })),
        },
      });
    }
  }

  if (/@wait\b/.test(input)) {
    await new Promise((resolve) => {
      session.onCancel = resolve;
    });
  }

  if (session.cancelled) {
    return { stopReason: 'cancelled' };
  }

  await text(client, sessionId, '\nDone');
  return { stopReason: 'end_turn' };
};

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

acp
  .agent({ name: 'fake-acp-agent' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false, mcpCapabilities: { http: true } },
    agentInfo: { name: 'fake-acp-agent', version: '1.0.0' },
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    const sessionId = randomUUID();
    sessions.set(sessionId, { mcpServers: params.mcpServers, cwd: params.cwd, cancelled: false });
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.prompt, (ctx) => prompt(ctx))
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
    const session = sessions.get(params.sessionId);
    if (session) {
      session.cancelled = true;
      session.onCancel?.();
    }
  })
  .connect(stream);
