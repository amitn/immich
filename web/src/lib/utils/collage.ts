import { getAssetInfo } from '@immich/sdk';
import { Route } from '$lib/route';

/** a collage has 2 to 9 photos (see `server/src/utils/book/collage.ts`) */
export const MIN_COLLAGE_PHOTOS = 2;
export const MAX_COLLAGE_PHOTOS = 9;

export const COLLAGE_ASPECT_RATIOS = ['1:1', '4:5', '9:16', '16:9'] as const;

/** where a saved collage opens: over the album it was added to, or in the timeline */
export const getCollageRoute = (assetId: string, albumId?: string) =>
  albumId ? Route.viewAlbumAsset({ albumId, assetId }) : Route.viewAsset({ id: assetId });

const THUMBNAIL_TIMEOUT = 30_000;
const THUMBNAIL_POLL_INTERVAL = 1000;

/** waits until the new collage has its thumbnail, so that the viewer shows it rather than an error */
export const waitForThumbnail = async (assetId: string, timeout = THUMBNAIL_TIMEOUT) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const asset = await getAssetInfo({ id: assetId });
      if (asset.thumbhash) {
        return true;
      }
    } catch {
      // not readable yet
    }
    await new Promise((resolve) => setTimeout(resolve, THUMBNAIL_POLL_INTERVAL));
  }
  return false;
};
