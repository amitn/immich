import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentWorkdirs,
  buildAgentEnv,
  isSafeFileName,
  isSafeId,
  listAgentFiles,
  readAgentFile,
  spawnAgent,
} from 'src/utils/agent/process.js';

describe('agent processes', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agent-process-spec-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe(buildAgentEnv.name, () => {
    const source = {
      PATH: '/usr/bin',
      HOME: '/home/agent',
      LANG: 'C.UTF-8',
      SECRET: 'no',
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: '',
      DB_PASSWORD: 'postgres',
      REDIS_PASSWORD: 'redis',
      IMMICH_API_KEY: 'immich',
      AGENT_HOST_SECRET: 'host secret',
    };

    it('should only pass the base variables, the forwarded ones and the profile ones', () => {
      expect(
        buildAgentEnv({ passEnv: ['ANTHROPIC_API_KEY'], env: [{ name: 'FAKE_SETTING', value: '1' }] }, source),
      ).toEqual({
        PATH: '/usr/bin',
        HOME: '/home/agent',
        LANG: 'C.UTF-8',
        ANTHROPIC_API_KEY: 'sk-ant',
        FAKE_SETTING: '1',
      });
    });

    it('should never forward database, Redis, server or agent host variables', () => {
      const env = buildAgentEnv(
        { passEnv: ['DB_PASSWORD', 'REDIS_PASSWORD', 'IMMICH_API_KEY', 'AGENT_HOST_SECRET'], env: [] },
        source,
      );
      expect(Object.keys(env).toSorted()).toEqual(['HOME', 'LANG', 'PATH']);
    });

    it('should skip empty variables', () => {
      expect(buildAgentEnv({ passEnv: ['OPENAI_API_KEY'], env: [] }, source)).not.toHaveProperty('OPENAI_API_KEY');
    });
  });

  describe('names', () => {
    it('should accept ids of sessions and art jobs', () => {
      expect(isSafeId('0b6f4f3e-7c3d-4d8e-9d4c-6f1f1f0e7b5a')).toBe(true);
      expect(isSafeId('art-0b6f4f3e-7c3d-4d8e-9d4c-6f1f1f0e7b5a')).toBe(true);
    });

    it.each(['', '..', '../etc', 'a/b', 'a b', 'x'.repeat(129)])('should reject the id %j', (id) => {
      expect(isSafeId(id)).toBe(false);
    });

    it.each(['source.jpg', 'output.png', 'output_1.webp'])('should accept the file name %s', (name) => {
      expect(isSafeFileName(name)).toBe(true);
    });

    it.each(['', '.env', '..', 'a/b', '../source.jpg', 'a..b', '/etc/passwd'])(
      'should reject the file name %j',
      (name) => {
        expect(isSafeFileName(name)).toBe(false);
      },
    );
  });

  describe(AgentWorkdirs.name, () => {
    it('should create an empty private directory with the files', async () => {
      const workdirs = new AgentWorkdirs(root);
      const dir = await workdirs.create('session', [{ name: 'source.jpg', data: Buffer.from('jpeg') }]);

      expect(dir.path).toBe(join(root, 'session'));
      const { mode } = await stat(dir.path);
      expect(mode & 0o777).toBe(0o700);
      await expect(readFile(join(dir.path, 'source.jpg'))).resolves.toEqual(Buffer.from('jpeg'));

      await dir.release();
      expect(existsSync(dir.path)).toBe(false);
    });

    it('should empty a directory left over from before', async () => {
      const workdirs = new AgentWorkdirs(root);
      const first = await workdirs.create('session');
      await writeFile(join(first.path, 'old.txt'), 'old');

      const second = await workdirs.create('session');
      await expect(listAgentFiles(second.path)).resolves.toEqual([]);
    });

    it('should keep the directory of a newer agent with the same id', async () => {
      const workdirs = new AgentWorkdirs(root);
      const old = await workdirs.create('session');
      const current = await workdirs.create('session');

      await old.release();
      expect(existsSync(current.path)).toBe(true);
      await current.release();
      expect(existsSync(current.path)).toBe(false);
    });

    it('should reject unsafe ids and file names', async () => {
      const workdirs = new AgentWorkdirs(root);
      await expect(workdirs.create('../escape')).rejects.toThrow('Invalid working directory id');
      await expect(workdirs.create('session', [{ name: '../x', data: Buffer.from('') }])).rejects.toThrow(
        'Invalid file name',
      );
      expect(existsSync(join(root, 'session'))).toBe(false);
    });
  });

  describe(readAgentFile.name, () => {
    it('should read a file of the directory', async () => {
      await writeFile(join(root, 'output.png'), 'png');
      await expect(readAgentFile(root, 'output.png', 100)).resolves.toEqual(Buffer.from('png'));
    });

    it('should not follow symbolic links', async () => {
      const secret = join(root, 'secret.txt');
      await writeFile(secret, 'secret');
      await symlink(secret, join(root, 'output.png'));

      await expect(readAgentFile(root, 'output.png', 100)).rejects.toThrow();
      await expect(listAgentFiles(root)).resolves.toEqual(['secret.txt']);
    });

    it('should refuse files that are too large', async () => {
      await writeFile(join(root, 'output.png'), Buffer.alloc(200));
      await expect(readAgentFile(root, 'output.png', 100)).rejects.toThrow('larger than');
    });

    it('should refuse names outside of the directory', async () => {
      await expect(readAgentFile(root, '../etc/passwd', 100)).rejects.toThrow('Invalid file name');
    });
  });

  describe(spawnAgent.name, () => {
    it('should kill the whole process group', async () => {
      const pidFile = join(root, 'child.pid');
      const agent = spawnAgent({
        command: 'sh',
        args: ['-c', `sleep 60 & echo $! > ${pidFile}; wait`],
        cwd: root,
        env: { PATH: process.env.PATH ?? '' },
      });
      await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true));
      const pid = await readFile(pidFile, 'utf8');
      const child = Number(pid.trim());
      expect(child).toBeGreaterThan(0);

      await agent.kill();

      expect(agent.isAlive()).toBe(false);
      await vi.waitFor(() => expect(() => process.kill(child, 0)).toThrow());
    });

    it('should report a command that does not exist as an exit', async () => {
      const agent = spawnAgent({ command: 'no-such-agent-command', args: [], cwd: root, env: {} });
      const info = await agent.exited;
      expect(info.stderr).toContain('ENOENT');
      expect(agent.isAlive()).toBe(false);
      await expect(agent.kill()).resolves.toBeUndefined();
    });

    it('should keep the end of stderr', async () => {
      const agent = spawnAgent({
        command: process.execPath,
        args: ['-e', 'process.stderr.write("x".repeat(20000) + "end"); process.exit(3)'],
        cwd: root,
        env: {},
      });
      const info = await agent.exited;
      expect(info.code).toBe(3);
      expect(info.stderr.length).toBe(16 * 1024);
      expect(info.stderr.endsWith('end')).toBe(true);
    });
  });
});
