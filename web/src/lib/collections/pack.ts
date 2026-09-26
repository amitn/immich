import type { BookStylePreset } from '@immich/sdk';
import type { Translations } from 'svelte-i18n';
import type {
  CollectionEntriesDto,
  CollectionEntriesResponse,
  CollectionMatch,
  CollectionPlaceSource,
  CollectionVisits,
} from '$lib/collections/types';

/**
 * The labels of a pack's naming dialog, each an i18n key `collections.<pack>.<label>` in `i18n/en.json`, e.g.
 * `collections.food.name_action` = "Name the dishes…".
 */
export const collectionLabels = [
  'name_action',
  'title',
  'finding',
  'truncated',
  'no_visits_album',
  'no_visits_selection',
  'visits_found',
  'all_visits',
  'also_read',
  'visit_photos',
  'visit_named',
  'place',
  'place_unknown',
  'place_unknown_lookup',
  'place_source_tag',
  'place_source_sign',
  'place_source_source',
  'place_source_receipt',
  'place_source_fallback',
  'other_names',
  'source',
  'source_photo',
  'view_source',
  'no_source',
  'entries_read',
  'subjects',
  'matching',
  'no_subjects',
  'skipped',
  'saved',
  'not_saved',
  'subject_name',
  'subject_name_placeholder',
  'subject_free_placeholder',
  'subject_photos',
  'subject_saved',
  'subject_unnamed',
  'subject_unsure',
  'not_on_source',
  'ask_assistant',
  'assistant_prompt',
  'assistant_prompt_unknown_place',
  'make_book',
  'make_book_description',
  'book_prompt',
  'error_find',
  'error_match',
  'error_save',
] as const;

export type CollectionLabel = (typeof collectionLabels)[number];

/**
 * `true` when `i18n/en.json` has every label of the pack `Id`; a pack declares `const labels: HasCollectionLabels<'food'>
 * = true`, which does not compile while a label is missing
 */
export type HasCollectionLabels<Id extends string> = `collections.${Id}.${CollectionLabel}` extends Translations
  ? true
  : false;

/** the i18n key of a label of a pack, e.g. collections.food.name_action */
export const getCollectionLabel = (pack: Pick<WebCollectionPack, 'id'>, label: CollectionLabel) =>
  `collections.${pack.id}.${label}` as Translations;

/** what to look in: an album, or photos */
export type CollectionTarget = { albumId: string } | { assetIds: string[] };

/**
 * A collection pack in the web: the naming dialog (`CollectionNameModal`) and the actions that open it are the same
 * for every pack, and read everything specific from here. A pack is the default export of
 * `src/lib/collections/packs/<id>.ts`, which the registry finds by itself. The server side of the pack is
 * `server/src/utils/collections/packs/<id>/pack.ts`.
 */
export type WebCollectionPack = {
  /** the id of the server pack, e.g. food */
  id: string;
  /** where the pack is listed among the packs, e.g. in the menus: food is 0, the others 10, 20... */
  order: number;
  /** an mdi icon path for the actions and the dialog */
  icon: string;
  /** the first level of the pack's tags, e.g. Food */
  tagRoot: string;
  /** the limits of one request, see `COLLECTION_LIMITS` on the server */
  limits: { assetIds: number; subjects: number; sources: number };
  /** the book style preset of the pack, offered once photos are named */
  bookStylePreset: BookStylePreset;
  /** the name and description of the preset in the style picker */
  bookStyleLabels: { name: Translations; description: Translations };
  /** the label of a kind of visit, e.g. Lunch, when the pack has kinds */
  visitTypeLabel?: (type: string) => Translations | undefined;
  /** whether the pack can be offered, e.g. smart search is enabled */
  isAvailable: () => boolean;
  /** whether the assistant can look the places up (the admin enabled the lookup and the pack has one) */
  hasPlaceLookup: () => boolean;
  /** the server calls of the pack */
  api: {
    findVisits: (target: CollectionTarget) => Promise<CollectionVisits>;
    matchVisit: (dto: { subjectIds: string[]; sourceIds: string[] }) => Promise<CollectionMatch>;
    saveEntries: (dto: CollectionEntriesDto) => Promise<CollectionEntriesResponse>;
  };
};

/** the i18n key for where a place name comes from */
export const getPlaceSourceLabel = (pack: Pick<WebCollectionPack, 'id'>, source: CollectionPlaceSource) =>
  getCollectionLabel(pack, `place_source_${source}`);
