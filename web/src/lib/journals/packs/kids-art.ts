import { findCollectionVisits, matchCollectionVisit, saveCollectionEntries, type BookStylePreset } from '@immich/sdk';
import { mdiPalette } from '@mdi/js';
import type { HasCollectionLabels, WebCollectionPack } from '$lib/journals/pack';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';

/** every label of the naming dialog is in `i18n/en.json`, under `journals.kids-art`: this does not compile otherwise */
export const kidsArtLabels: HasCollectionLabels<'kids-art'> = true;

/** The limits of one request, see `COLLECTION_LIMITS` on the server */
export const KIDS_ART_LIMITS = { assetIds: 2000, subjects: 100, sources: 100 } as const;

/**
 * Kids' art: an archive of children's drawings, paintings, crafts and illustrated letters, saved as
 * `Kids art/<Child or family, year>/<Title (age N)>` tags through the generic `/collections/kids-art/*` endpoints. The
 * server keeps at most the first name of a child in every name it saves, and never looks a place up.
 */
export const kidsArtPack: WebCollectionPack = {
  id: 'kids-art',
  order: 80,
  icon: mdiPalette,
  tagRoot: 'Kids art',
  limits: KIDS_ART_LIMITS,
  // what the child wrote on each artwork is read by the server: a year of artworks needs no other source
  sourceOnSubjects: true,
  // the preset of the kids' art pack, which the SDK lists once it is regenerated with the pack
  bookStylePreset: 'kids-art' as BookStylePreset,
  bookStyleLabels: {
    name: 'journals.kids-art.book_style_name',
    description: 'journals.kids-art.book_style_description',
  },
  // artworks are recognized by smart search
  isAvailable: () => featureFlagsManager.value.smartSearch,
  // where a family lives is never looked up
  hasPlaceLookup: () => false,
  api: {
    // the generic DTOs of the server are the types of the collections, field for field
    findVisits: (target) => findCollectionVisits({ pack: 'kids-art', collectionVisitsDto: target }),
    matchVisit: ({ subjectIds, sourceIds }) =>
      matchCollectionVisit({ pack: 'kids-art', collectionMatchDto: { subjectIds, sourceIds } }),
    saveEntries: (dto) => saveCollectionEntries({ pack: 'kids-art', collectionEntriesDto: dto }),
  },
};

export default kidsArtPack;
