import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { MemoryExclusionCreateDto } from 'src/dtos/memory-exclusion.dto.js';
import { YearRecapExclusionOptions } from 'src/dtos/year-recap.dto.js';
import { MemoryExclusionType } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { MemoryExclusionService } from 'src/services/memory-exclusion.service.js';
import { YearRecapService } from 'src/services/year-recap.service.js';
import { AgentTool, AgentToolResult, defineTool, toolError, toolJson } from 'src/utils/agent/tools.js';
import { HIGHLIGHT_FORMATS, MAX_HIGHLIGHT_DURATION, MIN_HIGHLIGHT_DURATION } from 'src/utils/highlight/plan.js';

const day = z.iso.date().describe('YYYY-MM-DD, the local date of the photos');
const dateRange = z.object({ startDate: day, endDate: day.describe('The last day, included') });
const year = z.int().min(1900).max(2100).describe('The year, e.g. 2026');

/** what one recap leaves out besides the memory exclusions: "my 2026 recap without Dana and without March" */
const recapExclusions = {
  excludePersonIds: z
    .array(z.string())
    .max(100)
    .optional()
    .describe('People or pets (ids from find_people or get_memory_exclusions) to leave out of this recap only'),
  excludePeopleNamed: z
    .array(z.string())
    .max(100)
    .optional()
    .describe('People or pets to leave out of this recap only, by their exact name (pets included)'),
  excludeAlbumIds: z.array(z.string()).max(100).optional().describe('Albums to leave out of this recap only'),
  excludeDateRanges: z.array(dateRange).max(100).optional().describe('Days to leave out of this recap only'),
  excludeDocuments: z.boolean().optional().describe('Leave screenshots, receipts and documents out of this recap only'),
};

type RecapExclusionInput = {
  excludePersonIds?: string[];
  excludePeopleNamed?: string[];
  excludeAlbumIds?: string[];
  excludeDateRanges?: Array<{ startDate: string; endDate: string }>;
  excludeDocuments?: boolean;
};

/**
 * The memory exclusions (people and pets, days, albums, screenshots and documents kept out of the memories and of
 * everything made of them) and the year in review (#12): "make my 2026 recap without …"
 */
