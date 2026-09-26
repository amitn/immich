import { SharedLinkType, type SharedLinkResponseDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { DetachedWindowAPI } from 'happy-dom';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';
import BookSharedViewer from './BookSharedViewer.svelte';

describe('BookSharedViewer component', () => {
  const bookId = 'b0a8d6f2-5c2e-4b8a-9d8e-2f6c1a7e3b90';
  const bookLink = (link: Partial<SharedLinkResponseDto> = {}, book: Partial<SharedLinkResponseDto['book']> = {}) =>
    sharedLinkFactory.build({
      type: SharedLinkType.Book,
      key: 'book-key',
      slug: null,
      allowDownload: true,
      ...link,
      book: { id: bookId, title: 'Summer in Rome', subtitle: 'Italy 2025', pageCount: 24, hasPdf: true, ...book },
    });

  const getFrame = () => screen.getByTitle('book_shared_frame_title') as HTMLIFrameElement;
  const queryDownload = () => screen.queryByRole('link', { name: /book_download_pdf/ });

  beforeAll(() => {
    // never request the book from a server
    (globalThis as unknown as { happyDOM: DetachedWindowAPI }).happyDOM.settings.disableIframePageLoading = true;
  });

  it('should show the title and the web book in a sandboxed frame', () => {
    render(BookSharedViewer, { props: { sharedLink: bookLink(), key: 'book-key' } });

    expect(screen.getByRole('heading', { name: 'Summer in Rome' })).toBeInTheDocument();
    expect(screen.getByText('Italy 2025')).toBeInTheDocument();
    const frame = getFrame();
    expect(frame.getAttribute('src')).toBe(`/api/books/${bookId}/preview?key=book-key`);
    // the book runs its own script, but never with access to this page or its session
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('should read the book through the custom URL', () => {
    render(BookSharedViewer, { props: { sharedLink: bookLink({ slug: 'rome' }), slug: 'rome' } });

    expect(getFrame().getAttribute('src')).toBe(`/api/books/${bookId}/preview?slug=rome`);
    expect(queryDownload()?.getAttribute('href')).toBe(`/api/books/${bookId}/pdf?slug=rome`);
  });

  it('should show a spinner until the book is open', async () => {
    render(BookSharedViewer, { props: { sharedLink: bookLink(), key: 'book-key' } });

    expect(screen.getByText('book_shared_loading')).toBeInTheDocument();
    await fireEvent.load(getFrame());
    expect(screen.queryByText('book_shared_loading')).not.toBeInTheDocument();
  });

  it('should offer the PDF when the link allows downloads', () => {
    render(BookSharedViewer, { props: { sharedLink: bookLink(), key: 'book-key' } });

    expect(queryDownload()?.getAttribute('href')).toBe(`/api/books/${bookId}/pdf?key=book-key`);
  });

  it('should not offer the PDF when downloads are not allowed', () => {
    render(BookSharedViewer, { props: { sharedLink: bookLink({ allowDownload: false }), key: 'book-key' } });

    expect(queryDownload()).not.toBeInTheDocument();
  });

  it('should not offer a PDF that was not exported', () => {
    render(BookSharedViewer, { props: { sharedLink: bookLink({}, { hasPdf: false }), key: 'book-key' } });

    expect(queryDownload()).not.toBeInTheDocument();
  });

  it('should say when the book has no pages', () => {
    render(BookSharedViewer, { props: { sharedLink: bookLink({}, { pageCount: 0 }), key: 'book-key' } });

    expect(screen.getByRole('alert')).toHaveTextContent('book_no_pages');
    expect(screen.queryByTitle('book_shared_frame_title')).not.toBeInTheDocument();
  });
});
