import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AcpAgent,
  AcpClientHandlers,
  AcpRepository,
  AcpSessionNotification,
  buildMcpServers,
  getAgentHost,
} from 'src/repositories/acp.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { AgentProfile } from 'src/utils/agent/config.js';
import { AgentHost } from 'src/utils/agent/host.js';
import { automock } from 'test/utils.js';

const fakeAgent = fileURLToPath(new URL('../../test/fixtures/fake-acp-agent.mjs', import.meta.url));
const SECRET = 'acp-repository-spec-'.padEnd(48, 'x');

const profile = (overrides: Partial<AgentProfile> = {}): AgentProfile => ({
  name: 'fake',
  command: process.execPath,
  args: [fakeAgent],
  env: [{ name: 'FAKE_SETTING', value: '1' }],
  passEnv: ['FAKE_API_KEY', 'DB_PASSWORD'],
  ...overrides,
});

describe(getAgentHost.name, () => {
  const env = { AGENT_HOST_URL: 'http://gallery-agents:2285', AGENT_HOST_SECRET: SECRET };

  it('should run agents on the server without an agent host', () => {
    expect(getAgentHost(profile(), {})).toBeUndefined();
    expect(getAgentHost(profile({ host: 'auto' }), {})).toBeUndefined();
  });

  it('should run agents on the agent host when one is configured', () => {
    expect(getAgentHost(profile(), env)).toEqual({ url: env.AGENT_HOST_URL, secret: SECRET });
    expect(getAgentHost(profile({ host: 'remote' }), env)).toEqual({ url: env.AGENT_HOST_URL, secret: SECRET });
  });

  it('should keep local profiles on the server', () => {
    expect(getAgentHost(profile({ host: 'local' }), env)).toBeUndefined();
  });

  it('should require the agent host to be configured for remote profiles', () => {
    expect(() => getAgentHost(profile({ host: 'remote' }), {})).toThrow('AGENT_HOST_URL is not set');
    expect(() => getAgentHost(profile(), { AGENT_HOST_URL: env.AGENT_HOST_URL })).toThrow('AGENT_HOST_SECRET is not');
  });
});

describe(buildMcpServers.name, () => {
  const options = { name: 'immich', url: 'http://immich-server:2283/api/agent/mcp', token: 'token' };

  it('should use MCP over HTTP when the agent supports it', () => {
    const initialize = { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } } };
    expect(buildMcpServers({ initialize, mcpStdioBridge: undefined }, options)).toEqual([
      { type: 'http', name: 'immich', url: options.url, headers: [{ name: 'Authorization', value: 'Bearer token' }] },
    ]);
  });

  it('should fail without a bridge for an agent that only has stdio MCP', () => {
    expect(() => buildMcpServers({ initialize: { protocolVersion: 1 }, mcpStdioBridge: undefined }, options)).toThrow(
      'no MCP bridge',
    );
  });
});

const handlers = () => {
  const updates: AcpSessionNotification[] = [];
  const value: AcpClientHandlers = {
    onUpdate: (notification) => {
      updates.push(notification);
    },
    onPermission: ({ options }) =>
      Promise.resolve({
        outcome: { outcome: 'selected', optionId: options.find(({ kind }) => kind === 'reject_once')!.optionId },
      }),
    onExit: vi.fn(),
  };
  const text = () =>
    updates
      .map(({ update }) =>
        update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? update.content.text : '',
      )
      .join('');
  return { handlers: value, updates, text };
};

/**
 * The same fake ACP agent (test/fixtures/fake-acp-agent.mjs), as a process of the server and on an agent host in this
 * process: the server side of the protocol is the same either way.
 */
