import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { BurstGroupSourceSchema, BurstKeepReasonSchema } from 'src/enum.js';
import { isoDatetimeToDate } from 'src/validation.js';

/** the most photos of a group that a cleanup takes */
export const BURST_GROUP_MAX_PHOTOS = 200;
/** the most groups one cleanup request takes */
export const BURST_CLEAN_MAX_GROUPS = 500;

const BurstRulesSchema = z
  .object({
    preferRaw: z.boolean().optional().describe('Keep a RAW photo over the others (default false)'),
    preferEdited: z.boolean().optional().describe('Keep a photo edited in the app over the others (default true)'),
    preferLargest: z
      .boolean()
      .optional()
      .describe('Keep the photo with the most pixels, then the biggest file (default false)'),
  })
  .describe('What to keep, applied in this order before the quality score')
  .meta({ id: 'BurstRulesDto' });

const BurstSearchSchema = z
  .object({
    albumId: z.uuidv4().optional().describe('Only the photos of this album'),
    takenAfter: isoDatetimeToDate.optional().describe('Only the photos taken at or after this date'),
    takenBefore: isoDatetimeToDate.optional().describe('Only the photos taken before this date'),
    rules: BurstRulesSchema.optional(),
    page: z.int().min(1).optional().describe('Page of groups, newest first (default 1)'),
    size: z.int().min(1).max(100).optional().describe('Groups per page (default 20)'),
  })
  .meta({ id: 'BurstSearchDto' });

const BurstPhotoSchema = z
  .object({
    assetId: z.uuidv4().describe('Asset ID'),
    isOwned: z.boolean().describe('Whether the photo is the user’s own: only those can be archived'),
    isRaw: z.boolean().describe('Whether the photo is a RAW file'),
    isEdited: z.boolean().describe('Whether the photo was edited in the app'),
    width: z.int().nullable().describe('Width in pixels'),
    height: z.int().nullable().describe('Height in pixels'),
    fileSize: z.int().nullable().describe('File size in bytes'),
    sharpness: z.number().describe('Sharpness score, 0 to 1').meta({ format: 'double' }),
    exposure: z.number().describe('Exposure score, 0 to 1').meta({ format: 'double' }),
    faces: z.int().describe('Number of faces'),
    score: z.number().describe('Overall quality score, 0 to 1').meta({ format: 'double' }),
  })
  .meta({ id: 'BurstPhotoDto' });

const BurstGroupSchema = z
  .object({
    key: z.string().describe('Group key, e.g. duplicate:<id>, stack:<id> or burst:<first asset id>'),
    source: BurstGroupSourceSchema,
    duplicateId: z.uuidv4().nullable().describe('Duplicate group ID'),
    stackId: z.uuidv4().nullable().describe('Stack ID'),
    takenAt: isoDatetimeToDate.describe('When the newest photo of the group was taken'),
    assets: z.array(BurstPhotoSchema).describe('The photos, best first'),
    keepAssetId: z.uuidv4().describe('The suggested photo to keep'),
    reasons: z.array(BurstKeepReasonSchema).describe('Why that photo is the one to keep'),
    archiveAssetIds: z.array(z.uuidv4()).describe('The photos that cleaning up the group archives'),
    readOnly: z.boolean().describe('Whether the group has photos of other users, so it can not be cleaned up'),
  })
  .meta({ id: 'BurstGroupResponseDto' });

const BurstSearchResponseSchema = z
  .object({
    groups: z.array(BurstGroupSchema).describe('The groups of the page, newest first'),
    total: z.int().describe('Number of groups found'),
    totalToArchive: z.int().describe('Number of photos that cleaning up every group found would archive'),
    scanned: z.int().describe('Number of photos looked at'),
    truncated: z.boolean().describe('Whether only the newest photos of the scope were looked at'),
    hasNextPage: z.boolean().describe('Whether there are more groups'),
  })
  .meta({ id: 'BurstSearchResponseDto' });

const BurstCleanGroupSchema = z
  .object({
    assetIds: z.array(z.uuidv4()).min(2).max(BURST_GROUP_MAX_PHOTOS).describe('The photos of the group'),
    keepAssetId: z.uuidv4().describe('The photo to keep; the others are archived'),
  })
  .refine(({ assetIds, keepAssetId }) => assetIds.includes(keepAssetId), {
    error: 'The photo to keep must be one of the photos of the group',
  })
  .meta({ id: 'BurstCleanGroupDto' });

const BurstCleanSchema = z
  .object({
    groups: z.array(BurstCleanGroupSchema).min(1).max(BURST_CLEAN_MAX_GROUPS).describe('The groups to clean up'),
    dryRun: z.boolean().optional().describe('Only count what would be archived'),
  })
  .meta({ id: 'BurstCleanDto' });

const BurstCleanGroupResultSchema = z
  .object({
    keepAssetId: z.uuidv4().describe('The photo kept'),
    archivedAssetIds: z.array(z.uuidv4()).describe('The photos archived (or that would be, in a dry run)'),
    error: z.string().optional().describe('Why the group was skipped'),
  })
  .meta({ id: 'BurstCleanGroupResultDto' });

const BurstCleanResponseSchema = z
  .object({
    dryRun: z.boolean().describe('Whether nothing was changed'),
    groups: z.array(BurstCleanGroupResultSchema).describe('The outcome of each group'),
    archived: z.int().describe('Number of photos archived (or that would be)'),
    activityId: z.uuidv4().nullable().describe('The change in the activity log, to undo it'),
  })
  .meta({ id: 'BurstCleanResponseDto' });

export class BurstSearchDto extends createZodDto(BurstSearchSchema) {}
export class BurstGroupResponseDto extends createZodDto(BurstGroupSchema) {}
export class BurstSearchResponseDto extends createZodDto(BurstSearchResponseSchema) {}
export class BurstCleanDto extends createZodDto(BurstCleanSchema) {}
export class BurstCleanResponseDto extends createZodDto(BurstCleanResponseSchema) {}

export type BurstRulesInput = z.infer<typeof BurstRulesSchema>;
export type BurstCleanGroup = z.infer<typeof BurstCleanGroupSchema>;
export type BurstCleanGroupResult = z.infer<typeof BurstCleanGroupResultSchema>;
export type BurstPhoto = z.infer<typeof BurstPhotoSchema>;
