import { BookExportFormat, BookExportStatus } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { bookDetailFactory } from '@test-data/factories/book-factory';
import BookExportProgressModal from './BookExportProgressModal.svelte';

describe('BookExportProgressModal component', () => {
  const onClose = vi.fn();
  const book = bookDetailFactory.build({ exportStatus: BookExportStatus.Completed });

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    Element.prototype.animate = getAnimateMock();
  });

  it('should list the notes from laying out the book', () => {
    const warning = 'Watercolor maps need a Stadia Maps API key; using the offline sketch style';
    render(BookExportProgressModal, { props: { book, formats: [BookExportFormat.Pdf], warnings: [warning], onClose } });

    expect(screen.getByText('book_layout_warnings')).toBeInTheDocument();
    expect(screen.getByTestId('book-layout-warnings')).toHaveTextContent(warning);
  });

  it('should not show notes without any', () => {
    render(BookExportProgressModal, { props: { book, formats: [BookExportFormat.Pdf], onClose } });
    expect(screen.queryByTestId('book-layout-warnings')).not.toBeInTheDocument();
  });
});
