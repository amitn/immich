import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const double = () => z.number().meta({ format: 'double' });
const uuid = () => z.uuidv4();

export const COLLECTION_LIMITS = {
  /** photos considered by one visit search */
  candidates: 5000,
  /** asset ids given to a visit search */
  assetIds: 2000,
  subjects: 100,
  sources: 10,
  entries: 200,
  photos: 200,
} as const;

export const collectionPlaceSources = ['tag', 'sign', 'source', 'receipt', 'fallback'] as const;

const CollectionPlaceSourceSchema = z
  .enum(collectionPlaceSources)
  .describe(
    'Where the place name comes from: the tags of the pack already on the photos, text read on a sign, a source ' +
      '(e.g. a menu) or a receipt, or a name made up from the visit and the city',
  )
  .meta({ id: 'CollectionPlaceSource' });

const CollectionPackParamSchema = z
  .object({
    pack: z
      .string()
      .regex(/^[a-z][\da-z-]*$/)
      .describe('Collection pack, e.g. food'),
  })
  .meta({ id: 'CollectionPackParamDto' });

const CollectionNamesSchema = z
  .object({
    subject: z.string().describe('A photographed thing, e.g. dish'),
    subjects: z.string().describe('Plural of subject'),
    source: z.string().describe('The text-source photo, e.g. menu'),
    sources: z.string().describe('Plural of source'),
    place: z.string().describe('The place of a visit, e.g. restaurant'),
    entry: z.string().describe('An entry of the source, e.g. menu item'),
    entries: z.string().describe('Plural of entry'),
    visit: z.string().describe('A visit, e.g. meal'),
    visits: z.string().describe('Plural of visit'),
  })
  .meta({ id: 'CollectionNamesDto' });

const CollectionPackSchema = z
  .object({
    id: z.string().describe('Pack ID, e.g. food'),
    title: z.string().describe('Pack title, e.g. Food'),
    description: z.string().describe('What the pack is for'),
    tagRoot: z.string().describe('First level of the tags of the pack, e.g. Food'),
    sourceLeaf: z.string().describe('The tag leaf that marks a source photo, e.g. Menu'),
    names: CollectionNamesSchema,
    bookStylePreset: z.string().describe('The book style preset of the pack'),
    placeLookup: z.boolean().describe('Whether places can be looked up on OpenStreetMap when the admin enables it'),
  })
  .meta({ id: 'CollectionPackResponseDto' });

const CollectionVisitsSchema = z
  .object({
    albumId: uuid().optional().describe('Find visits among the photos of this album'),
    assetIds: z.array(uuid()).max(COLLECTION_LIMITS.assetIds).optional().describe('Find visits among these photos'),
    takenAfter: z.string().optional().describe('Only photos taken after this date (ISO 8601)'),
    takenBefore: z.string().optional().describe('Only photos taken before this date (ISO 8601)'),
    maxGapMinutes: z.int().min(5).max(240).optional().describe('A longer gap between photos starts a new visit'),
    maxDistanceMeters: z
      .int()
      .min(20)
      .max(5000)
      .optional()
      .describe('A photo further from the place of the visit starts a new visit'),
  })
  .meta({ id: 'CollectionVisitsDto' });

const CollectionPlaceCandidateSchema = z
  .object({
    name: z.string().describe('Place name'),
    source: CollectionPlaceSourceSchema,
    confidence: double().describe('Confidence, 0-1'),
    assetIds: z.array(uuid()).describe('Photos the name was read on'),
  })
  .meta({ id: 'CollectionPlaceCandidateDto' });

const CollectionSavedEntrySchema = z
  .object({
    assetId: uuid().describe('Asset ID'),
    place: z.string().describe('Place of the tag'),
    entry: z.string().optional().describe('Entry of the tag, absent for a source photo'),
    source: z.boolean().describe('Whether the photo is tagged as the source'),
  })
  .meta({ id: 'CollectionSavedEntryDto' });

