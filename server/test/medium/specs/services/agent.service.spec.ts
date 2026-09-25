// eslint-disable-next-line import-x/no-unresolved -- resolved through the package's wildcard export
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// eslint-disable-next-line import-x/no-unresolved
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { UnauthorizedException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import z from 'zod';
import { defaults } from 'src/dtos/config.dto.js';
import { AgentMessageKind, AgentMessageRole, AgentSessionStatus } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AcpRepository } from 'src/repositories/acp.repository.js';
import { AgentRepository } from 'src/repositories/agent.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { DB } from 'src/schema/index.js';
import { AgentToolService } from 'src/services/agent-tool.service.js';
import { AgentService } from 'src/services/agent.service.js';
import { defineTool, toolJson } from 'src/utils/agent/tools.js';
import { clearConfigCache } from 'src/utils/config.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

const fakeAgent = fileURLToPath(new URL('../../../fixtures/fake-acp-agent.mjs', import.meta.url));
const stdioBridge = fileURLToPath(new URL('../../../../src/bin/agent-mcp-stdio.ts', import.meta.url));
const albumId = '0b6f4f3e-7c3d-4d8e-9d4c-6f1f1f0e7b5a';

const testTools = [
  defineTool({
    name: 'echo_assets',
    title: 'Echo assets',
    description: 'Returns the given assets',
    input: z.object({ assetIds: z.array(z.string()) }),
    mutating: false,
    handler: ({ auth }, { assetIds }) =>
      Promise.resolve(toolJson({ userId: auth.user.id, assets: assetIds.map((id) => ({ id })) })),
  }),
  defineTool({
    name: 'make_album',
    title: 'Make album',
    description: 'Pretends to create an album',
    input: z.object({ name: z.string() }),
    mutating: true,
    handler: (_, { name }) => Promise.resolve(toolJson({ albumId, name })),
  }),
];

let defaultDatabase: Kysely<DB>;

