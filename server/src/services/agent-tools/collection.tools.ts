import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { COLLECTION_LIMITS, CollectionMatchResponseDto, CollectionVisitsResponseDto } from 'src/dtos/collection.dto.js';
import { BaseService } from 'src/services/base.service.js';
import { CollectionService, PRIVATE_SOURCE_NOTE } from 'src/services/collection.service.js';
import {
  AgentTool,
  AgentToolContext,
  AgentToolResult,
  defineTool,
  toolError,
  toolJson,
} from 'src/utils/agent/tools.js';
import { MAX_LOOKUP_RADIUS } from 'src/utils/collections/overpass.js';
import { CollectionPack } from 'src/utils/collections/pack.js';
import { getEntriesFocus } from 'src/utils/collections/source.js';
import { getCollectionPacks } from 'src/utils/collections/registry.js';

const uuid = z.uuidv4();
const date = z.string().describe('ISO date or date-time, e.g. 2024-06-01 or 2024-06-01T18:00:00');

/** turns client errors (access, validation) into tool errors the agent can read and recover from */
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

const withImages = (details: unknown, images: Buffer[]): AgentToolResult => ({
  content: [
    ...toolJson(details).content,
    ...images.map((image) => ({ type: 'image' as const, data: image.toString('base64'), mimeType: 'image/jpeg' })),
  ],
});

const nonEmpty = <T>(values: T[] | undefined) => (values && values.length > 0 ? values : undefined);

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** a visit as the agent reads it: no empty lists, no internals */
const compactVisits = (
  pack: CollectionPack,
  { count, truncated, photos, visits, warnings }: CollectionVisitsResponseDto,
) => ({
  pack: pack.id,
  count,
  ...(truncated && { truncated }),
  photos,
  visits: visits.map((visit) => ({
    index: visit.index,
    start: visit.start,
    end: visit.end,
    ...(visit.type && { type: visit.type }),
    ...(visit.city && { city: visit.city }),
    ...(visit.country && { country: visit.country }),
    ...(visit.latitude !== undefined && { gps: [visit.latitude, visit.longitude] }),
    place: { name: visit.place.name, source: visit.place.source, confidence: visit.place.confidence },
    ...(visit.candidates.length > 0 && {
      otherNames: visit.candidates.map(({ name, source, confidence }) => ({ name, source, confidence })),
    }),
    subjectIds: visit.subjectIds,
    ...(nonEmpty(visit.sourceIds) && { sourceIds: visit.sourceIds }),
    ...(nonEmpty(visit.signIds) && { signIds: visit.signIds }),
    ...(nonEmpty(visit.receiptIds) && { receiptIds: visit.receiptIds }),
    ...(visit.saved.length > 0 && {
      saved: visit.saved.map(({ assetId, place, entry, source }) => ({
        assetId,
        tag: source ? `${place}/${pack.sourceLeaf}` : `${place}/${entry}`,
      })),
    }),
  })),
  ...(warnings.length > 0 && { warnings }),
});

const compactMatch = ({ entries, subjects, ordered, noEmbedding, warnings }: CollectionMatchResponseDto) => ({
  entries: entries.map(({ index, name, description, price, section }) => ({
    i: index,
    name,
    ...(description && { description }),
    ...(price && { price }),
    ...(section && { section }),
  })),
  subjects: subjects.map((subject) => ({
    assetIds: subject.assetIds,
    ...(subject.name === undefined ? { match: null } : { match: subject.name, i: subject.index }),
    score: subject.score,
    ...(subject.unsure && { unsure: true }),
    ...(subject.shared && { shared: true }),
    ...(subject.offList !== undefined && subject.offList >= 0.2 && { offList: subject.offList }),
    suggestions: subject.suggestions.map(({ index, name, score }) => ({ i: index, name, score })),
  })),
  ...(ordered && { ordered }),
  ...(noEmbedding.length > 0 && { noEmbedding }),
  ...(warnings.length > 0 && { warnings }),
});

/** "food (restaurant meals: ...; dishes, menu, restaurant)" for each pack */
const describePacks = (packs: CollectionPack[]) =>
  packs
    .map(
      ({ id, description, names }) =>
        `${id} (${description}; subjects: ${names.subjects}, source: ${names.source}, place: ${names.place})`,
    )
    .join('; ');

