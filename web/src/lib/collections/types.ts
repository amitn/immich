/**
 * The collections engine as the web sees it, field for field the server's generic DTOs (`src/dtos/collection.dto.ts`:
 * `CollectionVisitsResponseDto`, `CollectionMatchResponseDto`, `CollectionEntriesDto`...). Until the SDK is
 * regenerated with them, each pack adapts its own endpoints to these types (food: `/food/*`); afterwards they can be
 * the SDK types and the adapters the generic `/collections/{pack}/*` calls.
 */

/** where the name of a place comes from */
export type CollectionPlaceSource = 'tag' | 'sign' | 'source' | 'receipt' | 'fallback';

export type CollectionPlaceCandidate = {
  name: string;
  source: CollectionPlaceSource;
  confidence: number;
  assetIds: string[];
};

/** a tag of the pack already on a photo of the visit */
export type CollectionSavedEntry = { assetId: string; place: string; entry?: string; source: boolean };

export type CollectionVisit = {
  index: number;
  start: string;
  end: string;
  day: string;
  /** the kind of visit by local time, for packs that have kinds (food: Breakfast, Lunch or Dinner) */
  type?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  subjectIds: string[];
  sourceIds: string[];
  signIds: string[];
  receiptIds: string[];
  place: CollectionPlaceCandidate;
  candidates: CollectionPlaceCandidate[];
  saved: CollectionSavedEntry[];
};

export type CollectionVisits = {
  pack: string;
  count: number;
  truncated: boolean;
  photos: number;
  visits: CollectionVisit[];
  warnings: string[];
};

export type CollectionEntry = {
  index: number;
  name: string;
  description?: string;
  price?: string;
  section?: string;
  sourceId?: string;
};

export type CollectionSuggestion = { index: number; name: string; score: number };

export type CollectionSubjectMatch = {
  assetIds: string[];
  index?: number;
  name?: string;
  score: number;
  unsure: boolean;
  shared?: boolean;
  /** probability that the subject is not an entry of the source */
  offList?: number;
  suggestions: CollectionSuggestion[];
};

export type CollectionMatch = {
  entries: CollectionEntry[];
  subjects: CollectionSubjectMatch[];
  ordered?: boolean;
  noEmbedding: string[];
  warnings: string[];
};

export type CollectionEntriesDto = {
  place: string;
  photos: Array<{ id: string; entry?: string; source?: boolean }>;
};

export type CollectionEntryResult = {
  id: string;
  success: boolean;
  tag?: string;
  previousTags?: string[];
  description?: string;
  error?: string;
};

export type CollectionEntriesResponse = { place: string; results: CollectionEntryResult[] };
