import {
  addBookPage,
  clearBookSlot,
  getBookLayouts,
  moveBookPage,
  removeBookPage,
  setBookSlot,
  updateBookPage,
  updateBookSlot,
  type BookDetailResponseDto,
  type BookLayoutResponseDto,
  type BookPageResponseDto,
  type BookSlotResponseDto,
  type NormalizedRect,
} from '@immich/sdk';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { isSameAspect, planLayoutChange } from '$lib/utils/book-geometry';
import { handleError } from '$lib/utils/handle-error';

/** A slot of a page */
export type BookSlotRef = { pageId: string; slot: number };

type Options = {
  /** the book as shown, refreshed after every change */
  getBook: () => BookDetailResponseDto;
  /** reloads the book, so that the pages are rendered again */
  refresh: () => Promise<unknown>;
};

const toText = (value: string | null | undefined) => {
  const text = value?.trim() ?? '';
  return text.length > 0 ? text : null;
};

export const isSameSlot = (a?: BookSlotRef, b?: BookSlotRef) =>
  !!a && !!b && a.pageId === b.pageId && a.slot === b.slot;

/**
 * Manual editing of a photo book: every change goes to the server one at a time, and the book is reloaded after
 * each one (also after a failure, since a change of several steps can fail halfway).
 */
export class BookEditorManager {
  selected = $state<BookSlotRef>();
  dragging = $state<BookSlotRef>();
  dropTarget = $state<BookSlotRef>();
  layouts = $state<BookLayoutResponseDto[]>([]);

  #pending = $state(0);
  #queue: Promise<unknown> = Promise.resolve();
  #layoutsLoaded = false;
  #options: Options;

  constructor(options: Options) {
    this.#options = options;
  }

  get isSaving() {
    return this.#pending > 0;
  }

  get book() {
    return this.#options.getBook();
  }

  async loadLayouts() {
    if (this.#layoutsLoaded) {
      return;
    }
    try {
      this.layouts = await getBookLayouts();
      this.#layoutsLoaded = true;
    } catch (error) {
      handleError(error, get(t)('errors.unable_to_load_book_layouts'));
    }
  }

  getLayout(id: string) {
    return this.layouts.find((layout) => layout.id === id);
  }

  getPage(pageId: string) {
    return this.book.pages.find((page) => page.id === pageId);
  }

  getSlot(ref?: BookSlotRef): BookSlotResponseDto | undefined {
    return ref ? this.getPage(ref.pageId)?.slots.find((slot) => slot.slot === ref.slot) : undefined;
  }

  select(ref?: BookSlotRef) {
    this.selected = ref && !isSameSlot(ref, this.selected) ? ref : undefined;
  }

  /** forgets a selection that no longer exists, e.g. after a layout change */
  prune() {
    if (this.selected && !this.getSlot(this.selected)) {
      this.selected = undefined;
    }
  }

