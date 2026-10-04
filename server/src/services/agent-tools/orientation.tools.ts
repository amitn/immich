import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { OrientationStatus } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { LIVE_ORIENTATION_LIMIT, OrientationService } from 'src/services/orientation.service.js';
import { AgentTool, AgentToolResult, defineTool, toolError, toolJson } from 'src/utils/agent/tools.js';

const toDate = (value?: string) => (value ? new Date(value) : undefined);

/** Photos stored sideways or upside down: finding them and turning them with a reversible edit */
@Injectable()
export class OrientationAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const orientation = BaseService.create(OrientationService, this);

    return [
      defineTool({
        name: 'find_rotated_photos',
        title: 'Find rotated photos',
        description:
          'Find photos stored sideways or upside down. Without a scope, lists the ones the background check already ' +
          'found and the user has not reviewed yet (on the Orientation page). With assetIds, an albumId or a date ' +
          `range, checks up to ${LIVE_ORIENTATION_LIMIT} of the user's own photos now (CLIP on four turns of each, ` +
          'confirmed by faces and text direction). Only confident cases are returned, with the clockwise turn that ' +
          'fixes each (rotate: 90, 180 or 270), how sure it is and why. Nothing is changed.',
        input: z.object({
          assetIds: z.array(z.string()).max(LIVE_ORIENTATION_LIMIT).optional().describe('Photos to check now'),
          albumId: z.string().optional().describe('Check the photos of this album now'),
          takenAfter: z.string().optional().describe('Check the photos taken at or after this date (ISO) now'),
          takenBefore: z.string().optional().describe('Check the photos taken before this date (ISO) now'),
        }),
        mutating: false,
        handler: ({ auth }, input) =>
          this.run(async () => {
            const live = input.assetIds || input.albumId || input.takenAfter || input.takenBefore;
            if (!live) {
              const suggestions = await orientation.getSuggestions(auth, OrientationStatus.Suggested);
              return toolJson({
                source: 'background check',
                photos: suggestions.map(({ assetId, rotate, confidence, reasons }) => ({
                  assetId,
                  rotate,
                  confidence,
                  reasons,
                })),
              });
            }
            const photos = await orientation.find(auth, {
              assetIds: input.assetIds,
              albumId: input.albumId,
              takenAfter: toDate(input.takenAfter),
              takenBefore: toDate(input.takenBefore),
            });
            return toolJson({ source: 'checked now', photos });
          }),
      }),
      defineTool({
        name: 'fix_rotation',
        title: 'Fix the rotation of photos',
        description:
          'Turn photos upright with a rotate edit, the same as turning them in the photo editor: no copy is made and ' +
          'it can be undone (the Orientation page, or removing the edit). Uses the turn find_rotated_photos found for ' +
          'each photo, or the given rotate (clockwise degrees: 90, 180 or 270) for all of them.',
        input: z.object({
          assetIds: z.array(z.string()).min(1).max(1000).describe('Photos to turn'),
          rotate: z
            .union([z.literal(90), z.literal(180), z.literal(270)])
            .optional()
            .describe('Clockwise turn for every photo; default: the turn found for each'),
        }),
        mutating: true,
        handler: ({ auth }, { assetIds, rotate }) =>
          this.run(async () => {
            if (rotate === undefined) {
              // photos checked live have no stored suggestion: record what was found, then fix them
              const suggestions = await orientation.getSuggestions(auth, OrientationStatus.Suggested);
              const pending = new Set(suggestions.map(({ assetId }) => assetId));
              const unchecked = assetIds.filter((id) => !pending.has(id));
              if (unchecked.length > 0) {
                await orientation.suggest(auth, unchecked);
              }
            }
            const results = await orientation.fix(auth, { assetIds, rotate });
            return toolJson({
              fixed: results.filter(({ success }) => success).map(({ id }) => id),
              failed: results
                .filter(({ success }) => !success)
                .map(({ id, error, errorMessage }) => ({ id, error: errorMessage ?? error })),
            });
          }),
      }),
    ];
  }

  private async run(handler: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
    try {
      return await handler();
    } catch (error: any) {
      if (!(error instanceof HttpException)) {
        this.logger.error(`Orientation tool failed: ${error?.message ?? error}`, error?.stack);
      }
      const message = error?.response?.message ?? error?.message ?? String(error);
      return toolError(Array.isArray(message) ? message.join('; ') : String(message));
    }
  }
}
