import {
  findCollectionVisits,
  matchCollectionVisit,
  saveCollectionEntries,
  type BookStylePreset,
  type CollectionMatchResponseDto,
  type CollectionVisitsResponseDto,
} from '@immich/sdk';
import { mdiChefHat } from '@mdi/js';
import type { HasCollectionLabels, WebCollectionPack } from '$lib/collections/pack';
import type { CollectionMatch, CollectionVisits } from '$lib/collections/types';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';

/** every label of the naming dialog is in `i18n/en.json`, under `collections.cookbook`: this does not compile otherwise */
export const cookbookLabels: HasCollectionLabels<'cookbook'> = true;

/** The limits of one request, see `COLLECTION_LIMITS` on the server */
export const COOKBOOK_LIMITS = { assetIds: 2000, subjects: 100, sources: 10 } as const;

/** the generic responses of the server, field for field the web's collection types */
const toVisits = (response: CollectionVisitsResponseDto): CollectionVisits => response as CollectionVisits;
const toMatch = (response: CollectionMatchResponseDto): CollectionMatch => response as CollectionMatch;

/**
 * Cookbook: the photos of cooking a recipe (ingredients, the steps, the finished dish), matched with the steps of the
 * recipe card or cookbook page and saved as `Recipes/<Recipe>/Step 1: Preheat the oven`, `Recipes/<Recipe>/Result`
 * and `Recipes/<Recipe>/Recipe` tags, through the generic `/collections/cookbook/*` endpoints.
 */
export const cookbookPack: WebCollectionPack = {
  id: 'cookbook',
  order: 30,
  icon: mdiChefHat,
  tagRoot: 'Recipes',
  limits: COOKBOOK_LIMITS,
  // the preset of the pack's books, known to the server (the SDK's enum lists the presets it was generated with)
  bookStylePreset: 'cookbook' as BookStylePreset,
  bookStyleLabels: {
    name: 'collections.cookbook.book_style_name',
    description: 'collections.cookbook.book_style_description',
  },
  // the photos of the cooking are recognized by smart search; without it only the recipes would be found
  isAvailable: () => featureFlagsManager.value.smartSearch,
  // a recipe is never looked up on a map
  hasPlaceLookup: () => false,
  api: {
    findVisits: async (target) =>
      toVisits(await findCollectionVisits({ pack: 'cookbook', collectionVisitsDto: target })),
    matchVisit: async ({ subjectIds, sourceIds }) =>
      toMatch(await matchCollectionVisit({ pack: 'cookbook', collectionMatchDto: { subjectIds, sourceIds } })),
    saveEntries: (dto) => saveCollectionEntries({ pack: 'cookbook', collectionEntriesDto: dto }),
  },
};

export default cookbookPack;
