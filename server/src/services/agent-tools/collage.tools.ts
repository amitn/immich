import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { bookStylePresetIds } from 'src/dtos/book.dto.js';
import { BaseService } from 'src/services/base.service.js';
import { CollageService } from 'src/services/collage.service.js';
import { AgentTool, AgentToolResult, defineTool, toolError, toolImage, toolJson } from 'src/utils/agent/tools.js';
import { MAX_COLLAGE_PHOTOS, MIN_COLLAGE_PHOTOS, collageAspectRatios } from 'src/utils/book/collage.js';

const collageInput = {
  assetIds: z
    .array(z.string())
    .min(MIN_COLLAGE_PHOTOS)
    .max(MAX_COLLAGE_PHOTOS)
    .describe(`${MIN_COLLAGE_PHOTOS} to ${MAX_COLLAGE_PHOTOS} different photos`),
  aspectRatio: z
    .enum(collageAspectRatios)
    .optional()
    .describe('1:1 (default), 4:5 (portrait, e.g. for a feed), 9:16 (a phone screen, a story) or 16:9 (a screen)'),
  layout: z
    .string()
    .optional()
    .describe('A layout id from preview_collage; default: the one that fits the orientations of the photos best'),
  stylePreset: z.enum(bookStylePresetIds).optional().describe('A book style preset, default classic'),
  styleId: z.string().optional().describe("One of the user's own book styles (list_book_styles)"),
  title: z.string().max(100).optional().describe('A short title drawn at the foot, e.g. the place and the day'),
};

/** Collages: a few photos on one page, drawn with the book layouts and styles */
@Injectable()
export class CollageAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const collages = BaseService.create(CollageService, this);

    return [
      defineTool({
        name: 'preview_collage',
        title: 'Preview a collage',
        description:
          'Draw a collage of 2 to 9 photos on one page (nothing is saved) and list the layouts for that number of ' +
          'photos, the best fitting first. Look at it before make_collage: a layout that crops faces or a photo that ' +
          'repeats another one makes a weak collage.',
        input: z.object(collageInput),
        mutating: false,
        handler: ({ auth }, input) =>
          this.run(async () => {
            const [{ layouts }, image] = await Promise.all([
              collages.getLayouts(auth, input),
              collages.render(auth, input),
            ]);
            return toolImage(image, 'image/jpeg', {
              layout: input.layout ?? layouts[0]?.id,
              layouts: layouts.map(({ id, name }) => ({ id, name })),
            });
          }),
      }),
      defineTool({
        name: 'make_collage',
        title: 'Make a collage',
        description:
          'Save a collage of 2 to 9 photos as a new photo in the timeline (dated like its last photo, tagged ' +
          'Collages/<title or dates>, optionally added to an album). The layout is chosen from the book layouts to fit ' +
          'the orientations of the photos at the aspect ratio, in a book style (a preset or one of the user’s own), ' +
          'with an optional title. Returns the assetId of the collage to show the user.',
        input: z.object({
          ...collageInput,
          albumId: z.string().optional().describe('Album to add the collage to'),
        }),
        mutating: true,
        handler: ({ auth }, input) =>
          this.run(async () => {
            const result = await collages.create(auth, input);
            return toolJson(result);
          }),
      }),
    ];
  }

  private async run(handler: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
    try {
      return await handler();
    } catch (error: any) {
      if (!(error instanceof HttpException)) {
        this.logger.error(`Collage tool failed: ${error?.message ?? error}`, error?.stack);
      }
      const message = error?.response?.message ?? error?.message ?? String(error);
      return toolError(Array.isArray(message) ? message.join('; ') : String(message));
    }
  }
}
