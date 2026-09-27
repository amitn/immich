import type { BookDetailResponseDto } from '@immich/sdk';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { BookEditorManager } from '$lib/managers/book-editor-manager.svelte';
import { handleError } from '$lib/utils/handle-error';
import { bookDetailFactory } from '@test-data/factories/book-factory';
import { bookLayouts, bookPageFactory } from '@test-data/factories/book-page-factory';

vi.mock('$lib/utils/handle-error', () => ({ handleError: vi.fn() }));

const crop = { x: 0.1, y: 0, width: 0.8, height: 1 };

describe('BookEditorManager', () => {
  let book: BookDetailResponseDto;
  const refresh = vi.fn();

  const create = async () => {
    const editor = new BookEditorManager({ getBook: () => book, refresh });
    sdkMock.getBookLayouts.mockResolvedValue(Object.values(bookLayouts));
    await editor.loadLayouts();
    return editor;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    book = bookDetailFactory.build({
      pages: [
        bookPageFactory(
          'page-1',
          0,
          [
            { assetId: 'asset-a', crop, caption: 'Rome' },
            { assetId: 'asset-b', caption: null },
          ],
          { layout: 'two-horizontal' },
        ),
        bookPageFactory(
          'page-2',
          1,
          [
            { assetId: 'asset-c', aspectRatio: 0.5 },
            { assetId: null },
            { assetId: null },
            { assetId: 'asset-d', caption: 'Pisa' },
          ],
          { layout: 'four-grid' },
        ),
      ],
    });
    refresh.mockResolvedValue(undefined);
  });

  it('should load the layouts once', async () => {
    const editor = await create();
    await editor.loadLayouts();

    expect(sdkMock.getBookLayouts).toHaveBeenCalledTimes(1);
    expect(editor.getLayout('four-grid')?.slots).toHaveLength(4);
  });

  describe('swap', () => {
    it('should swap two photos with their captions, keeping crops between slots of the same shape', async () => {
      const editor = await create();

      await expect(editor.swap({ pageId: 'page-1', slot: 0 }, { pageId: 'page-1', slot: 1 })).resolves.toBe(true);

      expect(sdkMock.setBookSlot).toHaveBeenCalledTimes(2);
      expect(sdkMock.setBookSlot).toHaveBeenNthCalledWith(1, {
        id: book.id,
        pageId: 'page-1',
        slot: 1,
        bookSlotUpdateDto: { assetId: 'asset-a', caption: 'Rome', crop },
      });
      expect(sdkMock.setBookSlot).toHaveBeenNthCalledWith(2, {
        id: book.id,
        pageId: 'page-1',
        slot: 0,
        bookSlotUpdateDto: { assetId: 'asset-b', caption: null },
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(editor.selected).toEqual({ pageId: 'page-1', slot: 1 });
    });

    it('should let the server choose new crops between slots of different shapes', async () => {
      const editor = await create();

      await editor.swap({ pageId: 'page-1', slot: 0 }, { pageId: 'page-2', slot: 0 });

      expect(sdkMock.setBookSlot).toHaveBeenCalledWith({
        id: book.id,
        pageId: 'page-2',
        slot: 0,
        bookSlotUpdateDto: { assetId: 'asset-a', caption: 'Rome' },
      });
      expect(sdkMock.setBookSlot).toHaveBeenCalledWith({
        id: book.id,
        pageId: 'page-1',
        slot: 0,
        bookSlotUpdateDto: { assetId: 'asset-c', caption: null },
      });
    });

    it('should move a photo into an empty slot', async () => {
      const editor = await create();

      await editor.swap({ pageId: 'page-2', slot: 3 }, { pageId: 'page-2', slot: 1 });

      expect(sdkMock.setBookSlot).toHaveBeenCalledExactlyOnceWith({
        id: book.id,
        pageId: 'page-2',
        slot: 1,
        bookSlotUpdateDto: { assetId: 'asset-d', caption: 'Pisa' },
      });
      expect(sdkMock.clearBookSlot).toHaveBeenCalledExactlyOnceWith({ id: book.id, pageId: 'page-2', slot: 3 });
    });

    it('should do nothing for the same slot or two empty slots', async () => {
      const editor = await create();

      await expect(editor.swap({ pageId: 'page-1', slot: 0 }, { pageId: 'page-1', slot: 0 })).resolves.toBe(false);
      await expect(editor.swap({ pageId: 'page-2', slot: 1 }, { pageId: 'page-2', slot: 2 })).resolves.toBe(false);

      expect(sdkMock.setBookSlot).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it('should report a failure and still reload the book', async () => {
      const editor = await create();
      sdkMock.setBookSlot.mockRejectedValueOnce(new Error('boom'));

      await expect(editor.swap({ pageId: 'page-1', slot: 0 }, { pageId: 'page-1', slot: 1 })).resolves.toBe(false);

      expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'errors.unable_to_move_book_photo');
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(editor.isSaving).toBe(false);
    });
  });

  it('should replace a photo and keep the caption of the slot', async () => {
    const editor = await create();

    await editor.replace({ pageId: 'page-1', slot: 0 }, 'asset-z');

    expect(sdkMock.setBookSlot).toHaveBeenCalledExactlyOnceWith({
      id: book.id,
      pageId: 'page-1',
      slot: 0,
      bookSlotUpdateDto: { assetId: 'asset-z', caption: 'Rome' },
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('should remove a photo', async () => {
    const editor = await create();

    await editor.remove({ pageId: 'page-1', slot: 1 });

    expect(sdkMock.clearBookSlot).toHaveBeenCalledExactlyOnceWith({ id: book.id, pageId: 'page-1', slot: 1 });
  });

  describe('setLayout', () => {
    it('should change the layout of a page', async () => {
      const editor = await create();
      sdkMock.updateBookPage.mockResolvedValue(
        bookPageFactory('page-1', 0, [{ assetId: 'asset-a', aspectRatio: 1, crop }, { assetId: 'asset-b' }], {
          layout: 'four-grid',
        }),
      );

      await expect(editor.setLayout('page-1', 'four-grid')).resolves.toBe(true);

      expect(sdkMock.updateBookPage).toHaveBeenCalledExactlyOnceWith({
        id: book.id,
        pageId: 'page-1',
        bookPageUpdateDto: { layout: 'four-grid' },
      });
      expect(sdkMock.setBookSlot).not.toHaveBeenCalled();
      expect(sdkMock.updateBookSlot).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('should keep the photos of slots the new layout lacks, and reset the crops of reshaped slots', async () => {
      const editor = await create();
      sdkMock.updateBookPage.mockResolvedValue(
        bookPageFactory(
          'page-2',
          1,
          [
            { assetId: 'asset-c', aspectRatio: 0.5 },
            { assetId: 'asset-d', aspectRatio: 0.5 },
          ],
          { layout: 'two-horizontal' },
        ),
      );

      await editor.setLayout('page-2', 'two-horizontal');

      // the photo in slot 4 moves to the free slot 2 first
      expect(sdkMock.setBookSlot).toHaveBeenCalledExactlyOnceWith({
        id: book.id,
        pageId: 'page-2',
        slot: 1,
        bookSlotUpdateDto: { assetId: 'asset-d', caption: 'Pisa' },
      });
      expect(sdkMock.updateBookPage).toHaveBeenCalledWith({
        id: book.id,
        pageId: 'page-2',
        bookPageUpdateDto: { layout: 'two-horizontal' },
      });
      expect(sdkMock.setBookSlot.mock.invocationCallOrder[0]).toBeLessThan(
        sdkMock.updateBookPage.mock.invocationCallOrder[0],
      );
      // slot 2 was square and is now tall; slot 1 kept its shape
      expect(sdkMock.updateBookSlot).toHaveBeenCalledExactlyOnceWith({
        id: book.id,
        pageId: 'page-2',
        slot: 1,
        bookSlotPatchDto: { crop: null },
      });
    });

    it('should not change to the same or an unknown layout', async () => {
      const editor = await create();

      await expect(editor.setLayout('page-1', 'two-horizontal')).resolves.toBe(false);
      await expect(editor.setLayout('page-1', 'unknown')).resolves.toBe(false);

      expect(sdkMock.updateBookPage).not.toHaveBeenCalled();
    });
  });

  describe('captions', () => {
    it('should save the section title and caption of a page, removing empty text', async () => {
      const editor = await create();

      await editor.updatePage('page-1', { caption: '  A day in Rome ' });
      await editor.updatePage('page-1', { sectionTitle: ' '.repeat(3) });

      expect(sdkMock.updateBookPage).toHaveBeenNthCalledWith(1, {
        id: book.id,
        pageId: 'page-1',
        bookPageUpdateDto: { caption: 'A day in Rome' },
      });
      expect(sdkMock.updateBookPage).toHaveBeenNthCalledWith(2, {
        id: book.id,
        pageId: 'page-1',
        bookPageUpdateDto: { sectionTitle: null },
      });
    });

    it('should save the caption of a photo', async () => {
      const editor = await create();

      await editor.updateSlotCaption({ pageId: 'page-2', slot: 3 }, 'Leaning tower');

      expect(sdkMock.updateBookSlot).toHaveBeenCalledExactlyOnceWith({
        id: book.id,
        pageId: 'page-2',
        slot: 3,
        bookSlotPatchDto: { caption: 'Leaning tower' },
      });
    });

    it('should report a failed save', async () => {
      const editor = await create();
      sdkMock.updateBookPage.mockRejectedValue(new Error('boom'));

      await expect(editor.updatePage('page-1', { caption: 'x' })).resolves.toBe(false);
      expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'errors.unable_to_update_book_page');
    });
  });

  it('should save and reset a crop', async () => {
    const editor = await create();

    await editor.updateCrop({ pageId: 'page-1', slot: 0 }, crop);
    await editor.updateCrop({ pageId: 'page-1', slot: 0 }, null);

    expect(sdkMock.updateBookSlot).toHaveBeenNthCalledWith(1, {
      id: book.id,
      pageId: 'page-1',
      slot: 0,
      bookSlotPatchDto: { crop },
    });
    expect(sdkMock.updateBookSlot).toHaveBeenNthCalledWith(2, {
      id: book.id,
      pageId: 'page-1',
      slot: 0,
      bookSlotPatchDto: { crop: null },
    });
  });

  describe('pages', () => {
    it('should move a page', async () => {
      const editor = await create();

      await expect(editor.movePage('page-1', 1)).resolves.toBe(true);
      await expect(editor.movePage('page-1', 0)).resolves.toBe(false);
      await expect(editor.movePage('page-1', 5)).resolves.toBe(false);

      expect(sdkMock.moveBookPage).toHaveBeenCalledExactlyOnceWith({
        id: book.id,
        pageId: 'page-1',
        bookPageMoveDto: { position: 1 },
      });
    });

    it('should add a page', async () => {
      const editor = await create();
      const page = bookPageFactory('page-3', 1);
      sdkMock.addBookPage.mockResolvedValue(page);

      await expect(editor.addPage(1, 'single')).resolves.toEqual(page);

      expect(sdkMock.addBookPage).toHaveBeenCalledWith({
        id: book.id,
        bookPageCreateDto: { layout: 'single', position: 1 },
      });
      expect(refresh).toHaveBeenCalled();
    });

    it('should delete a page', async () => {
      const editor = await create();

      await editor.removePage('page-2');

      expect(sdkMock.removeBookPage).toHaveBeenCalledWith({ id: book.id, pageId: 'page-2' });
    });
  });

  it('should run the changes one after the other', async () => {
    const editor = await create();
    let release!: () => void;
    sdkMock.updateBookPage.mockReturnValueOnce(
      new Promise((resolve) => (release = () => resolve(bookPageFactory('page-1', 0)))),
    );

    const first = editor.updatePage('page-1', { caption: 'first' });
    const second = editor.updateSlotCaption({ pageId: 'page-1', slot: 0 }, 'second');
    await vi.waitFor(() => expect(sdkMock.updateBookPage).toHaveBeenCalled());

    expect(editor.isSaving).toBe(true);
    expect(sdkMock.updateBookSlot).not.toHaveBeenCalled();

    release();
    await Promise.all([first, second]);

    expect(sdkMock.updateBookSlot).toHaveBeenCalled();
    expect(editor.isSaving).toBe(false);
  });

  it('should forget a selection that no longer exists', async () => {
    const editor = await create();
    editor.select({ pageId: 'page-2', slot: 3 });
    refresh.mockImplementation(() => {
      book = { ...book, pages: [book.pages[0]] };
    });

    await editor.removePage('page-2');

    expect(editor.selected).toBeUndefined();
  });
});
