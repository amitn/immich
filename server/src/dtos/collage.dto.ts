import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { BookStylePresetSchema } from 'src/dtos/book.dto.js';
import { MAX_COLLAGE_PHOTOS, MIN_COLLAGE_PHOTOS, collageAspectRatios } from 'src/utils/book/collage.js';

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
    .describe(`Photos of the collage, ${MIN_COLLAGE_PHOTOS} to ${MAX_COLLAGE_PHOTOS}`),
  aspectRatio: CollageAspectRatioSchema.optional().describe('Aspect ratio, width:height (default 1:1)'),
  layout: z
    .string()
    .max(100)
    .optional()
    .describe('Layout (see POST /collages/layouts); default: the one that fits the photos best'),
  stylePreset: BookStylePresetSchema.optional().describe('A book style preset (default classic)'),
  styleId: z.uuidv4().optional().describe("One of the user's own book styles (see GET /book-styles)"),
  title: z.string().trim().max(100).optional().describe('Title, drawn in a band at the foot of the collage'),
};

const onlyOneStyle = (dto: { stylePreset?: string; styleId?: string }) => !(dto.stylePreset && dto.styleId);
const onlyOneStyleError = { error: 'Pass either stylePreset or styleId, not both' };

const CollageSchema = z.object(collageOptions).refine(onlyOneStyle, onlyOneStyleError).meta({ id: 'CollageDto' });

const CollageCreateSchema = z
  .object({
    ...collageOptions,
    albumId: z.uuidv4().optional().describe('Album to add the collage to, e.g. the album the photos were picked in'),
  })
  .refine(onlyOneStyle, onlyOneStyleError)
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
  })
  .meta({ id: 'CollageLayoutsResponseDto' });

const CollageResponseSchema = z
  .object({
    assetId: z.uuidv4().describe('The new image asset'),
    duplicate: z.boolean().describe('An identical collage had already been saved, and is returned instead'),
    layout: z.string().describe('Layout the collage was drawn with'),
    tag: z.string().describe('Tag of the collage, Collages/<title or dates>'),
  })
  .meta({ id: 'CollageResponseDto' });

export class CollageDto extends createZodDto(CollageSchema) {}
export class CollageCreateDto extends createZodDto(CollageCreateSchema) {}
export class CollageRenderDto extends createZodDto(CollageRenderSchema) {}
export class CollageLayoutsResponseDto extends createZodDto(CollageLayoutsResponseSchema) {}
export class CollageResponseDto extends createZodDto(CollageResponseSchema) {}
