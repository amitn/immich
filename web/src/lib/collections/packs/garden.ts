import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries, type BookStylePreset } from '@immich/sdk';
import { mdiSprout } from '@mdi/js';
import type { HasCollectionLabels, WebCollectionPack } from '$lib/collections/pack';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';

/** every label of the naming dialog is in `i18n/en.json`, under `collections.garden`: this does not compile otherwise */
export const gardenLabels: HasCollectionLabels<'garden'> = true;

/** The limits of one request, see `COLLECTION_LIMITS` on the server */
export const GARDEN_LIMITS = { assetIds: 2000, subjects: 100, sources: 100 } as const;

/**
 * Garden: a garden journal. The photos of the same plants over seasons and years follow the plant tags and seed
 * packets they were photographed after, and are saved as `Garden/<Garden>/<Plant variety>` tags, with the sources as
 * `Garden/<Garden>/Tag` or `Garden/<Garden>/Seed packet`, through the generic `/collections/garden/*` endpoints.
 */
export const gardenPack: WebCollectionPack = {
  id: 'garden',
  order: 90,
  icon: mdiSprout,
  tagRoot: 'Garden',
  limits: GARDEN_LIMITS,
  // the preset of the garden pack, which the SDK lists once it is regenerated with the pack
  bookStylePreset: 'garden' as BookStylePreset,
  bookStyleLabels: {
    name: 'collections.garden.book_style_name',
    description: 'collections.garden.book_style_description',
  },
  // plants are recognized by smart search; without it only the seed packets would be found, by their text
  isAvailable: () => featureFlagsManager.value.smartSearch,
  // a garden is named by its owner
  hasPlaceLookup: () => false,
  api: {
    // the generic DTOs of the server are the types of the collections, field for field
    findVisits: (target) => findCollectionVisits({ pack: 'garden', collectionVisitsDto: target }),
    matchVisit: ({ subjectIds, sourceIds }) =>
      matchCollectionVisit({ pack: 'garden', collectionMatchDto: { subjectIds, sourceIds } }),
    saveEntries: (dto) => saveCollectionEntries({ pack: 'garden', collectionEntriesDto: dto }),
  },
};

export default gardenPack;
