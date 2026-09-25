import { BookExportStatus } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { bookFactory } from '@test-data/factories/book-factory';
import BookCard from './BookCard.svelte';

describe('BookCard component', () => {
  it('should show the page count and the cover', () => {
    const book = bookFactory.build({ title: 'Italy', pageCount: 12, firstPageId: 'page-1' });

    render(BookCard, { props: { book } });

    expect(screen.getByRole('link')).toHaveAttribute('href', `/books/${book.id}`);
    expect(screen.getByText('book_page_count')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      expect.stringContaining(`/books/${book.id}/pages/page-1/render`),
    );
  });

  it('should show completed exports as ready', () => {
    const book = bookFactory.build({
      exportStatus: BookExportStatus.Completed,
      htmlExportStatus: BookExportStatus.Completed,
      exportedAt: '2026-01-01T10:00:00.000Z',
      htmlExportedAt: '2026-01-01T10:00:00.000Z',
    });

    render(BookCard, { props: { book } });

    expect(screen.getByTitle('book_pdf_ready')).toBeInTheDocument();
    expect(screen.getByTitle('book_html_ready')).toBeInTheDocument();
    expect(screen.queryByText('book_format_outdated')).not.toBeInTheDocument();
  });

  it('should mark an export as outdated when the book changed since', () => {
    const book = bookFactory.build({
      exportStatus: BookExportStatus.Completed,
      htmlExportStatus: BookExportStatus.Completed,
      exportedAt: '2026-01-01T10:00:00.000Z',
      htmlExportedAt: '2026-01-02T10:00:00.000Z',
      exportStale: true,
    });

    render(BookCard, { props: { book } });

    expect(screen.getByTitle('book_export_outdated_hint')).toHaveTextContent('book_format_outdated');
    expect(screen.queryByTitle('book_pdf_ready')).not.toBeInTheDocument();
    expect(screen.getByTitle('book_html_ready')).toBeInTheDocument();
  });

  it('should not mark a running export as outdated', () => {
    const book = bookFactory.build({
      exportStatus: BookExportStatus.Running,
      exportedAt: '2026-01-01T10:00:00.000Z',
      exportStale: true,
    });

    render(BookCard, { props: { book } });

    expect(screen.queryByTitle('book_export_outdated_hint')).not.toBeInTheDocument();
    expect(screen.getByText('book_exporting_short')).toBeInTheDocument();
  });
});
