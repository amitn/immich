import { BookStatus } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { bookDraftFactory, bookFactory } from '@test-data/factories/book-factory';
import BooksPage from './+page.svelte';

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: {} } as never,
}));
vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  return await import('@test-data/mocks/UserPageLayout.mock.svelte');
});
vi.mock('$lib/services/assistant.service', () => ({ openAssistant: vi.fn() }));

type Data = ComponentProps<typeof BooksPage>['data'];

describe('books page', () => {
  const book = bookFactory.build({ title: 'Italy', updatedAt: '2026-09-20T10:00:00.000Z' });
  const food = bookDraftFactory.build({
    book: bookFactory.build({ title: '2025 in food', status: BookStatus.Draft, firstPageId: 'cover-1' }),
    reason: 'You visited 6 restaurants in 2025 and photographed 54 dishes',
  });
  const trip = bookDraftFactory.build({
    book: bookFactory.build({ title: 'Our trip to Rome', status: BookStatus.Draft }),
    reason: 'You spent 3 days in Rome and took 45 photos',
  });

  const renderPage = (data: Partial<Data> = {}) =>
    render(BooksPage, {
      props: { data: { enabled: true, books: [book], drafts: [food, trip], meta: { title: 'Photo books' }, ...data } },
    });

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getBaseUrl.mockReturnValue('/api');
    Element.prototype.animate = getAnimateMock();
  });

  it('should show the suggested books above the books', () => {
    renderPage();

    const row = screen.getByTestId('book-drafts');
    expect(within(row).getByRole('heading', { name: 'book_drafts_title' })).toBeInTheDocument();
    const cards = within(row).getAllByTestId('book-draft-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('2025 in food');
    expect(cards[0]).toHaveTextContent('You visited 6 restaurants in 2025 and photographed 54 dishes');
    expect(screen.getByRole('heading', { name: 'book_your_books' })).toBeInTheDocument();
    expect(screen.getByText('Italy')).toBeInTheDocument();
  });

  it('should hide the row without suggestions', () => {
    renderPage({ drafts: [] });

    expect(screen.queryByTestId('book-drafts')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'book_your_books' })).not.toBeInTheDocument();
  });

  it('should show the suggestions instead of the empty state', () => {
    renderPage({ books: [] });

    expect(screen.getByTestId('book-drafts')).toBeInTheDocument();
    expect(screen.queryByText('book_empty_title')).not.toBeInTheDocument();
  });

  it('should move a kept draft to the books', async () => {
    sdkMock.keepBookDraft.mockResolvedValue({ ...food.book, status: BookStatus.Active });
    vi.spyOn(toastManager, 'success');
    renderPage();

    const [first] = screen.getAllByTestId('book-draft-card');
    await fireEvent.click(within(first).getByRole('button', { name: 'book_draft_keep_title' }));

    expect(sdkMock.keepBookDraft).toHaveBeenCalledWith({ id: food.book.id });
    await waitFor(() => expect(screen.getAllByTestId('book-draft-card')).toHaveLength(1));
    expect(screen.getByText('2025 in food')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /2025 in food/ })).toHaveAttribute('href', `/books/${food.book.id}`);
  });

  it('should remove a discarded draft', async () => {
    vi.spyOn(modalManager, 'showDialog').mockResolvedValue(true);
    vi.spyOn(toastManager, 'primary');
    sdkMock.discardBookDraft.mockResolvedValue(undefined as never);
    renderPage();

    const [, second] = screen.getAllByTestId('book-draft-card');
    await fireEvent.click(within(second).getByRole('button', { name: 'book_draft_discard_title' }));

    await waitFor(() => expect(sdkMock.discardBookDraft).toHaveBeenCalledWith({ id: trip.book.id }));
    await waitFor(() => expect(screen.getAllByTestId('book-draft-card')).toHaveLength(1));
    expect(screen.queryByText('Our trip to Rome')).not.toBeInTheDocument();
  });

  it('should keep a draft whose discard is cancelled', async () => {
    vi.spyOn(modalManager, 'showDialog').mockResolvedValue(false);
    renderPage();

    const [first] = screen.getAllByTestId('book-draft-card');
    await fireEvent.click(within(first).getByRole('button', { name: 'book_draft_discard_title' }));

    await waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
    expect(sdkMock.discardBookDraft).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('book-draft-card')).toHaveLength(2);
  });
});
