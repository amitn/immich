import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { enhanceCorrectionTypes, enhanceStrengths } from 'src/utils/enhance.js';

const double = () => z.number().meta({ format: 'double' });

const EnhanceStrengthSchema = z
  .enum(enhanceStrengths)
  .describe('How strongly to correct the photo')
  .meta({ id: 'EnhanceStrength' });

const EnhanceCorrectionTypeSchema = z
  .enum(enhanceCorrectionTypes)
  .describe('Kind of correction')
  .meta({ id: 'EnhanceCorrectionType' });

const enhanceOptions = {
  strength: EnhanceStrengthSchema.optional().describe('How strongly to correct the photo (default normal)'),
  only: z
    .array(EnhanceCorrectionTypeSchema)
    .max(enhanceCorrectionTypes.length)
    .optional()
    .describe('Only consider these corrections'),
};

const EnhancePreviewSchema = z.object(enhanceOptions).meta({ id: 'EnhancePreviewDto' });

const EnhancePreviewQuerySchema = z
  .object({ strength: enhanceOptions.strength })
  .meta({ id: 'EnhancePreviewQueryDto' });

const EnhanceSchema = z.object(enhanceOptions).meta({ id: 'EnhanceDto' });

const EnhancePlanSchema = z
  .object({
    levels: z
      .object({
        black: double().describe('Input value (0-255) that becomes black'),
        white: double().describe('Input value (0-255) that becomes white'),
      })
      .optional()
      .describe('Stretch of the tonal range'),
    whiteBalance: z
      .object({
        r: double().describe('Red multiplier'),
        g: double().describe('Green multiplier'),
        b: double().describe('Blue multiplier'),
      })
      .optional()
      .describe('Per-channel multipliers'),
    exposure: z
      .object({ gamma: double().describe('Gamma: above 1 brightens the midtones, below 1 darkens them') })
      .optional()
      .describe('Gamma correction'),
    localContrast: z
      .object({
        grid: z.int().describe('Number of tiles along each side'),
        clipLimit: double().describe('Contrast limit'),
        amount: double().describe('Blend with the original, 0-1'),
      })
      .optional()
      .describe('Contrast-limited adaptive histogram equalization (CLAHE) of the brightness'),
    saturation: z
      .object({ factor: double().describe('Saturation multiplier') })
      .optional()
      .describe('Saturation boost'),
    sharpen: z
      .object({
        sigma: double().describe('Radius of the unsharp mask'),
        m1: double().describe('Sharpening of flat areas'),
        m2: double().describe('Sharpening of edges'),
      })
      .optional()
      .describe('Unsharp mask'),
    denoise: z
      .object({ size: z.int().describe('Median filter size') })
      .optional()
      .describe('Noise reduction'),
  })
  .describe('Parameters of the corrections')
  .meta({ id: 'EnhancePlanDto' });

const EnhanceCorrectionSchema = z
  .object({
    type: EnhanceCorrectionTypeSchema,
    amount: double().describe('How strong the correction is, 0-1'),
    description: z.string().describe('What the correction does'),
    reason: z.string().describe('Why it is applied'),
  })
  .meta({ id: 'EnhanceCorrectionDto' });

const EnhanceAnalysisResponseSchema = z
  .object({
    assetId: z.uuidv4().describe('Asset ID'),
    strength: EnhanceStrengthSchema,
    needed: z.boolean().describe('Whether the photo would change noticeably'),
    adjustments: z.array(z.string()).describe('Human-readable list of the corrections'),
    corrections: z.array(EnhanceCorrectionSchema).describe('The corrections, in the order they are applied'),
    notes: z.array(z.string()).describe('Corrections that were considered and skipped, and why'),
    plan: EnhancePlanSchema,
  })
  .meta({ id: 'EnhanceAnalysisResponseDto' });

const EnhanceResponseSchema = z
  .object({
    id: z.uuidv4().describe('ID of the enhanced copy'),
    sourceId: z.uuidv4().describe('ID of the original'),
    adjustments: z.array(z.string()).describe('Human-readable list of the corrections'),
    duplicate: z.boolean().describe('An identical enhanced copy already existed and was returned instead'),
  })
  .meta({ id: 'EnhanceResponseDto' });

export class EnhancePreviewDto extends createZodDto(EnhancePreviewSchema) {}
export class EnhancePreviewQueryDto extends createZodDto(EnhancePreviewQuerySchema) {}
export class EnhanceDto extends createZodDto(EnhanceSchema) {}
export class EnhanceAnalysisResponseDto extends createZodDto(EnhanceAnalysisResponseSchema) {}
export class EnhanceResponseDto extends createZodDto(EnhanceResponseSchema) {}
