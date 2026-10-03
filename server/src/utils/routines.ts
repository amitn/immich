import { CronTime } from 'cron';
import { createHash } from 'node:crypto';
import { RoutineApprovalMode, RoutineEvent, RoutineTriggerType } from 'src/enum.js';

/**
 * Assistant routines (#15): an instruction in plain words that the assistant runs on its own, on a schedule or after
 * an event. These are the pure parts: the trigger and its schedule, the tools a run may use in each approval mode,
 * and the prompt of a headless run.
 */

export type RoutineTrigger =
  | { type: RoutineTriggerType.Manual }
  /** a 5-field cron expression, in `timezone` (the server's when absent) */
  | { type: RoutineTriggerType.Schedule; cron: string; timezone?: string }
  /** `tag` filters tag events (the tag or a tag under it), `pack` journal visits (e.g. food) */
  | { type: RoutineTriggerType.Event; event: RoutineEvent; tag?: string; pack?: string };

/** what a run is pointed at; told to the agent as context, the access checks are the chat's */
export type RoutineScope = {
  albumIds?: string[];
  personIds?: string[];
  tags?: string[];
  /** a journal (collection pack), e.g. food */
  pack?: string;
  /** only what is new since the last run */
  sinceLastRun?: boolean;
  /** only the last days */
  days?: number;
};

export type RoutineLimits = {
  /** runs of the routine in 24 hours */
  runsPerDay: number;
  /** minutes a run may take */
  minutes: number;
  /** tool calls a run may make */
  toolCalls: number;
};

export type RoutineRunEvent = { kind: string; at: string; data?: Record<string, unknown> };

/** what a run was started with */
export type RoutineRunContext = {
  /** the photos the events handed over (uploads, a visit, a tag, a Workflow...) */
  assetIds?: string[];
  /** photos left out of `assetIds` over the limit */
  moreAssets?: number;
  events?: RoutineRunEvent[];
  /** the start of the last run, for a scope "since the last run" */
  since?: string;
};

/** the most photos a run is handed by name; the others are counted */
export const ROUTINE_MAX_CONTEXT_ASSETS = 500;

/** the most events a run is told about one by one */
export const ROUTINE_MAX_CONTEXT_EVENTS = 50;

/**
 * The tools that "Auto-approve safe actions" runs without asking: reversible, low-risk changes that the activity log
 * can undo (albums, journal names and descriptions, copies stacked with their originals, new collages and videos, book
 * edits). Anything that archives, removes, shares, exports, costs money (artworks) or changes settings waits for
 * approval.
 */
export const ROUTINE_SAFE_TOOLS: ReadonlySet<string> = new Set([
  'create_album',
  'add_to_album',
  'save_entries',
  'crop_photo',
  'straighten_photo',
  'enhance_photo',
  'improve_photos',
  'make_collage',
  'make_highlight_video',
  'apply_book_style',
  'apply_improvements',
]);

/**
 * Tools the chat runs without asking because they only shape the agent's own working drafts (photo books), but which
 * still write: a dry run refuses them too, so that it changes nothing at all.
 */
export const ROUTINE_DRAFT_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'create_book',
  'auto_layout_book',
  'update_book',
  'set_book_style',
  'add_page',
  'remove_page',
  'move_page',
  'set_page_layout',
  'add_map_page',
  'set_page_map',
  'place_photo',
  'clear_slot',
  'set_caption',
]);

/** what a run does with a tool call: run it, queue it for the user's approval, or only report it (dry run) */
export type RoutineToolDecision = 'run' | 'queue' | 'report';

export const getRoutineToolDecision = (
  mode: RoutineApprovalMode,
  tool: { name: string; mutating: boolean },
): RoutineToolDecision => {
  if (mode === RoutineApprovalMode.DryRun) {
    return tool.mutating || ROUTINE_DRAFT_WRITE_TOOLS.has(tool.name) ? 'report' : 'run';
  }
  if (!tool.mutating) {
    return 'run';
  }
  return mode === RoutineApprovalMode.AutoSafe && ROUTINE_SAFE_TOOLS.has(tool.name) ? 'run' : 'queue';
};

/** throws when the expression is not a valid 5-field cron expression (or the time zone is unknown) */
export const validateCron = (cron: string, timezone?: string) => {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error('A schedule is a cron expression of 5 fields: minute, hour, day of month, month, day of week');
  }
  // throws on a bad expression or time zone
  new CronTime(cron.trim(), timezone || undefined);
};

/** when a scheduled routine runs next after `from`; undefined for the other triggers or a bad expression */
export const getNextRunAt = (trigger: RoutineTrigger, from: Date): Date | undefined => {
  if (trigger.type !== RoutineTriggerType.Schedule) {
    return;
  }
  try {
    const timezone = trigger.timezone || undefined;
    return new CronTime(trigger.cron.trim(), timezone).getNextDateFrom(from, timezone).toJSDate();
  } catch {
    return;
  }
};

/** whether a tag (e.g. Food/Noma/Tartare) is `filter` or a tag under it (not case-sensitive) */
export const isTagUnder = (value: string, filter: string) => {
  const tag = value.toLowerCase();
  const target = filter
    .trim()
    .replaceAll(/^\/+|\/+$/g, '')
    .toLowerCase();
  return target.length > 0 && (tag === target || tag.startsWith(`${target}/`));
};

const EVENT_DESCRIPTIONS: Record<RoutineEvent, string> = {
  [RoutineEvent.Upload]: 'new photos were uploaded',
  [RoutineEvent.JournalVisit]: 'a new journal visit was found',
  [RoutineEvent.Tag]: 'photos got a tag',
  [RoutineEvent.Trip]: 'a trip ended',
  [RoutineEvent.BookDraft]: 'a photo book draft was made',
  [RoutineEvent.Workflow]: 'a Workflow sent photos to it',
};

