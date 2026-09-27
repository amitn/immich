import { BookMapLook, BookMapStyle } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { bookDetailFactory, bookFactory } from '@test-data/factories/book-factory';
import { bookLayouts, bookPageFactory } from '@test-data/factories/book-page-factory';
import type BookPage from './+page.svelte';
import BookPageTestWrapper from './BookPage.test-wrapper.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: {} } as never,
}));
vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  return await import('@test-data/mocks/UserPageLayout.mock.svelte');
});
vi.mock('$lib/stores/websocket', () => ({ websocketEvents: { on: () => () => {} } }));

type Data = ComponentProps<typeof BookPage>['data'];

describe('book page editing', () => {
  const book = bookDetailFactory.build({
    title: 'Italy',
    updatedAt: '2026-09-25T10:00:00.000Z',
    pages: [
      bookPageFactory('page-1', 0, [{ assetId: 'asset-a' }, { assetId: 'asset-b' }], { layout: 'two-horizontal' }),
      bookPageFactory('page-2', 1, [{ assetId: 'asset-c' }]),
    ],
  });

  const renderPage = () =>
    render(BookPageTestWrapper, {
      data: { book, books: [bookFactory.build({ id: book.id })], meta: { title: book.title } } as Data,
    });

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getBaseUrl.mockReturnValue('/api');
    sdkMock.getBookLayouts.mockResolvedValue(Object.values(bookLayouts));
    Element.prototype.animate = getAnimateMock();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn();
  });

  it('should show the editing tools on the page and in the strip while editing', async () => {
    renderPage();

    expect(screen.queryByTestId('book-page-editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'book_page_actions' })).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'book_edit_pages' });
    await fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(sdkMock.getBookLayouts).toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'book_edit_slot' })).toHaveLength(2));
    expect(screen.getByTestId('book-edit-panel')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'book_page_actions' })).toHaveLength(2);

    await fireEvent.click(toggle);
    expect(screen.queryByTestId('book-page-editor')).not.toBeInTheDocument();
  });

  it('should reload the book after a change and render the pages again', async () => {
    const updated = { ...book, updatedAt: '2026-09-25T11:00:00.000Z' };
    sdkMock.getBook.mockResolvedValue(updated);
    renderPage();

    await fireEvent.click(screen.getByRole('button', { name: 'book_edit_pages' }));
    const [first, second] = await screen.findAllByRole('button', { name: 'book_edit_slot' });
    const transfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' };
    await fireEvent.dragStart(first, { dataTransfer: transfer });
    await fireEvent.dragOver(second, { dataTransfer: transfer });
    await fireEvent.drop(second, { dataTransfer: transfer });

    await waitFor(() => expect(sdkMock.setBookSlot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(sdkMock.getBook).toHaveBeenCalledWith({ id: book.id }));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'book_page_image' })).toHaveAttribute(
        'src',
        expect.stringContaining(encodeURIComponent(updated.updatedAt)),
      ),
    );
  });

  describe('map pages', () => {
    const mapBook = bookDetailFactory.build({
      title: 'Sicily',
      updatedAt: '2026-09-25T10:00:00.000Z',
      pages: [
        bookPageFactory('map-page', 0, [], {
          layout: 'map',
          map: { style: BookMapStyle.Sketch, showRoute: true, labels: true, title: 'Sicily' },
        }),
      ],
    });

    const renderMapBook = () =>
      render(BookPageTestWrapper, {
        data: { book: mapBook, books: [bookFactory.build({ id: mapBook.id })], meta: { title: 'Sicily' } } as Data,
      });

    it('should pick the style of a map page, with previews of each style', async () => {
      sdkMock.getBook.mockResolvedValue(mapBook);
      renderMapBook();
      await fireEvent.click(screen.getByRole('button', { name: 'book_edit_pages' }));

      const sketch = await screen.findByRole('radio', { name: 'book_map_style_sketch' });
      expect(sketch).toBeChecked();
      const preview = screen.getByTestId('book-map-style-styled-engraved').querySelector('img');
      expect(preview?.getAttribute('src')).toBe(
        `/api/books/map-preview?bookId=${mapBook.id}&pageId=map-page&style=styled&look=engraved&size=240`,
      );

      await fireEvent.click(screen.getByRole('radio', { name: 'book_map_look_engraved' }));

      await waitFor(() =>
        expect(sdkMock.updateBookPage).toHaveBeenCalledWith({
          id: mapBook.id,
          pageId: 'map-page',
          bookPageUpdateDto: {
            map: {
              style: BookMapStyle.Styled,
              look: BookMapLook.Engraved,
              title: 'Sicily',
              showRoute: true,
              labels: true,
            },
          },
        }),
      );
    });

    it('should illustrate the map with the art agent', async () => {
      featureFlagsManager.value.artisticStyles = true;
      sdkMock.getBook.mockResolvedValue(mapBook);
      renderMapBook();
      await fireEvent.click(screen.getByRole('button', { name: 'book_edit_pages' }));

      await fireEvent.click(await screen.findByRole('radio', { name: 'book_map_style_illustrated' }));
      await waitFor(() =>
        expect(sdkMock.illustrateBookPageMap).toHaveBeenCalledWith({ id: mapBook.id, pageId: 'map-page' }),
      );
      featureFlagsManager.value.artisticStyles = false;
    });

    it('should only offer an illustrated map with an art agent', async () => {
      sdkMock.getBook.mockResolvedValue(mapBook);
      renderMapBook();
      await fireEvent.click(screen.getByRole('button', { name: 'book_edit_pages' }));

      expect(await screen.findByRole('radio', { name: 'book_map_style_illustrated' })).toBeDisabled();
      expect(screen.getByRole('radio', { name: 'book_map_style_toner' })).toBeDisabled();
      expect(screen.getByRole('radio', { name: 'book_map_look_auto' })).toBeEnabled();
    });
  });
});
