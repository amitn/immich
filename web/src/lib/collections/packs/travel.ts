import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries, type BookStylePreset } from '@immich/sdk';
import { mdiBagSuitcase } from '@mdi/js';
import type { HasCollectionLabels, WebCollectionPack } from '$lib/collections/pack';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';

/** every label of the naming dialog is in `i18n/en.json`, under `collections.travel`: this does not compile otherwise */
export const travelLabels: HasCollectionLabels<'travel'> = true;

/** The limits of one request, see `COLLECTION_LIMITS` on the server */
export const TRAVEL_LIMITS = { assetIds: 2000, subjects: 100, sources: 10 } as const;

/**
 * Travel: the photos of a trip, matched by time with the legs read on its travel documents (boarding passes, tickets,
 * fare receipts) and saved as `Travel/<Trip>/<Leg>` tags, with the documents as `Travel/<Trip>/Tickets`. The server
 * redacts every name, booking reference and ticket number the documents carry.
 */
export const travelPack: WebCollectionPack = {
  id: 'travel',
  order: 40,
  icon: mdiBagSuitcase,
  tagRoot: 'Travel',
  limits: TRAVEL_LIMITS,
  // the preset of the travel pack, which the SDK lists once it is regenerated with the pack
  bookStylePreset: 'travel' as BookStylePreset,
  bookStyleLabels: {
    name: 'collections.travel.book_style_name',
    description: 'collections.travel.book_style_description',
  },
  // trip photos are recognized by smart search; without it only the documents would be found, by their text
  isAvailable: () => featureFlagsManager.value.smartSearch,
  // trips are never looked up
  hasPlaceLookup: () => false,
  api: {
    // the generic DTOs of the server are the types of the collections, field for field
    findVisits: (target) => findCollectionVisits({ pack: 'travel', collectionVisitsDto: target }),
    matchVisit: ({ subjectIds, sourceIds }) =>
      matchCollectionVisit({ pack: 'travel', collectionMatchDto: { subjectIds, sourceIds } }),
    saveEntries: (dto) => saveCollectionEntries({ pack: 'travel', collectionEntriesDto: dto }),
  },
};

export default travelPack;