const CollectionVisitSchema = z
  .object({
    index: z.int().describe('Position of the visit, in time order'),
    start: z.string().describe('Local date-time of the first photo'),
    end: z.string().describe('Local date-time of the last photo'),
    day: z.string().describe('Local day of the visit'),
    type: z.string().optional().describe('Kind of visit by local time, e.g. Lunch, for packs that have kinds'),
    city: z.string().optional().describe('City'),
    country: z.string().optional().describe('Country'),
    latitude: double().optional().describe('Latitude of the visit (average of its located photos)'),
    longitude: double().optional().describe('Longitude of the visit (average of its located photos)'),
    subjectIds: z.array(uuid()).describe('Photos of the subjects, e.g. dishes and drinks'),
    sourceIds: z.array(uuid()).describe('Photos of the source, e.g. the menu'),
    signIds: z.array(uuid()).describe('Photos of a sign of the place, e.g. a storefront'),
    receiptIds: z.array(uuid()).describe('Photos of a receipt or a ticket'),
    place: CollectionPlaceCandidateSchema.describe('The best name for the place'),
    candidates: z.array(CollectionPlaceCandidateSchema).describe('Other names read on the photos'),
    saved: z.array(CollectionSavedEntrySchema).describe('Tags of the pack already on the photos of the visit'),
  })
  .meta({ id: 'CollectionVisitResponseDto' });

const CollectionVisitsResponseSchema = z
  .object({
    pack: z.string().describe('Collection pack'),
    count: z.int().describe('Photos considered'),
    truncated: z
      .boolean()
      .describe(`Whether more than ${COLLECTION_LIMITS.candidates} photos matched and the rest were left out`),
    photos: z.int().describe('Photos found to belong to the collection: subjects, sources, signs and receipts'),
    visits: z.array(CollectionVisitSchema).describe('Visits, in time order'),
    warnings: z.array(z.string()).describe('Why the search may be incomplete, e.g. smart search is disabled'),
  })
  .meta({ id: 'CollectionVisitsResponseDto' });

const CollectionEntryInputSchema = z
  .object({
    name: z.string().min(1).max(200).describe('Name of the entry, as printed'),
    description: z.string().max(500).optional().describe('Description of the entry'),
  })
  .meta({ id: 'CollectionEntryInputDto' });

const CollectionMatchSchema = z
  .object({
    subjectIds: z.array(uuid()).min(1).max(COLLECTION_LIMITS.subjects).describe('Photos of the subjects of one visit'),
    sourceIds: z.array(uuid()).max(COLLECTION_LIMITS.sources).optional().describe('Photos of the source of the visit'),
    entries: z
      .array(CollectionEntryInputSchema)
      .max(COLLECTION_LIMITS.entries)
      .optional()
      .describe('Entries to match instead of the ones read on the source photos'),
  })
  .meta({ id: 'CollectionMatchDto' });

const CollectionEntrySchema = z
  .object({
    index: z.int().describe('Index of the entry'),
    name: z.string().describe('Name of the entry, as printed'),
    description: z.string().optional().describe('Description of the entry'),
    price: z.string().optional().describe('Price as printed'),
    section: z.string().optional().describe('Section of the source, e.g. "Primi piatti"'),
    sourceId: uuid().optional().describe('Source photo the entry was read on'),
  })
  .meta({ id: 'CollectionEntryDto' });

const CollectionSuggestionSchema = z
  .object({
    index: z.int().describe('Index of the entry'),
    name: z.string().describe('Name of the entry'),
    score: double().describe('Probability among the entries, 0-1'),
  })
  .meta({ id: 'CollectionSuggestionDto' });

