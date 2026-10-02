import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { AgentHostTarget, RemoteAgent, startRemoteAgent } from 'src/utils/agent/host-client.js';
import {
  AGENT_HOST_PATH,
  AGENT_HOST_PROTOCOL,
  HostMessage,
  parseMessage,
  readLines,
  sendMessage,
} from 'src/utils/agent/host-protocol.js';
import { AgentHost, AgentHostOptions } from 'src/utils/agent/host.js';
import { AgentLaunch } from 'src/utils/agent/process.js';

const SECRET = 'test-secret-'.padEnd(48, 'x');

/** A fake agent: reports its environment and working directory, then echoes every line back */
const ECHO_AGENT = String.raw`
process.stdout.write(JSON.stringify({ env: Object.keys(process.env).sort(), cwd: process.cwd() }) + '\n');
process.stdin.pipe(process.stdout);
`;

const echoProfile = (overrides: Partial<AgentLaunch> = {}): AgentLaunch => ({
  name: 'echo',
  command: process.execPath,
  args: ['-e', ECHO_AGENT],
  env: [{ name: 'FAKE_SETTING', value: '1' }],
  passEnv: ['FAKE_API_KEY', 'DB_PASSWORD', 'AGENT_HOST_SECRET'],
  ...overrides,
});

/** A connection to the host without the client, which can go silent or away */
const connectRaw = (target: AgentHostTarget) =>
  new Promise<{ socket: Duplex; messages: HostMessage[] }>((resolve, reject) => {
    const req = request(new URL(AGENT_HOST_PATH, target.url), {
      headers: { Connection: 'Upgrade', Upgrade: AGENT_HOST_PROTOCOL, Authorization: `Bearer ${target.secret}` },
    });
    req.on('upgrade', (_, socket) => {
      const messages: HostMessage[] = [];
      readLines(socket, (line) => void messages.push(parseMessage<HostMessage>(line)!), {
        maxBytes: 1024 * 1024,
        onError: reject,
      });
      resolve({ socket, messages });
    });
    req.on('response', (response) => reject(new Error(`status ${response.statusCode}`)));
    req.on('error', reject);
    req.end();
  });

