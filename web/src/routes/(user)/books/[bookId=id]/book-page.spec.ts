import type { BookPageResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { goto } from '$app/navigation';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import BookPreviewModal from '$lib/modals/BookPreviewModal.svelte';
import { bookDetailFactory, bookFactory } from '@test-data/factories/book-factory';
import type BookPage from './+page.svelte';
import BookPageTestWrapper from './BookPage.test-wrapper.svelte';

const navigation = vi.hoisted(() => ({ afterNavigate: [] as Array<() => void> }));

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: (callback: () => void) => {
    navigation.afterNavigate.push(callback);
  },
}));
vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: {} } as never,
}));
vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  return await import('@test-data/mocks/UserPageLayout.mock.svelte');
});
vi.mock('$lib/stores/websocket', () => ({ websocketEvents: { on: () => () => {} } }));

type Data = ComponentProps<typeof BookPage>['data'];

const pageFactory = (id: string, position: number): BookPageResponseDto => ({
  id,
  position,
  layout: 'single',
  slots: [],
  background: null,
  caption: null,
  sectionTitle: null,
  map: null,
  updatedAt: '2026-09-25T10:00:00.000Z',
});

describe('book page', () => {
  const book = bookDetailFactory.build({
    title: 'Italy',
    updatedAt: '2026-09-25T10:00:00.000Z',
    pages: [pageFactory('page-1', 0), pageFactory('page-2', 1)],
  });
  const other = bookFactory.build({
    title: 'Norway',
    pageCount: 8,
    firstPageId: 'page-9',
    updatedAt: '2026-09-20T10:00:00.000Z',
  });
  const listed = bookFactory.build({ id: book.id, title: 'Italy', updatedAt: book.updatedAt });

  const pageProps = (data: Partial<Data> = {}) => ({
    data: { book, books: [listed, other], meta: { title: book.title }, ...data } as Data,
  });

  const renderPage = (data: Partial<Data> = {}) => render(BookPageTestWrapper, pageProps(data));

  beforeEach(() => {
    vi.resetAllMocks();
    navigation.afterNavigate = [];
    sdkMock.getBaseUrl.mockReturnValue('/api');
    Element.prototype.animate = getAnimateMock();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn();
    // show() is generic, so the spy cannot infer its result type
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
  });

  it('should link back to the list of books', () => {
    renderPage();

    expect(screen.getByRole('link', { name: 'book_back_to_list' })).toHaveAttribute('href', '/books');
  });

  it('should list the books and mark the open one', async () => {
    renderPage();

    await fireEvent.click(screen.getByRole('button', { name: 'book_switch' }));

    const entries = await screen.findAllByRole('menuitemradio');
    expect(entries.map((entry) => entry.textContent)).toEqual([
      expect.stringContaining('Italy'),
      expect.stringContaining('Norway'),
    ]);
    expect(entries[0]).toHaveAttribute('aria-checked', 'true');
    expect(entries[1]).toHaveAttribute('aria-checked', 'false');
    expect(entries[1]).toHaveTextContent('book_page_count');
    expect(entries[1].querySelector('img')?.getAttribute('src')).toBe(
      `/api/books/${other.id}/pages/${other.firstPageId}/render?size=120&c=${encodeURIComponent(other.updatedAt)}`,
    );
  });

  it('should switch to another book', async () => {
    renderPage();

    await fireEvent.click(screen.getByRole('button', { name: 'book_switch' }));
    await fireEvent.click(await screen.findByRole('menuitemradio', { name: /Norway/ }));

    expect(goto).toHaveBeenCalledWith(`/books/${other.id}`);
  });

  it('should hide the book switcher when there is only one book', () => {
    renderPage({ books: [listed] });

    expect(screen.queryByRole('button', { name: 'book_switch' })).not.toBeInTheDocument();
  });

  it('should show the next book after switching', async () => {
    const { rerender } = renderPage();
    const next = bookDetailFactory.build({ title: 'Norway', pages: [pageFactory('page-3', 0)] });

    await rerender(pageProps({ book: next, meta: { title: next.title } }));
    for (const callback of navigation.afterNavigate) {
      callback();
    }

    await waitFor(() => expect(screen.getAllByRole('button', { name: /book_go_to_page/ })).toHaveLength(1));
    expect(screen.getByRole('img', { name: 'book_page_image' })).toHaveAttribute(
      'src',
      expect.stringContaining(`/api/books/${next.id}/pages/page-3/render`),
    );
  });

  it('should open the preview', async () => {
    renderPage();

    await fireEvent.click(screen.getByRole('button', { name: /preview/ }));

    expect(modalManager.show).toHaveBeenCalledWith(BookPreviewModal, {
      book: expect.objectContaining({ id: book.id, pageCount: 2 }),
    });
  });

  it('should not offer a preview of a book without pages', () => {
    renderPage({ book: { ...book, pages: [] } });

    expect(screen.getByRole('button', { name: /preview/ })).toBeDisabled();
    expect(sdkMock.getBook).not.toHaveBeenCalled();
  });
});
