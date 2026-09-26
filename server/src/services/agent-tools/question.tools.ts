import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { BaseService } from 'src/services/base.service.js';
import { CollectionQueryResponse, CollectionService } from 'src/services/collection.service.js';
import {
  AgentTool,
  AgentToolContext,
  AgentToolResult,
  defineTool,
  toolError,
  toolJson,
} from 'src/utils/agent/tools.js';
import { getCollectionPacks } from 'src/utils/collections/registry.js';

/** turns client errors (validation, unknown people) into tool errors the agent can read and recover from */
const handle =
  <I>(handler: (ctx: AgentToolContext, input: I) => Promise<AgentToolResult>) =>
  async (ctx: AgentToolContext, input: I) => {
    try {
      return await handler(ctx, input);
    } catch (error) {
      if (error instanceof HttpException) {
        return toolError(error.message);
      }
      throw error;
    }
  };

const alternatives = (description: string) =>
  z
    .union([z.string().max(200), z.array(z.string().max(200)).max(10)])
    .optional()
    .describe(description);

const toList = (value: string | string[] | undefined) =>
  value === undefined ? undefined : (Array.isArray(value) ? value : [value]).filter((item) => item.trim() !== '');

const date = z
  .string()
  .max(40)
  .describe('A year (2025), a month (2025-06), a day (2016-10-04) or a local date-time; the whole period counts');

export const QUESTION_NOTES = {
  tagsOnly:
    'Only photos named with a collection pack count (their tags). Photos never named are not here: search_photos ' +
    '(query, dates, places) and find_events find them.',
  byName:
    'Names are matched by their words, not their meaning ("dessert" does not find "Rum lamington"): pass synonyms ' +
    'as alternatives, or use search_photos with a query and tags for the pack.',
  redacted: 'Travel names are redacted, and travel documents are never listed.',
  truncated: 'The library has more tagged photos than were read: narrow the question with a pack or dates.',
};

/** the notes that tell the agent what the answer may be missing */
const getNotes = (
  result: CollectionQueryResponse,
  input: { entry?: string[]; text?: string[]; pack?: string },
): string[] => {
  const hidesText = getCollectionPacks().filter((pack) => pack.privacy?.redact || pack.privacy?.sourceImages === false);
  return [
    QUESTION_NOTES.tagsOnly,
    ...(input.entry?.length || input.text?.length ? [QUESTION_NOTES.byName] : []),
    ...(hidesText.some(({ id }) => result.packs?.includes(id)) ? [QUESTION_NOTES.redacted] : []),
    ...(result.truncated ? [QUESTION_NOTES.truncated] : []),
  ];
};

/**
 * Questions about the library ("which wine did we have at Noma?", "when did we last make the quiche?"): answered from
 * the tags the collection packs saved, across every pack of the registry.
 */
@Injectable()
export class QuestionAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const collections = BaseService.create(CollectionService, this);
    const packs = getCollectionPacks();
    const packIds = packs.map(({ id }) => id) as [string, ...string[]];
    const packWords = packs
      .map(({ id, tagRoot, names }) => `${id} (${tagRoot}/<${names.place}>/<${names.entry}>)`)
      .join(', ');

    return [
      defineTool({
        name: 'query_collections',
        title: 'Ask the collections',
        description:
          'Answer factual questions about the life in the library from the collection tags of every pack ' +
          `(${packWords}): "which wine did we have at Noma?", "when did we last make the quiche?", "what did I eat ` +
          'at The French Laundry?", "which museums did we visit in 2025?", "every dessert we photographed". Filters ' +
          '(all optional, combined): pack; place, entry and text (fuzzy: accents, case and plurals ignored, "noma" ' +
          'finds "Noma Australia"; give several alternatives for synonyms; text matches the place or the entry, a ' +
          'matching place counts whole, e.g. a recipe "Quiche Lorraine"); from/to; people (on any photo taken ' +
          'during the visit); city/country (EXIF). Returns {total: {visits, places, entries, photos}, last (and ' +
          'first, when there were several): {pack, place, date, entries, photoIds}, visits: [{pack, place, date, ' +
          'endDate, type, city, country, people, entries: [{name, photoIds, n}], moreEntries, sources}], ' +
          'moreVisits, notes}, newest ' +
          'first; detail="places" returns places: [{pack, place, visits, dates, city, entries, photoIds}] instead. ' +
          'Show the photoIds to the user. Source photos (menus, wall labels) are listed as sourcePhotoIds only with ' +
          'includeSources, and travel documents never.',
        input: z.object({
          pack: z.enum(packIds).optional().describe('Only this collection pack'),
          place: alternatives('The place, e.g. "noma", or alternatives'),
          entry: alternatives('The entry, e.g. "quiche", or alternatives like ["dessert", "petits fours", "cake"]'),
          text: alternatives('Words of the place or the entry, when unsure which one it is'),
          from: date.optional(),
          to: date.optional(),
          people: z
            .array(z.string().min(1).max(100))
            .max(5)
            .optional()
            .describe('Person ids (find_people) or names; every one has to be on a photo taken during the visit'),
          city: z.string().max(100).optional(),
          country: z.string().max(100).optional(),
          detail: z.enum(['visits', 'places']).optional().describe('Visits with their entries (default) or places'),
          order: z.enum(['desc', 'asc']).optional().describe('Newest first (default) or oldest first'),
          limit: z.int().min(1).max(100).optional().describe('Visits or places, default 20'),
          entriesPerVisit: z.int().min(1).max(100).optional().describe('Default 30'),
          photosPerEntry: z.int().min(1).max(20).optional().describe('Default 3'),
          includeSources: z.boolean().optional().describe('List the source photos (menus, labels), default false'),
        }),
        mutating: false,
        handler: handle(async ({ auth }, { includeSources, city, country, ...input }) => {
          const filters = {
            place: toList(input.place),
            entry: toList(input.entry),
            text: toList(input.text),
            city: toList(city),
            country: toList(country),
          };
          const result = await collections.queryCollections(auth, {
            ...input,
            ...filters,
            sources: includeSources,
          });
          return toolJson({ ...result, notes: getNotes(result, { ...filters, pack: input.pack }) });
        }),
      }),

      defineTool({
        name: 'summarize_collections',
        title: 'Summarize the collections',
        description:
          'What the collections of the library hold, per pack: the photos, visits, places and entries named with ' +
          'the tags of the pack, the years covered, the first and last visit and the places visited most recently. ' +
          'Use it for "what collections do I have?", and to pick the pack, places and dates of query_collections. ' +
          'Returns {packs: [{pack, title, place, entry, visit (the words of the pack), photos, visits, places, ' +
          'entries, sources, years, first, last, recentPlaces: [{name, visits, last}]}], empty (packs with no ' +
          'named photos yet)}.',
        input: z.object({}),
        mutating: false,
        handler: handle(async ({ auth }) => {
          const { packs: summaries, truncated } = await collections.getSummary(auth);
          const empty = summaries.filter(({ photos }) => photos === 0).map(({ pack }) => pack);
          return toolJson({
            packs: summaries.filter(({ photos }) => photos > 0),
            ...(empty.length > 0 && { empty }),
            ...(truncated && { truncated, note: QUESTION_NOTES.truncated }),
          });
        }),
      }),
    ];
  }
}
