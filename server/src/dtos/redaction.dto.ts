import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { redactionKinds, redactionReasons, redactionStyles } from 'src/utils/redaction.js';

const double = () => z.number().meta({ format: 'double' });

/** the most regions a redacted copy blurs */
export const REDACTION_MAX_REGIONS = 200;

const RedactionKindSchema = z
  .enum(redactionKinds)
  .describe('What a region covers: a face, text, a number plate, a screen, or an area drawn by the user')
  .meta({ id: 'RedactionKind' });

const RedactionStyleSchema = z
  .enum(redactionStyles)
  .describe('How the regions are hidden: blurred or pixelated')
  .meta({ id: 'RedactionStyle' });

const RedactionReasonSchema = z
  .enum(redactionReasons)
  .describe(
    'Why a region is suggested: unknown (a face of nobody the library knows), person (a named person), kept (a person to keep), notChosen (not among the people to blur), personal (text that looks personal), plate, screen, document, other (other text, not selected) or manual',
  )
  .meta({ id: 'RedactionReason' });

const RedactionOptionsSchema = z.object({
  faces: z.boolean().optional().describe('Suggest the faces (default true); pets are never suggested'),
  keepPersonIds: z
    .array(z.uuidv4())
    .max(100)
    .optional()
    .describe('People whose faces are not blurred; the faces of everyone else are'),
  onlyPersonIds: z
    .array(z.uuidv4())
    .max(100)
    .optional()
    .describe('Blur only the faces of these people (the other faces are suggested, not selected)'),
  text: z
    .boolean()
    .optional()
    .describe(
      'Suggest the text (default true): text that looks personal, and the text of documents, is selected; other text, such as signs, is suggested only',
    ),
  plates: z.boolean().optional().describe('Suggest number plates (default true)'),
  screens: z.boolean().optional().describe('Suggest the text of screens (default true)'),
});

const RedactionSuggestSchema = RedactionOptionsSchema.refine((dto) => !(dto.keepPersonIds && dto.onlyPersonIds), {
  error: 'Pass keepPersonIds or onlyPersonIds, not both',
}).meta({ id: 'RedactionSuggestDto' });

const RedactionRectSchema = z
  .object({
    x: double().min(0).max(1).describe('Left edge, as a fraction of the photo width'),
    y: double().min(0).max(1).describe('Top edge, as a fraction of the photo height'),
    width: double().gt(0).max(1).describe('Width, as a fraction of the photo width'),
    height: double().gt(0).max(1).describe('Height, as a fraction of the photo height'),
    kind: RedactionKindSchema.optional().describe('What the region covers (default manual)'),
  })
  .describe('A region to blur, in fractions of the photo as it is shown (upright, with its edits)')
  .meta({ id: 'RedactionRectDto' });

const RedactionRenderSchema = z
  .object({
    regions: z.array(RedactionRectSchema).min(1).max(REDACTION_MAX_REGIONS).describe('The regions to blur'),
    style: RedactionStyleSchema.optional().describe('Blur (default) or pixelate'),
  })
  .meta({ id: 'RedactionPreviewDto' });

const RedactionCreateSchema = RedactionOptionsSchema.extend({
  regions: z
    .array(RedactionRectSchema)
    .max(REDACTION_MAX_REGIONS)
    .optional()
    .describe('The regions to blur; without them, the selected suggestions for the options are blurred'),
  style: RedactionStyleSchema.optional().describe('Blur (default) or pixelate'),
})
  .refine((dto) => !(dto.keepPersonIds && dto.onlyPersonIds), {
    error: 'Pass keepPersonIds or onlyPersonIds, not both',
  })
  .meta({ id: 'RedactionCreateDto' });

const RedactionRegionSchema = z
  .object({
    id: z.string().describe('Region ID within the photo, e.g. face:<face id>, text:<OCR box id> or screen'),
    kind: RedactionKindSchema,
    reason: RedactionReasonSchema,
    selected: z.boolean().describe('Whether the region is blurred unless deselected'),
    x: double().describe('Left edge, as a fraction of the photo width'),
    y: double().describe('Top edge, as a fraction of the photo height'),
    width: double().describe('Width, as a fraction of the photo width'),
    height: double().describe('Height, as a fraction of the photo height'),
    personId: z.uuidv4().nullable().optional().describe('The person of a face'),
    personName: z.string().nullable().optional().describe('The name of the person of a face'),
    text: z.string().optional().describe('The text OCR read'),
  })
  .meta({ id: 'RedactionRegionDto' });

const RedactionSuggestionResponseSchema = z
  .object({
    assetId: z.uuidv4().describe('Asset ID'),
    width: z.int().describe('Width of the photo as it is shown, in pixels (0 when unknown)'),
    height: z.int().describe('Height of the photo as it is shown, in pixels (0 when unknown)'),
    regions: z.array(RedactionRegionSchema).describe('The suggested regions'),
    hasFaces: z.boolean().describe('Whether face detection has run on the photo and found faces'),
    hasText: z.boolean().describe('Whether OCR has run on the photo and found text'),
    scene: z
      .object({
        vehicle: double().describe('How likely the photo shows a vehicle, 0 to 1'),
        screen: double().describe('How likely the photo shows a screen, 0 to 1'),
        document: double().describe('How likely the photo shows a document, 0 to 1'),
      })
      .nullable()
      .describe('What the photo shows, from its CLIP embedding; null without one'),
  })
  .meta({ id: 'RedactionSuggestionResponseDto' });

const RedactionResponseSchema = z
  .object({
    id: z.uuidv4().describe('ID of the redacted copy'),
    sourceId: z.uuidv4().describe('ID of the original photo, which is not changed'),
    regionCount: z.int().describe('Number of regions blurred'),
    description: z.string().describe('What was blurred, e.g. "3 faces, 1 number plate"'),
    duplicate: z.boolean().describe('An identical copy existed and was returned'),
  })
  .meta({ id: 'RedactionResponseDto' });

export class RedactionSuggestDto extends createZodDto(RedactionSuggestSchema) {}
export class RedactionPreviewDto extends createZodDto(RedactionRenderSchema) {}
export class RedactionCreateDto extends createZodDto(RedactionCreateSchema) {}
export class RedactionSuggestionResponseDto extends createZodDto(RedactionSuggestionResponseSchema) {}
export class RedactionResponseDto extends createZodDto(RedactionResponseSchema) {}

export type RedactionRectDto = z.infer<typeof RedactionRectSchema>;
