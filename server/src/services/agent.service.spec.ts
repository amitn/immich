import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import z from 'zod';
import { defaults } from 'src/dtos/config.dto.js';
import { AgentMessageKind, AgentMessageRole, AgentSessionStatus } from 'src/enum.js';
import {
  AcpAgent,
  AcpClientHandlers,
  AcpPermissionRequest,
  AcpPromptResponse,
  AcpSessionNotification,
} from 'src/repositories/acp.repository.js';
import { AgentToolService } from 'src/services/agent-tool.service.js';
import { AGENT_APPROVAL_TIMEOUT_MS, AGENT_TEXT_FLUSH_MS, AgentService } from 'src/services/agent.service.js';
import { ASSISTANT_INSTRUCTIONS } from 'src/utils/agent/instructions.js';
import { defineTool, toolJson } from 'src/utils/agent/tools.js';
import { clearConfigCache } from 'src/utils/config.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

type Row = {
  id: string;
  sessionId: string;
  role: string;
  kind: string;
  externalId: string | null;
  content: Record<string, unknown>;
  createdAt: Date;
};

const readTool = defineTool({
  name: 'search_photos',
  title: 'Search photos',
  description: 'Search',
  input: z.object({ query: z.string() }),
  mutating: false,
  handler: () => Promise.resolve(toolJson({ assets: [{ id: '5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10' }] })),
});

const writeTool = defineTool({
  name: 'create_album',
  title: 'Create album',
  description: 'Create an album',
  input: z.object({ name: z.string(), assetIds: z.array(z.string()) }),
  mutating: true,
  handler: vi.fn(() => Promise.resolve(toolJson({ albumId: '1d7b2c4e-9f5a-4d3b-8e2c-7a6f5e4d3c2b' }))),
});

const deferred = <T>() => Promise.withResolvers<T>();

/** lets the queued (promise based) session work run */
const settle = async () => {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
};

const permissionRequest = (toolCall: AcpPermissionRequest['toolCall']): AcpPermissionRequest => ({
  sessionId: 'acp-session',
  toolCall,
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'always', name: 'Always', kind: 'allow_always' },
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
  ],
});

const waitForPermission = async (rows: Map<string, Row>) => {
  await settle();
  const permission = rows.values().find((message) => message.kind === AgentMessageKind.Permission);
  expect(permission).toBeDefined();
  return permission!;
};

