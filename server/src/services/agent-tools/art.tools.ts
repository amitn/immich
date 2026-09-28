import { Injectable } from '@nestjs/common';
import z from 'zod';
import { ActivityLogAction, ArtJobStatus, AssetFileType } from 'src/enum.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { ArtService } from 'src/services/art.service.js';
import { BaseService } from 'src/services/base.service.js';
import { CollectionService, PRIVATE_SOURCE_NOTE } from 'src/services/collection.service.js';
import { ART_PROMPT_LIMITS, artStyles, checkArtPrompt } from 'src/utils/agent/art-styles.js';
import { AgentTool, defineTool, toolError, toolImage, toolJson } from 'src/utils/agent/tools.js';

const MAX_WAIT_SECONDS = 90;

/** how to write a style prompt, from what the built-in ones share */
const PROMPT_GUIDE =
  'Write the prompt like the built-in styles (list_art_styles withPrompts): "Transform the reference photograph ' +
  'into <medium> of the exact same scene. Preserve the recognizable composition, subjects, people, poses and ' +
  'perspective of the reference photograph." then the materials, marks, palette and paper, and end with "No text." ' +
  'unless the style renders a caption, which is written as "{caption}" (usesCaption). The style must keep the ' +
  "photo's subject recognizable: it restyles the photo, it never replaces its people or scene. With photoAbove the " +
  'prompt paints only the lower half and must not include the photograph, which Immich places above it.';

