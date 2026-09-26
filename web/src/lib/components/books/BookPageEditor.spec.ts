import type { BookDetailResponseDto, BookPageResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import BookEditPanel from '$lib/components/books/BookEditPanel.svelte';
import BookPageEditor from '$lib/components/books/BookPageEditor.svelte';
import { BookEditorManager } from '$lib/managers/book-editor-manager.svelte';
import BookAssetPickerModal from '$lib/modals/BookAssetPickerModal.svelte';
import BookCropModal from '$lib/modals/BookCropModal.svelte';
import BookLayoutPickerModal from '$lib/modals/BookLayoutPickerModal.svelte';
import { bookDetailFactory } from '@test-data/factories/book-factory';
import { bookLayouts, bookPageFactory } from '@test-data/factories/book-page-factory';

describe('book page editor', () => {
  let book: BookDetailResponseDto;
  let editor: BookEditorManager;
  const refresh = vi.fn();

  const percent = (value: string) => Number(value.replace('%', ''));

  const dataTransfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' });

  const renderEditor = (pageIndex = 0) =>
    render(BookPageEditor, { editor, page: book.pages[pageIndex], pageNumber: pageIndex + 1 });

  const renderPanel = () =>
    render(TestWrapper, {
      component: BookEditPanel,
      componentProps: {
        editor,
        pages: book.pages,
        pageNumber: (page: BookPageResponseDto) => book.pages.indexOf(page) + 1,
      },
    } as never);

  beforeEach(async () => {
    vi.resetAllMocks();
    sdkMock.getBaseUrl.mockReturnValue('/api');
    Element.prototype.animate = getAnimateMock();
    book = bookDetailFactory.build({
      albumId: 'album-1',
      pageWidthMm: 200,
      pageHeightMm: 100,
      style: { marginMm: 10, gutterMm: 4, background: '#ffffff', textColor: '#222222', fontFamily: 'serif' },
      pages: [
        bookPageFactory('page-1', 0, [{ assetId: 'asset-a', caption: 'Rome' }, { assetId: 'asset-b' }], {
          layout: 'two-horizontal',
          caption: 'Our trip',
        }),
      ],
    });
    refresh.mockResolvedValue(undefined);
    editor = new BookEditorManager({ getBook: () => book, refresh });
    sdkMock.getBookLayouts.mockResolvedValue(Object.values(bookLayouts));
    await editor.loadLayouts();
    // show() is generic, so the spy cannot infer its result type
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
  });

  describe('overlay', () => {
    it('should place a button over every slot, including the margins and gutters', () => {
      renderEditor();

      const [first, second] = screen.getAllByRole('button');
      expect(first).toHaveAccessibleName('book_edit_slot');
      // 10 mm margins on a 200 × 100 mm page, and half of the 4 mm gutter between the slots
      expect(first.style.left).toBe('5%');
      expect(first.style.top).toBe('10%');
      expect(percent(first.style.width)).toBeCloseTo(44);
      expect(percent(first.style.height)).toBeCloseTo(80);
      expect(percent(second.style.left)).toBeCloseTo(51);
    });

    it('should select a slot', async () => {
      renderEditor();

      const [first] = screen.getAllByRole('button');
      await fireEvent.click(first);

      expect(editor.selected).toEqual({ pageId: 'page-1', slot: 0 });
      expect(first).toHaveAttribute('aria-pressed', 'true');

      await fireEvent.keyDown(first, { key: 'Escape' });
      expect(editor.selected).toBeUndefined();
    });

    it('should swap two photos by drag and drop', async () => {
      renderEditor();

      const [first, second] = screen.getAllByRole('button');
      expect(first).toHaveAttribute('draggable', 'true');
      await fireEvent.dragStart(first, { dataTransfer: dataTransfer() });
      await fireEvent.dragOver(second, { dataTransfer: dataTransfer() });
      await fireEvent.drop(second, { dataTransfer: dataTransfer() });

      await waitFor(() => expect(sdkMock.setBookSlot).toHaveBeenCalledTimes(2));
      expect(sdkMock.setBookSlot).toHaveBeenCalledWith({
        id: book.id,
        pageId: 'page-1',
        slot: 1,
        bookSlotUpdateDto: { assetId: 'asset-a', caption: 'Rome' },
      });
      expect(sdkMock.setBookSlot).toHaveBeenCalledWith({
        id: book.id,
        pageId: 'page-1',
        slot: 0,
        bookSlotUpdateDto: { assetId: 'asset-b', caption: null },
      });
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });
  });

  describe('panel', () => {
    it('should replace the photo of the selected slot with one from the picker', async () => {
      vi.mocked(modalManager.show).mockResolvedValue('asset-z' as never);
      editor.select({ pageId: 'page-1', slot: 1 });
      renderPanel();

      await fireEvent.click(screen.getByRole('button', { name: 'book_replace_photo' }));

      expect(modalManager.show).toHaveBeenCalledWith(BookAssetPickerModal, {
        title: 'book_replace_photo',
        albumId: 'album-1',
        usedAssetIds: ['asset-a', 'asset-b'],
        currentAssetId: 'asset-b',
      });
      await waitFor(() =>
        expect(sdkMock.setBookSlot).toHaveBeenCalledWith({
          id: book.id,
          pageId: 'page-1',
          slot: 1,
          bookSlotUpdateDto: { assetId: 'asset-z', caption: null },
        }),
      );
    });

    it('should move the selected photo from the keyboard', async () => {
      editor.select({ pageId: 'page-1', slot: 0 });
      renderPanel();

      await fireEvent.click(screen.getByRole('button', { name: 'book_move_photo_to' }));
      const options = await screen.findAllByRole('menuitem');
      expect(options).toHaveLength(1);
      await fireEvent.click(options[0]);

      await waitFor(() => expect(sdkMock.setBookSlot).toHaveBeenCalledTimes(2));
    });

    it('should remove the photo of the selected slot', async () => {
      editor.select({ pageId: 'page-1', slot: 0 });
      renderPanel();

      await fireEvent.click(screen.getByRole('button', { name: 'book_remove_photo' }));

      await waitFor(() =>
        expect(sdkMock.clearBookSlot).toHaveBeenCalledWith({ id: book.id, pageId: 'page-1', slot: 0 }),
      );
    });

    it('should crop the photo of the selected slot', async () => {
      const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
      vi.mocked(modalManager.show).mockResolvedValue({ crop } as never);
      editor.select({ pageId: 'page-1', slot: 0 });
      renderPanel();

      await fireEvent.click(screen.getByRole('button', { name: 'book_adjust_crop' }));

      expect(modalManager.show).toHaveBeenCalledWith(BookCropModal, {
        assetId: 'asset-a',
        crop: null,
        slotAspect: 1,
      });
      await waitFor(() =>
        expect(sdkMock.updateBookSlot).toHaveBeenCalledWith({
          id: book.id,
          pageId: 'page-1',
          slot: 0,
          bookSlotPatchDto: { crop },
        }),
      );
    });

    it('should change the layout of a page', async () => {
      vi.mocked(modalManager.show).mockResolvedValue('four-grid' as never);
      sdkMock.updateBookPage.mockResolvedValue(
        bookPageFactory('page-1', 0, [
          { assetId: 'asset-a' },
          { assetId: 'asset-b' },
          { assetId: null },
          { assetId: null },
        ]),
      );
      renderPanel();

      await fireEvent.click(screen.getByRole('button', { name: 'book_change_layout' }));

      expect(modalManager.show).toHaveBeenCalledWith(
        BookLayoutPickerModal,
        expect.objectContaining({ current: 'two-horizontal', photoCount: 2, isMap: false }),
      );
      await waitFor(() =>
        expect(sdkMock.updateBookPage).toHaveBeenCalledWith({
          id: book.id,
          pageId: 'page-1',
          bookPageUpdateDto: { layout: 'four-grid' },
        }),
      );
    });

    it('should save the page caption on blur', async () => {
      renderPanel();

      const caption = screen.getByRole('textbox', { name: 'book_page_caption' });
      expect(caption).toHaveValue('Our trip');
      await fireEvent.input(caption, { target: { value: 'Our trip to Italy' } });
      await fireEvent.blur(caption);

      await waitFor(() =>
        expect(sdkMock.updateBookPage).toHaveBeenCalledExactlyOnceWith({
          id: book.id,
          pageId: 'page-1',
          bookPageUpdateDto: { caption: 'Our trip to Italy' },
        }),
      );
    });

    it('should save the section title with Enter, and not save text that did not change', async () => {
      renderPanel();

      const title = screen.getByRole('textbox', { name: 'book_section_title' });
      await fireEvent.keyDown(title, { key: 'Enter' });
      expect(sdkMock.updateBookPage).not.toHaveBeenCalled();

      await fireEvent.input(title, { target: { value: 'Rome' } });
      await fireEvent.keyDown(title, { key: 'Enter' });

      await waitFor(() =>
        expect(sdkMock.updateBookPage).toHaveBeenCalledWith({
          id: book.id,
          pageId: 'page-1',
          bookPageUpdateDto: { sectionTitle: 'Rome' },
        }),
      );
    });

    it('should save a photo caption after typing stops', async () => {
      vi.useFakeTimers();
      try {
        editor.select({ pageId: 'page-1', slot: 0 });
        renderPanel();

        const caption = screen.getByRole('textbox', { name: 'book_photo_caption' });
        expect(caption).toHaveValue('Rome');
        await fireEvent.input(caption, { target: { value: 'The Colosseum' } });
        expect(sdkMock.updateBookSlot).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2000);

        expect(sdkMock.updateBookSlot).toHaveBeenCalledExactlyOnceWith({
          id: book.id,
          pageId: 'page-1',
          slot: 0,
          bookSlotPatchDto: { caption: 'The Colosseum' },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('should keep the text of a caption that could not be saved', async () => {
      sdkMock.updateBookPage.mockRejectedValue(new Error('boom'));
      renderPanel();

      const caption = screen.getByRole('textbox', { name: 'book_page_caption' });
      await fireEvent.input(caption, { target: { value: 'Unsaved' } });
      await fireEvent.blur(caption);

      await waitFor(() => expect(sdkMock.updateBookPage).toHaveBeenCalled());
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(caption).toHaveValue('Unsaved');
    });
  });
});
