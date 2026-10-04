import { Selectable } from 'kysely';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import {
  ActivityLogAction,
  ActivityLogActionSchema,
  ActivityLogSourceSchema,
  ActivityUndoStatusSchema,
} from 'src/enum.js';
import { ActivityLogTable } from 'src/schema/tables/activity-log.table.js';
import { isoDatetimeToDate, stringToBool } from 'src/validation.js';

/** changes whose undo can be applied again ("redo") by re-running the change as it was recorded */
export const REDOABLE_ACTIONS: ReadonlySet<ActivityLogAction> = new Set([
  ActivityLogAction.AlbumAddAssets,
  ActivityLogAction.AlbumRemoveAssets,
  ActivityLogAction.BookDraftKeep,
  ActivityLogAction.BurstCleanup,
  ActivityLogAction.SpaceAddAssets,
]);

const ActivityLogSearchSchema = z
  .object({
    sessionId: z.uuidv4().optional().describe('Only the changes of this assistant chat'),
    groupId: z.uuidv4().optional().describe('Only the changes of this group (a chat turn or a web request)'),
    source: ActivityLogSourceSchema.optional(),
    action: ActivityLogActionSchema.optional(),
    from: isoDatetimeToDate.optional().describe('Only changes made at or after this date'),
    to: isoDatetimeToDate.optional().describe('Only changes made before this date'),
    undone: stringToBool.optional().describe('true: only undone changes; false: only changes that were not undone'),
    limit: z.coerce.number().int().min(1).max(500).default(100).describe('Number of changes to return'),
    offset: z.coerce.number().int().min(0).default(0).describe('Number of changes to skip'),
  })
  .meta({ id: 'ActivityLogSearchDto' });

const ActivityLogResponseSchema = z
  .object({
    id: z.uuidv4().describe('Change ID'),
    source: ActivityLogSourceSchema,
    sessionId: z.uuidv4().nullable().describe('Assistant chat that made the change'),
    toolName: z.string().nullable().describe('Assistant tool that made the change'),
    action: ActivityLogActionSchema,
    summary: z.string().describe('What changed'),
    targetId: z
      .string()
      .nullable()
      .describe('The album, book, style, shared link or highlight video that was changed or created'),
    assetIds: z.array(z.string()).describe('The photos and videos that were changed or created'),
    groupId: z.uuidv4().describe('Group of the change: the changes of one chat turn or one web request'),
    createdAt: isoDatetimeToDate.describe('When the change was made'),
    undoneAt: isoDatetimeToDate.nullable().describe('When the change was undone'),
    undoneBy: ActivityLogSourceSchema.nullable().describe('Who undid the change'),
    canUndo: z.boolean().describe('Whether the change can be undone (it may still be refused by the safety checks)'),
    canRedo: z.boolean().describe('Whether the undone change can be applied again'),
  })
  .meta({ id: 'ActivityLogResponseDto' });

const ActivityUndoSchema = z
  .object({
    ids: z.array(z.uuidv4()).max(500).optional().describe('Changes to undo; they are undone newest first'),
    groupId: z.uuidv4().optional().describe('Undo every change of this group (a chat turn or a web request)'),
  })
  .refine((dto) => (dto.ids?.length ?? 0) > 0 || dto.groupId !== undefined, {
    error: 'Pass ids or a groupId',
  })
  .meta({ id: 'ActivityUndoDto' });

const ActivityUndoResultSchema = z
  .object({
    id: z.uuidv4().describe('Change ID'),
    summary: z.string().describe('What changed'),
    status: ActivityUndoStatusSchema,
    message: z.string().optional().describe('Why the change was not undone, or not all of it'),
    warnings: z.array(z.string()).describe('What undoing left as it was, e.g. a photo that was already in the trash'),
  })
  .meta({ id: 'ActivityUndoResultDto' });

const ActivityUndoResponseSchema = z
  .object({
    results: z.array(ActivityUndoResultSchema).describe('One result per change, in the order they were undone'),
    undone: z.int().describe('Number of changes undone (fully or partly)'),
    refused: z.int().describe('Number of changes that were refused or failed'),
  })
  .meta({ id: 'ActivityUndoResponseDto' });

export class ActivityLogSearchDto extends createZodDto(ActivityLogSearchSchema) {}
export class ActivityLogResponseDto extends createZodDto(ActivityLogResponseSchema) {}
export class ActivityUndoDto extends createZodDto(ActivityUndoSchema) {}
export class ActivityUndoResultDto extends createZodDto(ActivityUndoResultSchema) {}
export class ActivityUndoResponseDto extends createZodDto(ActivityUndoResponseSchema) {}

export const mapActivityLog = (row: Selectable<ActivityLogTable>): ActivityLogResponseDto => ({
  id: row.id,
  source: row.source,
  sessionId: row.sessionId,
  toolName: row.toolName,
  action: row.action,
  summary: row.summary,
  targetId: row.targetId,
  assetIds: row.assetIds,
  groupId: row.groupId,
  createdAt: row.createdAt,
  undoneAt: row.undoneAt,
  undoneBy: row.undoneBy,
  canUndo: row.undo !== null && row.undoneAt === null,
  canRedo: row.undoneAt !== null && REDOABLE_ACTIONS.has(row.action),
});
