import { AssetVisibility } from '@immich/sdk';
import type { AlbumContext, SelectionCommandContext, SpaceContext } from '$lib/managers/command-context-manager.svelte';
import { MAX_COLLAGE_PHOTOS, MIN_COLLAGE_PHOTOS } from '$lib/utils/collage';

/**
 * What the assistant's selection actions need to know about the surface: the selection and, on an album or a space,
 * the caller's role there. A `CommandContext` fits it as is.
 */
export type AssistantCapabilityContext = {
  selection: Pick<SelectionCommandContext, 'assets' | 'selectedAssetIds' | 'ownedSelectedAssetIds'> | null;
  album: Pick<AlbumContext, 'id' | 'isOwner' | 'isEditor'> | null;
  space: Pick<SpaceContext, 'id' | 'canWrite'> | null;
};

export type AssistantFeatures = {
  /** the assistant is configured (feature flag `assistant`) */
  assistant: boolean;
  /** an art agent is configured (feature flag `artisticStyles`) */
  artisticStyles: boolean;
};

/**
 * Which of the assistant's actions a selection allows, next to noodle's `getSelectionCapabilities`. The photos of
 * others (e.g. other members' photos in a shared space) are read-only for them (#21):
 * - the photos anyone can read go into a chat, a collage or a highlight video;
 * - naming writes tags and descriptions on the owned subset only, the rest help to read the names, so it is offered
 *   when any of the selection is the user's, like noodle's share;
 * - copies (artistic style, auto enhance) are made of the user's own photos only, one photo at a time.
 */
export interface AssistantSelectionCapabilities {
  canAskAssistant: boolean;
  canMakeCollage: boolean;
  canMakeHighlightVideo: boolean;
  canName: boolean;
  canArtisticStyle: boolean;
  canAutoEnhance: boolean;
  /** the album a collage made here is added to: one the user can add photos to */
  collageAlbumId?: string;
}

const NONE: AssistantSelectionCapabilities = {
  canAskAssistant: false,
  canMakeCollage: false,
  canMakeHighlightVideo: false,
  canName: false,
  canArtisticStyle: false,
  canAutoEnhance: false,
};

export function getAssistantSelectionCapabilities(
  ctx: AssistantCapabilityContext,
  features: AssistantFeatures,
): AssistantSelectionCapabilities {
  const selection = ctx.selection;
  const count = selection?.selectedAssetIds.length ?? 0;
  if (!selection || count === 0) {
    return { ...NONE };
  }

  // the viewer offers nothing of the assistant's on trashed and locked photos either
  const { assets } = selection;
  if (assets.some((asset) => asset.isTrashed || asset.visibility === AssetVisibility.Locked)) {
    return { ...NONE };
  }

  const ownedCount = selection.ownedSelectedAssetIds.length;
  const allImages = assets.length === count && assets.every((asset) => asset.isImage);
  const isOwnImage = count === 1 && ownedCount === 1 && allImages;

  // the server adds the collage to an album the user owns or edits, or to one of a space they edit
  const { album, space } = ctx;
  const canAddToAlbum = !!album && (album.isOwner || album.isEditor || !!space?.canWrite);

  return {
    canAskAssistant: features.assistant,
    canMakeCollage: allImages && count >= MIN_COLLAGE_PHOTOS && count <= MAX_COLLAGE_PHOTOS,
    canMakeHighlightVideo: true,
    canName: ownedCount > 0,
    canArtisticStyle: isOwnImage && features.artisticStyles,
    // local image processing: it does not need the assistant
    canAutoEnhance: isOwnImage,
    ...(canAddToAlbum && album && { collageAlbumId: album.id }),
  };
}
