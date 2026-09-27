import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries, type BookStylePreset } from '@immich/sdk';
import { mdiBookOpenPageVariantOutline } from '@mdi/js';
import type { HasCollectionLabels, WebCollectionPack } from '$lib/collections/pack';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';

/** every label of the naming dialog is in `i18n/en.json`, under `collections.reading`: this does not compile otherwise */
export const readingLabels: HasCollectionLabels<'reading'> = true;

/** The limits of one request, see `COLLECTION_LIMITS` on the server */
export const READING_LIMITS = { assetIds: 2000, subjects: 100, sources: 100 } as const;

/**
 * Reading: a reading log. Book covers, spines and title pages are named from their printed text (title, author, year,
 * publisher) and saved as `Reading/<Year or place>/<Title — Author>` tags, by reading period or by the library they
 * were photographed at, through the generic `/collections/reading/*` endpoints.
 */
export const readingPack: WebCollectionPack = {
  id: 'reading',
  order: 70,
  icon: mdiBookOpenPageVariantOutline,
  tagRoot: 'Reading',
  limits: READING_LIMITS,
  // each cover and title page carries its own text, read by the server: a period needs no reading list
  sourceOnSubjects: true,
  // the preset of the reading pack, which the SDK lists once it is regenerated with the pack
  bookStylePreset: 'reading' as BookStylePreset,
  bookStyleLabels: {
    name: 'collections.reading.book_style_name',
    description: 'collections.reading.book_style_description',
  },
  // books are recognized by smart search; without it only the reading lists would be found, by their text
  isAvailable: () => featureFlagsManager.value.smartSearch,
  // libraries and bookshops are never looked up: their names are read on their signs, or asked
  hasPlaceLookup: () => false,
  api: {
    // the generic DTOs of the server are the types of the collections, field for field
    findVisits: (target) => findCollectionVisits({ pack: 'reading', collectionVisitsDto: target }),
    matchVisit: ({ subjectIds, sourceIds }) =>
      matchCollectionVisit({ pack: 'reading', collectionMatchDto: { subjectIds, sourceIds } }),
    saveEntries: (dto) => saveCollectionEntries({ pack: 'reading', collectionEntriesDto: dto }),
  },
};

export default readingPack;