/** Artistic style transforms, delegated to an ACP art agent */
@Injectable()
export class ArtAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const artService = BaseService.create(ArtService, this);

    return [
      defineTool({
        name: 'list_art_styles',
        title: 'List artistic styles',
        description:
          "List the artistic styles a photo can be transformed into (watercolor, gouache poster, linocut, cyanotype, 35mm film, …), then the user's own styles (owned, with their prompt). Styles with usesCaption render a short caption into the image. Pass withPrompts to see the prompts of the built-in styles too, e.g. as models for a new style.",
        input: z.object({
          withPrompts: z.boolean().optional().describe('Include the prompts of the built-in styles (default false)'),
        }),
        mutating: false,
        handler: async ({ auth }, { withPrompts }) => {
          const own = await artService.getUserStyles(auth);
          return toolJson([
            ...artStyles.map(({ id, name, description, usesCaption, photoAbove, prompt }) => ({
              id,
              name,
              description,
              usesCaption,
              ...(photoAbove && { photoAbove }),
              ...(withPrompts && { prompt }),
            })),
            ...own.map(({ id, name, description, usesCaption, photoAbove, prompt }) => ({
              id,
              name,
              description,
              usesCaption,
              ...(photoAbove && { photoAbove }),
              owned: true,
              prompt,
            })),
          ]);
        },
      }),
      defineTool({
        name: 'stylize_photo',
        title: 'Transform a photo into artwork',
        description:
          'Start turning one photo into artwork in a style from list_art_styles, or with a custom art direction prompt. A separate image-generation agent makes it, which takes 30 seconds to a few minutes. The result is saved as a new photo stacked with the original, and the original is never changed. Returns a jobId; then call get_artwork(jobId) to wait for and look at the result. Only the owner of a photo can transform it.',
        input: z.object({
          assetId: z.string().describe('Photo to transform'),
          style: z
            .string()
            .optional()
            .describe("Style id from list_art_styles: a built-in style, or the id of one of the user's own styles"),
          prompt: z
            .string()
            .optional()
            .describe(
              'Custom art direction instead of (or refining) a style; `{caption}` is replaced with the caption',
            ),
          caption: z
            .string()
            .max(100)
            .optional()
            .describe('Short caption for styles with usesCaption, e.g. "summer days" (2–4 words work best)'),
        }),
        mutating: true,
        handler: async ({ auth, activity }, { assetId, style, prompt, caption }) => {
          if (!style && !prompt) {
            return toolJson({ error: 'Pass a style or a prompt' });
          }
          const job = await artService.createJob(auth, { assetId, style, prompt, caption });
          const styleName = style ? (artStyles.find(({ id }) => id === style)?.name ?? 'your own style') : undefined;
          await BaseService.create(ActivityLogService, this).record(auth, activity, {
            action: ActivityLogAction.Artwork,
            summary: styleName ? `Made an artwork of a photo (${styleName})` : 'Made an artwork of a photo',
            targetId: job.id,
            assetIds: [assetId],
            undo: { jobId: job.id },
          });
          return toolJson({ jobId: job.id, status: job.status, next: 'call get_artwork with this jobId' });
        },
      }),
      defineTool({
        name: 'test_art_style',
        title: 'Test a draft art style',
        description:
          `Try a draft prompt for a new artistic style on one photo the user picked, before saving it with save_art_style. ${PROMPT_GUIDE} ` +
          'The artwork is saved as a new photo stacked with the original, marked as a style test in its description ' +
          '(tell the user they can delete the tests afterwards). Returns a jobId; call get_artwork(jobId) to look at ' +
          'the result, then refine the prompt and test again, or save it.',
        input: z.object({
          assetId: z.uuidv4().describe('Photo the user picked to test the style on'),
          prompt: z.string().describe(`Draft prompt, ${ART_PROMPT_LIMITS.min} to ${ART_PROMPT_LIMITS.max} characters`),
          caption: z
            .string()
            .max(100)
            .optional()
            .describe('Caption for a prompt with {caption}; without one, the art agent picks a short one'),
          photoAbove: z
            .boolean()
            .optional()
            .describe('Place the untouched photo above the artwork, for a prompt that paints only the lower half'),
        }),
        mutating: true,
        handler: async ({ auth, activity }, { assetId, prompt, caption, photoAbove }) => {
          const { errors, warnings } = checkArtPrompt(prompt, {
            usesCaption: prompt.includes('{caption}'),
            photoAbove,
          });
          if (errors.length > 0) {
            return toolError(errors.join('; '));
          }
          try {
            const job = await artService.createJob(auth, { assetId, prompt, caption }, { test: true, photoAbove });
            await BaseService.create(ActivityLogService, this).record(auth, activity, {
              action: ActivityLogAction.Artwork,
              summary: 'Tested a draft art style on a photo',
              targetId: job.id,
              assetIds: [assetId],
              undo: { jobId: job.id },
            });
            return toolJson({
              jobId: job.id,
              status: job.status,
              ...(warnings.length > 0 && { warnings }),
              next: 'call get_artwork with this jobId',
            });
          } catch (error: any) {
            return toolError(error?.response?.message ?? error?.message ?? String(error));
          }
        },
      }),
      defineTool({
        name: 'save_art_style',
        title: 'Save an art style',
        description: `Save an artistic style the user approved after testing it (test_art_style): it appears in the Artistic style dialog under "Your styles" and in list_art_styles, and stylize_photo takes its id. ${PROMPT_GUIDE}`,
        input: z.object({
          name: z.string().trim().min(1).max(100).describe('Short name, e.g. "Blueprint"'),
          description: z.string().trim().max(500).describe('One sentence on what the artwork looks like'),
          prompt: z
            .string()
            .describe(`The tested prompt, ${ART_PROMPT_LIMITS.min} to ${ART_PROMPT_LIMITS.max} characters`),
          usesCaption: z.boolean().describe('Whether the prompt renders a caption ("{caption}") into the image'),
          photoAbove: z
            .boolean()
            .optional()
            .describe('Place the untouched photo above the artwork, which paints only the lower half (default false)'),
        }),
        mutating: true,
        handler: async ({ auth, activity }, input) => {
          try {
            const style = await artService.createStyle(auth, input, activity);
            const { warnings } = checkArtPrompt(style.prompt, style);
            return toolJson({
              id: style.id,
              name: style.name,
              ...(warnings.length > 0 && { warnings }),
            });
          } catch (error: any) {
            const message = error?.response?.message ?? error?.message ?? String(error);
            return toolError(Array.isArray(message) ? message.join('; ') : String(message));
          }
        },
      }),
      defineTool({
        name: 'get_artwork',
        title: 'Get artwork',
        description: `Wait for an artwork job from stylize_photo (up to "wait" seconds, max ${MAX_WAIT_SECONDS}) and return its status. When it is completed, the result is returned as an image so you can review it, together with its asset id. Call again if it is still running.`,
        input: z.object({
          jobId: z.string(),
          wait: z.number().int().min(0).max(MAX_WAIT_SECONDS).optional().describe('Seconds to wait, default 60'),
        }),
        mutating: false,
        handler: async ({ auth }, { jobId, wait = 60 }) => {
          const job = await artService.waitForJob(auth, jobId, wait * 1000);
          const details = {
            jobId: job.id,
            status: job.status,
            ...(job.resultAssetId && { assetId: job.resultAssetId }),
            ...(job.error && { error: job.error }),
          };

          if (job.status !== ArtJobStatus.Completed || !job.resultAssetId) {
            return toolJson(details);
          }
          // the artwork of a travel document (or another private source) may still show its text: never shown
          const hidden = await BaseService.create(CollectionService, this).getPrivateSourceIds([job.sourceAssetId]);
          if (hidden.size > 0) {
            return toolJson({ ...details, note: PRIVATE_SOURCE_NOTE });
          }

          // the new asset's thumbnails may not exist yet, so resize the generated original
          const { originalPath } = await this.assetRepository.getForThumbnail(
            job.resultAssetId,
            AssetFileType.Preview,
            false,
          );
          const image = await this.withLocalFile(originalPath, (path) => this.mediaRepository.resizeToJpeg(path, 1024));
          return toolImage(image, 'image/jpeg', details);
        },
      }),
    ];
  }
}
