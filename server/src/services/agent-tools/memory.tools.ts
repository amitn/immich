import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { AssetType, MemoryType } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { MemorySourceService } from 'src/services/memory-source.service.js';
import { AgentTool, AgentToolResult, defineTool, toolError, toolJson } from 'src/utils/agent/tools.js';
import { MemorySource, MemorySourceKind, getMemorySource } from 'src/utils/memory-source.js';

/** the memories looked through to list them, the newest first */
const MAX_SCANNED_MEMORIES = 200;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

const memoryKinds = ['trip', 'birthday', 'period', 'people', 'day', 'curated'] as const satisfies MemorySourceKind[];

const toDay = (date?: Date) => date?.toISOString().slice(0, 10);

const summarize = (source: MemorySource, memory: { memoryAt: Date; isSaved: boolean }) => ({
  memoryId: source.memoryId,
  type: source.ruleId,
  kind: source.kind,
  title: source.title,
  ...(source.from && source.to && { from: toDay(source.from), to: toDay(source.to), dates: source.subtitle }),
  photoCount: source.assetIds.length,
  memoryAt: toDay(memory.memoryAt),
  ...(memory.isSaved && { saved: true }),
});

/**
 * The user's memories, as the rule engine made them (recent trips, trip anniversaries, birthdays, recaps of a month
 * or a season…): read-only, so that the assistant can make a highlight video, a book or a collage of "our last
 * trip" (#5). Memories are their owner's only.
 */
@Injectable()
export class MemoryAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const sources = BaseService.create(MemorySourceService, this);

    return [
      defineTool({
        name: 'list_memories',
        title: 'List memories',
        description:
          'List the memories Immich made for the user (the cards of the memory lane): recent trips and trip ' +
          'anniversaries (kind trip), birthdays, recaps of a month or a season, favorites, videos, people, a day years ' +
          'ago. Each has its memoryId, type (the rule), kind, title, the dates of the whole moment it stands for ' +
          '(from, to; e.g. every day of the trip) and how many photos the card shows. The newest moments come first. ' +
          'Use it for "make a video of our last trip": take the first memory of kind trip and pass its memoryId to ' +
          'make_highlight_video, auto_layout_book or make_collage, which use every photo of its window, not only the ' +
          'ones the card shows.',
        input: z.object({
          kind: z.enum(memoryKinds).optional().describe('Only memories of this kind, e.g. trip'),
          limit: z
            .int()
            .min(1)
            .max(MAX_LIST_LIMIT)
            .optional()
            .describe(`At most this many, default ${DEFAULT_LIST_LIMIT}`),
        }),
        mutating: false,
        handler: ({ auth }, { kind, limit = DEFAULT_LIST_LIMIT }) =>
          this.run(async () => {
            const memories = await this.memoryRepository.search(auth.user.id, { size: MAX_SCANNED_MEMORIES });
            const listed = memories
              .map((memory) => ({
                memory,
                source: getMemorySource({
                  id: memory.id,
                  type: memory.type as MemoryType,
                  data: memory.data,
                  memoryAt: new Date(memory.memoryAt),
                  assetIds: memory.assets.map(({ id }) => id),
                }),
              }))
              .filter(({ source }) => !kind || source.kind === kind)
              .toSorted(
                (a, b) =>
                  (b.source.to ?? new Date(b.memory.memoryAt)).getTime() -
                    (a.source.to ?? new Date(a.memory.memoryAt)).getTime() || a.memory.id.localeCompare(b.memory.id),
              )
              .slice(0, limit);
            return toolJson({
              memories: listed.map(({ memory, source }) =>
                summarize(source, { memoryAt: new Date(memory.memoryAt), isSaved: memory.isSaved }),
              ),
              ...(listed.length === 0 && {
                note: kind
                  ? `No memories of kind ${kind}. Memories are made every night from the photos, and kept for a while.`
                  : 'No memories yet. Memories are made every night from the photos.',
              }),
            });
          }),
      }),

      defineTool({
        name: 'get_memory',
        title: 'Get a memory',
        description:
          'Get a memory from list_memories: its title, the dates of the whole moment it stands for, and how many ' +
          'photos and videos of the user were taken in that window (what a video, a book or a collage of it is made ' +
          'from), with the ids of the photos the card shows.',
        input: z.object({ memoryId: z.string().describe('Memory ID from list_memories') }),
        mutating: false,
        handler: ({ auth }, { memoryId }) =>
          this.run(async () => {
            const { source, memory, assets } = await sources.resolve(auth, memoryId);
            const photos = assets.filter(({ type }) => type === AssetType.Image).length;
            return toolJson({
              ...summarize(source, memory),
              windowPhotoCount: photos,
              windowVideoCount: assets.length - photos,
              ...(source.personIds.length > 0 && { personIds: source.personIds }),
              ...(source.favoritesOnly && { favoritesOnly: true }),
              ...(source.videosOnly && { videosOnly: true }),
              cardAssetIds: source.assetIds,
              next:
                'pass this memoryId to make_highlight_video, auto_layout_book (to create a book) or make_collage ' +
                '(it picks the best photos)',
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
        this.logger.error(`Memory tool failed: ${error?.message ?? error}`, error?.stack);
      }
      const message = error?.response?.message ?? error?.message ?? String(error);
      return toolError(Array.isArray(message) ? message.join('; ') : String(message));
    }
  }
}