/**
 * Collections: themed photos named by a pack (food: dishes matched with the menu of a restaurant). The same tools
 * work for every pack, which is given by its id.
 */
@Injectable()
export class CollectionAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const collections = BaseService.create(CollectionService, this);
    const packs = getCollectionPacks();
    const packIds = packs.map(({ id }) => id) as [string, ...string[]];
    const pack = z.enum(packIds).describe(`Collection pack: ${describePacks(packs)}`);
    const lookupPacks = packs.filter((item) => item.place.lookup).map(({ id }) => id);

    return [
      defineTool({
        name: 'find_visits',
        title: 'Find the visits of a collection',
        description:
          'Find the visits of a collection pack among photos (for food: the restaurant meals). Subjects (e.g. dishes ' +
          'and drinks) are found by CLIP; sources (e.g. menus), signs or storefronts and receipts by CLIP and the ' +
          'text read on them; they are grouped into visits by time (gaps up to 45 minutes, up to 5 hours; a ' +
          'source or sign photographed apart joins the closest visit) and place when the photos are located. Give ' +
          `an album, asset ids (up to ${COLLECTION_LIMITS.assetIds}, e.g. from search_photos) or a date range. ` +
          'Returns {pack, visits: [{index, start, end, type (e.g. Breakfast/Lunch/Dinner from the camera clock, ' +
          'which can be on the wrong time zone), city, gps, place: {name, source, confidence}, otherNames, ' +
          'subjectIds, sourceIds, signIds, receiptIds, saved (tags of the pack already set)}]}. place.source is tag ' +
          '(already named), sign, source or receipt (read on the photos: check it) or fallback (a made-up name such ' +
          'as "Dinner in <City>": ask the user). Next: read_source for a source photo, match_subjects for the ' +
          'subjects, view_photos to check.',
        input: z.object({
          pack,
          albumId: uuid.optional(),
          assetIds: z.array(uuid).max(COLLECTION_LIMITS.assetIds).optional(),
          takenAfter: date.optional(),
          takenBefore: date.optional(),
          maxGapMinutes: z.int().min(5).max(240).optional().describe('Gap that starts a new visit, default 45'),
          maxDistanceMeters: z
            .int()
            .min(20)
            .max(5000)
            .optional()
            .describe('Distance that starts a new visit, default 150'),
        }),
        mutating: false,
        handler: handle(async ({ auth }, { pack: packId, ...input }) => {
          const result = await collections.findVisits(auth, packId, input);
          return toolJson(compactVisits(collections.requirePack(packId), result));
        }),
      }),

      defineTool({
        name: 'read_source',
        title: 'Read a source photo',
        description:
          'Read the entries of a source photo of a collection (for food: the items of a menu): the original is read ' +
          'again with OCR in overlapping tiles at full resolution, then split into columns and lines by the pack ' +
          '(for food: prices, section headings, allergen codes, addresses, phone numbers and cover charges are set ' +
          'aside, and names over several lines are joined). Names stay in the language of the page. Returns {id, ' +
          'title (often the place), place (name candidates), sections, entries: [{i, name, description, price, ' +
          'section}], ocr} and the image, plus zoomed parts of it when zoom=true or when few entries were read. ' +
          'OCR misses thin, handwritten or tilted print: always look at the image, and pass the entries you read ' +
          'yourself to match_subjects when they differ.',
        input: z.object({
          pack,
          id: uuid.describe('Asset ID of the source photo'),
          zoom: z
            .boolean()
            .optional()
            .describe('Also return zoomed parts of the page, default: when few entries are read'),
        }),
        mutating: false,
        handler: handle(async ({ auth }, { pack: packId, id, zoom }) => {
          const reading = await collections.readSource(auth, packId, id);
          const source = collections.requirePack(packId);
          // a pack may keep its source photos to itself (e.g. tickets): the entries are redacted, an image is not
          const images =
            source.privacy?.sourceImages === false
              ? []
              : await collections.getSourceImages(auth, id, {
                  zoom: zoom ?? reading.items.length < 3,
                  // a label on a bottle: the zoom is on the label
                  ...(source.source.onSubjects && { focus: getEntriesFocus(reading.items) }),
                });
          return withImages(
            {
              id,
              ...(reading.title && { title: reading.title }),
              ...(reading.place.length > 0 && {
                place: reading.place.map(({ name, confidence }) => ({ name, confidence })),
              }),
              ...(reading.sections.length > 0 && { sections: reading.sections }),
              entries: reading.items.map(({ name, description, price, section }, i) => ({
                i,
                name,
                ...(description && { description }),
                ...(price && { price }),
                ...(section && { section }),
              })),
              // other readings of the page, e.g. the neighbouring recipes of a cookbook page
              ...(reading.alternatives?.length && {
                alternatives: reading.alternatives.map(({ title, items }) => ({
                  title,
                  entries: items.map(({ name }) => name),
                })),
              }),
              ocr: reading.ocr,
              ...(reading.warnings.length > 0 && { warnings: reading.warnings }),
            },
            images,
          );
        }),
      }),

      defineTool({
        name: 'match_subjects',
        title: 'Match subjects with their source',
        description:
          'Suggest which entry each subject photo of one visit shows (for food: which menu item each dish is): CLIP ' +
          'compares the photos with the entry names (and descriptions), near-identical photos of the same subject ' +
          'are grouped, and each subject gets a different entry unless two clearly share one (a course of assorted ' +
          'desserts, two plates of the same thing). When the entries have an order the photos follow (a tasting ' +
          'menu with few prices), the subjects are matched in that order, skipping entries no photo shows and ' +
          'subjects off the list (ordered: true). Entries come from the sourceIds (read like read_source), or pass ' +
          'entries yourself (what you read, in source order). Returns {entries: [{i, name, price, section}], ' +
          'subjects: [{assetIds, match (entry name or null), i, score (0-1), unsure, shared, offList (probability ' +
          'it is not on the source: for food bread, coffee, an amuse-bouche), suggestions: [{i, name, score}]}], ' +
          'ordered} and a contact sheet of the subjects captioned with their suggestions. Suggestions only: check ' +
          'every match with view_photos, especially unsure ones, and name off-list subjects from what you see. ' +
          'Without a source, name the subjects yourself.',
        input: z.object({
          pack,
          subjectIds: z.array(uuid).min(1).max(COLLECTION_LIMITS.subjects),
          sourceIds: z.array(uuid).max(COLLECTION_LIMITS.sources).optional(),
          entries: z
            .array(z.object({ name: z.string().min(1).max(200), description: z.string().max(500).optional() }))
            .max(COLLECTION_LIMITS.entries)
            .optional()
            .describe('Entries to match instead of the ones read on the source photos'),
          contactSheet: z.boolean().optional().describe('Return the captioned contact sheet, default true'),
        }),
        mutating: false,
        handler: handle(async ({ auth }, { pack: packId, contactSheet = true, ...input }) => {
          const result = await collections.matchVisit(auth, packId, input);
          const details = compactMatch(result);
          if (!contactSheet || result.subjects.length === 0) {
            return toolJson(details);
          }

          const pack = collections.requirePack(packId);
          const { entry } = pack.names;
          const rows = await this.assetJobRepository.getForAgent(
            result.subjects.map(({ assetIds }) => assetIds[0]),
            auth.user.id,
          );
          const previews = new Map(rows.map((row) => [row.id, row.previewPath]));
          // a travel document passed as a subject is never shown
          const hidden = await collections.getPrivateSourceIds(rows.map(({ id }) => id));
          // subjects that carry their source (bottles) are shown by the crop of their label, to read it
          const crops = pack.source.onSubjects
            ? await collections.getEntryCrops(
                auth,
                packId,
                result.subjects.slice(0, 36).flatMap(({ assetIds }) => assetIds.slice(0, 2)),
              )
            : new Map<string, Buffer>();
          const cropOf = (assetIds: string[]) => assetIds.map((id) => crops.get(id)).find(Boolean);
          const tiles = result.subjects.slice(0, 36).map((subject, index) => ({
            input: hidden.has(subject.assetIds[0])
              ? null
              : (cropOf(subject.assetIds) ?? previews.get(subject.assetIds[0]) ?? null),
            label: String(index + 1),
            caption:
              subject.suggestions.length === 0
                ? `no ${entry}`
                : subject.suggestions
                    .slice(0, 3)
                    .map(({ name, score }) => `${name} ${percent(score)}`)
                    .join('\n'),
          }));
          const image = await this.mediaRepository.createContactSheet(tiles, { tileSize: crops.size > 0 ? 400 : 320 });
          const sheet = Object.fromEntries(
            result.subjects.slice(0, 36).map((subject, index) => [index + 1, subject.assetIds[0]]),
          );
          const privacy = hidden.size > 0 ? { hidden: [...hidden], note: PRIVATE_SOURCE_NOTE } : {};
          return withImages({ ...details, sheet, ...privacy }, [image]);
        }),
      }),

      defineTool({
        name: 'lookup_place',
        title: 'Look up places on OpenStreetMap',
        description:
          'Look up the named places of a collection pack (for food: restaurants, cafés and bars) within `radius` ' +
          'meters (default 75) of a visit on OpenStreetMap, from the GPS of its photos (assetIds) or given ' +
          'coordinates. This sends the location to a public service (the Overpass API), so ask the user before you ' +
          'call it, and only when find_visits could not read the name. The admin has to enable it (Food > ' +
          'OpenStreetMap), and only some packs have places to look up' +
          (lookupPacks.length > 0 ? ` (${lookupPacks.join(', ')})` : '') +
          '; otherwise the result says so: then ask the user for the name. Returns {places: [{name, type, ' +
          'cuisine, distance (m)}]}, closest first; confirm the place with the user.',
        input: z.object({
          pack,
          assetIds: z.array(uuid).min(1).max(100).optional().describe('Photos of the visit, for their location'),
          latitude: z.number().min(-90).max(90).optional(),
          longitude: z.number().min(-180).max(180).optional(),
          radius: z.int().min(10).max(MAX_LOOKUP_RADIUS).optional().describe('Meters, default 75'),
        }),
        mutating: true,
        handler: handle(async ({ auth }, { pack: packId, ...input }) => {
          const result = await collections.lookupPlaces(auth, packId, input);
          if (!result.enabled) {
            return toolJson({ enabled: false, message: result.message });
          }
          const { latitude, longitude, radius, places } = result;
          return toolJson({
            location: [latitude, longitude],
            radius,
            places: places.map(({ name, type, cuisine, distance }) => ({
              name,
              type,
              ...(cuisine && { cuisine }),
              distance,
            })),
            ...(places.length === 0 && { message: 'No named place nearby: ask the user for the name' }),
          });
        }),
      }),

      defineTool({
        name: 'save_entries',
        title: 'Name the photos of a visit',
        description:
          'Save the names of a visit of a collection pack: every photo gets the tag <Root>/<place>/<entry> (for ' +
          'food Food/<restaurant>/<dish>), or <Root>/<place>/<SourceLeaf> for a source photo (Food/<restaurant>/Menu) ' +
          'with source: true, replacing the tag of the pack it had, and a subject photo with no description gets ' +
          'one in the words of the pack ("<dish> · <restaurant>"). Running it again replaces the names, so it is ' +
          'safe to correct them. Use the names as printed on the source (in its language), or a short clear name ' +
          'for subjects that are not on it. Only name the subjects and the source: leave out signs, storefronts, ' +
          'receipts and people shots, which books show as they are. Photo books and albums can then be built from ' +
          'the tags (for food, a book with stylePreset "food"). Returns {place, photos: [{id, tag, description, ' +
          'previousTags}], failed}.',
        input: z.object({
          pack,
          place: z.string().min(1).max(100).describe('Name of the place, e.g. the restaurant'),
          photos: z
            .array(
              z.object({
                id: uuid,
                entry: z.string().max(200).optional().describe('Name of the entry, e.g. the dish'),
                source: z.boolean().optional().describe('The photo shows the source, e.g. the menu'),
              }),
            )
            .min(1)
            .max(COLLECTION_LIMITS.photos),
        }),
        mutating: true,
        handler: handle(async ({ auth }, { pack: packId, ...input }) => {
          const { place, results } = await collections.saveEntries(auth, packId, input);
          const failed = results.filter(({ success }) => !success).map(({ id, error }) => ({ id, error }));
          return toolJson({
            place,
            photos: results
              .filter(({ success }) => success)
              .map(({ id, tag, description, previousTags }) => ({
                id,
                tag,
                ...(description && { description }),
                ...(previousTags && { previousTags }),
              })),
            ...(failed.length > 0 && { failed }),
          });
        }),
      }),
    ];
  }
}
