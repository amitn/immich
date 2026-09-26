import type { AdminConfigAgentDto } from '@immich/sdk';
import { formatArgs, parseArgs, parseNameList, validateAgentConfig } from '$lib/utils/agent-config';

describe(parseArgs.name, () => {
  it('should split on whitespace', () => {
    expect(parseArgs('  --model  sonnet\t-v ')).toEqual(['--model', 'sonnet', '-v']);
  });

  it('should return an empty list for an empty string', () => {
    expect(parseArgs('')).toEqual([]);
    expect(parseArgs(' '.repeat(3))).toEqual([]);
  });

  it('should support double quotes', () => {
    expect(parseArgs('--name "hello world"')).toEqual(['--name', 'hello world']);
  });

  it('should support single quotes without escapes', () => {
    expect(parseArgs(String.raw`--x 'a \ b'`)).toEqual(['--x', String.raw`a \ b`]);
  });

  it('should support escapes', () => {
    expect(parseArgs(String.raw`a\ b "c\"d"`)).toEqual(['a b', 'c"d']);
  });

  it('should keep empty quoted arguments', () => {
    expect(parseArgs(`--empty "" ''`)).toEqual(['--empty', '', '']);
  });

  it('should join adjacent quoted parts', () => {
    expect(parseArgs(`--opt="a b"`)).toEqual(['--opt=a b']);
  });
});

describe(formatArgs.name, () => {
  it('should join simple arguments with spaces', () => {
    expect(formatArgs(['--model', 'sonnet'])).toBe('--model sonnet');
  });

  it('should quote arguments that need it', () => {
    expect(formatArgs(['hello world', '', 'say "hi"'])).toBe(String.raw`"hello world" "" "say \"hi\""`);
  });

  it('should round trip', () => {
    const args = ['--flag', 'with space', '', String.raw`back\slash`, `quote"s`, "single'quote"];
    expect(parseArgs(formatArgs(args))).toEqual(args);
  });
});

describe(parseNameList.name, () => {
  it('should split on spaces and commas and remove duplicates', () => {
    expect(parseNameList('ANTHROPIC_API_KEY, OPENAI_API_KEY  ANTHROPIC_API_KEY,')).toEqual([
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
    ]);
  });

  it('should return an empty list for an empty string', () => {
    expect(parseNameList(' , ')).toEqual([]);
  });
});

describe(validateAgentConfig.name, () => {
  const config = (overrides: Partial<AdminConfigAgentDto> = {}): AdminConfigAgentDto => ({
    enabled: true,
    profiles: [{ name: 'claude', command: 'claude-agent-acp', args: [], env: [], passEnv: [] }],
    chatProfile: 'claude',
    artProfile: '',
    maxConcurrentSessions: 3,
    idleTimeoutMinutes: 15,
    autoApproveWrites: false,
    mcpUrl: '',
    ...overrides,
  });

  it('should accept a valid config', () => {
    expect(validateAgentConfig(config())).toEqual([]);
  });

  it('should require profile names and commands', () => {
    const issues = validateAgentConfig(
      config({
        profiles: [
          { name: '', command: 'x', args: [], env: [], passEnv: [] },
          { name: 'claude', command: ' ', args: [], env: [], passEnv: [] },
        ],
      }),
    );
    expect(issues).toEqual([
      { key: 'admin.agent_error_profile_name_required', index: 1 },
      { key: 'admin.agent_error_profile_command_required', name: 'claude' },
    ]);
  });

  it('should reject duplicate profile names', () => {
    const profile = { name: 'claude', command: 'x', args: [], env: [], passEnv: [] };
    expect(validateAgentConfig(config({ profiles: [profile, { ...profile }] }))).toEqual([
      { key: 'admin.agent_error_profile_name_duplicate', name: 'claude' },
    ]);
  });

  it('should require the chat profile to exist when enabled', () => {
    expect(validateAgentConfig(config({ chatProfile: 'codex' }))).toEqual([
      { key: 'admin.agent_error_chat_profile_missing', name: 'codex' },
    ]);
    expect(validateAgentConfig(config({ enabled: false, chatProfile: 'codex' }))).toEqual([]);
  });

  it('should require the art profile to exist unless it is disabled', () => {
    expect(validateAgentConfig(config({ artProfile: 'codex' }))).toEqual([
      { key: 'admin.agent_error_art_profile_missing', name: 'codex' },
    ]);
    expect(validateAgentConfig(config({ artProfile: '' }))).toEqual([]);
  });
});
