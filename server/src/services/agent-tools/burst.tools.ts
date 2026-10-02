import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { BURST_CLEAN_MAX_GROUPS, BURST_GROUP_MAX_PHOTOS, BurstGroupResponseDto } from 'src/dtos/burst.dto.js';
import { BaseService } from 'src/services/base.service.js';
import { BURST_SCAN_LIMIT, BURST_TOOL_MAX_GROUPS, BurstScope, BurstService } from 'src/services/burst.service.js';
import { AgentTool, AgentToolResult, defineTool, toolError, toolJson } from 'src/utils/agent/tools.js';

const DEFAULT_GROUPS = 50;

const ScopeSchema = {
  albumId: z.uuid().optional().describe('Only the photos of this album'),
  takenAfter: z.string().optional().describe('Only the photos taken at or after this date (ISO), e.g. a trip start'),
  takenBefore: z.string().optional().describe('Only the photos taken before this date (ISO), e.g. the day after a trip'),
  preferRaw: z.boolean().optional().describe('Keep a RAW photo over the others (default false)'),
  preferEdited: z.boolean().optional().describe('Keep a photo edited in the app over the others (default true)'),
  preferLargest: z.boolean().optional().describe('Keep the photo with the most pixels (default false)'),
};

type ScopeInput = {
  albumId?: string;
  takenAfter?: string;
  takenBefore?: string;
  preferRaw?: boolean;
  preferEdited?: boolean;
  preferLargest?: boolean;
};

const toDate = (value?: string) => {
  if (value === undefined) {
    return;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Invalid date: ${value}`);
  }
  return date;
};

const toScope = (input: ScopeInput): BurstScope & { rules: Record<string, boolean | undefined> } => ({
  albumId: input.albumId,
  takenAfter: toDate(input.takenAfter),
  takenBefore: toDate(input.takenBefore),
  rules: { preferRaw: input.preferRaw, preferEdited: input.preferEdited, preferLargest: input.preferLargest },
});

const compactGroup = (group: BurstGroupResponseDto) => ({
  key: group.key,
  source: group.source,
  takenAt: group.takenAt.toISOString(),
  photos: group.assets.length,
  keepAssetId: group.keepAssetId,
  reasons: group.reasons,
  ...(group.readOnly ? { readOnly: true } : { archiveAssetIds: group.archiveAssetIds }),
});

/** Burst cleanup (#9): finding groups of near-identical photos, and keeping the best of each */
@Injectable()
export class BurstAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const bursts = () => BaseService.create(BurstService, this);

    return [
      defineTool({
        name: 'find_bursts',
        title: 'Find bursts',
        description:
          'Find groups of near-identical photos on the timeline: duplicate groups, stacks, and bursts taken seconds ' +
          'apart that look the same. Scope: an album, a date range (for a trip, its dates from find_events), or the ' +
          `whole library (the newest ${BURST_SCAN_LIMIT} photos). For each group: keepAssetId, the photo to keep ` +
          '(the rules first, then the score_photo quality score), reasons (raw, edited, largest, sharpest, ' +
          'bestExposed, mostFaces, largestFaces, favorite, highestRated, bestOverall) and archiveAssetIds, the ' +
          'photos clean_up_bursts would archive. Groups with photos of other users are readOnly. Changes nothing: ' +
          'it is the dry run of clean_up_bursts. Returns the newest `limit` groups, total and wouldArchive (for all).',
        input: z.object({
          ...ScopeSchema,
          limit: z
            .int()
            .min(1)
            .max(BURST_TOOL_MAX_GROUPS)
            .optional()
            .describe(`Groups to return, newest first (default ${DEFAULT_GROUPS})`),
        }),
        mutating: false,
        handler: ({ auth }, input) =>
          this.run(async () => {
            const { groups, total, totalToArchive, scanned, truncated } = await bursts().find(auth, {
              ...toScope(input),
              limit: input.limit ?? DEFAULT_GROUPS,
            });
            return toolJson({
              total,
              ...(groups.length < total && { shown: groups.length }),
              wouldArchive: totalToArchive,
              scanned,
              ...(truncated && { truncated: true }),
              groups: groups.map((group) => compactGroup(group)),
            });
          }),
      }),
      defineTool({
        name: 'clean_up_bursts',
        title: 'Clean up bursts',
        description:
          'Keep the best photo of each group of near-identical photos and archive the others (never delete them; ' +
          'they stay in the archive, and the change can be undone from the activity log). Pass the groups ' +
          'find_bursts returned ({assetIds: [keepAssetId, ...archiveAssetIds], keepAssetId}, with another keeper ' +
          'when the user picked one), or the same scope and rules as find_bursts to clean up every group of it (at ' +
          `most the newest ${BURST_TOOL_MAX_GROUPS}). Run find_bursts first and tell the user what will be archived. ` +
          "Only the user's own photos are archived; groups with photos of others are skipped. dryRun only counts.",
        input: z.object({
          ...ScopeSchema,
          groups: z
            .array(
              z.object({
                assetIds: z.array(z.uuid()).min(2).max(BURST_GROUP_MAX_PHOTOS),
                keepAssetId: z.uuid(),
              }),
            )
            .min(1)
            .max(BURST_CLEAN_MAX_GROUPS)
            .optional()
            .describe('The groups to clean up; default: every group of the scope'),
          dryRun: z.boolean().optional().describe('Only count what would be archived'),
        }),
        mutating: true,
        handler: ({ auth, activity }, input) =>
          this.run(async () => {
            let groups = input.groups;
            if (!groups) {
              const found = await bursts().find(auth, { ...toScope(input), limit: BURST_TOOL_MAX_GROUPS });
              groups = found.groups
                .filter(({ readOnly }) => !readOnly)
                .map(({ assets, keepAssetId }) => ({ assetIds: assets.map(({ assetId }) => assetId), keepAssetId }));
              if (groups.length === 0) {
                return toolJson({ archived: 0, groups: 0, message: 'No bursts to clean up in this scope' });
              }
            }
            for (const group of groups) {
              if (!group.assetIds.includes(group.keepAssetId)) {
                throw new BadRequestException('keepAssetId must be one of the assetIds of its group');
              }
            }

            const result = await bursts().clean(auth, { groups, dryRun: input.dryRun }, activity);
            const skipped = result.groups.filter(({ error }) => error);
            return toolJson({
              ...(result.dryRun && { dryRun: true }),
              archived: result.archived,
              groups: result.groups.length - skipped.length,
              keptAssetIds: result.groups.filter(({ error }) => !error).map(({ keepAssetId }) => keepAssetId),
              ...(skipped.length > 0 && {
                skipped: skipped.map(({ keepAssetId, error }) => ({ keepAssetId, reason: error })),
              }),
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
        this.logger.error(`Burst tool failed: ${error?.message ?? error}`, error?.stack);
      }
      const message = error?.response?.message ?? error?.message ?? String(error);
      return toolError(Array.isArray(message) ? message.join('; ') : String(message));
    }
  }
}
