import { IMMICH_MCP_SERVER_NAME } from 'src/utils/agent/instructions.js';

export type AgentRefs = { assetIds: string[]; albumIds: string[]; bookIds: string[] };
type RefKind = keyof AgentRefs;

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const MAX_REFS = 500;
/**
 * keys of asset ids besides `*AssetId(s)` and `*PhotoId(s)`: `ids` (select_best, cluster_similar), `sampleIds`, and
 * the photos of a meal (find_meals, match_dishes)
 */
const ASSET_ID_KEYS = new Set(['ids', 'sampleids', 'dishids', 'menuids', 'signids', 'receiptids']);
/** lists of photos, so the `id` of their items is an asset id (search_photos `items`, improve_photos `improved`...) */
const ASSET_LIST_KEYS = new Set([
  'assets',
  'photos',
  'items',
  'selected',
  'candidates',
  'improved',
  'improvements',
  'unusedphotos',
  'weakestplaced',
]);
/** objects whose values are asset ids: view_photos `sheet` {position: id}, improve_photos `copies` {sourceId: id} */
const ASSET_MAP_KEYS = new Set(['sheet', 'copies']);

/** what the top-level `id` of a tool's input or result is; elsewhere an `id` can be a page, person or face */
const TOP_LEVEL_ID: Record<string, RefKind> = {
  create_album: 'albumIds',
  get_album: 'albumIds',
  list_books: 'bookIds',
  create_book: 'bookIds',
  get_book: 'bookIds',
  update_book: 'bookIds',
  edit_existing_book: 'bookIds',
  view_photos: 'assetIds',
  crop_photo: 'assetIds',
  straighten_photo: 'assetIds',
  enhance_photo: 'assetIds',
  suggest_enhancement: 'assetIds',
  read_menu: 'assetIds',
};

