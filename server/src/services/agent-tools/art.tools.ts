import { Injectable } from '@nestjs/common';
import z from 'zod';
import { ArtJobStatus, AssetFileType } from 'src/enum.js';
import { ArtService } from 'src/services/art.service.js';
import { BaseService } from 'src/services/base.service.js';
import { CollectionService, PRIVATE_SOURCE_NOTE } from 'src/services/collection.service.js';
import { artStyles } from 'src/utils/agent/art-styles.js';
import { AgentTool, defineTool, toolImage, toolJson } from 'src/utils/agent/tools.js';

const MAX_WAIT_SECONDS = 90;

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
          'List the artistic styles a photo can be transformed into (watercolor, gouache poster, linocut, cyanotype, 35mm film, …). Styles with usesCaption render a short caption into the image.',
        input: z.object({}),
        mutating: false,
        handler: () =>
          Promise.resolve(
            toolJson(
              artStyles.map(({ id, name, description, usesCaption }) => ({ id, name, description, usesCaption })),
            ),
          ),
      }),
      defineTool({
        name: 'stylize_photo',
        title: 'Transform a photo into artwork',
        description:
          'Start turning one photo into artwork in a style from list_art_styles, or with a custom art direction prompt. A separate image-generation agent makes it, which takes 30 seconds to a few minutes. The result is saved as a new photo stacked with the original, and the original is never changed. Returns a jobId; then call get_artwork(jobId) to wait for and look at the result. Only the owner of a photo can transform it.',
        input: z.object({
          assetId: z.string().describe('Photo to transform'),
          style: z.string().optional().describe('Style id from list_art_styles'),
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
        handler: async ({ auth }, { assetId, style, prompt, caption }) => {
          if (!style && !prompt) {
            return toolJson({ error: 'Pass a style or a prompt' });
          }
          const job = await artService.createJob(auth, { assetId, style, prompt, caption });
          return toolJson({ jobId: job.id, status: job.status, next: 'call get_artwork with this jobId' });
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
          return toolImage(await this.mediaRepository.resizeToJpeg(originalPath, 1024), 'image/jpeg', details);
        },
      }),
    ];
  }
}
