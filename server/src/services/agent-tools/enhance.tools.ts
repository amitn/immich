import { Injectable } from '@nestjs/common';
import z from 'zod';
import { BaseService } from 'src/services/base.service.js';
import { EnhanceService } from 'src/services/enhance.service.js';
import { AgentTool, defineTool, toolError, toolImage, toolJson } from 'src/utils/agent/tools.js';
import { enhanceCorrectionTypes, enhanceStrengths } from 'src/utils/enhance.js';

const StrengthSchema = z
  .enum(enhanceStrengths)
  .optional()
  .describe('How strongly to correct: subtle, normal (default) or strong');

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Automatic photo enhancement with local image processing */
@Injectable()
export class EnhanceAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const enhanceService = BaseService.create(EnhanceService, this);

    return [
      defineTool({
        name: 'suggest_enhancement',
        title: 'Suggest enhancement',
        description:
          'Analyze a photo for automatic enhancement without changing anything: auto levels, white balance, exposure (gamma), local contrast (CLAHE), saturation, sharpening and noise reduction. Local image processing only, no AI. Returns the corrections it would apply with the reason for each, the corrections it skipped (notes), whether the photo needs enhancing at all (needed), and a before/after image of the preview so you can judge whether the result is an improvement. Use it before enhance_photo, and skip photos that do not need it.',
        input: z.object({
          id: z.uuidv4().describe('Asset ID of the photo'),
          strength: StrengthSchema,
        }),
        mutating: false,
        handler: async ({ auth }, { id, strength }) => {
          try {
            const analysis = await enhanceService.analyze(auth, id, { strength });
            const comparison = await enhanceService.renderEnhancePreview(auth, id, { strength });
            return toolImage(comparison, 'image/jpeg', analysis);
          } catch (error) {
            return toolError(`Could not analyze ${id}: ${errorMessage(error)}`);
          }
        },
      }),

      defineTool({
        name: 'enhance_photo',
        title: 'Enhance photo',
        description:
          'Create an automatically enhanced copy of a photo with local image processing (no AI) at full resolution. The original is never changed: the copy is a new asset stacked with the original, which stays the primary asset of the stack. Call suggest_enhancement first and skip photos that do not need it; pass "only" to limit the kinds of correction. Only the owner of a photo can enhance it. Returns the ID of the new asset and the adjustments that were applied.',
        input: z.object({
          id: z.uuidv4().describe('Asset ID of the photo'),
          strength: StrengthSchema,
          only: z
            .array(z.enum(enhanceCorrectionTypes))
            .optional()
            .describe('Only apply these kinds of correction, e.g. ["whiteBalance", "exposure"]'),
        }),
        mutating: true,
        handler: async ({ auth }, { id, strength, only }) => {
          try {
            return toolJson(await enhanceService.createEnhancedCopy(auth, id, { strength, only }));
          } catch (error) {
            return toolError(`Could not enhance ${id}: ${errorMessage(error)}`);
          }
        },
      }),
    ];
  }
}
