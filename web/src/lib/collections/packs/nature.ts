import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries, type BookStylePreset } from '@immich/sdk';
import { mdiFlower } from '@mdi/js';
import type { HasCollectionLabels, WebCollectionPack } from '$lib/collections/pack';
import type { CollectionMatch, CollectionVisits } from '$lib/collections/types';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';

/** every label of the naming dialog is in `i18n/en.json`, under `collections.nature`: this does not compile otherwise */
export const natureLabels: HasCollectionLabels<'nature'> = true;

/** The limits of one request, see `COLLECTION_LIMITS` on the server */
export const NATURE_LIMITS = { assetIds: 2000, subjects: 100, sources: 100 } as const;

/**
 * Nature field guide: photos of plants and animals in botanical gardens and zoos, each paired with the label
 * photographed next to it and saved as `Nature/<Garden or zoo>/<Common name (Scientific name, Family)>` tags, through
 * the generic `/collections/nature/*` endpoints. The server side is `server/src/utils/collections/packs/nature/pack.ts`.
 */
export const naturePack: WebCollectionPack = {
  id: 'nature',
  order: 60,
  icon: mdiFlower,
  tagRoot: 'Nature',
  limits: NATURE_LIMITS,
  // the preset of the pack's books; the SDK lists it once it is regenerated with the pack
  bookStylePreset: 'nature' as BookStylePreset,
  bookStyleLabels: {
    name: 'collections.nature.book_style_name',
    description: 'collections.nature.book_style_description',
  },
  // plants and animals are recognized by smart search; without it only their labels and signs would be found
  isAvailable: () => featureFlagsManager.value.smartSearch,
  // the lookup of places on OpenStreetMap is one admin setting for every pack, and runs through the assistant
  hasPlaceLookup: () => featureFlagsManager.value.restaurantLookup,
  api: {
    // the generic DTOs of the SDK are the web's collection types, but for the enums of the place sources
    findVisits: async (target) =>
      (await findCollectionVisits({ pack: 'nature', collectionVisitsDto: target })) as CollectionVisits,
    matchVisit: async ({ subjectIds, sourceIds }) =>
      (await matchCollectionVisit({
        pack: 'nature',
        collectionMatchDto: { subjectIds, sourceIds },
      })) as CollectionMatch,
    saveEntries: (dto) => saveCollectionEntries({ pack: 'nature', collectionEntriesDto: dto }),
  },
};

export default naturePack;
