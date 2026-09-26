import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries, type BookStylePreset } from '@immich/sdk';
import { mdiBank } from '@mdi/js';
import type { HasCollectionLabels, WebCollectionPack } from '$lib/collections/pack';
import type { CollectionMatch, CollectionVisits } from '$lib/collections/types';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';

/** every label of the naming dialog is in `i18n/en.json`, under `collections.museum`: this does not compile otherwise */
export const museumLabels: HasCollectionLabels<'museum'> = true;

/** The limits of one request, see `COLLECTION_LIMITS` on the server */
export const MUSEUM_LIMITS = { assetIds: 2000, subjects: 100, sources: 10 } as const;

/**
 * Museum & gallery visits: the artworks of a visit, each paired with the wall label photographed next to it and saved
 * as `Art/<Museum>/<Title — Artist, Date, Medium>` tags, through the generic `/collections/museum/*` endpoints. The
 * server side is `server/src/utils/collections/packs/museum/pack.ts`.
 */
export const museumPack: WebCollectionPack = {
  id: 'museum',
  order: 10,
  icon: mdiBank,
  tagRoot: 'Art',
  limits: MUSEUM_LIMITS,
  // the preset of the pack's books; the SDK lists it once it is regenerated with the pack
  bookStylePreset: 'museum' as BookStylePreset,
  bookStyleLabels: {
    name: 'collections.museum.book_style_name',
    description: 'collections.museum.book_style_description',
  },
  // artworks are recognized by smart search; without it only the labels, signs and tickets would be found
  isAvailable: () => featureFlagsManager.value.smartSearch,
  // the lookup of places on OpenStreetMap is one admin setting for every pack, and runs through the assistant
  hasPlaceLookup: () => featureFlagsManager.value.restaurantLookup,
  api: {
    // the generic DTOs of the SDK are the web's collection types, but for the enums of the place sources
    findVisits: async (target) =>
      (await findCollectionVisits({ pack: 'museum', collectionVisitsDto: target })) as CollectionVisits,
    matchVisit: async ({ subjectIds, sourceIds }) =>
      (await matchCollectionVisit({
        pack: 'museum',
        collectionMatchDto: { subjectIds, sourceIds },
      })) as CollectionMatch,
    saveEntries: (dto) => saveCollectionEntries({ pack: 'museum', collectionEntriesDto: dto }),
  },
};

export default museumPack;