const startMcpServer = async (sut: AgentService) => {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      sut.handleMcpRequest(req.headers.authorization, req, res, text ? JSON.parse(text) : undefined).catch((error) => {
        res.writeHead(error instanceof UnauthorizedException ? 401 : 500).end();
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/agent/mcp`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const setup = async () => {
  const { sut, ctx } = newMediumService(AgentService, {
    database: defaultDatabase,
    real: [AccessRepository, AcpRepository, AgentRepository, ConfigRepository, SystemMetadataRepository],
    mock: [LoggingRepository, WebsocketRepository],
  });

  const mcp = await startMcpServer(sut);
  await ctx.updateConfig({
    ...defaults,
    agent: {
      ...defaults.agent,
      enabled: true,
      chatProfile: 'fake',
      mcpUrl: mcp.url,
      profiles: [
        {
          name: 'fake',
          command: process.execPath,
          args: [fakeAgent],
          env: [{ name: 'FAKE_SETTING', value: '1' }],
          passEnv: ['FAKE_API_KEY', 'DB_PASSWORD'],
        },
      ],
    },
  });

  const { user } = await ctx.newUser();
  const auth = factory.auth({ user: { id: user.id } });

  const waitForIdle = (id: string) =>
    vi.waitFor(
      async () => {
        const session = await sut.getSession(auth, id);
        expect(session.status).not.toBe(AgentSessionStatus.Running);
        return session;
      },
      { timeout: 20_000, interval: 100 },
    );

  return { sut, ctx, auth, mcp, waitForIdle, websocket: ctx.getMock(WebsocketRepository) };
};

type Context = Awaited<ReturnType<typeof setup>>;
let context: Context | undefined;

type WebsocketMock = Context['websocket'];

const waitForPermission = (websocket: WebsocketMock) =>
  vi.waitFor(
    () => {
      const update = websocket.clientSend.mock.calls
        .map((args) => args[2] as { message?: { kind: string; content: { requestId?: string } } })
        .find((update) => update.message?.kind === AgentMessageKind.Permission);
      expect(update).toBeDefined();
      return update!.message!.content.requestId!;
    },
    { timeout: 20_000, interval: 50 },
  );

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
  process.env.FAKE_API_KEY = 'api-key';
  process.env.DB_PASSWORD = 'secret';
});

beforeEach(() => {
  clearConfigCache();
  vi.spyOn(AgentToolService.prototype, 'getTools').mockReturnValue(testTools);
});

afterEach(async () => {
  await context?.sut.onShutdown();
  await context?.mcp.close();
  context = undefined;
});

describe(AgentService.name, () => {
  it('should run a prompt through the agent, MCP tool and websocket', async () => {
    context = await setup();
    const { sut, auth, waitForIdle, websocket } = context;
    const assetId = factory.uuid();

    const session = await sut.createSession(auth, {});
    const call = JSON.stringify({ name: 'echo_assets', arguments: { assetIds: [assetId] } });
    await sut.prompt(auth, session.id, { text: `Find photos @env\ncall:${call}`, assetIds: [assetId] });

    const result = await waitForIdle(session.id);
    expect(result.status).toBe(AgentSessionStatus.Idle);
    expect(result.title).toBe(`Find photos @env call:${call}`.slice(0, 80) + '…');

    const [prompt, text, toolCall, done, ...rest] = result.messages;
    expect(rest).toEqual([]);
    expect(prompt).toMatchObject({
      role: AgentMessageRole.User,
      kind: AgentMessageKind.Text,
      content: { assetIds: [assetId] },
    });

    // chunks are coalesced into one message, bash was rejected, the env was scrubbed
    expect(text).toMatchObject({ role: AgentMessageRole.Agent, kind: AgentMessageKind.Text });
    const [greeting, envLine, bashLine] = text.content.text!.split('\n', 3);
    expect(greeting).toBe('Hello world');
    expect(bashLine).toBe('bash:reject');
    const env = envLine.replace('env:', '').split(',');
    expect(env).toEqual(expect.arrayContaining(['FAKE_API_KEY', 'FAKE_SETTING', 'PATH']));
    expect(
      env.filter((name) => !['FAKE_API_KEY', 'FAKE_SETTING', 'PATH', 'HOME', 'LANG', 'TZ'].includes(name)),
    ).toEqual([]);

    expect(toolCall).toMatchObject({
      kind: AgentMessageKind.ToolCall,
      content: {
        toolName: 'echo_assets',
        title: 'Echo assets',
        status: 'completed',
        input: { assetIds: [assetId] },
        assetIds: [assetId],
      },
    });
    expect(toolCall.content.output).toContain(auth.user.id);

    expect(done).toMatchObject({ kind: AgentMessageKind.Text, content: { text: '\nDone' } });

    expect(websocket.clientSend).toHaveBeenCalledWith(
      'on_agent_update',
      auth.user.id,
      expect.objectContaining({
        sessionId: session.id,
        status: AgentSessionStatus.Running,
        message: expect.objectContaining({ kind: AgentMessageKind.ToolCall }),
      }),
    );
    expect(websocket.clientSend).toHaveBeenLastCalledWith('on_agent_update', auth.user.id, {
      sessionId: session.id,
      status: AgentSessionStatus.Idle,
    });

    const row = await context.ctx.get(AgentRepository).getSession(session.id);
    expect(row?.acpSessionId).toEqual(expect.any(String));
  });

  it('should ask the user before running a mutating tool', async () => {
    context = await setup();
    const { sut, auth, waitForIdle, websocket } = context;

    const session = await sut.createSession(auth, {});
    const call = JSON.stringify({ name: 'make_album', arguments: { name: 'Italy' } });
    await sut.prompt(auth, session.id, { text: `call:${call}` });

    const requestId = await waitForPermission(websocket);

    await sut.respondToPermission(auth, session.id, requestId, { approved: true });
    const result = await waitForIdle(session.id);

    const permission = result.messages.find((message) => message.kind === AgentMessageKind.Permission);
    expect(permission?.content).toMatchObject({ toolName: 'make_album', summary: 'name: Italy', status: 'approved' });

    const toolCall = result.messages.find((message) => message.kind === AgentMessageKind.ToolCall);
    expect(toolCall?.content).toMatchObject({ toolName: 'make_album', status: 'completed', albumIds: [albumId] });
  });

  it('should return an error to the agent when the user declines', async () => {
    context = await setup();
    const { sut, auth, waitForIdle, websocket } = context;

    const session = await sut.createSession(auth, {});
    const call = JSON.stringify({ name: 'make_album', arguments: { name: 'Italy' } });
    await sut.prompt(auth, session.id, { text: `call:${call}` });

    const requestId = await waitForPermission(websocket);

    await sut.respondToPermission(auth, session.id, requestId, { optionId: 'deny' });
    const result = await waitForIdle(session.id);

    const toolCall = result.messages.find((message) => message.kind === AgentMessageKind.ToolCall);
    expect(toolCall?.content).toMatchObject({ toolName: 'make_album', status: 'failed' });
    expect(toolCall?.content.output).toContain('User declined');
  });

  it('should cancel a running turn', async () => {
    context = await setup();
    const { sut, auth, waitForIdle } = context;

    const session = await sut.createSession(auth, {});
    await sut.prompt(auth, session.id, { text: '@wait' });

    await vi.waitFor(
      async () => {
        const { messages } = await sut.getSession(auth, session.id);
        expect(messages.some((message) => message.content.text?.includes('bash:'))).toBe(true);
      },
      { timeout: 20_000, interval: 50 },
    );
    await expect(sut.prompt(auth, session.id, { text: 'again' })).rejects.toThrow('still working');

    await sut.cancel(auth, session.id);
    const result = await waitForIdle(session.id);

    expect(result.status).toBe(AgentSessionStatus.Idle);
    expect(result.messages.some((message) => message.content.text?.includes('Done'))).toBe(false);
  });

  it('should keep the agent process for the next prompt and stop it on delete', async () => {
    context = await setup();
    const { sut, auth, waitForIdle } = context;
    const acp = context.ctx.get(AcpRepository);
    const start = vi.spyOn(acp, 'start');

    const session = await sut.createSession(auth, {});
    await sut.prompt(auth, session.id, { text: 'one' });
    await waitForIdle(session.id);
    await sut.prompt(auth, session.id, { text: 'two' });
    const result = await waitForIdle(session.id);

    expect(start).toHaveBeenCalledTimes(1);
    expect(result.messages.filter((message) => message.content.text?.endsWith('Done'))).toHaveLength(2);
    expect(existsSync(acp.getWorkdir(session.id))).toBe(true);

    await sut.deleteSession(auth, session.id);
    expect(existsSync(acp.getWorkdir(session.id))).toBe(false);
    await expect(context.ctx.get(AgentRepository).getSession(session.id)).resolves.toBeUndefined();
  });

  it('should reject MCP requests without a valid token', async () => {
    context = await setup();

    const response = await fetch(context.mcp.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(401);
  });

  it('should bridge a stdio MCP client to the MCP endpoint', async () => {
    context = await setup();
    const token = context.ctx.get(AcpRepository).issueMcpToken({ userId: context.auth.user.id, sessionId: null });
    const assetId = factory.uuid();

    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [stdioBridge],
        env: { IMMICH_MCP_URL: context.mcp.url, IMMICH_MCP_TOKEN: token },
      }),
    );

    try {
      const { tools } = await client.listTools();
      expect(tools.map(({ name, annotations }) => ({ name, readOnly: annotations?.readOnlyHint }))).toEqual([
        { name: 'echo_assets', readOnly: true },
        { name: 'make_album', readOnly: false },
      ]);

      const result = await client.callTool({ name: 'echo_assets', arguments: { assetIds: [assetId] } });
      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify({ userId: context.auth.user.id, assets: [{ id: assetId }] }) },
      ]);

      // mutating tools need a session to ask the user for approval
      const denied = await client.callTool({ name: 'make_album', arguments: { name: 'Italy' } });
      expect(denied.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
