import { ChildProcess, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Starting ACP agent processes, shared by the server (agents it runs itself) and the agent host
// (src/bin/agent-host.ts, the agents of the gallery-agents container). Node built-ins only: the agent host is bundled
// on its own, without the server's dependencies.

/** What the agent host needs of an agent profile to start it. */
export type AgentLaunch = {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
  passEnv: string[];
};

export type AgentExitInfo = { code: number | null; signal: NodeJS.Signals | null; stderr: string };

/** A file in the working directory of an agent: its name (no directories) and its content. */
export type AgentFile = { name: string; data: Buffer };

/** Environment variables every agent process gets from the environment of its starter, when set. */
const BASE_ENV = ['PATH', 'HOME', 'LANG', 'TZ'];
/** Never forwarded through `passEnv`, even when configured: server and agent host secrets. */
export const BLOCKED_ENV = /^(DB_|REDIS_|IMMICH_|TYPESENSE_|MACHINE_LEARNING_|AGENT_HOST_)/;
const STDERR_LIMIT = 16 * 1024;
export const KILL_GRACE_MS = 5000;

/** Ids of working directories and agents: letters, digits, `-` and `_` (UUIDs, `art-<uuid>`). */
const SAFE_ID = /^[\w-]{1,128}$/;
/** Names of files in a working directory: no directories, no dot files. */
const SAFE_FILE_NAME = /^[\w-][\w.-]{0,127}$/;

export const isSafeId = (id: unknown): id is string => typeof id === 'string' && SAFE_ID.test(id);
export const isSafeFileName = (name: unknown): name is string =>
  typeof name === 'string' && SAFE_FILE_NAME.test(name) && !name.includes('..');

/** PATH, HOME, LANG and TZ, the variables named in `passEnv`, and `env`. Nothing else from `source`. */
export const buildAgentEnv = (profile: Pick<AgentLaunch, 'env' | 'passEnv'>, source: NodeJS.ProcessEnv) => {
  const env: Record<string, string> = {};
  for (const name of [...BASE_ENV, ...profile.passEnv.filter((name) => !BLOCKED_ENV.test(name))]) {
    const value = source[name];
    // an empty variable is the same as none (compose passes `${ANTHROPIC_API_KEY:-}` as an empty string)
    if (value !== undefined && value !== '') {
      env[name] = value;
    }
  }

  for (const { name, value } of profile.env) {
    env[name] = value;
  }

  return env;
};

export type AgentProcess = {
  readonly pid: number | undefined;
  readonly stdin: NodeJS.WritableStream & { writableNeedDrain?: boolean };
  readonly stdout: NodeJS.ReadableStream;
  /** resolves when the process is gone, also when it could not be started */
  readonly exited: Promise<AgentExitInfo>;
  isAlive(): boolean;
  /** SIGTERM (to the process group), then SIGKILL after a grace period; resolves when the process is gone */
  kill(): Promise<void>;
};

const signalGroup = (child: ChildProcess, name: NodeJS.Signals) => {
  try {
    // negative pid: the whole process group
    process.kill(-child.pid!, name);
  } catch {
    child.kill(name);
  }
};

/** Starts an agent process in its own process group, with stdio pipes and only the given environment. */
export const spawnAgent = ({
  command,
  args,
  cwd,
  env,
}: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}): AgentProcess => {
  const child = spawn(command, args, {
    cwd,
    env,
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

  let gone = false;
  const exited = new Promise<AgentExitInfo>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal, stderr }));
    child.once('error', (error) => resolve({ code: null, signal: null, stderr: `${stderr}\n${error.message}` }));
  }).finally(() => {
    gone = true;
  });

  const isAlive = () => !gone && child.exitCode === null && child.signalCode === null;

  const kill = async () => {
    if (!isAlive()) {
      await exited;
      return;
    }

    signalGroup(child, 'SIGTERM');
    const timeout = setTimeout(() => signalGroup(child, 'SIGKILL'), KILL_GRACE_MS);
    await exited;
    clearTimeout(timeout);
  };

  return { pid: child.pid, stdin: child.stdin, stdout: child.stdout, exited, isAlive, kill };
};

/**
 * The working directories of agents, one per id, below `root`. The same id gives the same path, so agents that key
 * stored sessions by their working directory can load them again. A directory is emptied when an agent gets it, and
 * removed when that agent releases it, unless a newer agent got the same directory in the meantime.
 */
export class AgentWorkdirs {
  private owners = new Map<string, symbol>();

  constructor(readonly root: string) {}

  getPath(id: string) {
    if (!isSafeId(id)) {
      throw new Error(`Invalid working directory id: ${id}`);
    }
    return join(this.root, id);
  }

  /** Creates the empty (private) directory of `id` with `files` in it; `release` removes it again. */
  async create(id: string, files: AgentFile[] = []) {
    const path = this.getPath(id);
    for (const { name } of files) {
      if (!isSafeFileName(name)) {
        throw new Error(`Invalid file name: ${name}`);
      }
    }

    const owner = Symbol(id);
    this.owners.set(id, owner);
    await rm(path, { recursive: true, force: true });
    await mkdir(path, { recursive: true, mode: 0o700 });
    for (const { name, data } of files) {
      await writeFile(join(path, name), data, { mode: 0o600 });
    }

    let released = false;
    const release = async () => {
      if (released) {
        return;
      }
      released = true;
      if (this.owners.get(id) === owner) {
        this.owners.delete(id);
        await rm(path, { recursive: true, force: true });
      }
    };

    return { path, release };
  }
}

/** The names of the regular files directly in `dir` */
export const listAgentFiles = async (dir: string) => {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
};

/** Reads a file directly in `dir`, without following symbolic links, up to `maxBytes` */
export const readAgentFile = async (dir: string, name: string, maxBytes: number) => {
  if (!isSafeFileName(name)) {
    throw new Error(`Invalid file name: ${name}`);
  }

  const handle = await open(join(dir, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new Error(`${name} is not a file`);
    }
    if (stats.size > maxBytes) {
      throw new Error(`${name} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
};
