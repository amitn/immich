import type { AlbumResponseDto, BookResponseDto } from '@immich/sdk';
import { modalManager, type ActionItem } from '@immich/ui';
import { mdiMovieOpenPlayOutline } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import HighlightVideoModal from '$lib/modals/HighlightVideoModal.svelte';

/** "Make a highlight video…" of an album */
export const getAlbumHighlightAction = ($t: MessageFormatter, album: AlbumResponseDto): ActionItem => ({
  title: $t('highlight_video_make_action'),
  icon: mdiMovieOpenPlayOutline,
  $if: () => album.assetCount > 0,
  onAction: () => modalManager.show(HighlightVideoModal, { albumId: album.id, title: album.albumName }),
});

/** "Make a highlight video…" of a book: its photos, its style and the videos of its album */
export const getBookHighlightAction = (
  $t: MessageFormatter,
  book: Pick<BookResponseDto, 'id' | 'title' | 'pageCount'>,
): ActionItem => ({
  title: $t('highlight_video_make_action'),
  icon: mdiMovieOpenPlayOutline,
  $if: () => book.pageCount > 0,
  onAction: () => modalManager.show(HighlightVideoModal, { bookId: book.id, title: book.title }),
});