const newFakeAgent = (capabilities?: Record<string, unknown>) => {
  const turns: Array<ReturnType<typeof deferred<AcpPromptResponse>>> = [];
  const agent = {
    pid: 1,
    cwd: '/tmp/immich-agent/test',
    initialize: { protocolVersion: 1, agentCapabilities: capabilities ?? { mcpCapabilities: { http: true } } },
    newSession: vi.fn().mockResolvedValue({ sessionId: 'acp-session' }),
    loadSession: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn(() => {
      const turn = deferred<AcpPromptResponse>();
      turns.push(turn);
      return turn.promise;
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    isAlive: vi.fn().mockReturnValue(true),
  } satisfies AcpAgent;

  return { agent, turns, endTurn: () => turns.at(-1)!.resolve({ stopReason: 'end_turn' }) };
};

describe(AgentService.name, () => {
  let sut: AgentService;
  let mocks: ServiceMocks;
  let rows: Map<string, Row>;
  let handlers: AcpClientHandlers | undefined;
  let fake: ReturnType<typeof newFakeAgent>;
  const auth = factory.auth();

  const newSession = (overrides: { acpSessionId?: string | null } = {}) => {
    const session = {
      id: factory.uuid(),
      userId: auth.user.id,
      title: null,
      profile: 'claude',
      acpSessionId: null,
      status: AgentSessionStatus.Idle,
      createdAt: new Date(),
      updatedAt: new Date(),
      updateId: factory.uuid(),
      ...overrides,
    };
    mocks.access.agentSession.checkOwnerAccess.mockResolvedValue(new Set([session.id]));
    mocks.agent.getSession.mockImplementation((id) => Promise.resolve(id === session.id ? session : undefined));
    return session;
  };

  const setConfig = (agent: Partial<typeof defaults.agent> = {}) => {
    clearConfigCache();
    mocks.systemMetadata.get.mockResolvedValue({ agent: { enabled: true, ...agent } });
  };

  const messages = () => rows.values().toArray();
  const updates = () =>
    mocks.websocket.clientSend.mock.calls.map(
      (args) => args[2] as { status: string; message?: { kind: string; content: Record<string, unknown> } },
    );

  const send = async (update: AcpSessionNotification['update']) => {
    await handlers!.onUpdate({ sessionId: 'acp-session', update });
    await settle();
  };

  const startTurn = async (sessionId: string, text = 'hello') => {
    await sut.prompt(auth, sessionId, { text });
    await settle();
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AgentService));
    vi.spyOn(AgentToolService.prototype, 'getTools').mockReturnValue([readTool, writeTool]);
    setConfig();

    rows = new Map();
    mocks.agent.createMessage.mockImplementation((message) => {
      const row = { id: factory.uuid(), externalId: null, createdAt: new Date(), ...message } as Row;
      rows.set(row.id, row);
      return Promise.resolve(row as never);
    });
    mocks.agent.updateMessage.mockImplementation((id, content) => {
      const row = { ...rows.get(id)!, content };
      rows.set(id, row);
      return Promise.resolve(row as never);
    });
    mocks.agent.updateSession.mockResolvedValue({} as never);
    mocks.agent.getRecentTextMessages.mockResolvedValue([]);
    mocks.agent.getAuthUser.mockResolvedValue(auth.user);

    let tokens = 0;
    mocks.acp.issueMcpToken.mockImplementation(() => `token-${++tokens}`);
    mocks.acp.revokeMcpToken.mockReturnValue(undefined);
    mocks.acp.getWorkdir.mockImplementation((id) => `/tmp/immich-agent/${id}`);
    mocks.acp.createWorkdir.mockImplementation((id) => Promise.resolve(`/tmp/immich-agent/${id}`));
    mocks.acp.removeWorkdir.mockResolvedValue(undefined);

    fake = newFakeAgent();
    handlers = undefined;
    mocks.acp.start.mockImplementation((options) => {
      handlers = options.handlers;
      return Promise.resolve(fake.agent);
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await sut.onShutdown();
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('onConfigValidate', () => {
    it('should require the chat profile to exist when enabled', () => {
      const newConfig = { ...defaults, agent: { ...defaults.agent, enabled: true, chatProfile: 'missing' } };
      expect(() => sut.onConfigValidate({ newConfig, oldConfig: defaults })).toThrow('Unknown assistant chat profile');
    });

    it('should allow an unknown chat profile when disabled', () => {
      const newConfig = { ...defaults, agent: { ...defaults.agent, enabled: false, chatProfile: 'missing' } };
      expect(() => sut.onConfigValidate({ newConfig, oldConfig: defaults })).not.toThrow();
    });
  });

  describe('createSession', () => {
    it('should fail when the assistant is disabled', async () => {
      setConfig({ enabled: false });
      await expect(sut.createSession(auth, {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should use the chat profile', async () => {
      mocks.agent.createSession.mockResolvedValue({ id: factory.uuid() } as never);
      await sut.createSession(auth, { title: 'Trip' });
      expect(mocks.agent.createSession).toHaveBeenCalledWith({
        userId: auth.user.id,
        title: 'Trip',
        profile: 'claude',
      });
    });
  });

  describe('prompt', () => {
    it('should start the agent with the Immich MCP server and send the instructions once', async () => {
      const session = newSession();
      await startTurn(session.id, 'make an album');

      expect(mocks.acp.start).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: expect.objectContaining({ name: 'claude', command: 'claude-agent-acp' }),
          cwd: `/tmp/immich-agent/${session.id}`,
        }),
      );
      expect(fake.agent.newSession).toHaveBeenCalledWith({
        cwd: `/tmp/immich-agent/${session.id}`,
        mcpServers: [
          {
            type: 'http',
            name: 'immich',
            url: 'http://127.0.0.1:2283/api/agent/mcp',
            headers: [{ name: 'Authorization', value: 'Bearer token-1' }],
          },
        ],
        _meta: {
          claudeCode: { options: expect.objectContaining({ tools: [], allowedTools: ['mcp__immich'] }) },
        },
      });
      expect(mocks.agent.updateSession).toHaveBeenCalledWith(session.id, { acpSessionId: 'acp-session' });

      const [[, first]] = fake.agent.prompt.mock.calls as unknown as [[string, [{ text: string }]]];
      expect(first[0].text).toContain(ASSISTANT_INSTRUCTIONS);
      expect(first[0].text.endsWith('make an album')).toBe(true);

      fake.endTurn();
      await settle();
      await startTurn(session.id, 'thanks');

      expect(mocks.acp.start).toHaveBeenCalledTimes(1);
      const [, [, second]] = fake.agent.prompt.mock.calls as unknown as [unknown, [string, [{ text: string }]]];
      expect(second[0].text).toBe('thanks');
    });

    it('should use a stdio bridge when the agent has no MCP over HTTP', async () => {
      fake = newFakeAgent({});
      const session = newSession();
      await startTurn(session.id);

      expect(fake.agent.newSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [
            {
              name: 'immich',
              command: process.execPath,
              args: [expect.stringMatching(/bin\/agent-mcp-stdio\.js$/)],
              env: [
                { name: 'IMMICH_MCP_URL', value: 'http://127.0.0.1:2283/api/agent/mcp' },
                { name: 'IMMICH_MCP_TOKEN', value: 'token-1' },
              ],
            },
          ],
        }),
      );
    });

    it('should load the previous ACP session when the agent supports it', async () => {
      fake = newFakeAgent({ loadSession: true, mcpCapabilities: { http: true } });
      const session = newSession({ acpSessionId: 'previous' });
      await startTurn(session.id, 'continue');

      expect(fake.agent.loadSession).toHaveBeenCalledWith(
        'previous',
        expect.objectContaining({ cwd: expect.any(String) }),
      );
      expect(fake.agent.newSession).not.toHaveBeenCalled();
      expect(fake.agent.prompt).toHaveBeenCalledWith('previous', [{ type: 'text', text: 'continue' }]);
    });

    it('should ignore the history replayed by session/load', async () => {
      fake = newFakeAgent({ loadSession: true });
      fake.agent.loadSession.mockImplementation(async () => {
        await handlers!.onUpdate({
          sessionId: 'previous',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old reply' } },
        });
      });
      const session = newSession({ acpSessionId: 'previous' });
      await startTurn(session.id);

      expect(messages().map((message) => message.content.text)).toEqual(['hello']);
    });

    it('should seed a new ACP session with a recap', async () => {
      const session = newSession({ acpSessionId: 'previous' });
      mocks.agent.getRecentTextMessages.mockResolvedValue([
        { id: 'b', role: AgentMessageRole.Agent, content: { text: 'Created the album "Italy"' } },
        { id: 'a', role: AgentMessageRole.User, content: { text: 'Make an Italy album' } },
      ] as never);
      await startTurn(session.id, 'add more');

      const [[, [block]]] = fake.agent.prompt.mock.calls as unknown as [[string, [{ text: string }]]];
      expect(block.text).toContain('User: Make an Italy album\nAssistant: Created the album "Italy"');
      expect(block.text).toContain(ASSISTANT_INSTRUCTIONS);
    });

    it('should not accept a prompt while the agent is busy', async () => {
      const session = newSession();
      await startTurn(session.id);
      await expect(sut.prompt(auth, session.id, { text: 'again' })).rejects.toThrow('still working');
    });

    it('should enforce the concurrency limit when every agent is busy', async () => {
      setConfig({ maxConcurrentSessions: 1 });
      const first = newSession();
      await startTurn(first.id);

      const second = newSession();
      await expect(sut.prompt(auth, second.id, { text: 'hi' })).rejects.toThrow('Too many assistant sessions');
      expect(mocks.acp.start).toHaveBeenCalledTimes(1);
    });

    it('should stop an idle agent to make room', async () => {
      setConfig({ maxConcurrentSessions: 1 });
      const first = newSession();
      await startTurn(first.id);
      fake.endTurn();
      await settle();

      const second = newSession();
      await startTurn(second.id);

      expect(fake.agent.kill).toHaveBeenCalledTimes(1);
      expect(mocks.acp.revokeMcpToken).toHaveBeenCalledWith('token-1');
      expect(mocks.acp.start).toHaveBeenCalledTimes(2);
    });

    it('should report errors and set the error status', async () => {
      mocks.acp.start.mockRejectedValue(new Error('spawn claude-agent-acp ENOENT'));
      const session = newSession();
      await startTurn(session.id);

      expect(messages().at(-1)).toMatchObject({
        kind: AgentMessageKind.Error,
        content: { text: 'spawn claude-agent-acp ENOENT' },
      });
      expect(mocks.agent.updateSession).toHaveBeenLastCalledWith(session.id, { status: AgentSessionStatus.Error });
      expect(mocks.acp.revokeMcpToken).toHaveBeenCalledWith('token-1');
    });

    it('should stop the agent after the idle timeout', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      setConfig({ idleTimeoutMinutes: 5 });
      const session = newSession();
      await startTurn(session.id);
      fake.endTurn();
      await settle();

      await vi.advanceTimersByTimeAsync(4 * 60_000);
      expect(fake.agent.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fake.agent.kill).toHaveBeenCalled();
      expect(mocks.acp.removeWorkdir).toHaveBeenCalledWith(`/tmp/immich-agent/${session.id}`);
    });
  });

  describe('session updates', () => {
    it('should coalesce text chunks, send every chunk and throttle database writes', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const session = newSession();
      await startTurn(session.id);

      for (const text of ['Hel', 'lo', ' there']) {
        await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
      }

      const texts = messages().filter((message) => message.role === AgentMessageRole.Agent);
      expect(texts).toHaveLength(1);
      expect(mocks.agent.updateMessage).not.toHaveBeenCalled();
      expect(
        updates()
          .filter((update) => update.message?.kind === AgentMessageKind.Text)
          .map((update) => update.message!.content.text),
      ).toEqual(['hello', 'Hel', 'Hello', 'Hello there']);

      // streamed text is visible before it's written
      mocks.agent.getMessages.mockResolvedValue(messages() as never);
      const { messages: current } = await sut.getSession(auth, session.id);
      expect(current.map((message) => message.content.text)).toEqual(['hello', 'Hello there']);

      await vi.advanceTimersByTimeAsync(AGENT_TEXT_FLUSH_MS);
      expect(mocks.agent.updateMessage).toHaveBeenCalledTimes(1);
      expect(mocks.agent.updateMessage).toHaveBeenCalledWith(texts[0].id, { text: 'Hello there' });
    });

    it('should start a new message after a tool call and flush at the end of the turn', async () => {
      const session = newSession();
      await startTurn(session.id);

      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Searching' } });
      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '...' } });
      await send({
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'mcp__immich__search_photos',
        name: 'mcp__immich__search_photos',
        status: 'pending',
        rawInput: { query: 'beach' },
      });
      await send({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: '{"assets":[{"id":"5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10"}]}' },
          },
        ],
      });
      await send({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Pick the best' } });
      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Found one' } });
      await send({
        sessionUpdate: 'plan',
        entries: [{ content: 'Search', priority: 'high', status: 'completed' }],
      });
      fake.endTurn();
      await settle();

      const agentMessages = messages().filter((message) => message.role === AgentMessageRole.Agent);
      expect(agentMessages.map(({ kind, externalId, content }) => ({ kind, externalId, content }))).toEqual([
        { kind: AgentMessageKind.Text, externalId: null, content: { text: 'Searching...' } },
        {
          kind: AgentMessageKind.ToolCall,
          externalId: 'call-1',
          content: {
            toolCallId: 'call-1',
            toolName: 'search_photos',
            title: 'Search photos',
            status: 'completed',
            input: { query: 'beach' },
            output: '{"assets":[{"id":"5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10"}]}',
            assetIds: ['5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10'],
          },
        },
        { kind: AgentMessageKind.Thought, externalId: null, content: { text: 'Pick the best' } },
        { kind: AgentMessageKind.Text, externalId: null, content: { text: 'Found one' } },
        {
          kind: AgentMessageKind.Plan,
          externalId: null,
          content: { entries: [{ content: 'Search', priority: 'high', status: 'completed' }] },
        },
      ]);
      expect(updates().at(-1)).toEqual({ sessionId: session.id, status: AgentSessionStatus.Idle });
      expect(mocks.agent.updateSession).toHaveBeenLastCalledWith(session.id, { status: AgentSessionStatus.Idle });
    });
  });

  describe('permission policy', () => {
    beforeEach(async () => {
      await startTurn(newSession().id);
    });

    it('should allow Immich MCP tools', async () => {
      await expect(
        handlers!.onPermission(permissionRequest({ toolCallId: '1', title: 'mcp__immich__search_photos' })),
      ).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
      await expect(
        handlers!.onPermission(
          permissionRequest({
            toolCallId: '2',
            title: 'Create album',
            _meta: { claudeCode: { toolName: 'mcp__immich__create_album' } },
          }),
        ),
      ).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    });

    it.each([
      { toolCallId: '1', title: 'rm -rf /', name: 'Bash' },
      { toolCallId: '2', title: 'Write /etc/passwd' },
      { toolCallId: '3', title: 'mcp__other__search_photos' },
      { toolCallId: '4', title: 'search_photos' },
      { toolCallId: '5', title: 'mcp__immich__unknown_tool' },
    ])('should reject $title', async (toolCall) => {
      await expect(handlers!.onPermission(permissionRequest(toolCall))).resolves.toEqual({
        outcome: { outcome: 'selected', optionId: 'reject' },
      });
      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Rejected tool'));
    });

    it('should allow an Immich tool call that was reported before the permission request (codex-acp)', async () => {
      // not awaited: the permission request can arrive before the update is processed
      void handlers!.onUpdate({
        sessionId: 'acp-session',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-9',
          title: 'mcp.immich.search_photos',
          kind: 'execute',
        },
      });
      await expect(
        handlers!.onPermission(permissionRequest({ toolCallId: 'call-9', kind: 'execute', status: 'pending' })),
      ).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
      await expect(
        handlers!.onPermission(permissionRequest({ toolCallId: 'call-10', kind: 'execute', status: 'pending' })),
      ).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } });
    });

    it('should cancel when there is no reject option', async () => {
      await expect(
        handlers!.onPermission({
          sessionId: 'acp-session',
          toolCall: { toolCallId: '1', title: 'Bash' },
          options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
        }),
      ).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    });
  });

  describe('runTool', () => {
    const input = { name: 'Italy', assetIds: ['5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10'] };
    let sessionId: string;

    beforeEach(async () => {
      sessionId = newSession().id;
      await startTurn(sessionId);
      vi.mocked(writeTool.handler).mockClear();
    });

    it('should run read-only tools and log them to the session', async () => {
      const result = await sut.runTool({ auth, sessionId }, readTool, { query: 'beach' });
      expect(result.isError).toBeUndefined();

      const toolCall = messages().find((message) => message.kind === AgentMessageKind.ToolCall);
      expect(toolCall?.content).toMatchObject({
        toolName: 'search_photos',
        status: 'completed',
        assetIds: ['5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10'],
      });
    });

    it('should not log a tool call twice when the agent reported it', async () => {
      await send({
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'mcp__immich__search_photos',
        status: 'pending',
      });
      await sut.runTool({ auth, sessionId }, readTool, { query: 'beach' });

      const toolCalls = messages().filter((message) => message.kind === AgentMessageKind.ToolCall);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].content).toMatchObject({
        toolCallId: 'call-1',
        status: 'pending',
        assetIds: ['5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10'],
      });
    });

    it('should run a mutating tool after the user approves it', async () => {
      const pending = sut.runTool({ auth, sessionId }, writeTool, input);
      const permission = await waitForPermission(rows);
      expect(permission.content).toMatchObject({
        toolName: 'create_album',
        title: 'Create album',
        summary: 'name: Italy, assetIds: 5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10',
        status: 'pending',
        assetIds: ['5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10'],
      });
      expect(writeTool.handler).not.toHaveBeenCalled();

      await sut.respondToPermission(auth, sessionId, permission.content.requestId as string, { optionId: 'allow' });
      const result = await pending;

      expect(result.isError).toBeUndefined();
      expect(writeTool.handler).toHaveBeenCalledWith({ auth, sessionId }, input);
      expect(rows.get(permission.id)?.content.status).toBe('approved');
    });

    it('should return an error when the user declines', async () => {
      const pending = sut.runTool({ auth, sessionId }, writeTool, input);
      const permission = await waitForPermission(rows);
      await sut.respondToPermission(auth, sessionId, permission.content.requestId as string, { approved: false });

      const result = await pending;
      expect(result).toEqual({
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('User declined') }],
      });
      expect(writeTool.handler).not.toHaveBeenCalled();
      expect(rows.get(permission.id)?.content.status).toBe('denied');
    });

    it('should decline after the approval timeout', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const pending = sut.runTool({ auth, sessionId }, writeTool, input);
      const permission = await waitForPermission(rows);

      await vi.advanceTimersByTimeAsync(AGENT_APPROVAL_TIMEOUT_MS);
      const result = await pending;

      expect(result.isError).toBe(true);
      expect(writeTool.handler).not.toHaveBeenCalled();
      expect(rows.get(permission.id)?.content.status).toBe('expired');
    });

    it('should decline pending approvals when the turn is cancelled', async () => {
      const pending = sut.runTool({ auth, sessionId }, writeTool, input);
      await waitForPermission(rows);

      await sut.cancel(auth, sessionId);

      await expect(pending).resolves.toMatchObject({ isError: true });
      expect(fake.agent.cancel).toHaveBeenCalledWith('acp-session');
    });

    it('should skip approval when writes are auto-approved', async () => {
      setConfig({ autoApproveWrites: true });
      const result = await sut.runTool({ auth, sessionId }, writeTool, input);

      expect(result.isError).toBeUndefined();
      expect(messages().some((message) => message.kind === AgentMessageKind.Permission)).toBe(false);
    });

    it('should turn tool errors into MCP errors', async () => {
      const failing = defineTool({ ...readTool, handler: () => Promise.reject(new BadRequestException('Not found')) });
      await expect(sut.runTool({ auth, sessionId }, failing, { query: 'x' })).resolves.toEqual({
        isError: true,
        content: [{ type: 'text', text: 'Not found' }],
      });
    });

    it('should reject unknown permission requests', async () => {
      await expect(sut.respondToPermission(auth, sessionId, factory.uuid(), { approved: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('authenticateMcp', () => {
    it('should reject a missing or unknown token', async () => {
      mocks.acp.getMcpToken.mockReturnValue(undefined);
      await expect(sut.authenticateMcp(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(sut.authenticateMcp('Bearer nope')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('should resolve the session owner', async () => {
      const sessionId = factory.uuid();
      mocks.acp.getMcpToken.mockReturnValue({ userId: auth.user.id, sessionId });
      await expect(sut.authenticateMcp('Bearer token')).resolves.toEqual({ auth: { user: auth.user }, sessionId });
      expect(mocks.acp.getMcpToken).toHaveBeenCalledWith('token');
    });

    it('should reject tokens of deleted users', async () => {
      mocks.acp.getMcpToken.mockReturnValue({ userId: auth.user.id, sessionId: null });
      mocks.agent.getAuthUser.mockResolvedValue(undefined);
      await expect(sut.authenticateMcp('Bearer token')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('deleteSession', () => {
    it('should stop the agent and delete the session', async () => {
      const session = newSession();
      await startTurn(session.id);
      mocks.agent.deleteSession.mockResolvedValue();

      await sut.deleteSession(auth, session.id);

      expect(fake.agent.kill).toHaveBeenCalled();
      expect(mocks.acp.revokeMcpToken).toHaveBeenCalledWith('token-1');
      expect(mocks.agent.deleteSession).toHaveBeenCalledWith(session.id);
    });
  });
});
