import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
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
});
