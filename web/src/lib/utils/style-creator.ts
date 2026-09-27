import type { BookDetailResponseDto } from '@immich/sdk';
import type { MessageFormatter, Translations } from 'svelte-i18n';

/** most photos handed to the assistant to preview a book style on (like the server's sample book) */
export const MAX_STYLE_SAMPLE_PHOTOS = 6;

export type StyleCreatorKind = 'book' | 'art';

/** what the new style is designed for: a book (or an album about to become one, or some photos), or a photo */
export type StyleCreatorTarget =
  | {
      kind: 'book';
      book?: Pick<BookDetailResponseDto, 'id' | 'title' | 'coverAssetId' | 'pages'>;
      album?: { id: string; albumName: string; albumThumbnailAssetId?: string | null };
      assetIds?: string[];
    }
  | { kind: 'art'; assetId: string };

/** the example descriptions shown as chips, one tap fills the description */
export const STYLE_CREATOR_EXAMPLES: Record<StyleCreatorKind, Translations[]> = {
  book: [
    'style_creator_example_book_polaroid',
    'style_creator_example_book_wedding',
    'style_creator_example_book_night',
    'style_creator_example_book_magazine',
  ],
  art: [
    'style_creator_example_art_blueprint',
    'style_creator_example_art_stained_glass',
    'style_creator_example_art_comic',
    'style_creator_example_art_embroidery',
  ],
};

/** the photos of a book to preview a style on: the cover first, then the photos in page order, each once */
export const getBookSampleAssetIds = (book: Pick<BookDetailResponseDto, 'coverAssetId' | 'pages'>) => {
  const ids = [
    ...(book.coverAssetId ? [book.coverAssetId] : []),
    ...book.pages.flatMap((page) => page.slots.flatMap((slot) => (slot.assetId ? [slot.assetId] : []))),
  ];
  return [...new Set(ids)].slice(0, MAX_STYLE_SAMPLE_PHOTOS);
};

/** the prompt the assistant chat opens with, and the photos attached to it */
export const getStyleCreatorRequest = (
  $t: MessageFormatter,
  target: StyleCreatorTarget,
  description: string,
): { prompt: string; assetIds: string[] } => {
  const text = description.trim().replace(/[.\s]+$/, '');

  if (target.kind === 'art') {
    return {
      prompt: $t('style_creator_art_prompt', { values: { description: text, id: target.assetId } }),
      assetIds: [target.assetId],
    };
  }

  if (target.book) {
    return {
      prompt: $t('style_creator_book_prompt_book', {
        values: { description: text, title: target.book.title, id: target.book.id },
      }),
      assetIds: getBookSampleAssetIds(target.book),
    };
  }

  if (target.album) {
    return {
      prompt: $t('style_creator_book_prompt_album', {
        values: { description: text, name: target.album.albumName, id: target.album.id },
      }),
      assetIds: target.album.albumThumbnailAssetId ? [target.album.albumThumbnailAssetId] : [],
    };
  }

  const assetIds = (target.assetIds ?? []).slice(0, MAX_STYLE_SAMPLE_PHOTOS);
  return {
    prompt: $t(assetIds.length > 0 ? 'style_creator_book_prompt_photos' : 'style_creator_book_prompt', {
      values: { description: text },
    }),
    assetIds,
  };
};
