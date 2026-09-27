import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries, type BookStylePreset } from '@immich/sdk';
import { mdiGuitarElectric } from '@mdi/js';
import type { HasCollectionLabels, WebCollectionPack } from '$lib/collections/pack';
import type { CollectionMatch, CollectionVisits } from '$lib/collections/types';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';

/** every label of the naming dialog is in `i18n/en.json`, under `collections.concerts`: this does not compile otherwise */
export const concertsLabels: HasCollectionLabels<'concerts'> = true;

/** The limits of one request, see `COLLECTION_LIMITS` on the server */
export const CONCERTS_LIMITS = { assetIds: 2000, subjects: 100, sources: 100 } as const;

/**
 * Concerts: the stage photos of gigs and festivals, matched by time with the acts of the line-ups and setlists and
 * saved as `Concerts/<Festival or venue, date>/<Act>` tags (`…/Setlist` and `…/Line-up` on the sources), through the
 * generic `/collections/concerts/*` endpoints. The server side is `server/src/utils/collections/packs/concerts/pack.ts`.
 */
export const concertsPack: WebCollectionPack = {
  id: 'concerts',
  order: 50,
  icon: mdiGuitarElectric,
  tagRoot: 'Concerts',
  limits: CONCERTS_LIMITS,
  // the preset of the pack's books; the SDK lists it once it is regenerated with the pack
  bookStylePreset: 'concerts' as BookStylePreset,
  bookStyleLabels: {
    name: 'collections.concerts.book_style_name',
    description: 'collections.concerts.book_style_description',
  },
  // stage photos are recognized by smart search; without it only the setlists, line-ups and tickets would be found
  isAvailable: () => featureFlagsManager.value.smartSearch,
  // the lookup of places on OpenStreetMap is one admin setting for every pack, and runs through the assistant
  hasPlaceLookup: () => featureFlagsManager.value.restaurantLookup,
  api: {
    // the generic DTOs of the SDK are the web's collection types, but for the enums of the place sources
    findVisits: async (target) =>
      (await findCollectionVisits({ pack: 'concerts', collectionVisitsDto: target })) as CollectionVisits,
    matchVisit: async ({ subjectIds, sourceIds }) =>
      (await matchCollectionVisit({
        pack: 'concerts',
        collectionMatchDto: { subjectIds, sourceIds },
      })) as CollectionMatch,
    saveEntries: (dto) => saveCollectionEntries({ pack: 'concerts', collectionEntriesDto: dto }),
  },
};

export default concertsPack;