  /** Runs the changes after the ones before them, then reloads the book; false when a change failed */
  #run(message: string, action: () => Promise<void>): Promise<boolean> {
    const task = async () => {
      this.#pending++;
      try {
        await action();
        return true;
      } catch (error) {
        handleError(error, message);
        return false;
      } finally {
        try {
          await this.#options.refresh();
          this.prune();
        } finally {
          this.#pending--;
        }
      }
    };
    const result = this.#queue.then(task);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  /** Swaps the photos (with their captions) of two slots, or moves a photo into an empty slot */
  swap(from: BookSlotRef, to: BookSlotRef) {
    const source = this.getSlot(from);
    const target = this.getSlot(to);
    if (!source || !target || isSameSlot(from, to) || (!source.assetId && !target.assetId)) {
      return Promise.resolve(false);
    }

    const id = this.book.id;
    // a crop only fits a slot of the same shape; otherwise the server chooses one
    const keepCrop = isSameAspect(source.aspectRatio, target.aspectRatio);
    const place = (ref: BookSlotRef, slot: BookSlotResponseDto) =>
      setBookSlot({
        id,
        pageId: ref.pageId,
        slot: ref.slot,
        bookSlotUpdateDto: {
          assetId: slot.assetId!,
          caption: slot.caption,
          ...(keepCrop && slot.crop && { crop: slot.crop }),
        },
      });
    const clear = (ref: BookSlotRef) => clearBookSlot({ id, pageId: ref.pageId, slot: ref.slot });

    return this.#run(get(t)('errors.unable_to_move_book_photo'), async () => {
      await (source.assetId ? place(to, source) : clear(to));
      await (target.assetId ? place(from, target) : clear(from));
      this.selected = to;
    });
  }

  /** Places another photo in a slot, keeping its caption; the server chooses a crop for the new photo */
  replace(ref: BookSlotRef, assetId: string) {
    const slot = this.getSlot(ref);
    if (!slot || slot.assetId === assetId) {
      return Promise.resolve(false);
    }
    return this.#run(get(t)('errors.unable_to_replace_book_photo'), async () => {
      await setBookSlot({
        id: this.book.id,
        pageId: ref.pageId,
        slot: ref.slot,
        bookSlotUpdateDto: { assetId, caption: slot.caption },
      });
    });
  }

  remove(ref: BookSlotRef) {
    return this.#run(get(t)('errors.unable_to_remove_book_photo'), async () => {
      await clearBookSlot({ id: this.book.id, pageId: ref.pageId, slot: ref.slot });
    });
  }

  /**
   * Changes the layout of a page. Photos in slots the new layout lacks move to free slots first (the server drops
   * them otherwise), and photos whose slot changed shape get a new default crop.
   */
  setLayout(pageId: string, layoutId: string) {
    const page = this.getPage(pageId);
    const layout = this.getLayout(layoutId);
    if (!page || !layout || page.layout === layoutId) {
      return Promise.resolve(false);
    }

    const id = this.book.id;
    return this.#run(get(t)('errors.unable_to_change_book_layout'), async () => {
      const slotAt = (index: number) => page.slots.find((slot) => slot.slot === index);
      for (const { from, to } of planLayoutChange(page.slots, layout.slots.length)) {
        const source = slotAt(from)!;
        await setBookSlot({
          id,
          pageId,
          slot: to,
          bookSlotUpdateDto: { assetId: source.assetId!, caption: source.caption },
        });
      }

      const updated = await updateBookPage({ id, pageId, bookPageUpdateDto: { layout: layoutId } });
      for (const slot of updated.slots) {
        const before = slotAt(slot.slot);
        if (slot.assetId && (!before || !isSameAspect(before.aspectRatio, slot.aspectRatio))) {
          await updateBookSlot({ id, pageId, slot: slot.slot, bookSlotPatchDto: { crop: null } });
        }
      }
    });
  }

  /** Saves the section title or the caption of a page; empty text removes it */
  updatePage(pageId: string, changes: { sectionTitle?: string | null; caption?: string | null }) {
    const bookPageUpdateDto = Object.fromEntries(
      Object.entries(changes).map(([key, value]) => [key, toText(value)]),
    ) as { sectionTitle?: string | null; caption?: string | null };
    return this.#run(get(t)('errors.unable_to_update_book_page'), async () => {
      await updateBookPage({ id: this.book.id, pageId, bookPageUpdateDto });
    });
  }

  updateSlotCaption(ref: BookSlotRef, caption: string | null) {
    return this.#run(get(t)('errors.unable_to_update_book_caption'), async () => {
      await updateBookSlot({
        id: this.book.id,
        pageId: ref.pageId,
        slot: ref.slot,
        bookSlotPatchDto: { caption: toText(caption) },
      });
    });
  }

  /** Saves a crop, or resets it to the default crop with null */
  updateCrop(ref: BookSlotRef, crop: NormalizedRect | null) {
    return this.#run(get(t)('errors.unable_to_crop_book_photo'), async () => {
      await updateBookSlot({ id: this.book.id, pageId: ref.pageId, slot: ref.slot, bookSlotPatchDto: { crop } });
    });
  }

  movePage(pageId: string, position: number) {
    const page = this.getPage(pageId);
    if (!page || page.position === position || position < 0 || position >= this.book.pages.length) {
      return Promise.resolve(false);
    }
    return this.#run(get(t)('errors.unable_to_move_book_page'), async () => {
      await moveBookPage({ id: this.book.id, pageId, bookPageMoveDto: { position } });
    });
  }

  /** Inserts an empty page; resolves to the new page, or undefined when it failed */
  async addPage(position: number, layout: string) {
    let page: BookPageResponseDto | undefined;
    await this.#run(get(t)('errors.unable_to_add_book_page'), async () => {
      page = await addBookPage({ id: this.book.id, bookPageCreateDto: { layout, position } });
    });
    return page;
  }

  removePage(pageId: string) {
    return this.#run(get(t)('errors.unable_to_delete_book_page'), async () => {
      await removeBookPage({ id: this.book.id, pageId });
    });
  }
}
