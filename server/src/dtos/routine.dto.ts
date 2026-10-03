import { Selectable } from 'kysely';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { AgentMessageSchema } from 'src/dtos/agent.dto.js';
import {
  RoutineApprovalMode,
  RoutineApprovalModeSchema,
  RoutineApprovalStatusSchema,
  RoutineEvent,
  RoutineEventSchema,
  RoutineRunStatusSchema,
  RoutineTriggerType,
  RoutineTriggerTypeSchema,
} from 'src/enum.js';
import {
  AssistantRoutineApprovalTable,
  AssistantRoutineRunTable,
  AssistantRoutineTable,
} from 'src/schema/tables/assistant-routine.table.js';
import { RoutineTrigger, validateCron } from 'src/utils/routines.js';
import { isoDatetimeToDate } from 'src/validation.js';

/** the most photos, albums, people or tags a scope names */
const MAX_SCOPE_ITEMS = 100;

const RoutineTriggerSchema = z
  .object({
    type: RoutineTriggerTypeSchema,
    cron: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Schedule: a cron expression of 5 fields, e.g. "0 2 * * *" for every night at 2:00'),
    timezone: z.string().trim().max(100).optional().describe('Schedule: the time zone of the cron expression'),
    event: RoutineEventSchema.optional(),
    tag: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Tag event: only this tag or a tag under it, e.g. print or Food/Noma'),
    pack: z.string().trim().max(50).optional().describe('Journal visit event: only visits of this journal, e.g. food'),
  })
  .superRefine((trigger, ctx) => {
    if (trigger.type === RoutineTriggerType.Schedule) {
      if (!trigger.cron) {
        ctx.addIssue({ code: 'custom', message: 'A schedule needs a cron expression', path: ['cron'] });
        return;
      }
      try {
        validateCron(trigger.cron, trigger.timezone);
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message, path: ['cron'] });
      }
    }
    if (trigger.type === RoutineTriggerType.Event && !trigger.event) {
      ctx.addIssue({ code: 'custom', message: 'An event trigger needs an event', path: ['event'] });
    }
  })
  .describe('When the routine runs: manually, on a schedule, or after an event')
  .meta({ id: 'RoutineTriggerDto' });

export type RoutineTriggerDto = z.infer<typeof RoutineTriggerSchema>;

/** the trigger as stored: only the fields of its type */
export const toRoutineTrigger = (dto: RoutineTriggerDto): RoutineTrigger => {
  switch (dto.type) {
    case RoutineTriggerType.Schedule: {
      return { type: dto.type, cron: dto.cron!, ...(dto.timezone && { timezone: dto.timezone }) };
    }
    case RoutineTriggerType.Event: {
      return {
        type: dto.type,
        event: dto.event!,
        ...(dto.event === RoutineEvent.Tag && dto.tag && { tag: dto.tag }),
        ...(dto.event === RoutineEvent.JournalVisit && dto.pack && { pack: dto.pack }),
      };
    }
    default: {
      return { type: RoutineTriggerType.Manual };
    }
  }
};

const RoutineScopeSchema = z
  .object({
    albumIds: z.array(z.uuidv4()).max(MAX_SCOPE_ITEMS).optional().describe('Only these albums'),
    personIds: z.array(z.uuidv4()).max(MAX_SCOPE_ITEMS).optional().describe('Only these people'),
    tags: z.array(z.string().trim().min(1).max(200)).max(MAX_SCOPE_ITEMS).optional().describe('Only these tags'),
    pack: z.string().trim().max(50).optional().describe('Only this journal, e.g. food'),
    sinceLastRun: z.boolean().optional().describe('Only what is new since the last run'),
    days: z.int().min(1).max(3650).optional().describe('Only the last days'),
  })
  .describe('What the runs are pointed at; the access checks are the same as in the chat')
  .meta({ id: 'RoutineScopeDto' });

const RoutineLimitsSchema = z
  .object({
    runsPerDay: z.int().min(1).max(1000).describe('Most runs in 24 hours'),
    minutes: z.int().min(1).max(240).describe('Longest a run may take, in minutes'),
    toolCalls: z.int().min(1).max(2000).describe('Most tool calls of a run'),
  })
  .describe('Limits of the runs (capped by the server settings)')
  .meta({ id: 'RoutineLimitsDto' });

const RoutineCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).describe('Routine name'),
    instruction: z.string().trim().min(1).max(5000).describe('What to do, in plain words'),
    trigger: RoutineTriggerSchema,
    scope: RoutineScopeSchema.optional(),
    approvalMode: RoutineApprovalModeSchema.optional().describe('Defaults to ask: every change waits for approval'),
    limits: RoutineLimitsSchema.partial().optional(),
    profile: z.string().trim().max(100).nullable().optional().describe('Agent profile (empty for the chat profile)'),
    enabled: z.boolean().optional(),
  })
  .meta({ id: 'RoutineCreateDto' });

const RoutineUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional().describe('Routine name'),
    instruction: z.string().trim().min(1).max(5000).optional().describe('What to do, in plain words'),
    trigger: RoutineTriggerSchema.optional(),
    scope: RoutineScopeSchema.optional(),
    approvalMode: RoutineApprovalModeSchema.optional(),
    limits: RoutineLimitsSchema.partial().optional(),
    profile: z.string().trim().max(100).nullable().optional().describe('Agent profile (empty for the chat profile)'),
    enabled: z.boolean().optional(),
    paused: z.literal(false).optional().describe('false resumes a routine that was paused after repeated failures'),
  })
  .meta({ id: 'RoutineUpdateDto' });

const RoutineRunCreateSchema = z
  .object({
    dryRun: z.boolean().optional().describe('Only report what the run would change'),
  })
  .meta({ id: 'RoutineRunCreateDto' });

const RoutineRunEventSchema = z
  .object({
    kind: z.string().describe('The event'),
    at: z.string().describe('When it happened'),
    data: z.record(z.string(), z.unknown()).optional().describe('What the run is told about it'),
  })
  .meta({ id: 'RoutineRunEventDto' });

const RoutineRunResponseSchema = z
  .object({
    id: z.uuidv4().describe('Run ID'),
    routineId: z.uuidv4().describe('Routine ID'),
    sessionId: z.uuidv4().nullable().describe('The assistant session of the run: its transcript'),
    trigger: z.string().describe('What started the run: manual, schedule or event'),
    approvalMode: RoutineApprovalModeSchema,
    status: RoutineRunStatusSchema,
    assetIds: z.array(z.string()).describe('The photos handed to the run'),
    moreAssets: z.int().describe('Photos handed to the run beyond assetIds'),
    events: z.array(RoutineRunEventSchema).describe('The events the run was started for'),
    summary: z.string().nullable().describe("The agent's summary of the run"),
    error: z.string().nullable().describe('Why the run failed or was skipped'),
    toolCalls: z.int().describe('Tool calls made'),
    changes: z.int().describe('Changes the run made itself'),
    pendingApprovals: z.int().describe('Changes that wait for approval'),
    startedAt: isoDatetimeToDate.nullable(),
    finishedAt: isoDatetimeToDate.nullable(),
    createdAt: isoDatetimeToDate,
  })
  .meta({ id: 'RoutineRunResponseDto' });

const RoutineResponseSchema = z
  .object({
    id: z.uuidv4().describe('Routine ID'),
    name: z.string(),
    instruction: z.string(),
    trigger: RoutineTriggerSchema,
    scope: RoutineScopeSchema,
    approvalMode: RoutineApprovalModeSchema,
    limits: RoutineLimitsSchema,
    profile: z.string().nullable().describe('Agent profile (null for the chat profile)'),
    enabled: z.boolean(),
    pausedAt: isoDatetimeToDate.nullable().describe('When it was paused after repeated failures'),
    consecutiveFailures: z.int(),
    lastRunAt: isoDatetimeToDate.nullable(),
    nextRunAt: isoDatetimeToDate.nullable().describe('When a scheduled routine runs next'),
    pendingEvents: z.int().describe('Events (photos, visits...) waiting for the next run'),
    pendingApprovals: z.int().describe('Changes of its runs that wait for approval'),
    lastRun: RoutineRunResponseSchema.nullable(),
    createdAt: isoDatetimeToDate,
    updatedAt: isoDatetimeToDate,
  })
  .meta({ id: 'RoutineResponseDto' });

const RoutineApprovalResponseSchema = z
  .object({
    id: z.uuidv4().describe('Change ID'),
    runId: z.uuidv4(),
    routineId: z.uuidv4().optional(),
    routineName: z.string().optional(),
    toolName: z.string().describe('The tool the change calls'),
    title: z.string().describe('The title of the tool'),
    summary: z.string().describe('A short summary of the arguments'),
    input: z.record(z.string(), z.unknown()).describe('The arguments, applied as they are'),
    assetIds: z.array(z.string()).describe('The photos of the arguments'),
    status: RoutineApprovalStatusSchema,
    result: z.string().nullable().describe('What applying it returned, or why it failed'),
    activityIds: z.array(z.string()).describe('The activity log entries of the change, once applied'),
    expiresAt: isoDatetimeToDate,
    decidedAt: isoDatetimeToDate.nullable(),
    createdAt: isoDatetimeToDate,
  })
  .meta({ id: 'RoutineApprovalResponseDto' });

const RoutineRunDetailResponseSchema = RoutineRunResponseSchema.extend({
  routineName: z.string(),
  messages: z.array(AgentMessageSchema).describe('The transcript, oldest first'),
  approvals: z.array(RoutineApprovalResponseSchema).describe('The changes that waited for (or got) a decision'),
}).meta({ id: 'RoutineRunDetailResponseDto' });

const RoutineApprovalDecisionSchema = z
  .object({
    ids: z.array(z.uuidv4()).max(500).optional().describe('The changes to decide'),
    runId: z.uuidv4().optional().describe('Decide every pending change of this run'),
    approve: z.boolean().describe('true applies the changes, false denies them'),
  })
  .refine((dto) => (dto.ids?.length ?? 0) > 0 || dto.runId !== undefined, { error: 'Pass ids or a runId' })
  .meta({ id: 'RoutineApprovalDecisionDto' });

