import { Selectable } from 'kysely';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { ExtraModel } from 'src/decorators.js';
import { ArtJobStatusSchema } from 'src/enum.js';
import { ArtJobTable } from 'src/schema/tables/art-job.table.js';
import { ArtStyleTable } from 'src/schema/tables/art-style.table.js';
import { ART_PROMPT_LIMITS, type ArtStyle } from 'src/utils/agent/art-styles.js';
import { isoDatetimeToDate } from 'src/validation.js';

const ArtStyleSchema = z
  .object({
    id: z.string().describe("Style ID: a built-in style's name, or the UUID of one of the user's own styles"),
    name: z.string().describe('Style name'),
    description: z.string().describe('What the style looks like'),
    usesCaption: z.boolean().describe('Whether the style renders a caption into the image'),
    photoAbove: z.boolean().describe('Whether the untouched photo is placed above the artwork'),
    owned: z.boolean().describe("Whether it is one of the user's own styles (e.g. designed with the assistant)"),
  })
  .meta({ id: 'ArtStyleDto' });

const artStyleName = z.string().trim().min(1).max(100);
const artStyleDescription = z.string().trim().max(500);
const artStylePrompt = z
  .string()
  .trim()
  .min(ART_PROMPT_LIMITS.min)
  .max(ART_PROMPT_LIMITS.max)
  .describe(
    'Image-generation prompt, written like the built-in ones: transform the reference photograph into … of the exact ' +
      'same scene, keeping its subjects recognizable; `{caption}` is replaced with the caption when usesCaption',
  );

const ArtUserStyleCreateSchema = z
  .object({
    name: artStyleName.describe('Style name'),
    description: artStyleDescription.optional().describe('What the style looks like'),
    prompt: artStylePrompt,
    usesCaption: z.boolean().optional().describe('Whether the style renders a caption into the image (default false)'),
    photoAbove: z
      .boolean()
      .optional()
      .describe('Place the untouched photo above the artwork, which then only paints the lower half (default false)'),
  })
  .meta({ id: 'ArtUserStyleCreateDto' });

const ArtUserStyleUpdateSchema = z
  .object({
    name: artStyleName.optional().describe('Style name'),
    description: artStyleDescription.optional().describe('What the style looks like'),
    prompt: artStylePrompt.optional(),
    usesCaption: z.boolean().optional().describe('Whether the style renders a caption into the image'),
    photoAbove: z.boolean().optional().describe('Place the untouched photo above the artwork'),
  })
  .meta({ id: 'ArtUserStyleUpdateDto' });

const ArtUserStyleResponseSchema = ArtStyleSchema.extend({
  id: z.uuidv4().describe('Style ID'),
  prompt: z.string().describe('Image-generation prompt'),
  createdAt: isoDatetimeToDate.describe('Creation date'),
  updatedAt: isoDatetimeToDate.describe('Last update date'),
}).meta({ id: 'ArtUserStyleResponseDto' });

const ArtJobCreateSchema = z
  .object({
    assetId: z.uuidv4().describe('Photo to transform'),
    style: z
      .string()
      .optional()
      .describe("Style ID, see the art styles endpoint: a built-in style, or the UUID of one of the user's own styles"),
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
export class ArtUserStyleCreateDto extends createZodDto(ArtUserStyleCreateSchema) {}
export class ArtUserStyleUpdateDto extends createZodDto(ArtUserStyleUpdateSchema) {}
export class ArtUserStyleResponseDto extends createZodDto(ArtUserStyleResponseSchema) {}
export class ArtJobCreateDto extends createZodDto(ArtJobCreateSchema) {}
@ExtraModel()
export class ArtJobResponseDto extends createZodDto(ArtJobResponseSchema) {}

export const mapArtStyle = (
  { id, name, description, usesCaption, photoAbove }: ArtStyle,
  owned = false,
): ArtStyleDto => ({
  id,
  name,
  description,
  usesCaption,
  photoAbove: !!photoAbove,
  owned,
});

export const mapArtUserStyle = (row: Selectable<ArtStyleTable>): ArtUserStyleResponseDto => ({
  ...mapArtStyle(row, true),
  id: row.id,
  prompt: row.prompt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
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
