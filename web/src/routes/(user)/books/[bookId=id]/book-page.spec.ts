import { AgentMessageKind, BookStylePreset, Orientation, Severity, type BookPageResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { goto } from '$app/navigation';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { AgentToolCallStatus } from '$lib/managers/agent-conversation.svelte';
import BookPreviewModal from '$lib/modals/BookPreviewModal.svelte';
import { openAssistant } from '$lib/services/assistant.service';
import { resetBookLayouts } from '$lib/utils/book-review';
import { resetBookStylePresets } from '$lib/utils/book-style';
import { bookDetailFactory, bookFactory } from '@test-data/factories/book-factory';
import { bookReviewIssueFactory, bookStylePresets, buildBookReview } from '@test-data/factories/book-review-factory';
import type BookPage from './+page.svelte';
import BookPageTestWrapper from './BookPage.test-wrapper.svelte';

const navigation = vi.hoisted(() => ({ afterNavigate: [] as Array<() => void> }));
const websocket = vi.hoisted(() => ({ handlers: [] as Array<(update: unknown) => void> }));

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
vi.mock('$lib/stores/websocket', () => ({
  websocketEvents: {
    on: (_event: string, handler: (update: unknown) => void) => {
      websocket.handlers.push(handler);
      return () => {};
    },
  },
}));
vi.mock('$lib/services/assistant.service', () => ({ openAssistant: vi.fn() }));

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
    websocket.handlers = [];
    resetBookStylePresets();
    resetBookLayouts();
    sdkMock.getBookStylePresets.mockResolvedValue([]);
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
  describe('review', () => {
    const review = buildBookReview({
      issues: [
        bookReviewIssueFactory.build({
          severity: Severity.High,
          message: 'Photo 1 prints at 120 dpi',
          pages: [2],
          slot: 1,
        }),
        bookReviewIssueFactory.build({ severity: Severity.Medium, message: 'Repeated layout', pages: [1, 2] }),
        bookReviewIssueFactory.build({ severity: Severity.Low, message: 'No captions', pages: [1] }),
      ],
    });

    const agentUpdate = (bookIds: string[]) => ({
      message: {
        kind: AgentMessageKind.ToolCall,
        content: { status: AgentToolCallStatus.Completed, bookIds },
      },
    });

    beforeEach(() => {
      sdkMock.getBookReview.mockResolvedValue(review);
      sdkMock.getBookLayouts.mockResolvedValue([
        {
          id: 'single',
          name: 'Single',
          description: 'One photo',
          fullBleed: false,
          orientation: Orientation.Any,
          slots: [{ x: 0, y: 0, width: 1, height: 1 }],
          textAreas: [],
        },
      ]);
    });

    it('should count the high and medium issues on the review button', async () => {
      renderPage();

      expect(await screen.findByTestId('book-review-badge')).toHaveTextContent('2');
      expect(sdkMock.getBookReview).toHaveBeenCalledWith({ id: book.id });
      expect(screen.getByRole('button', { name: /book_review/ })).toHaveAttribute('aria-expanded', 'false');
    });

    it('should open the review and go to the page of an issue', async () => {
      renderPage();
      const button = screen.getByRole('button', { name: /book_review/ });

      await fireEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
      await fireEvent.click(await screen.findByRole('button', { name: /prints at 120 dpi/ }));

      const thumbnails = screen.getAllByRole('button', { name: /book_go_to_page/ });
      await waitFor(() => expect(thumbnails[1]).toHaveAttribute('aria-current', 'true'));
      expect(await screen.findByTestId('book-slot-highlight')).toBeInTheDocument();
    });

    it('should close the review with Escape and focus the review button', async () => {
      renderPage();
      const button = screen.getByRole('button', { name: /book_review/ });

      await fireEvent.click(button);
      const heading = await screen.findByRole('heading', { name: 'book_review_title' });
      await fireEvent.keyDown(heading, { key: 'Escape' });

      expect(screen.queryByRole('complementary', { name: 'book_review_title' })).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    });

    it('should fix an issue with the assistant', async () => {
      renderPage();

      await fireEvent.click(screen.getByRole('button', { name: /book_review/ }));
      const [fix] = await screen.findAllByRole('button', { name: 'book_review_fix_issue' });
      await fireEvent.click(fix);

      expect(openAssistant).toHaveBeenCalledWith({ prompt: expect.any(String), assetIds: undefined });
    });

    it('should review the book again after the assistant used a tool on it', async () => {
      sdkMock.getBook.mockResolvedValue(book);
      renderPage();
      await waitFor(() => expect(sdkMock.getBookReview).toHaveBeenCalledTimes(1));

      for (const handler of websocket.handlers) {
        handler(agentUpdate([book.id]));
        handler(agentUpdate(['another-book']));
      }

      await waitFor(() => expect(sdkMock.getBookReview).toHaveBeenCalledTimes(2));
      expect(sdkMock.getBook).toHaveBeenCalledTimes(1);
    });

    it('should review the book again once when the assistant changed it', async () => {
      sdkMock.getBook.mockResolvedValue({ ...book, updatedAt: '2026-09-25T11:00:00.000Z' });
      renderPage();
      await waitFor(() => expect(sdkMock.getBookReview).toHaveBeenCalledTimes(1));

      for (const handler of websocket.handlers) {
        handler(agentUpdate([book.id]));
      }

      await waitFor(() => expect(sdkMock.getBookReview).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(sdkMock.getBookReview).toHaveBeenCalledTimes(2);
    });
  });

  describe('style', () => {
    it('should apply a preset and render the pages again', async () => {
      const [classic, soft] = bookStylePresets;
      const styled = { ...book, style: { ...soft.style } };
      sdkMock.getBookStylePresets.mockResolvedValue(bookStylePresets);
      sdkMock.updateBook.mockResolvedValue({
        ...styled,
        style: { ...classic.style },
        updatedAt: '2026-09-25T12:00:00.000Z',
      });
      renderPage({ book: styled });

      await fireEvent.click(await screen.findByRole('button', { name: 'book_style_current' }));
      await fireEvent.click(await screen.findByRole('menuitemradio', { name: /book_style_preset_classic/ }));

      await waitFor(() =>
        expect(screen.getByRole('img', { name: 'book_page_image' })).toHaveAttribute(
          'src',
          expect.stringContaining(encodeURIComponent('2026-09-25T12:00:00.000Z')),
        ),
      );
      expect(sdkMock.updateBook).toHaveBeenCalledWith({
        id: book.id,
        bookUpdateDto: { stylePreset: BookStylePreset.Classic },
      });
    });
  });
});
