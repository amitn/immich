import { IMMICH_MCP_SERVER_NAME } from 'src/utils/agent/instructions.js';

export type AgentRefs = { assetIds: string[]; albumIds: string[]; bookIds: string[] };

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const MAX_REFS = 500;
const ASSET_LIST_KEYS = new Set(['assets', 'photos', 'selected', 'candidates']);

const refKind = (key: string, parentKey?: string): keyof AgentRefs | undefined => {
  const normalized = key.toLowerCase();
  if (/(asset|photo)ids?$/.test(normalized)) {
    return 'assetIds';
  }
  if (/albumids?$/.test(normalized)) {
    return 'albumIds';
  }
  if (/bookids?$/.test(normalized)) {
    return 'bookIds';
  }
  if (normalized !== 'id' || !parentKey) {
    return;
  }

  const parent = parentKey.toLowerCase();
  if (ASSET_LIST_KEYS.has(parent)) {
    return 'assetIds';
  }
  if (parent === 'album' || parent === 'albums') {
    return 'albumIds';
  }
  if (parent === 'book' || parent === 'books') {
    return 'bookIds';
  }
};

/** Finds asset, album and book ids in a (parsed JSON) tool result so the UI can show them. */
export const extractRefs = (value: unknown): AgentRefs => {
  const refs = { assetIds: new Set<string>(), albumIds: new Set<string>(), bookIds: new Set<string>() };

  const add = (kind: keyof AgentRefs, candidate: unknown) => {
    const values = Array.isArray(candidate) ? candidate : [candidate];
    for (const item of values) {
      if (typeof item === 'string' && UUID.test(item) && refs[kind].size < MAX_REFS) {
        refs[kind].add(item.toLowerCase());
      }
    }
  };

  const walk = (node: unknown, parentKey: string | undefined, depth: number) => {
    if (depth > 8 || node === null || typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, parentKey, depth + 1);
      }
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      const kind = refKind(key, parentKey);
      if (kind) {
        add(kind, child);
      }
      walk(child, key, depth + 1);
    }
  };

  walk(value, undefined, 0);

  return { assetIds: [...refs.assetIds], albumIds: [...refs.albumIds], bookIds: [...refs.bookIds] };
};

/** Parses the JSON text blocks of a tool result and extracts the referenced ids. */
export const extractRefsFromText = (texts: string[]): AgentRefs => {
  const parsed: unknown[] = [];
  for (const text of texts) {
    try {
      parsed.push(JSON.parse(text));
    } catch {
      // not JSON
    }
  }
  return extractRefs(parsed);
};

export const mergeRefs = <T extends Partial<AgentRefs>>(target: T, refs: Partial<AgentRefs>): T => {
  const result: T = { ...target };
  for (const key of ['assetIds', 'albumIds', 'bookIds'] as const) {
    const merged = [...new Set([...(target[key] ?? []), ...(refs[key] ?? [])])].slice(0, MAX_REFS);
    if (merged.length > 0) {
      result[key] = merged;
    }
  }
  return result;
};

const truncate = (text: string, length: number) => (text.length > length ? `${text.slice(0, length)}…` : text);

/** Shrinks a JSON value for storage: long strings and arrays are cut, deep objects are summarized. */
export const compactJson = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') {
    return truncate(value, 500);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (depth >= 4) {
    return Array.isArray(value) ? `[${value.length} items]` : '{…}';
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((item) => compactJson(item, depth + 1));
    return value.length > 50 ? [...items, `…${value.length - 50} more`] : items;
  }

  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, compactJson(child, depth + 1)]));
};

export const truncateText = (text: string, length = 2000) => truncate(text, length);

/** A one line, human readable description of tool arguments, e.g. for approval prompts. */
export const summarizeToolArgs = (args: Record<string, unknown>) => {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      parts.push(
        value.length <= 3 && value.every((item) => typeof item !== 'object')
          ? `${key}: ${value.join(', ')}`
          : `${key}: ${value.length} items`,
      );
    } else if (typeof value === 'object') {
      parts.push(`${key}: ${truncate(JSON.stringify(value), 80)}`);
    } else {
      parts.push(`${key}: ${truncate(String(value), 80)}`);
    }
  }

  return parts.join(', ');
};

type ToolCallLike = {
  title?: string | null;
  name?: string | null;
  _meta?: Record<string, unknown> | null;
};

const getClaudeCodeMeta = (meta: ToolCallLike['_meta']) => {
  const claudeCode = meta?.claudeCode;
  if (!claudeCode || typeof claudeCode !== 'object') {
    return {};
  }
  const { toolName, mcpServer } = claudeCode as { toolName?: unknown; mcpServer?: { name?: unknown } };
  return {
    toolName: typeof toolName === 'string' ? toolName : undefined,
    mcpServerName: typeof mcpServer?.name === 'string' ? mcpServer.name : undefined,
  };
};

/** The agent's own name for a tool call (e.g. `mcp__immich__search_photos` or `Bash`). */
export const getAgentToolName = (toolCall: ToolCallLike) =>
  toolCall.name ?? getClaudeCodeMeta(toolCall._meta).toolName ?? toolCall.title ?? undefined;

const prefix = IMMICH_MCP_SERVER_NAME;
const MCP_TOOL_PATTERNS = [
  // claude-agent-acp / Claude Code
  new RegExp(`^mcp__${prefix}__([a-z0-9_]+)$`),
  // codex-acp titles them mcp.<server>.<tool>; other adapters use server.tool, server/tool, server:tool...
  new RegExp(`^(?:mcp[./:])?${prefix}(?:__|[./:])([a-z0-9_]+)$`),
];

/**
 * Returns the Immich tool name if the tool call targets a tool of the Immich MCP server, otherwise undefined.
 * Bare tool names are not trusted, since an agent could have a built-in tool with the same name.
 */
export const getImmichToolName = (toolCall: ToolCallLike, tools: Set<string>): string | undefined => {
  const { toolName, mcpServerName } = getClaudeCodeMeta(toolCall._meta);
  const candidates = [toolCall.name, toolName, toolCall.title].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    for (const pattern of MCP_TOOL_PATTERNS) {
      const match = candidate.trim().match(pattern);
      if (match && tools.has(match[1])) {
        return match[1];
      }
    }

    if (mcpServerName === IMMICH_MCP_SERVER_NAME && tools.has(candidate)) {
      return candidate;
    }
  }
};
