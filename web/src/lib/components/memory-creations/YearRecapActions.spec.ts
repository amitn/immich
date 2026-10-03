import { BookDraftKind, HighlightFormat, MemoryType, type MemoryResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import HighlightVideoModal from '$lib/modals/HighlightVideoModal.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import { bookFactory } from '@test-data/factories/book-factory';
import YearRecapActions from './YearRecapActions.svelte';

const { flags } = vi.hoisted(() => ({ flags: { assistant: true } }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: flags, valueOrUndefined: flags } as never,
}));

const memory: MemoryResponseDto = {
  id: 'recap-memory',
  ownerId: 'me',
  assets: [assetFactory.build({ id: 'photo' })],
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  type: MemoryType.Rule,
  data: {
    ruleId: 'year_recap',
    context: {
      year: 2025,
      count: 1200,
      places: 9,
      people: 4,
      trips: 2,
      journals: { food: { places: 3, entries: 20 } },
    },
  },
  isSaved: false,
  memoryAt: '2025-07-01T00:00:00.000Z',
};

const draftOf = (bookId: string) => ({
  id: 'draft-1',
  key: 'recap:2025',
  kind: BookDraftKind.Recap,
  reason: 'Your 2025',
  memoryId: 'recap-memory',
  createdAt: '2026-01-02T00:00:00.000Z',
  book: bookFactory.build({ id: bookId, title: '2025 in review' }),
});

describe('YearRecapActions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    flags.assistant = true;
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    vi.spyOn(modalManager, 'showDialog').mockResolvedValue(true);
    vi.spyOn(toastManager, 'primary').mockImplementation(() => {});
    vi.spyOn(toastManager, 'success').mockImplementation(() => {});
    sdkMock.getBookDrafts.mockResolvedValue([]);
  });

  it('shows the stats of the year', () => {
    render(YearRecapActions, { props: { memory, title: '2025 in review' } });

    // svelte-i18n echoes the keys in tests
    expect(screen.getByText('year_recap_stat_people')).toBeInTheDocument();
    expect(screen.getByText('year_recap_stat_trips')).toBeInTheDocument();
    expect(screen.getByText('year_recap_stat_dishes')).toBeInTheDocument();
  });

  it('offers a landscape and a vertical video, named after the card', async () => {
    render(YearRecapActions, { props: { memory, title: '2025 in review' } });

    await fireEvent.click(screen.getByText('year_recap_video_vertical'));
    expect(modalManager.show).toHaveBeenCalledWith(HighlightVideoModal, {
      memoryId: 'recap-memory',
      title: '2025 in review',
      format: HighlightFormat.Vertical,
    });

    await fireEvent.click(screen.getByText('year_recap_video'));
    expect(modalManager.show).toHaveBeenCalledWith(HighlightVideoModal, {
      memoryId: 'recap-memory',
      title: '2025 in review',
      format: HighlightFormat.Landscape,
    });
  });

  it('drafts the book of the year when asked, then offers to keep it', async () => {
    sdkMock.createYearRecapBook.mockResolvedValue(draftOf('book-1') as never);
    sdkMock.keepBookDraft.mockResolvedValue(bookFactory.build({ id: 'book-1' }) as never);
    render(YearRecapActions, { props: { memory, title: '2025 in review' } });

    await fireEvent.click(await screen.findByText('year_recap_make_book'));

    expect(sdkMock.createYearRecapBook).toHaveBeenCalledWith({
      year: 2025,
      yearRecapBookDto: { title: '2025 in review' },
    });
    await fireEvent.click(await screen.findByText('book_draft_keep'));
    expect(sdkMock.keepBookDraft).toHaveBeenCalledWith({ id: 'book-1' });
    await waitFor(() => expect(screen.queryByText('book_draft_keep')).not.toBeInTheDocument());
    expect(screen.getByText('year_recap_book_open').closest('a')).toHaveAttribute('href', '/books/book-1');
  });

  it('offers the draft already made of the year, to keep or discard', async () => {
    sdkMock.getBookDrafts.mockResolvedValue([draftOf('book-2')] as never);
    sdkMock.discardBookDraft.mockResolvedValue();
    render(YearRecapActions, { props: { memory, title: '2025 in review' } });

    await fireEvent.click(await screen.findByText('book_draft_discard'));

    expect(sdkMock.discardBookDraft).toHaveBeenCalledWith({ id: 'book-2' });
    expect(await screen.findByText('year_recap_make_book')).toBeInTheDocument();
  });

  it('offers no book without the book engine', async () => {
    flags.assistant = false;
    render(YearRecapActions, { props: { memory, title: '2025 in review' } });

    expect(screen.queryByText('year_recap_make_book')).not.toBeInTheDocument();
    expect(sdkMock.getBookDrafts).not.toHaveBeenCalled();
  });
});
