import type { BookDetailResponseDto, BookPageResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import BookPageStrip from '$lib/components/books/BookPageStrip.svelte';
import { BookEditorManager } from '$lib/managers/book-editor-manager.svelte';
import BookLayoutPickerModal from '$lib/modals/BookLayoutPickerModal.svelte';
import { bookDetailFactory } from '@test-data/factories/book-factory';
import { bookLayouts, bookPageFactory } from '@test-data/factories/book-page-factory';

describe('BookPageStrip component', () => {
  let book: BookDetailResponseDto;
  let editor: BookEditorManager;
  const refresh = vi.fn();
  const onGoToPage = vi.fn();

  const renderStrip = (editing = true) =>
    render(TestWrapper, {
      component: BookPageStrip,
      componentProps: {
        pages: book.pages,
        current: [book.pages[0]],
        ratio: 1,
        renderUrl: (page: BookPageResponseDto, size: number) => `/render/${page.id}?size=${size}`,
        onGoToPage,
        editor: editing ? editor : undefined,
      },
    } as never);

  const dataTransfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' });

  const openMenu = async (page: number) => {
    await fireEvent.click(screen.getAllByRole('button', { name: 'book_page_actions' })[page - 1]);
    return screen.findAllByRole('menuitem');
  };

  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    book = bookDetailFactory.build({
      pages: [bookPageFactory('page-1', 0), bookPageFactory('page-2', 1), bookPageFactory('page-3', 2)],
    });
    refresh.mockResolvedValue(undefined);
    editor = new BookEditorManager({ getBook: () => book, refresh });
    sdkMock.getBookLayouts.mockResolvedValue(Object.values(bookLayouts));
    // show() is generic, so the spy cannot infer its result type
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
  });

  it('should only offer page actions while editing', () => {
    renderStrip(false);

    expect(screen.getAllByRole('button', { name: 'book_go_to_page' })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'book_page_actions' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('draggable', 'false');
  });

  it('should go to a page', async () => {
    renderStrip();

    await fireEvent.click(screen.getAllByRole('button', { name: 'book_go_to_page' })[2]);

    expect(onGoToPage).toHaveBeenCalledWith(2);
  });

  it('should reorder pages by drag and drop', async () => {
    renderStrip();

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('draggable', 'true');
    await fireEvent.dragStart(items[0], { dataTransfer: dataTransfer() });
    await fireEvent.dragOver(items[2], { dataTransfer: dataTransfer() });
    await fireEvent.drop(items[2], { dataTransfer: dataTransfer() });

    await waitFor(() =>
      expect(sdkMock.moveBookPage).toHaveBeenCalledExactlyOnceWith({
        id: book.id,
        pageId: 'page-1',
        bookPageMoveDto: { position: 2 },
      }),
    );
    await waitFor(() => expect(onGoToPage).toHaveBeenCalledWith(2));
    expect(refresh).toHaveBeenCalled();
  });

  it('should not move a page dropped onto itself', async () => {
    renderStrip();

    const items = screen.getAllByRole('listitem');
    await fireEvent.dragStart(items[1], { dataTransfer: dataTransfer() });
    await fireEvent.drop(items[1], { dataTransfer: dataTransfer() });

    expect(sdkMock.moveBookPage).not.toHaveBeenCalled();
  });

  it('should move a page from the keyboard', async () => {
    renderStrip();

    const options = await openMenu(2);
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'book_move_page_earlier',
      'book_move_page_later',
      'book_add_page_after',
      'book_delete_page',
    ]);
    await fireEvent.click(options[1]);

    await waitFor(() =>
      expect(sdkMock.moveBookPage).toHaveBeenCalledWith({
        id: book.id,
        pageId: 'page-2',
        bookPageMoveDto: { position: 2 },
      }),
    );
  });

  it('should not offer to move the first page earlier', async () => {
    renderStrip();

    const options = await openMenu(1);
    expect(options.map((option) => option.textContent?.trim())).not.toContain('book_move_page_earlier');
  });

  it('should delete a page after confirming', async () => {
    const showDialog = vi.spyOn(modalManager, 'showDialog').mockResolvedValue(true);
    renderStrip();

    const options = await openMenu(3);
    await fireEvent.click(options.at(-1)!);

    expect(showDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'book_delete_page' }));
    await waitFor(() => expect(sdkMock.removeBookPage).toHaveBeenCalledWith({ id: book.id, pageId: 'page-3' }));
    await waitFor(() => expect(onGoToPage).toHaveBeenCalled());
  });

  it('should keep the page when the deletion is cancelled', async () => {
    vi.spyOn(modalManager, 'showDialog').mockResolvedValue(false);
    renderStrip();

    const options = await openMenu(2);
    await fireEvent.click(options.at(-1)!);

    await waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
    expect(sdkMock.removeBookPage).not.toHaveBeenCalled();
  });

  it('should add a page with the chosen layout after a page', async () => {
    vi.mocked(modalManager.show).mockResolvedValue('four-grid' as never);
    sdkMock.addBookPage.mockResolvedValue(bookPageFactory('page-4', 1));
    renderStrip();

    const options = await openMenu(1);
    await fireEvent.click(options.find((option) => option.textContent?.includes('book_add_page_after'))!);

    await waitFor(() =>
      expect(modalManager.show).toHaveBeenCalledWith(
        BookLayoutPickerModal,
        expect.objectContaining({ title: 'book_add_page', layouts: Object.values(bookLayouts) }),
      ),
    );
    await waitFor(() =>
      expect(sdkMock.addBookPage).toHaveBeenCalledWith({
        id: book.id,
        bookPageCreateDto: { layout: 'four-grid', position: 1 },
      }),
    );
    await waitFor(() => expect(onGoToPage).toHaveBeenCalledWith(1));
  });
});
