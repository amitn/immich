import { Injectable } from '@nestjs/common';
import z from 'zod';
import { BaseService } from 'src/services/base.service.js';
import { EnhanceService } from 'src/services/enhance.service.js';
import { ImproveService, ImprovedCopyResult } from 'src/services/improve.service.js';
import { MAX_STRAIGHTEN_DEGREES } from 'src/utils/agent/straighten.js';
import { AgentTool, defineTool, toolError, toolImage, toolJson } from 'src/utils/agent/tools.js';
import { enhanceCorrectionTypes, enhanceStrengths } from 'src/utils/enhance.js';

const StrengthSchema = z
  .enum(enhanceStrengths)
  .optional()
  .describe('How strongly to correct: subtle, normal (default) or strong');

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const MAX_IMPROVE = 50;

const RecipeSchema = z.object({
  id: z.uuidv4().describe('Asset ID of the photo'),
  enhance: z.object({ strength: z.enum(enhanceStrengths) }).optional(),
  rotate: z.number().min(-MAX_STRAIGHTEN_DEGREES).max(MAX_STRAIGHTEN_DEGREES).optional(),
  crop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().gt(0).max(1),
      height: z.number().gt(0).max(1),
    })
    .optional(),
  gain: z
    .number()
    .optional()
    .describe('Ignored; accepted so the improvements of select_best can be passed as they are'),
});

/** Automatic photo enhancement with local image processing */
@Injectable()
export class EnhanceAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const enhanceService = BaseService.create(EnhanceService, this);
    const improveService = BaseService.create(ImproveService, this);

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
        name: 'improve_photos',
        title: 'Improve photos',
        description:
          `Create one improved copy of each of up to ${MAX_IMPROVE} photos at full resolution, applying the fixes of ` +
          'its recipe in one go: straighten (rotate, degrees), crop (fractions of the straightened photo) and ' +
          'auto-enhance (levels, white balance, exposure, local contrast, vibrance, sharpening; no AI). Call it ' +
          'after select_best with its improvements (pass them as photos, as they are), or pass ids with auto=true ' +
          'to let the server choose the fixes. The originals are never changed: each copy is stacked with its ' +
          'original and tagged Edits/Improved. Returns {improved: [{sourceId, id, description}], skipped, ' +
          'copies: {originalId: copyId}}; use the copies instead of the originals in albums and books.',
        input: z.object({
          photos: z.array(RecipeSchema).max(MAX_IMPROVE).optional().describe('Photos with the recipe to apply'),
          ids: z.array(z.uuidv4()).max(MAX_IMPROVE).optional().describe('Photos whose fixes are chosen automatically'),
          auto: z.boolean().optional().describe('Choose the fixes of the ids automatically, default true'),
        }),
        mutating: true,
        handler: async ({ auth }, { photos = [], ids = [], auto }) => {
          const jobs = [
            ...photos.map(({ id, enhance, rotate, crop }) => ({ id, recipe: { enhance, rotate, crop } })),
            ...(auto === false ? [] : ids.map((id) => ({ id, recipe: 'auto' as const }))),
          ];
          if (jobs.length === 0) {
            return toolError('Pass photos with their recipes, or ids with auto=true');
          }
          if (jobs.length > MAX_IMPROVE) {
            return toolError(`At most ${MAX_IMPROVE} photos per call`);
          }

          const improved: Array<Pick<ImprovedCopyResult, 'sourceId' | 'id' | 'description'> & { duplicate?: true }> =
            [];
          const skipped: Array<{ id: string; reason: string }> = [];
          const seen = new Set<string>();
          // one at a time: every photo is decoded at full resolution
          for (const { id, recipe } of jobs) {
            if (seen.has(id)) {
              continue;
            }
            seen.add(id);
            try {
              const result = await improveService.createImprovedCopy(auth, id, recipe);
              improved.push({
                sourceId: result.sourceId,
                id: result.id,
                description: result.description,
                ...(result.duplicate && { duplicate: true }),
              });
            } catch (error) {
              skipped.push({ id, reason: errorMessage(error) });
            }
          }

          if (improved.length === 0) {
            return toolError(
              `No photo was improved: ${skipped.map(({ id, reason }) => `${id}: ${reason}`).join('; ')}`,
            );
          }
          return toolJson({
            improved,
            ...(skipped.length > 0 && { skipped }),
            copies: Object.fromEntries(improved.map(({ sourceId, id }) => [sourceId, id])),
          });
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