const CollectionSubjectMatchSchema = z
  .object({
    assetIds: z.array(uuid()).describe('Photos of the same subject'),
    index: z.int().optional().describe('Index of the matched entry'),
    name: z.string().optional().describe('Name of the matched entry'),
    score: double().describe('Probability of the match, 0-1'),
    unsure: z.boolean().describe('The match is weak or not the favourite of the photos: check it'),
    shared: z.boolean().optional().describe('The entry is matched to other subjects too'),
    offList: double().optional().describe('Probability that the subject is not an entry of the source, 0-1'),
    suggestions: z.array(CollectionSuggestionSchema).describe('Best entries for the photos'),
  })
  .meta({ id: 'CollectionSubjectMatchDto' });

const CollectionMatchResponseSchema = z
  .object({
    entries: z.array(CollectionEntrySchema).describe('The entries'),
    subjects: z.array(CollectionSubjectMatchSchema).describe('The subjects, with their matches'),
    ordered: z
      .boolean()
      .optional()
      .describe('The subjects were matched in the order of the source; the scores are over all such alignments'),
    noEmbedding: z.array(uuid()).describe('Subject photos that could not be matched because smart search has not run'),
    warnings: z.array(z.string()).describe('Why matching may be incomplete'),
  })
  .meta({ id: 'CollectionMatchResponseDto' });

const CollectionEntryNameSchema = z
  .object({
    id: uuid().describe('Asset ID'),
    entry: z.string().max(200).optional().describe('Name of the entry; the source leaf (e.g. "menu") marks a source'),
    source: z.boolean().optional().describe('The photo shows the source'),
  })
  .meta({ id: 'CollectionEntryNameDto' });

const CollectionEntriesSchema = z
  .object({
    place: z.string().min(1).max(100).describe('Name of the place'),
    photos: z.array(CollectionEntryNameSchema).min(1).max(COLLECTION_LIMITS.photos).describe('The photos to name'),
  })
  .meta({ id: 'CollectionEntriesDto' });

const CollectionEntryResultSchema = z
  .object({
    id: uuid().describe('Asset ID'),
    success: z.boolean().describe('Whether the photo was tagged'),
    tag: z.string().optional().describe('The tag of the photo'),
    previousTags: z.array(z.string()).optional().describe('Tags of the pack the photo had before, now removed'),
    description: z.string().optional().describe('The description set on the photo, when it had none'),
    error: z.string().optional().describe('Why the photo was not tagged'),
  })
  .meta({ id: 'CollectionEntryResultDto' });

const CollectionEntriesResponseSchema = z
  .object({
    place: z.string().describe('Name of the place as it is used in the tags'),
    results: z.array(CollectionEntryResultSchema).describe('One result per photo'),
  })
  .meta({ id: 'CollectionEntriesResponseDto' });

export class CollectionPackParamDto extends createZodDto(CollectionPackParamSchema) {}
export class CollectionPackResponseDto extends createZodDto(CollectionPackSchema) {}
export class CollectionVisitsDto extends createZodDto(CollectionVisitsSchema) {}
export class CollectionVisitsResponseDto extends createZodDto(CollectionVisitsResponseSchema) {}
export class CollectionMatchDto extends createZodDto(CollectionMatchSchema) {}
export class CollectionMatchResponseDto extends createZodDto(CollectionMatchResponseSchema) {}
export class CollectionEntriesDto extends createZodDto(CollectionEntriesSchema) {}
export class CollectionEntriesResponseDto extends createZodDto(CollectionEntriesResponseSchema) {}

export type CollectionVisitResponse = z.infer<typeof CollectionVisitSchema>;
export type CollectionPlaceCandidate = z.infer<typeof CollectionPlaceCandidateSchema>;
export type CollectionSavedEntry = z.infer<typeof CollectionSavedEntrySchema>;
export type CollectionEntryResponse = z.infer<typeof CollectionEntrySchema>;
export type CollectionSubjectMatchResponse = z.infer<typeof CollectionSubjectMatchSchema>;
export type CollectionEntryResult = z.infer<typeof CollectionEntryResultSchema>;
