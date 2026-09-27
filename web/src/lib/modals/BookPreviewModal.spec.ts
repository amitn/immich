import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { DetachedWindowAPI } from 'happy-dom';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { bookFactory } from '@test-data/factories/book-factory';
import BookPreviewModal from './BookPreviewModal.svelte';

describe('BookPreviewModal component', () => {
  const onClose = vi.fn();
  const book = bookFactory.build({ title: 'Italy', pageCount: 12, updatedAt: '2026-09-25T10:00:00.000Z' });
  const previewUrl = `/api/books/${book.id}/preview?v=2026-09-25T10%3A00%3A00.000Z`;

  const getFrame = () => screen.getByTitle('book_preview_of') as HTMLIFrameElement;

  beforeAll(() => {
    // never request the preview from a server (happy-dom logs that it skipped the frame)
    (globalThis as unknown as { happyDOM: DetachedWindowAPI }).happyDOM.settings.disableIframePageLoading = true;
  });

  beforeEach(() => {
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('should show the always-current preview in a sandboxed frame', async () => {
    render(BookPreviewModal, { props: { book, onClose } });

    const frame = await waitFor(getFrame);
    expect(frame.getAttribute('src')).toBe(previewUrl);
    // the preview runs its own script, but never with access to the user's session
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(screen.getByText('Italy')).toBeInTheDocument();
  });

  it('should show a spinner until the preview is built', async () => {
    render(BookPreviewModal, { props: { book, onClose } });

    expect(await screen.findByText('book_preview_loading')).toBeInTheDocument();
    await fireEvent.load(getFrame());

    expect(screen.queryByText('book_preview_loading')).not.toBeInTheDocument();
  });

  it('should focus the preview so the arrow keys turn the pages', async () => {
    render(BookPreviewModal, { props: { book, onClose } });

    await waitFor(() => expect(document.activeElement).toBe(getFrame()));
  });

  it('should open the preview in a new tab', async () => {
    render(BookPreviewModal, { props: { book, onClose } });

    const link = await screen.findByRole('link', { name: /open_in_new_tab/ });
    expect(link.getAttribute('href')).toBe(previewUrl);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('should close', async () => {
    render(BookPreviewModal, { props: { book, onClose } });

    await fireEvent.click(await screen.findByRole('button', { name: 'close' }));

    expect(onClose).toHaveBeenCalled();
  });

  describe('messages from the preview', () => {
    const close = { type: 'immich-book-preview', action: 'close' };
    const post = (data: unknown, source: unknown) =>
      dispatchEvent(new MessageEvent('message', { data, source: source as MessageEventSource | null }));

    /** the frame does not load in tests, so it gets a stand-in for its window */
    const getFrameWindow = async () => {
      const frame = await waitFor(getFrame);
      const contentWindow = {};
      Object.defineProperty(frame, 'contentWindow', { value: contentWindow, configurable: true });
      return contentWindow;
    };

    it('should close when the preview asks to, e.g. on Esc', async () => {
      render(BookPreviewModal, { props: { book, onClose } });
      const frameWindow = await getFrameWindow();

      post(close, frameWindow);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should ignore messages from other windows', async () => {
      render(BookPreviewModal, { props: { book, onClose } });
      await getFrameWindow();

      post(close, document.defaultView);
      post(close, {});
      post(close, null);

      expect(onClose).not.toHaveBeenCalled();
    });

    it('should ignore other messages from the preview', async () => {
      render(BookPreviewModal, { props: { book, onClose } });
      const frameWindow = await getFrameWindow();

      post({ type: 'immich-book-preview', action: 'next' }, frameWindow);
      post({ type: 'other', action: 'close' }, frameWindow);
      post('close', frameWindow);
      post(null, frameWindow);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('should not load a preview of a book without pages', async () => {
    render(BookPreviewModal, { props: { book: { ...book, pageCount: 0 }, onClose } });

    expect(await screen.findByRole('alert')).toHaveTextContent('book_no_pages');
    expect(screen.queryByTitle('book_preview_of')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open_in_new_tab/ })).not.toBeInTheDocument();
  });
});