describe(AcpRepository.name, () => {
  let root: string;
  let sut: AcpRepository;
  let host: AgentHost | undefined;
  let agent: AcpAgent | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'acp-repository-spec-'));
    sut = new AcpRepository(automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }], strict: false }));
    vi.stubEnv('FAKE_API_KEY', 'server-key');
    vi.stubEnv('DB_PASSWORD', 'postgres');
  });

  afterEach(async () => {
    await agent?.kill();
    agent = undefined;
    await host?.close();
    host = undefined;
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  const runTurn = async (started: AcpAgent, text: () => string, prompt: string) => {
    const { sessionId } = await started.newSession({ cwd: started.cwd, mcpServers: [] });
    const response = await started.prompt(sessionId, [{ type: 'text', text: prompt }]);
    expect(response.stopReason).toBe('end_turn');
    return text();
  };

  it('should run an agent as a process of the server', async () => {
    const { handlers: value, text } = handlers();
    agent = await sut.start({ profile: profile(), workdir: 'local-test', handlers: value });

    expect(agent.remote).toBe(false);
    expect(agent.cwd).toBe(sut.getWorkdir('local-test'));
    expect(agent.mcpStdioBridge).toEqual({
      command: process.execPath,
      args: [expect.stringMatching(/agent-mcp-stdio\.js$/)],
    });
    expect(sut.getDefaultMcpUrl(agent, 2283)).toBe('http://127.0.0.1:2283/api/agent/mcp');

    const output = await runTurn(agent, text, 'hi @env');
    expect(output).toContain('Hello world');
    expect(output).toContain('bash:reject');
    expect(output).toMatch(/env:.*FAKE_API_KEY/);
    expect(output).not.toContain('DB_PASSWORD');

    await agent.kill();
    expect(existsSync(sut.getWorkdir('local-test'))).toBe(false);
    expect(value.onExit).toHaveBeenCalled();
  });

  it('should run an agent on the agent host', async () => {
    host = new AgentHost({
      secret: SECRET,
      workRoot: root,
      // the variables of the agent host, not the server's
      env: { PATH: process.env.PATH, FAKE_API_KEY: 'host-key', HOST_ONLY: 'x' },
      mcpStdioBridge: { command: '/usr/local/bin/node', args: ['/opt/gallery-agents/host/agent-mcp-stdio.js'] },
      log: () => {},
    });
    const port = await host.listen(0, '127.0.0.1');
    vi.stubEnv('AGENT_HOST_URL', `http://127.0.0.1:${port}`);
    vi.stubEnv('AGENT_HOST_SECRET', SECRET);
    vi.stubEnv('AGENT_MCP_URL', 'http://immich-server:2283/api/agent/mcp');

    const { handlers: value, text } = handlers();
    agent = await sut.start({
      profile: profile({ passEnv: ['FAKE_API_KEY', 'HOST_ONLY', 'AGENT_HOST_SECRET'] }),
      workdir: 'remote-test',
      files: [{ name: 'source.jpg', data: Buffer.from('jpeg') }],
      handlers: value,
    });

    expect(agent.remote).toBe(true);
    expect(agent.cwd).toBe(join(root, 'remote-test'));
    expect(existsSync(sut.getWorkdir('remote-test'))).toBe(false);
    expect(agent.mcpStdioBridge).toEqual({
      command: '/usr/local/bin/node',
      args: ['/opt/gallery-agents/host/agent-mcp-stdio.js'],
    });
    expect(agent.initialize.agentInfo).toMatchObject({ name: 'fake-acp-agent' });
    expect(sut.getDefaultMcpUrl(agent, 2283)).toBe('http://immich-server:2283/api/agent/mcp');
    await expect(agent.listFiles()).resolves.toEqual(['source.jpg']);

    const output = await runTurn(agent, text, 'hi @env');
    expect(output).toContain('Hello world');
    expect(output).toContain('bash:reject');
    expect(output).toMatch(/env:.*FAKE_API_KEY.*HOST_ONLY/);
    expect(output).not.toContain('AGENT_HOST_SECRET');

    await agent.kill();
    expect(agent.isAlive()).toBe(false);
    expect(existsSync(join(root, 'remote-test'))).toBe(false);
    expect(value.onExit).toHaveBeenCalled();
    expect(host.size).toBe(0);
  });

  it('should cancel a turn on the agent host', async () => {
    host = new AgentHost({ secret: SECRET, workRoot: root, env: { PATH: process.env.PATH }, log: () => {} });
    vi.stubEnv('AGENT_HOST_URL', `http://127.0.0.1:${await host.listen(0, '127.0.0.1')}`);
    vi.stubEnv('AGENT_HOST_SECRET', SECRET);

    const { handlers: value } = handlers();
    agent = await sut.start({ profile: profile(), workdir: 'cancel-test', handlers: value });
    const { sessionId } = await agent.newSession({ cwd: agent.cwd, mcpServers: [] });
    const turn = agent.prompt(sessionId, [{ type: 'text', text: '@wait' }]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await agent.cancel(sessionId);

    await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
  });

  it('should report an agent that fails to start on the agent host', async () => {
    host = new AgentHost({ secret: SECRET, workRoot: root, env: { PATH: process.env.PATH }, log: () => {} });
    vi.stubEnv('AGENT_HOST_URL', `http://127.0.0.1:${await host.listen(0, '127.0.0.1')}`);
    vi.stubEnv('AGENT_HOST_SECRET', SECRET);

    await expect(
      sut.start({
        profile: profile({ command: 'claude-agent-acp-missing' }),
        workdir: 'missing',
        handlers: handlers().handlers,
      }),
    ).rejects.toThrow(/Agent fake exited during initialization.*ENOENT/);
    expect(host.size).toBe(0);
  });

  it('should report a wrong secret', async () => {
    host = new AgentHost({ secret: SECRET, workRoot: root, log: () => {} });
    vi.stubEnv('AGENT_HOST_URL', `http://127.0.0.1:${await host.listen(0, '127.0.0.1')}`);
    vi.stubEnv('AGENT_HOST_SECRET', 'wrong'.padEnd(48, 'x'));

    await expect(sut.start({ profile: profile(), workdir: 'secret', handlers: handlers().handlers })).rejects.toThrow(
      'rejected the secret',
    );
  });

  it('should need the MCP URL of the server for agents on the agent host', () => {
    expect(() => sut.getDefaultMcpUrl({ remote: true }, 2283)).toThrow('AGENT_MCP_URL');
  });
});
