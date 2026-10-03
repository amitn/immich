import {
  AssetTypeEnum,
  createBookFromMemory,
  createYearRecapBook,
  HighlightFormat,
  type MemoryResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { mdiBookOpenPageVariantOutline, mdiCellphone, mdiMovieOpenPlayOutline, mdiViewDashboardOutline } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { goto } from '$app/navigation';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import CollageModal from '$lib/modals/CollageModal.svelte';
import HighlightVideoModal from '$lib/modals/HighlightVideoModal.svelte';
import { Route } from '$lib/route';
import { handleError } from '$lib/utils/handle-error';
import { getYearRecapYear } from '$lib/utils/memory-card';

/**
 * Make a video, a book or a collage of a memory (#5): the server makes each of every photo of the moment the memory
 * stands for (the whole trip, the year before a birthday, the month), not only of the photos the card shows. `title` is
 * the card's title in the viewer's language (see `memory-card.ts`), which the creation is named after.
 */
export type MemoryCreation = {
  id: 'video' | 'video-vertical' | 'book' | 'collage';
  title: string;
  icon: string;
  onAction: () => Promise<unknown> | unknown;
};

const hasPhotos = (memory: MemoryResponseDto) => memory.assets.some(({ type }) => type === AssetTypeEnum.Image);

/** lays out a book of the memory, then opens it in the book editor */
export const makeMemoryBook = async ($t: MessageFormatter, memory: MemoryResponseDto, title: string) => {
  toastManager.primary($t('memory_make_book_started', { values: { title } }));
  try {
    const book = await createBookFromMemory({ bookFromMemoryDto: { memoryId: memory.id, title: title || undefined } });
    toastManager.success($t('memory_make_book_done', { values: { title: book.title } }));
    await goto(Route.viewBook({ id: book.id }));
    return book;
  } catch (error) {
    handleError(error, $t('errors.unable_to_create_book'));
  }
};

/**
 * Gallery fork (#12): lays out the book of a year in review as a draft, kept or discarded like the suggested books,
 * then opens it
 */
export const makeYearRecapBook = async ($t: MessageFormatter, year: number, title: string) => {
  toastManager.primary($t('year_recap_book_started', { values: { title } }));
  try {
    const draft = await createYearRecapBook({ year, yearRecapBookDto: { title: title || undefined } });
    await goto(Route.viewBook(draft.book));
    return draft;
  } catch (error) {
    handleError(error, $t('errors.unable_to_make_year_recap_book'));
  }
};

/** the creations a memory can be turned into; a book needs the assistant's book engine, a collage two photos */
export const getMemoryCreations = (
  $t: MessageFormatter,
  memory: MemoryResponseDto,
  title: string,
): MemoryCreation[] => {
  const creations: MemoryCreation[] = [
    {
      id: 'video',
      title: $t('memory_make_video'),
      icon: mdiMovieOpenPlayOutline,
      onAction: () => modalManager.show(HighlightVideoModal, { memoryId: memory.id, title }),
    },
  ];
  // a year in review offers its vertical video and a draft of its book (#12)
  const recapYear = getYearRecapYear(memory);
  if (recapYear !== undefined) {
    creations.push({
      id: 'video-vertical',
      title: $t('year_recap_video_vertical'),
      icon: mdiCellphone,
      onAction: () =>
        modalManager.show(HighlightVideoModal, { memoryId: memory.id, title, format: HighlightFormat.Vertical }),
    });
  }
  if (featureFlagsManager.valueOrUndefined?.assistant && hasPhotos(memory)) {
    creations.push({
      id: 'book',
      title: $t('memory_make_book'),
      icon: mdiBookOpenPageVariantOutline,
      onAction: () =>
        recapYear === undefined ? makeMemoryBook($t, memory, title) : makeYearRecapBook($t, recapYear, title),
    });
  }
  if (hasPhotos(memory)) {
    creations.push({
      id: 'collage',
      title: $t('memory_make_collage'),
      icon: mdiViewDashboardOutline,
      // a collage title is drawn on the image, so it is kept short
      onAction: () => modalManager.show(CollageModal, { memoryId: memory.id, title: title.slice(0, 100) }),
    });
  }
  return creations;
};
