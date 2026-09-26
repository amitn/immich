import { Selectable } from 'kysely';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import type { ArtStyle } from 'src/utils/agent/art-styles.js';
import { ExtraModel } from 'src/decorators.js';
import { ArtJobStatusSchema } from 'src/enum.js';
import { ArtJobTable } from 'src/schema/tables/art-job.table.js';
import { isoDatetimeToDate } from 'src/validation.js';

const ArtStyleSchema = z
  .object({
    id: z.string().describe('Style ID'),
    name: z.string().describe('Style name'),
    description: z.string().describe('What the style looks like'),
    usesCaption: z.boolean().describe('Whether the style renders a caption into the image'),
  })
  .meta({ id: 'ArtStyleDto' });

const ArtJobCreateSchema = z
  .object({
    assetId: z.uuidv4().describe('Photo to transform'),
    style: z.string().optional().describe('Style ID, see the art styles endpoint'),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(5000)
      .optional()
      .describe('Custom art direction; replaces the style prompt. `{caption}` is replaced with the caption'),
    caption: z.string().trim().max(100).optional().describe('Caption for styles that render one'),
  })
  .refine((dto) => dto.style !== undefined || dto.prompt !== undefined, { error: 'Either style or prompt is required' })
  .meta({ id: 'ArtJobCreateDto' });

const ArtJobResponseSchema = z
  .object({
    id: z.uuidv4().describe('Job ID'),
    sourceAssetId: z.uuidv4().describe('Photo that is transformed'),
    resultAssetId: z.uuidv4().nullable().describe('Generated artwork, once the job completed'),
    style: z.string().nullable().describe('Style ID'),
    caption: z.string().nullable().describe('Caption'),
    status: ArtJobStatusSchema,
    error: z.string().nullable().describe('Why the job failed'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
    updatedAt: isoDatetimeToDate.describe('Last update date'),
  })
  .meta({ id: 'ArtJobResponseDto' });

export class ArtStyleDto extends createZodDto(ArtStyleSchema) {}
export class ArtJobCreateDto extends createZodDto(ArtJobCreateSchema) {}
@ExtraModel()
export class ArtJobResponseDto extends createZodDto(ArtJobResponseSchema) {}

export const mapArtStyle = ({ id, name, description, usesCaption }: ArtStyle): ArtStyleDto => ({
  id,
  name,
  description,
  usesCaption,
});

export const mapArtJob = (job: Selectable<ArtJobTable>): ArtJobResponseDto => ({
  id: job.id,
  sourceAssetId: job.sourceAssetId,
  resultAssetId: job.resultAssetId,
  style: job.style,
  caption: job.caption,
  status: job.status,
  error: job.error,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});