describe(AgentHost.name, () => {
  let root: string;
  let host: AgentHost | undefined;
  let agents: RemoteAgent[];

  const newHost = async (options: Partial<AgentHostOptions> = {}): Promise<AgentHostTarget> => {
    host = new AgentHost({
      secret: SECRET,
      workRoot: root,
      env: { PATH: process.env.PATH, FAKE_API_KEY: 'fake', DB_PASSWORD: 'postgres', AGENT_HOST_SECRET: SECRET },
      log: () => {},
      ...options,
    });
    const port = await host.listen(0, '127.0.0.1');
    return { url: `http://127.0.0.1:${port}`, secret: SECRET };
  };

  const start = async (target: AgentHostTarget, options: Partial<Parameters<typeof startRemoteAgent>[1]> = {}) => {
    const agent = await startRemoteAgent(target, {
      id: crypto.randomUUID(),
      workdir: 'chat-1',
      profile: echoProfile(),
      ...options,
    });
    agents.push(agent);
    return agent;
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agent-host-spec-'));
    agents = [];
  });

  afterEach(async () => {
    await Promise.all(agents.map((agent) => agent.kill()));
    await host?.close();
    host = undefined;
    await rm(root, { recursive: true, force: true });
  });

  it('should require a long secret', () => {
    expect(() => new AgentHost({ secret: 'short', workRoot: root })).toThrow('at least 32 characters');
  });

  it('should answer health checks', async () => {
    const { url } = await newHost();
    const health = await fetch(`${url}/health`);
    expect(health.status).toBe(200);
    await expect(health.text()).resolves.toBe('ok');
    const upgradeOnly = await fetch(`${url}/v1/agents`);
    expect(upgradeOnly.status).toBe(404);
  });

  it('should start an agent and relay its messages both ways', async () => {
    const target = await newHost();
    const agent = await start(target, { files: [{ name: 'source.jpg', data: Buffer.from('jpeg') }] });
    const reader = agent.readable.getReader();

    expect(agent.cwd).toBe(join(root, 'chat-1'));
    expect(agent.pid).toBeGreaterThan(0);
    expect(agent.mcpStdioBridge).toBeUndefined();
    expect(host!.size).toBe(1);

    const { value: hello } = await reader.read();
    expect(hello).toEqual({ env: expect.any(Array), cwd: agent.cwd });

    // large messages, like base64 images, pass unchanged
    const message = { jsonrpc: '2.0', method: 'test', params: { data: 'x'.repeat(3 * 1024 * 1024), text: 'חלון 🪟' } };
    const writer = agent.writable.getWriter();
    await writer.write(message);
    await expect(reader.read()).resolves.toEqual({ value: message, done: false });

    await expect(agent.listFiles()).resolves.toEqual(['source.jpg']);
    await expect(agent.readFile('source.jpg')).resolves.toEqual(Buffer.from('jpeg'));
    await expect(agent.readFile('../../etc/passwd')).rejects.toThrow('Invalid file name');
    await expect(agent.readFile('missing.png')).rejects.toThrow('ENOENT');

    await agent.kill();
    expect(agent.isAlive()).toBe(false);
    await expect(agent.exited).resolves.toMatchObject({ signal: 'SIGTERM' });
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true });
    await expect(agent.listFiles()).rejects.toThrow('not running');
    expect(existsSync(agent.cwd)).toBe(false);
    expect(host!.size).toBe(0);
  });

  it("should give agents a scrubbed environment from the host's own", async () => {
    const target = await newHost();
    const agent = await start(target);
    const { value } = await agent.readable.getReader().read();

    const { env } = value as { env: string[] };
    expect(env).toEqual(expect.arrayContaining(['FAKE_API_KEY', 'FAKE_SETTING', 'PATH']));
    expect(env).not.toContain('DB_PASSWORD');
    expect(env).not.toContain('AGENT_HOST_SECRET');
  });

  it('should pass the MCP bridge of the host', async () => {
    const bridge = { command: '/usr/local/bin/node', args: ['/opt/gallery-agents/host/agent-mcp-stdio.js'] };
    const agent = await start(await newHost({ mcpStdioBridge: bridge }));
    expect(agent.mcpStdioBridge).toEqual(bridge);
  });

  it('should reject a wrong secret', async () => {
    const { url } = await newHost();
    await expect(start({ url, secret: 'wrong'.padEnd(48, 'x') })).rejects.toThrow('rejected the secret');
    expect(host!.size).toBe(0);
  });

  it('should report an agent host that cannot be reached', async () => {
    const { url } = await newHost();
    await host!.close();
    host = undefined;
    await expect(start({ url, secret: SECRET })).rejects.toThrow(`Unable to reach the agent host at ${url}`);
  });

  it('should only run the allowed commands', async () => {
    const target = await newHost({ allowedCommands: ['claude-agent-acp', 'codex-acp'] });
    await expect(start(target)).rejects.toThrow(`The agent host doesn't run "${process.execPath}"`);
    expect(existsSync(join(root, 'chat-1'))).toBe(false);
  });

  it('should reject unsafe working directories', async () => {
    const target = await newHost();
    await expect(start(target, { workdir: '../escape' })).rejects.toThrow('Invalid agent or working directory id');
    await expect(start(target, { files: [{ name: '.bashrc', data: Buffer.from('') }] })).rejects.toThrow(
      'Invalid file',
    );
  });

  it('should limit the number of agents', async () => {
    const target = await newHost({ maxAgents: 1 });
    const first = await start(target);
    await expect(start(target, { workdir: 'chat-2' })).rejects.toThrow('running 1 agents already');

    await first.kill();
    await expect(start(target, { workdir: 'chat-2' })).resolves.toBeDefined();
  });

  it('should report an agent that exits', async () => {
    const target = await newHost();
    const agent = await start(target, {
      profile: echoProfile({ args: ['-e', 'console.error("not logged in"); process.exit(4)'] }),
    });

    await expect(agent.exited).resolves.toEqual({ code: 4, signal: null, stderr: 'not logged in\n' });
    expect(agent.isAlive()).toBe(false);
    await vi.waitFor(() => expect(existsSync(join(root, 'chat-1'))).toBe(false));
    expect(host!.size).toBe(0);
  });

  it('should report a command that is not installed', async () => {
    const agent = await start(await newHost(), { profile: echoProfile({ command: 'no-such-agent' }) });
    await expect(agent.exited).resolves.toMatchObject({ code: null, stderr: expect.stringContaining('ENOENT') });
  });

  it('should stop the agent when the server goes away', async () => {
    const target = await newHost();
    const { socket, messages } = await connectRaw(target);
    sendMessage(socket, { type: 'start', id: 'agent-1', workdir: 'chat-1', profile: echoProfile(), files: [] });
    await vi.waitFor(() => expect(messages.map(({ type }) => type)).toContain('ready'));
    expect(host!.size).toBe(1);

    socket.destroy();

    await vi.waitFor(() => expect(host!.size).toBe(0));
    await vi.waitFor(() => expect(existsSync(join(root, 'chat-1'))).toBe(false));
  });

  it('should close the connection of a server that stopped answering', async () => {
    const target = await newHost({ heartbeatMs: 50 });
    const { socket, messages } = await connectRaw(target);
    const closed = new Promise((resolve) => socket.on('close', resolve));
    sendMessage(socket, { type: 'start', id: 'agent-1', workdir: 'chat-1', profile: echoProfile(), files: [] });

    // no pongs
    await closed;
    expect(messages.map(({ type }) => type)).toEqual(expect.arrayContaining(['ready', 'ping']));
    await vi.waitFor(() => expect(host!.size).toBe(0));
  });

  it('should keep a connection that answers the pings', async () => {
    const target = await newHost({ heartbeatMs: 50 });
    const agent = await start(target);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(agent.isAlive()).toBe(true);
  });

  it('should stop an idle agent', async () => {
    const target = await newHost({ heartbeatMs: 50, idleTimeoutMs: 200 });
    const agent = await start(target);

    await expect(agent.exited).resolves.toMatchObject({ signal: 'SIGTERM' });
    expect(host!.size).toBe(0);
  });

  it('should require a start message first', async () => {
    const target = await newHost();
    const { socket, messages } = await connectRaw(target);
    sendMessage(socket, { type: 'kill' });
    await vi.waitFor(() => expect(messages).toEqual([{ type: 'error', message: 'Expected a start message' }]));
  });

  it('should reject a second agent with the same id', async () => {
    const target = await newHost();
    await start(target, { id: 'agent-1' });
    await expect(start(target, { id: 'agent-1', workdir: 'chat-2' })).rejects.toThrow(
      'Agent agent-1 is running already',
    );
  });

  it('should stop every agent when it closes', async () => {
    const target = await newHost();
    const first = await start(target);
    const second = await start(target, { workdir: 'chat-2' });

    await host!.close();
    host = undefined;

    await expect(first.exited).resolves.toBeDefined();
    await expect(second.exited).resolves.toBeDefined();
    expect(existsSync(first.cwd)).toBe(false);
    expect(existsSync(second.cwd)).toBe(false);
  });
});