const RoutineApprovalDecisionResponseSchema = z
  .object({
    results: z.array(RoutineApprovalResponseSchema).describe('The changes as decided'),
    applied: z.int(),
    denied: z.int(),
    failed: z.int(),
    skipped: z.int().describe('Changes that were decided before, or expired'),
  })
  .meta({ id: 'RoutineApprovalDecisionResponseDto' });

const RoutineConfigResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether routines can run: the assistant and routines are on'),
    profiles: z.array(z.string()).describe('The agent profiles a routine can use'),
    defaultProfile: z.string().describe('The chat profile, used when a routine names none'),
    maxRoutines: z.int(),
    defaultLimits: RoutineLimitsSchema,
    maxLimits: RoutineLimitsSchema,
    safeTools: z.array(z.string()).describe('The tools "Auto-approve safe actions" runs without asking'),
    approvalExpiryDays: z.int(),
  })
  .meta({ id: 'RoutineConfigResponseDto' });

export class RoutineCreateDto extends createZodDto(RoutineCreateSchema) {}
export class RoutineUpdateDto extends createZodDto(RoutineUpdateSchema) {}
export class RoutineRunCreateDto extends createZodDto(RoutineRunCreateSchema) {}
export class RoutineResponseDto extends createZodDto(RoutineResponseSchema) {}
export class RoutineRunResponseDto extends createZodDto(RoutineRunResponseSchema) {}
export class RoutineRunDetailResponseDto extends createZodDto(RoutineRunDetailResponseSchema) {}
export class RoutineApprovalResponseDto extends createZodDto(RoutineApprovalResponseSchema) {}
export class RoutineApprovalDecisionDto extends createZodDto(RoutineApprovalDecisionSchema) {}
export class RoutineApprovalDecisionResponseDto extends createZodDto(RoutineApprovalDecisionResponseSchema) {}
export class RoutineConfigResponseDto extends createZodDto(RoutineConfigResponseSchema) {}

type RoutineRow = Selectable<AssistantRoutineTable>;
type RunRow = Selectable<AssistantRoutineRunTable>;
type ApprovalRow = Selectable<AssistantRoutineApprovalTable>;

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** the photo ids among the arguments of a tool call (assetIds, assetId, keepAssetIds...) */
export const getInputAssetIds = (input: Record<string, unknown>): string[] => {
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(input)) {
    if (!/assetids?$/i.test(key)) {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string' && UUID.test(item)) {
        ids.add(item);
      }
    }
  }
  return [...ids];
};

export const mapRoutineRun = (run: RunRow, pendingApprovals = 0): RoutineRunResponseDto => ({
  id: run.id,
  routineId: run.routineId,
  sessionId: run.sessionId,
  trigger: run.trigger,
  approvalMode: run.approvalMode,
  status: run.status,
  assetIds: run.context.assetIds ?? [],
  moreAssets: run.context.moreAssets ?? 0,
  events: run.context.events ?? [],
  summary: run.summary,
  error: run.error,
  toolCalls: run.toolCalls,
  changes: run.changes,
  pendingApprovals,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  createdAt: run.createdAt,
});

export const mapRoutine = (
  routine: RoutineRow,
  {
    lastRun,
    pendingEvents = 0,
    pendingApprovals = 0,
  }: { lastRun?: RunRow; pendingEvents?: number; pendingApprovals?: number } = {},
): RoutineResponseDto => ({
  id: routine.id,
  name: routine.name,
  instruction: routine.instruction,
  trigger: routine.trigger,
  scope: routine.scope,
  approvalMode: routine.approvalMode ?? RoutineApprovalMode.Ask,
  limits: routine.limits,
  profile: routine.profile,
  enabled: routine.enabled,
  pausedAt: routine.pausedAt,
  consecutiveFailures: routine.consecutiveFailures,
  lastRunAt: routine.lastRunAt,
  nextRunAt: routine.nextRunAt,
  pendingEvents,
  pendingApprovals,
  lastRun: lastRun ? mapRoutineRun(lastRun) : null,
  createdAt: routine.createdAt,
  updatedAt: routine.updatedAt,
});

export const mapRoutineApproval = (
  approval: ApprovalRow & { routineId?: string; routineName?: string },
): RoutineApprovalResponseDto => ({
  id: approval.id,
  runId: approval.runId,
  ...(approval.routineId && { routineId: approval.routineId }),
  ...(approval.routineName && { routineName: approval.routineName }),
  toolName: approval.toolName,
  title: approval.title,
  summary: approval.summary,
  input: approval.input,
  assetIds: getInputAssetIds(approval.input),
  status: approval.status,
  result: approval.result,
  activityIds: approval.activityIds,
  expiresAt: approval.expiresAt,
  decidedAt: approval.decidedAt,
  createdAt: approval.createdAt,
});
