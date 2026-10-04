import { SharedLinkType } from '@immich/sdk';
import { screen } from '@testing-library/svelte';
import { renderWithTooltips } from '$tests/helpers';
import { bookFactory } from '@test-data/factories/book-factory';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';
import SharedLinkCard from './SharedLinkCard.svelte';

describe('SharedLinkCard component', () => {
  const bookLink = (link: Parameters<typeof sharedLinkFactory.build>[0] = {}) =>
    sharedLinkFactory.build({
      type: SharedLinkType.Book,
      allowUpload: false,
      allowDownload: true,
      showMetadata: true,
      password: null,
      ...link,
      book: { id: 'book-id', title: 'Museum visits', subtitle: null, pageCount: 25, hasPdf: true },
    });

  it('should say what a link to a book allows: the PDF and the dates and file names', () => {
    renderWithTooltips(SharedLinkCard, { sharedLink: bookLink() });

    expect(screen.getByText('Museum visits')).toBeInTheDocument();
    expect(screen.getByText('book_share_pdf_download')).toBeInTheDocument();
    expect(screen.getByText('book_share_photo_details')).toBeInTheDocument();
    expect(screen.queryByText('download')).not.toBeInTheDocument();
    expect(screen.queryByText('exif')).not.toBeInTheDocument();
  });

  it('should leave out what a link to a book does not allow', () => {
    renderWithTooltips(SharedLinkCard, { sharedLink: bookLink({ allowDownload: false, showMetadata: false }) });

    expect(screen.queryByText('book_share_pdf_download')).not.toBeInTheDocument();
    expect(screen.queryByText('book_share_photo_details')).not.toBeInTheDocument();
  });

  it('should show the first page of the book as its cover', () => {
    const book = bookFactory.build({ id: 'book-id', title: 'Museum visits', firstPageId: 'page-1' });
    renderWithTooltips(SharedLinkCard, { sharedLink: bookLink(), book });

    expect(screen.getByTestId('book-cover').querySelector('img')?.getAttribute('src')).toContain(
      '/books/book-id/pages/page-1/render',
    );
  });

  it('should list what a link to an album allows as before', () => {
    renderWithTooltips(SharedLinkCard, {
      sharedLink: sharedLinkFactory.build({
        type: SharedLinkType.Album,
        allowUpload: false,
        allowDownload: true,
        showMetadata: true,
        password: null,
      }),
    });

    expect(screen.getByText('download')).toBeInTheDocument();
    expect(screen.getByText('exif')).toBeInTheDocument();
    expect(screen.queryByText('book_share_pdf_download')).not.toBeInTheDocument();
  });
});
