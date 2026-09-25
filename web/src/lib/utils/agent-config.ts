import type { AdminConfigAgentDto } from '@immich/sdk';

/** Split a command line into arguments, honouring single quotes, double quotes and backslash escapes */
export const parseArgs = (input: string): string[] => {
  const args: string[] = [];
  let current = '';
  let hasToken = false;
  let quote: '"' | "'" | undefined;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quote === "'") {
      if (char === "'") {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '\\' && i + 1 < input.length && (quote !== '"' || ['"', '\\'].includes(input[i + 1]))) {
      current += input[++i];
      hasToken = true;
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasToken) {
        args.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }

    current += char;
    hasToken = true;
  }

  if (hasToken) {
    args.push(current);
  }

  return args;
};

const quoteArg = (arg: string) => {
  if (arg !== '' && !/[\s"'\\]/.test(arg)) {
    return arg;
  }
  return `"${arg.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`)}"`;
};

/** Inverse of parseArgs */
export const formatArgs = (args: string[]) => args.map((arg) => quoteArg(arg)).join(' ');

/** Parse a list of environment variable names separated by spaces or commas */
export const parseNameList = (input: string) => [
  ...new Set(
    input
      .split(/[\s,]+/)
      .map((name) => name.trim())
      .filter(Boolean),
  ),
];

export type AgentConfigIssue =
  | { key: 'admin.agent_error_profile_name_required'; index: number }
  | { key: 'admin.agent_error_profile_name_duplicate'; name: string }
  | { key: 'admin.agent_error_profile_command_required'; name: string }
  | { key: 'admin.agent_error_chat_profile_missing'; name: string }
  | { key: 'admin.agent_error_art_profile_missing'; name: string };

export const validateAgentConfig = (agent: AdminConfigAgentDto): AgentConfigIssue[] => {
  const issues: AgentConfigIssue[] = [];
  const names = new Set<string>();

  for (const [index, profile] of agent.profiles.entries()) {
    const name = profile.name.trim();
    if (!name) {
      issues.push({ key: 'admin.agent_error_profile_name_required', index: index + 1 });
      continue;
    }
    if (names.has(name)) {
      issues.push({ key: 'admin.agent_error_profile_name_duplicate', name });
    }
    names.add(name);
    if (!profile.command.trim()) {
      issues.push({ key: 'admin.agent_error_profile_command_required', name });
    }
  }

  if (agent.enabled && !names.has(agent.chatProfile)) {
    issues.push({ key: 'admin.agent_error_chat_profile_missing', name: agent.chatProfile });
  }

  if (agent.artProfile && !names.has(agent.artProfile)) {
    issues.push({ key: 'admin.agent_error_art_profile_missing', name: agent.artProfile });
  }

  return issues;
};