export const describeEvent = (event: RoutineEvent | string) =>
  EVENT_DESCRIPTIONS[event as RoutineEvent] ?? `the event ${event} happened`;

const APPROVAL_INSTRUCTIONS: Record<RoutineApprovalMode, string> = {
  [RoutineApprovalMode.Ask]:
    'Ask me: every change to the library (the tools that may ask for approval in a chat) is queued for the user, who approves or denies it later in the Routines inbox. A queued call is applied later exactly as you made it, so make each change a complete, self-contained call (e.g. create_album with all its photos rather than create_album then add_to_album). Do not wait for the approval and do not repeat a queued call; carry on with the rest.',
  [RoutineApprovalMode.AutoSafe]: `Auto-approve safe actions: these reversible tools run right away: ${[...ROUTINE_SAFE_TOOLS].join(', ')}. Every other change is queued for the user, who approves or denies it later in the Routines inbox, exactly as you called it: make such changes complete, self-contained calls, don't wait for them and don't repeat them.`,
  [RoutineApprovalMode.DryRun]:
    'Dry run: nothing may be changed. Every change you would make (including creating or editing photo books) is only recorded and reported to the user, not made. Look and judge as for a real run, call the tools that would make the changes so that they are recorded, and report what you would change.',
};

const formatScope = (scope: RoutineScope, context: RoutineRunContext) => {
  const lines: string[] = [];
  if (scope.albumIds?.length) {
    lines.push(`- albums (album ids): ${scope.albumIds.join(', ')}`);
  }
  if (scope.personIds?.length) {
    lines.push(`- people (person ids): ${scope.personIds.join(', ')}`);
  }
  if (scope.tags?.length) {
    lines.push(`- tags: ${scope.tags.join(', ')}`);
  }
  if (scope.pack) {
    lines.push(`- journal: ${scope.pack}`);
  }
  if (scope.sinceLastRun && context.since) {
    lines.push(`- only what is new since the last run, ${context.since}`);
  } else if (scope.sinceLastRun) {
    lines.push('- this is the first run: look at the last 7 days');
  }
  if (scope.days) {
    lines.push(`- only the last ${scope.days} day(s)`);
  }
  return lines;
};

const formatContext = (context: RoutineRunContext) => {
  const lines: string[] = [];
  for (const event of (context.events ?? []).slice(0, ROUTINE_MAX_CONTEXT_EVENTS)) {
    const data = event.data && Object.keys(event.data).length > 0 ? ` ${JSON.stringify(event.data)}` : '';
    lines.push(`- ${event.at}: ${describeEvent(event.kind)}${data}`);
  }
  const more = (context.events?.length ?? 0) - ROUTINE_MAX_CONTEXT_EVENTS;
  if (more > 0) {
    lines.push(`- and ${more} more event(s)`);
  }
  return lines;
};

/**
 * The prompt of a headless run: who is running (nobody is watching), the approval mode, the scope and the photos the
 * events handed over, how to end, then the user's instruction.
 */
export const buildRoutinePrompt = ({
  name,
  instruction,
  trigger,
  mode,
  scope,
  context,
  limits,
}: {
  name: string;
  instruction: string;
  /** what started the run, e.g. "schedule" */
  trigger: string;
  mode: RoutineApprovalMode;
  scope: RoutineScope;
  context: RoutineRunContext;
  limits: RoutineLimits;
}) => {
  const started =
    trigger === RoutineTriggerType.Schedule
      ? 'on its schedule'
      : trigger === RoutineTriggerType.Event
        ? 'after an event'
        : 'because the user started it';
  const parts = [
    `<routine>`,
    `You are running the user's routine “${name}” on your own, ${started}. Nobody is watching this chat and nobody can answer questions now: decide what you can, and leave the rest for the user and say so in your summary.`,
    `Approval mode: ${APPROVAL_INSTRUCTIONS[mode]}`,
    `Limits: at most ${limits.toolCalls} tool calls and ${limits.minutes} minutes. Stop in time to write your summary.`,
  ];

  const scopeLines = formatScope(scope, context);
  if (scopeLines.length > 0) {
    parts.push(`Scope:\n${scopeLines.join('\n')}`);
  }

  const eventLines = formatContext(context);
  if (eventLines.length > 0) {
    parts.push(`Events since the last run:\n${eventLines.join('\n')}`);
  }

  if (context.assetIds?.length) {
    const more = context.moreAssets
      ? ` (and ${context.moreAssets} more, not listed: find them with search_photos)`
      : '';
    parts.push(`Photos handed to this run (asset ids)${more}: ${context.assetIds.join(', ')}`);
  }

  parts.push(
    'When you are done, end with a short summary in a few lines, in the user’s language: what you did, what waits for their approval, and what you could not do.',
    `</routine>`,
    instruction,
  );
  return parts.join('\n\n');
};

/** "12 changes · 2 need your OK", the line of the notification of a run */
export const describeRunOutcome = ({
  changes,
  pending,
  reported,
}: {
  changes: number;
  pending: number;
  reported: number;
}) => {
  const parts: string[] = [];
  if (reported > 0) {
    parts.push(`Dry run: ${reported} change${reported === 1 ? '' : 's'} proposed`);
  }
  if (changes > 0 || (pending === 0 && reported === 0)) {
    parts.push(`${changes} change${changes === 1 ? '' : 's'}`);
  }
  if (pending > 0) {
    parts.push(`${pending} need${pending === 1 ? 's' : ''} your OK`);
  }
  return parts.join(' · ');
};

/** the hash of the MCP token of a routine run, as stored with the run: the API process finds the run by it */
export const hashRoutineToken = (token: string) => createHash('sha256').update(token).digest('hex');
