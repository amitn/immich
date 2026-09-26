import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries, type BookStylePreset } from '@immich/sdk';
import { mdiGlassWine } from '@mdi/js';
import type { HasCollectionLabels, WebCollectionPack } from '$lib/collections/pack';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';

/** every label of the naming dialog is in `i18n/en.json`, under `collections.wine`: this does not compile otherwise */
export const wineLabels: HasCollectionLabels<'wine'> = true;

/** The limits of one request, see `COLLECTION_LIMITS` on the server */
export const WINE_LIMITS = { assetIds: 2000, subjects: 100, sources: 10 } as const;

/**
 * Wine: a wine and drinks journal. Bottles, glasses and pours are named from their labels (or the wine list of the
 * tasting) and saved as `Wine/<Tasting>/<Producer · Wine · Vintage>` tags, with a list as `Wine/<Tasting>/Wine list`,
 * through the generic `/collections/wine/*` endpoints.
 */
export const winePack: WebCollectionPack = {
  id: 'wine',
  order: 20,
  icon: mdiGlassWine,
  tagRoot: 'Wine',
  limits: WINE_LIMITS,
  // the preset of the wine pack, which the SDK lists once it is regenerated with the pack
  bookStylePreset: 'wine' as BookStylePreset,
  bookStyleLabels: {
    name: 'collections.wine.book_style_name',
    description: 'collections.wine.book_style_description',
  },
  // bottles are recognized by smart search; without it only the wine lists would be found, by their text
  isAvailable: () => featureFlagsManager.value.smartSearch,
  // wineries, wine bars and restaurants are looked up like restaurants, when the admin enabled it
  hasPlaceLookup: () => featureFlagsManager.value.restaurantLookup,
  api: {
    // the generic DTOs of the server are the types of the collections, field for field
    findVisits: (target) => findCollectionVisits({ pack: 'wine', collectionVisitsDto: target }),
    matchVisit: ({ subjectIds, sourceIds }) =>
      matchCollectionVisit({ pack: 'wine', collectionMatchDto: { subjectIds, sourceIds } }),
    saveEntries: (dto) => saveCollectionEntries({ pack: 'wine', collectionEntriesDto: dto }),
  },
};

export default winePack;
