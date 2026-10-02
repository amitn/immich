import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { BookDraftResponseSchema } from 'src/dtos/book.dto.js';
import { HighlightFormatSchema } from 'src/dtos/highlight.dto.js';
import { MAX_HIGHLIGHT_DURATION, MIN_HIGHLIGHT_DURATION } from 'src/utils/highlight/plan.js';
import { MemoryExclusions } from 'src/utils/memory-exclusions.js';

const YearParamSchema = z
  .object({ year: z.coerce.number().int().min(1900).max(2100).describe('The year, e.g. 2026') })
  .meta({ id: 'YearRecapParamDto' });

const DateRangeSchema = z
  .object({
    startDate: z.iso.date().describe('First day left out (YYYY-MM-DD)'),
    endDate: z.iso.date().describe('Last day left out, included (YYYY-MM-DD)'),
  })
  .refine((range) => range.startDate <= range.endDate, { error: 'The date range ends before it starts' })
  .meta({ id: 'YearRecapDateRange' });

/** what one recap leaves out besides the user's memory exclusions ("my 2026 recap without …") */
const exclusionOptions = {
  excludePersonIds: z
    .array(z.uuidv4())
    .max(100)
    .optional()
    .describe('People or pets to leave out of this recap, besides the memory exclusions'),
  excludeAlbumIds: z.array(z.uuidv4()).max(100).optional().describe('Albums to leave out of this recap'),
  excludeDateRanges: z.array(DateRangeSchema).max(100).optional().describe('Days to leave out of this recap'),
  excludeDocuments: z
    .boolean()
    .optional()
    .describe('Leave screenshots, receipts and documents out of this recap, even when the memories keep them'),
};

const YearRecapQuerySchema = z.object(exclusionOptions).meta({ id: 'YearRecapQueryDto' });

const YearRecapBookSchema = z
  .object({
    ...exclusionOptions,
    title: z.string().trim().min(1).max(200).optional().describe('Title of the book (default "<year> in review")'),
  })
  .meta({ id: 'YearRecapBookDto' });

const YearRecapVideoSchema = z
  .object({
    ...exclusionOptions,
    title: z.string().trim().min(1).max(200).optional().describe('Title of the video (default "<year> in review")'),
    format: HighlightFormatSchema.optional().describe('Landscape (default) or vertical'),
    durationSeconds: z
      .int()
      .min(MIN_HIGHLIGHT_DURATION)
      .max(MAX_HIGHLIGHT_DURATION)
      .optional()
      .describe('Length of the video in seconds'),
    music: z.uuidv4().optional().describe('An audio file of the user played under the video'),
  })
  .meta({ id: 'YearRecapVideoDto' });

const NamedSchema = z.object({ id: z.string(), name: z.string() }).meta({ id: 'YearRecapPerson' });

const JournalStatsSchema = z
  .object({
    places: z.int().describe('The places of the journal, e.g. restaurants or museums'),
    entries: z.int().describe('Its entries, e.g. dishes or artworks'),
    topPlaces: z.array(z.string()).describe('The places with the most photos'),
  })
  .meta({ id: 'YearRecapJournalStats' });

export const YearRecapStatsSchema = z
  .object({
    year: z.int().describe('The year'),
    count: z.int().describe('Photos and videos'),
    photoCount: z.int().describe('Photos'),
    videoCount: z.int().describe('Videos'),
    places: z.int().describe('Distinct cities'),
    countries: z.int().describe('Distinct countries'),
    topPlaces: z.array(z.string()).describe('The most photographed cities'),
    people: z.int().describe('Named people in the photos'),
    topPeople: z.array(NamedSchema).describe('The most photographed people'),
    pets: z.int().describe('Named pets in the photos'),
    topPets: z.array(NamedSchema).describe('The most photographed pets'),
    trips: z.int().describe('Trips, from the travel journal or the days away from home'),
    topTrips: z.array(z.string()).describe('Where the biggest trips went'),
    journals: z
      .record(z.string(), JournalStatsSchema)
      .describe('What each journal saw, by journal pack id (food, museum, wine, concerts…)'),
  })
  .meta({ id: 'YearRecapStats' });

const YearRecapResponseSchema = z
  .object({
    year: z.int().describe('The year'),
    memoryId: z.string().optional().describe('The year_recap memory of the year, when there is one'),
    stats: YearRecapStatsSchema,
    draft: BookDraftResponseSchema.optional().describe('The book of the year waiting to be kept or discarded'),
  })
  .meta({ id: 'YearRecapResponseDto' });

export class YearRecapParamDto extends createZodDto(YearParamSchema) {}
export class YearRecapBookDto extends createZodDto(YearRecapBookSchema) {}
export class YearRecapVideoDto extends createZodDto(YearRecapVideoSchema) {}
export class YearRecapResponseDto extends createZodDto(YearRecapResponseSchema) {}

export type YearRecapExclusionOptions = z.infer<typeof YearRecapQuerySchema>;

/** the exclusions of one recap, to add to the user's memory exclusions */
export const toExtraExclusions = (options: YearRecapExclusionOptions = {}): Partial<MemoryExclusions> => ({
  personIds: options.excludePersonIds ?? [],
  albumIds: options.excludeAlbumIds ?? [],
  dateRanges: (options.excludeDateRanges ?? []).map(({ startDate, endDate }) => ({ from: startDate, to: endDate })),
  documents: options.excludeDocuments ?? false,
});

export const hasExtraExclusions = (options: YearRecapExclusionOptions = {}) =>
  (options.excludePersonIds?.length ?? 0) > 0 ||
  (options.excludeAlbumIds?.length ?? 0) > 0 ||
  (options.excludeDateRanges?.length ?? 0) > 0 ||
  !!options.excludeDocuments;
