// eslint-disable-next-line import-x/no-unresolved -- resolved through the package's wildcard export
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// eslint-disable-next-line import-x/no-unresolved
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import z from 'zod';
import { AcpAgent, AcpRepository, AcpSessionNotification, buildMcpServers } from 'src/repositories/acp.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { automock } from 'test/utils.js';

/**
 * The server side against a real gallery-agents container, with the fake ACP agent of test/fixtures mounted into it.
 * Skipped unless AGENT_HOST_E2E_URL is set; see specs/testing/2026-09-29-agents-sidecar-test-plan.md:
 *
 *   docker run -d --rm --name gallery-agents-e2e --read-only --tmpfs /tmp --cap-drop ALL \
 *     --security-opt no-new-privileges -p 127.0.0.1:52285:2285 -e AGENT_HOST_SECRET=$SECRET \
 *     -e AGENT_HOST_COMMANDS=node \
 *     -v $PWD/server/test/fixtures/fake-acp-agent.mjs:/opt/gallery-agents/fixtures/fake-acp-agent.mjs:ro \
 *     gallery-agents:dev-sidecar
 *   AGENT_HOST_E2E_URL=http://127.0.0.1:52285 AGENT_HOST_E2E_SECRET=$SECRET AGENT_HOST_E2E_MCP_HOST=172.17.0.1 \
 *     pnpm test -- --run src/repositories/acp.repository.container.spec.ts
 *
 * AGENT_HOST_E2E_MCP_HOST is an address of this machine that the container reaches (the gateway of its network); the
 * test serves an MCP tool there, which the agent calls from the container.
 */
const url = process.env.AGENT_HOST_E2E_URL;
const secret = process.env.AGENT_HOST_E2E_SECRET ?? '';
const mcpHost = process.env.AGENT_HOST_E2E_MCP_HOST ?? '172.17.0.1';
const fakeAgent = '/opt/gallery-agents/fixtures/fake-acp-agent.mjs';

const startMcpServer = async () => {
  const calls: unknown[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => void chunks.push(chunk));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer e2e-token') {
        res.writeHead(401).end();
        return;
      }
      const mcp = new McpServer({ name: 'e2e', version: '1.0.0' });
      mcp.registerTool('echo_assets', { inputSchema: { assetIds: z.array(z.string()) } }, ({ assetIds }) => {
        calls.push(assetIds);
        return { content: [{ type: 'text', text: JSON.stringify({ assets: assetIds }) }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => void transport.close());
      const text = Buffer.concat(chunks).toString();
      void mcp.connect(transport).then(() => transport.handleRequest(req, res, text ? JSON.parse(text) : undefined));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, mcpHost, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${mcpHost}:${port}/api/agent/mcp`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

describe.skipIf(!url)('AcpRepository with a gallery-agents container', () => {
  let agent: AcpAgent | undefined;

  beforeEach(() => {
    vi.stubEnv('AGENT_HOST_URL', url!);
    vi.stubEnv('AGENT_HOST_SECRET', secret);
  });

  afterEach(async () => {
    await agent?.kill();
    agent = undefined;
    vi.unstubAllEnvs();
  });

  it('should run a prompt with an MCP tool call from the container', async () => {
    const mcp = await startMcpServer();
    try {
      const sut = new AcpRepository(
        automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }], strict: false }),
      );
      const updates: AcpSessionNotification[] = [];
      agent = await sut.start({
        profile: {
          name: 'fake',
          command: 'node',
          args: [fakeAgent],
          env: [],
          passEnv: ['DB_PASSWORD'],
          host: 'remote',
        },
        workdir: 'e2e-session',
        files: [{ name: 'source.jpg', data: Buffer.from('jpeg') }],
        handlers: {
          onUpdate: (notification) => {
            updates.push(notification);
          },
          onPermission: ({ options }) =>
            Promise.resolve({ outcome: { outcome: 'selected', optionId: options[0].optionId } }),
        },
      });

      expect(agent.remote).toBe(true);
      expect(agent.cwd).toBe('/tmp/gallery-agents/e2e-session');
      expect(agent.mcpStdioBridge).toEqual({
        command: '/usr/local/bin/node',
        args: ['/opt/gallery-agents/host/agent-mcp-stdio.js'],
      });
      await expect(agent.listFiles()).resolves.toEqual(['source.jpg']);

      const { sessionId } = await agent.newSession({
        cwd: agent.cwd,
        mcpServers: buildMcpServers(agent, { name: 'immich', url: mcp.url, token: 'e2e-token' }),
      });
      const call = JSON.stringify({ name: 'echo_assets', arguments: { assetIds: ['a1'] } });
      const response = await agent.prompt(sessionId, [{ type: 'text', text: `hi @env\ncall:${call}` }]);

      expect(response.stopReason).toBe('end_turn');
      expect(mcp.calls).toEqual([['a1']]);
      const text = updates
        .map(({ update }) =>
          update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? update.content.text : '',
        )
        .join('');
      expect(text).toContain('Hello world');
      expect(text).toContain('bash:allow');
      const env = text.match(/env:(.*)/)![1].split(',');
      expect(env.toSorted()).toEqual(['HOME', 'PATH']);
      expect(
        updates.some(
          ({ update }) =>
            update.sessionUpdate === 'tool_call_update' && update.status === 'completed' && !!update.content?.length,
        ),
      ).toBe(true);

      await agent.kill();
      expect(agent.isAlive()).toBe(false);
    } finally {
      await mcp.close();
    }
  });

  it.each(['claude-agent-acp', 'codex-acp'])('should initialize %s in the container', async (command) => {
    const sut = new AcpRepository(
      automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }], strict: false }),
    );
    agent = await sut.start({
      profile: { name: command, command, args: [], env: [], passEnv: [], host: 'remote' },
      workdir: `e2e-${command}`,
      handlers: { onUpdate: () => {}, onPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }) },
    });

    expect(agent.initialize.protocolVersion).toBe(1);
    expect(agent.initialize.agentInfo?.name).toEqual(expect.any(String));
    // both speak MCP over HTTP, so the stdio bridge is only a fallback
    expect(agent.initialize.agentCapabilities?.mcpCapabilities?.http).toBe(true);
  });

  it('should reject a wrong secret', async () => {
    vi.stubEnv('AGENT_HOST_SECRET', 'wrong'.padEnd(48, 'x'));
    const sut = new AcpRepository(
      automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }], strict: false }),
    );
    await expect(
      sut.start({
        profile: { name: 'fake', command: 'node', args: [fakeAgent], env: [], passEnv: [], host: 'remote' },
        workdir: 'e2e-secret',
        handlers: { onUpdate: () => {}, onPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }) },
      }),
    ).rejects.toThrow('rejected the secret');
  });

  it('should only start the allowed commands', async () => {
    const sut = new AcpRepository(
      automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }], strict: false }),
    );
    await expect(
      sut.start({
        profile: {
          name: 'shell',
          command: 'bash',
          args: ['-c', 'cat /proc/1/environ'],
          env: [],
          passEnv: [],
          host: 'remote',
        },
        workdir: 'e2e-shell',
        handlers: { onUpdate: () => {}, onPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }) },
      }),
    ).rejects.toThrow(`doesn't run "bash"`);
  });
});