/** tools whose card also shows what their input refers to, e.g. the photos added to an album */
const INPUT_REF_TOOLS = new Set([
  'create_album',
  'add_to_album',
  'remove_from_album',
  'suggest_enhancement',
  'stylize_photo',
  'read_menu',
  'set_dish_names',
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const refKind = (key: string, parentKey: string | undefined, topLevelKind?: RefKind): RefKind | undefined => {
  const normalized = key.toLowerCase();
  if (/(asset|photo)ids?$/.test(normalized) || ASSET_ID_KEYS.has(normalized)) {
    return 'assetIds';
  }
  if (/albumids?$/.test(normalized)) {
    return 'albumIds';
  }
  if (/bookids?$/.test(normalized)) {
    return 'bookIds';
  }
  if (normalized !== 'id') {
    return;
  }

  if (parentKey === undefined) {
    return topLevelKind;
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

/**
 * Finds asset, album and book ids in the (parsed JSON) input or result of a tool so the UI can show them. With the
 * name of the Immich tool, a top-level `id` is known to be an album, book or photo.
 */
export const extractRefs = (value: unknown, toolName?: string): AgentRefs => {
  const refs = { assetIds: new Set<string>(), albumIds: new Set<string>(), bookIds: new Set<string>() };
  const topLevelKind = toolName ? TOP_LEVEL_ID[toolName] : undefined;

  const add = (kind: RefKind, candidate: unknown) => {
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
      const kind = refKind(key, parentKey, topLevelKind);
      if (kind) {
        add(kind, child);
      } else if (ASSET_MAP_KEYS.has(key.toLowerCase()) && isObject(child)) {
        add('assetIds', Object.values(child));
      }
      walk(child, key, depth + 1);
    }
  };

  // the items of a top-level array are top-level too (e.g. list_books)
  walk(value, undefined, 0);

  return { assetIds: [...refs.assetIds], albumIds: [...refs.albumIds], bookIds: [...refs.bookIds] };
};

const parseJson = (texts: string[]) => {
  const parsed: unknown[] = [];
  for (const text of texts) {
    try {
      parsed.push(JSON.parse(text));
    } catch {
      // not JSON
    }
  }
  return parsed;
};

/** Parses the JSON text blocks of a tool result and extracts the referenced ids. */
export const extractRefsFromText = (texts: string[], toolName?: string): AgentRefs =>
  extractRefs(parseJson(texts), toolName);

/** The refs shown on the card of a tool call: what its result refers to and, for some tools, what its input does. */
export const extractToolCallRefs = (
  toolName: string | undefined,
  { input, output = [] }: { input?: unknown; output?: unknown[] },
): AgentRefs => {
  const refs = extractRefs(output, toolName);
  return toolName && INPUT_REF_TOOLS.has(toolName) && input !== undefined
    ? mergeRefs(refs, extractRefs(input, toolName))
    : refs;
};

type ToolCallContentLike = { type: string; content?: { type: string; text?: unknown } };

const getBlockTexts = (blocks: unknown[]) =>
  blocks.flatMap((block) => (isObject(block) && typeof block.text === 'string' ? [block.text] : []));

/**
 * The result of a tool call from a `tool_call` or `tool_call_update`: its text blocks and their parsed JSON.
 *
 * claude-agent-acp sends an MCP result twice in the final update: as `content` (`{type: 'content', content: {type:
 * 'text', text}}`) and as `rawOutput` (the MCP content blocks, or a string). So `rawOutput` is only read when there is
 * no text content, or the output would be stored twice. Other adapters may send `rawOutput` as an MCP
 * `CallToolResult` (`content` and maybe `structuredContent`) or as plain JSON.
 */
export const getToolCallResult = ({
  content,
  rawOutput,
}: {
  content?: ToolCallContentLike[] | null;
  rawOutput?: unknown;
}): { texts: string[]; values: unknown[] } => {
  const contentTexts = (content ?? []).flatMap((item) =>
    item.type === 'content' && item.content?.type === 'text' && typeof item.content.text === 'string'
      ? [item.content.text]
      : [],
  );

  let rawTexts: string[] = [];
  const rawValues: unknown[] = [];
  if (typeof rawOutput === 'string') {
    rawTexts = [rawOutput];
  } else if (Array.isArray(rawOutput)) {
    rawTexts = getBlockTexts(rawOutput);
  } else if (isObject(rawOutput)) {
    if (Array.isArray(rawOutput.content)) {
      rawTexts = getBlockTexts(rawOutput.content);
      if (isObject(rawOutput.structuredContent)) {
        rawValues.push(rawOutput.structuredContent);
      }
    } else {
      rawValues.push(rawOutput);
    }
  }

  const texts = [...new Set(contentTexts.length > 0 ? contentTexts : rawTexts)];
  return { texts, values: [...parseJson(texts), ...rawValues] };
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

/** arguments that are photos: counted, since the photos are shown next to the summary */
const PHOTO_ARGS = new Set(['id', 'ids', 'assetId', 'assetIds', 'photoIds', 'photos']);
const PEOPLE_ARGS = new Set(['personId', 'personIds']);
const ARG_LABELS: Record<string, string> = {
  rect: 'Crop (pixels)',
  rectNormalized: 'Crop',
  pageWidthMm: 'Page width (mm)',
  pageHeightMm: 'Page height (mm)',
};

const plural = (count: number, one: string, other: string) => `${count} ${count === 1 ? one : other}`;

/** `aspectRatio` → `Aspect ratio` */
const toLabel = (key: string) => {
  const words = key.replaceAll(/([\da-z])([A-Z])/g, '$1 $2').toLowerCase();
  return ARG_LABELS[key] ?? words.charAt(0).toUpperCase() + words.slice(1);
};

const isUuid = (value: unknown) => typeof value === 'string' && UUID.test(value);

const formatValue = (value: unknown): string => {
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'number') {
    return String(Math.round(value * 1000) / 1000);
  }
  if (Array.isArray(value)) {
    return value.length <= 3 && value.every((item) => typeof item !== 'object')
      ? value.map((item) => formatValue(item)).join(', ')
      : plural(value.length, 'item', 'items');
  }
  if (isObject(value)) {
    return Object.entries(value)
      .filter(([, child]) => child !== undefined && child !== null)
      .map(([key, child]) => `${toLabel(key).toLowerCase()} ${isObject(child) ? '…' : formatValue(child)}`)
      .join(', ');
  }
  return String(value);
};

const countOf = (value: unknown) => (Array.isArray(value) ? value.length : 1);

/**
 * A short, human readable description of tool arguments for approval prompts, e.g. `Name: Best of Sicily · 20 photos`.
 * Photos are counted and other ids (albums, books...) left out, since they are shown as thumbnails and links.
 */
export const summarizeToolArgs = (args: Record<string, unknown>) => {
  const parts: Array<string | { photos: number }> = [];
  let photos: { photos: number } | undefined;
  let people = 0;

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
      continue;
    }

    if (PHOTO_ARGS.has(key)) {
      if (!photos) {
        photos = { photos: 0 };
        parts.push(photos);
      }
      photos.photos += countOf(value);
      continue;
    }

    if (PEOPLE_ARGS.has(key)) {
      people += countOf(value);
      continue;
    }

    if (isUuid(value) || (Array.isArray(value) && value.every((item) => isUuid(item)))) {
      continue;
    }

    parts.push(`${toLabel(key)}: ${truncate(formatValue(value), 80)}`);
  }

  if (people > 0) {
    parts.push(plural(people, 'person', 'people'));
  }

  return parts.map((part) => (typeof part === 'string' ? part : plural(part.photos, 'photo', 'photos'))).join(' · ');
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
