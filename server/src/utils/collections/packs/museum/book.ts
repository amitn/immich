import { getLayout, getSlotRectsMm } from 'src/utils/book/layouts.js';
import { CollectionReviewInput, CollectionReviewIssue } from 'src/utils/collections/pack.js';

/** the theme of museum books, which fits every slot to its photo (see `render.ts`) */
export const GALLERY_THEME = 'gallery';

/** an artwork keeps less than this share of its photo in its slot: it is cropped */
const WHOLE = 0.97;

const formatPages = (pages: number[]) =>
  pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.slice(0, -1).join(', ')} and ${pages.at(-1)}`;

/**
 * The museum pack's own check of its books: artworks that are cropped, by their crop and, in a style that fills its
 * slots (any but the Gallery style), by the slot a photo of another shape is trimmed to. An artwork is shown whole.
 */
export const reviewMuseumBook = ({ pages, photos, size, style }: CollectionReviewInput): CollectionReviewIssue[] => {
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const cropped: Array<{ page: number; assetId: string; entry: string }> = [];
  for (const [index, page] of pages.entries()) {
    const layout = getLayout(page.layout);
    if (!layout || page.layout === 'cover' || !size || !style) {
      continue;
    }
    const rects = getSlotRectsMm(layout, size, style);
    for (const asset of page.assets) {
      const photo = byId.get(asset.assetId);
      const rect = rects[asset.slot ?? -1];
      if (photo?.collection?.pack !== 'museum' || photo.collection.kind !== 'entry' || !rect) {
        continue;
      }
      const crop = asset.crop ?? { x: 0, y: 0, width: 1, height: 1 };
      let kept = crop.width * crop.height;
      const { width = 0, height = 0 } = photo;
      if (style.theme !== GALLERY_THEME && width > 0 && height > 0 && rect.height > 0) {
        const ratio = (crop.width * width) / (crop.height * height) / (rect.width / rect.height);
        kept *= Math.min(ratio, 1 / ratio);
      }
      if (kept < WHOLE) {
        cropped.push({ page: index + 1, assetId: asset.assetId, entry: photo.collection.entry ?? '' });
      }
    }
  }
  if (cropped.length === 0) {
    return [];
  }
  const numbers = [...new Set(cropped.map(({ page }) => page))];
  return [
    {
      severity: 'medium',
      type: 'could-look-better',
      message:
        `${formatPages(numbers)} ${numbers.length === 1 ? 'crops' : 'crop'} ` +
        `${cropped.length === 1 ? 'an artwork' : `${cropped.length} artworks`} (e.g. ${cropped[0].entry}); artworks ` +
        'are shown whole: use the museum style preset, whose slots fit the photos, or clear the crops',
      pages: numbers,
      assetIds: cropped.map(({ assetId }) => assetId),
    },
  ];
};
