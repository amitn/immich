import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { BookStylePresetSchema } from 'src/dtos/book.dto.js';
import {
  DEFAULT_MEMORY_COLLAGE_PHOTOS,
  MAX_COLLAGE_PHOTOS,
  MIN_COLLAGE_PHOTOS,
  collageAspectRatios,
} from 'src/utils/book/collage.js';

const CollageAspectRatioSchema = z
  .enum(collageAspectRatios)
  .describe('Aspect ratio of the collage, width:height')
  .meta({ id: 'CollageAspectRatio' });

const collageOptions = {
  assetIds: z
    .array(z.uuidv4())
    .min(MIN_COLLAGE_PHOTOS)
    .max(MAX_COLLAGE_PHOTOS)
    .refine((ids) => new Set(ids).size === ids.length, { error: 'The photos must be different' })
    .optional()
    .describe(`Photos of the collage, ${MIN_COLLAGE_PHOTOS} to ${MAX_COLLAGE_PHOTOS}`),
  memoryId: z
    .uuidv4()
    .optional()
    .describe(
      'Memory to make the collage of instead of assetIds: its best photos are picked from the whole moment it stands ' +
        'for (e.g. one or two of every day of a trip), the same ones every time',
    ),
  count: z
    .int()
    .min(MIN_COLLAGE_PHOTOS)
    .max(MAX_COLLAGE_PHOTOS)
    .optional()
    .describe(`With memoryId: how many photos to pick (default ${DEFAULT_MEMORY_COLLAGE_PHOTOS})`),
  aspectRatio: CollageAspectRatioSchema.optional().describe('Aspect ratio, width:height (default 1:1)'),
  layout: z
    .string()
    .max(100)
    .optional()
    .describe('Layout (see POST /collages/layouts); default: the one that fits the photos best'),
  stylePreset: BookStylePresetSchema.optional().describe('A book style preset (default classic)'),
  styleId: z.uuidv4().optional().describe("One of the user's own book styles (see GET /book-styles)"),
  title: z
    .string()
    .trim()
    .max(100)
    .optional()
    .describe('Title, drawn in a band at the foot of the collage (default with memoryId: the title of the memory)'),
};

const onlyOneStyle = (dto: { stylePreset?: string; styleId?: string }) => !(dto.stylePreset && dto.styleId);
const onlyOneStyleError = { error: 'Pass either stylePreset or styleId, not both' };
const onlyOneSource = (dto: { assetIds?: string[]; memoryId?: string }) => !dto.assetIds !== !dto.memoryId;
const onlyOneSourceError = { error: 'Pass either assetIds or memoryId' };

const CollageSchema = z
  .object(collageOptions)
  .refine(onlyOneStyle, onlyOneStyleError)
  .refine(onlyOneSource, onlyOneSourceError)
  .meta({ id: 'CollageDto' });

const CollageCreateSchema = z
  .object({
    ...collageOptions,
    albumId: z.uuidv4().optional().describe('Album to add the collage to, e.g. the album the photos were picked in'),
  })
  .refine(onlyOneStyle, onlyOneStyleError)
  .refine(onlyOneSource, onlyOneSourceError)
  .meta({ id: 'CollageCreateDto' });

const CollageRenderSchema = z
  .object({
    ...collageOptions,
    full: z
      .boolean()
      .optional()
      .describe('Render at full size (3000 px on the long edge) from the originals, e.g. to download; default preview'),
  })
  .refine(onlyOneStyle, onlyOneStyleError)
  .refine(onlyOneSource, onlyOneSourceError)
  .meta({ id: 'CollageRenderDto' });

const CollageLayoutSchema = z
  .object({
    id: z.string().describe('Layout ID'),
    name: z.string().describe('Name of the layout'),
    description: z.string().describe('What the layout looks like'),
  })
  .meta({ id: 'CollageLayoutResponseDto' });

const CollageLayoutsResponseSchema = z
  .object({
    layouts: z
      .array(CollageLayoutSchema)
      .describe('The layouts for the number of photos, the one that fits them best first'),
    assetIds: z.array(z.uuidv4()).describe('The photos of the collage, e.g. those picked from a memory'),
  })
  .meta({ id: 'CollageLayoutsResponseDto' });

const CollageResponseSchema = z
  .object({
    assetId: z.uuidv4().describe('The new image asset'),
    duplicate: z.boolean().describe('An identical collage had already been saved, and is returned instead'),
    layout: z.string().describe('Layout the collage was drawn with'),
    tag: z.string().describe('Tag of the collage, Collages/<title or dates>'),
    assetIds: z.array(z.uuidv4()).describe('The photos of the collage, e.g. those picked from a memory'),
  })
  .meta({ id: 'CollageResponseDto' });

export class CollageDto extends createZodDto(CollageSchema) {}
export class CollageCreateDto extends createZodDto(CollageCreateSchema) {}
export class CollageRenderDto extends createZodDto(CollageRenderSchema) {}
export class CollageLayoutsResponseDto extends createZodDto(CollageLayoutsResponseSchema) {}
export class CollageResponseDto extends createZodDto(CollageResponseSchema) {}