@Injectable()
export class YearRecapAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const exclusions = BaseService.create(MemoryExclusionService, this);
    const recaps = BaseService.create(YearRecapService, this);

    return [
      defineTool({
        name: 'get_memory_exclusions',
        title: 'Get the memory exclusions',
        description:
          'List what the user keeps out of their memories and of everything made of them (memory cards, the year ' +
          'recap, the videos, books and collages of a memory, the suggested books): people and pets, albums, ranges ' +
          'of days (each with its exclusionId), and whether screenshots, receipts and documents are left out.',
        input: z.object({}),
        mutating: false,
        handler: ({ auth }) =>
          this.run(async () => {
            const { exclusions: items, documents } = await exclusions.getAll(auth);
            return toolJson({
              exclusions: items.map((item) => ({
                exclusionId: item.id,
                type: item.type,
                ...(item.person && { personId: item.person.id, name: item.person.name, isPet: item.person.isPet }),
                ...(item.album && { albumId: item.album.id, name: item.album.albumName }),
                ...(item.startDate && { startDate: item.startDate, endDate: item.endDate }),
              })),
              documents,
            });
          }),
      }),

      defineTool({
        name: 'set_memory_exclusions',
        title: 'Change the memory exclusions',
        description:
          'Keep people or pets, albums or ranges of days out of the memories for good (the memories already made ' +
          'included, and everything made of them), let some back in (removeExclusionIds from get_memory_exclusions), ' +
          'or switch screenshots, receipts and documents off or on. One change of the activity log: it can be undone. ' +
          'For one recap only, pass the exclusions to the year recap tools instead.',
        input: z.object({
          personIds: z.array(z.string()).max(100).optional().describe('People or pets to leave out (find_people ids)'),
          peopleNamed: z
            .array(z.string())
            .max(100)
            .optional()
            .describe('People or pets to leave out, by their exact name (pets included)'),
          albumIds: z.array(z.string()).max(100).optional().describe('Albums whose photos to leave out'),
          dateRanges: z.array(dateRange).max(100).optional().describe('Days to leave out'),
          removeExclusionIds: z.array(z.string()).max(100).optional().describe('Exclusions to remove'),
          documents: z.boolean().optional().describe('true: leave screenshots, receipts and documents out'),
        }),
        mutating: true,
        handler: ({ auth, activity }, input) =>
          this.run(async () => {
            const personIds = await this.resolvePeople(auth.user.id, input.personIds, input.peopleNamed);
            const add: MemoryExclusionCreateDto[] = [
              ...personIds.map((personId) => ({ type: MemoryExclusionType.Person, personId })),
              ...(input.albumIds ?? []).map((albumId) => ({ type: MemoryExclusionType.Album, albumId })),
              ...(input.dateRanges ?? []).map(({ startDate, endDate }) => {
                if (startDate > endDate) {
                  throw new Error(`The date range ${startDate}..${endDate} ends before it starts`);
                }
                return { type: MemoryExclusionType.DateRange, startDate, endDate };
              }),
            ];
            const result = await exclusions.change(
              auth,
              { add, removeIds: input.removeExclusionIds, documents: input.documents },
              activity,
            );
            return toolJson({
              added: result.added.map(({ id }) => id),
              removed: result.removedIds,
              exclusions: result.exclusions.length,
              note: 'The memories, the year recap and what is made of them now leave these photos out',
            });
          }),
      }),

      defineTool({
        name: 'get_year_recap',
        title: 'Get the recap of a year',
        description:
          'The year in review: how many photos and videos, the places (cities, countries), the people and pets, the ' +
          'trips, and what the journals saw (dishes and restaurants, museums, wines, concerts, books…), without what ' +
          'the user keeps out of their memories and what you pass to leave out of this recap. Also its memoryId ' +
          '(the year_recap memory made early in January, when there is one) and the book of the year waiting to be ' +
          'kept or discarded. Use it before make_year_recap_video or make_year_recap_book, to tell the user what the ' +
          'recap holds.',
        input: z.object({ year, ...recapExclusions }),
        mutating: false,
        handler: ({ auth }, { year, ...input }) =>
          this.run(async () => {
            const recap = await recaps.get(auth, year, await this.toOptions(auth.user.id, input));
            return toolJson({
              year: recap.year,
              ...(recap.memoryId && { memoryId: recap.memoryId }),
              stats: recap.stats,
              ...(recap.draft && {
                bookDraft: { bookId: recap.draft.book.id, title: recap.draft.book.title, reason: recap.draft.reason },
              }),
            });
          }),
      }),

      defineTool({
        name: 'make_year_recap_video',
        title: 'Make the video of a year',
        description:
          'Start a highlight video of a year in review, landscape (16:9) or vertical (9:16, for phones and social ' +
          'apps), from the photos and videos of the whole year without what the user keeps out of their memories, ' +
          'and without what you pass to leave out of this recap ("my 2026 recap without Dana"). Returns a ' +
          'highlightId; follow it with get_highlight_video.',
        input: z.object({
          year,
          ...recapExclusions,
          format: z.enum(HIGHLIGHT_FORMATS).optional().describe('landscape (default) or vertical'),
          durationSeconds: z.int().min(MIN_HIGHLIGHT_DURATION).max(MAX_HIGHLIGHT_DURATION).optional(),
          title: z.string().max(200).optional().describe('Title card, default "<year> in review"'),
          musicId: z.string().optional().describe('An audio file of the user, from list_highlight_music'),
        }),
        mutating: true,
        handler: ({ auth, activity }, { year, format, durationSeconds, title, musicId, ...input }) =>
          this.run(async () => {
            const options = await this.toOptions(auth.user.id, input);
            const job = await recaps.createVideo(
              auth,
              year,
              { ...options, format, durationSeconds, title, music: musicId },
              activity,
            );
            return toolJson({
              highlightId: job.id,
              title: job.title,
              status: job.status,
              format: job.format,
              next: 'call get_highlight_video with this highlightId to wait for the video',
            });
          }),
      }),

      defineTool({
        name: 'make_year_recap_book',
        title: 'Make the book of a year',
        description:
          'Lay out a photo book of a year in review as a draft that the user keeps or discards (like the suggested ' +
          'books, see list_book_drafts), from the photos of the whole year without what the user keeps out of their ' +
          'memories and without what you pass to leave out of this recap. Without exclusions of its own it returns ' +
          'the draft already waiting, when there is one. Returns the bookId.',
        input: z.object({
          year,
          ...recapExclusions,
          title: z.string().max(200).optional().describe('Title, default "<year> in review"'),
        }),
        mutating: true,
        handler: ({ auth }, { year, title, ...input }) =>
          this.run(async () => {
            const options = await this.toOptions(auth.user.id, input);
            const draft = await recaps.createBook(auth, year, { ...options, title });
            return toolJson({
              bookId: draft.book.id,
              title: draft.book.title,
              pageCount: draft.book.pageCount,
              reason: draft.reason,
              next: 'the user keeps or discards it in Books, or with keep_book_draft / discard_book_draft',
            });
          }),
      }),
    ];
  }

  /** the ids of people and pets given by id or by exact name; an unknown name is an error */
  private async resolvePeople(ownerId: string, ids: string[] = [], names: string[] = []) {
    const found = await this.memoryExclusionRepository.findPeopleByName(ownerId, names);
    const missing = names.filter((name) =>
      found.every((person) => person.name.trim().toLowerCase() !== name.trim().toLowerCase()),
    );
    if (missing.length > 0) {
      throw new Error(`No person or pet is named ${missing.join(', ')}: use find_people to look them up`);
    }
    return [...new Set([...ids, ...found.map(({ id }) => id)])];
  }

  private async toOptions(ownerId: string, input: RecapExclusionInput): Promise<YearRecapExclusionOptions> {
    const personIds = await this.resolvePeople(ownerId, input.excludePersonIds, input.excludePeopleNamed);
    for (const { startDate, endDate } of input.excludeDateRanges ?? []) {
      if (startDate > endDate) {
        throw new Error(`The date range ${startDate}..${endDate} ends before it starts`);
      }
    }
    return {
      excludePersonIds: personIds,
      excludeAlbumIds: input.excludeAlbumIds,
      excludeDateRanges: input.excludeDateRanges,
      excludeDocuments: input.excludeDocuments,
    };
  }

  private async run(handler: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
    try {
      return await handler();
    } catch (error: any) {
      if (!(error instanceof HttpException) && !(error instanceof Error && error.message.startsWith('No person'))) {
        this.logger.warn(`Year recap tool failed: ${error?.message ?? error}`);
      }
      const message = error?.response?.message ?? error?.message ?? String(error);
      return toolError(Array.isArray(message) ? message.join('; ') : String(message));
    }
  }
}
