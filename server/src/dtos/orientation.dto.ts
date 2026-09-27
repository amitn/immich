import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { OrientationStatus, OrientationStatusSchema } from 'src/enum.js';
import { isoDatetimeToDate } from 'src/validation.js';

const RotationSchema = z
  .int()
  .refine((value) => [90, 180, 270].includes(value), { error: 'Rotation must be 90, 180 or 270' })
  .describe('Clockwise turn in degrees: 90, 180 or 270');

const OrientationScanSchema = z
  .object({
    albumId: z.uuidv4().optional().describe('Only the photos of this album'),
    takenAfter: isoDatetimeToDate.optional().describe('Only the photos taken at or after this date'),
    takenBefore: isoDatetimeToDate.optional().describe('Only the photos taken before this date'),
  })
  .meta({ id: 'OrientationScanDto' });

const OrientationSuggestionsQuerySchema = z
  .object({
    status: OrientationStatusSchema.optional().describe('Only the suggestions with this status (default suggested)'),
  })
  .meta({ id: 'OrientationSuggestionsQueryDto' });

const OrientationSuggestionResponseSchema = z
  .object({
    assetId: z.uuidv4().describe('Asset ID'),
    status: OrientationStatusSchema,
    rotate: z.int().describe('Clockwise turn in degrees that makes the photo upright: 90, 180 or 270'),
    confidence: z.number().min(0).max(1).describe('How sure the check is, 0 to 1').meta({ format: 'double' }),
    reasons: z.array(z.string()).describe('What the check saw: CLIP, faces, text'),
    checkedAt: isoDatetimeToDate.describe('When the photo was checked'),
  })
  .meta({ id: 'OrientationSuggestionResponseDto' });

const OrientationFixSchema = z
  .object({
    assetIds: z.array(z.uuidv4()).min(1).max(1000).describe('Photos to turn'),
    rotate: RotationSchema.optional().describe(
      'Clockwise turn in degrees (90, 180 or 270); default: the suggested one',
    ),
  })
  .meta({ id: 'OrientationFixDto' });

const OrientationAssetsSchema = z
  .object({
    assetIds: z.array(z.uuidv4()).min(1).max(1000).describe('Photos'),
  })
  .meta({ id: 'OrientationAssetsDto' });

export class OrientationScanDto extends createZodDto(OrientationScanSchema) {}
export class OrientationSuggestionsQueryDto extends createZodDto(OrientationSuggestionsQuerySchema) {}
export class OrientationSuggestionResponseDto extends createZodDto(OrientationSuggestionResponseSchema) {}
export class OrientationFixDto extends createZodDto(OrientationFixSchema) {}
export class OrientationAssetsDto extends createZodDto(OrientationAssetsSchema) {}

/** what an orientation check stores in the metadata of an asset (`AssetMetadataKey.Orientation`) */
export type OrientationRecord = {
  status: OrientationStatus;
  rotate: number;
  confidence: number;
  reasons: string[];
  checkedAt: string;
  reviewedAt?: string;
};

export const mapOrientationSuggestion = (row: {
  assetId: string;
  value: Record<string, unknown>;
}): OrientationSuggestionResponseDto => {
  const value = row.value as Partial<OrientationRecord>;
  return {
    assetId: row.assetId,
    status: value.status ?? OrientationStatus.Suggested,
    rotate: value.rotate ?? 0,
    confidence: Math.round((value.confidence ?? 0) * 1000) / 1000,
    reasons: value.reasons ?? [],
    checkedAt: new Date(value.checkedAt ?? 0),
  };
};
