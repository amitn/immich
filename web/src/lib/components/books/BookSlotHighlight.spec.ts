import { Orientation, type BookPageResponseDto } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { resetBookLayouts } from '$lib/utils/book-review';
import { bookDetailFactory } from '@test-data/factories/book-factory';
import BookSlotHighlight from './BookSlotHighlight.svelte';

describe('BookSlotHighlight component', () => {
  const book = bookDetailFactory.build({
    pageWidthMm: 200,
    pageHeightMm: 100,
    style: { marginMm: 10, gutterMm: 4, background: '#ffffff', textColor: '#000000', fontFamily: 'serif' },
  });
  const page: BookPageResponseDto = {
    id: 'page-1',
    position: 0,
    layout: 'two',
    slots: [],
    background: null,
    caption: null,
    sectionTitle: null,
    map: null,
    updatedAt: '2026-09-25T10:00:00.000Z',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    resetBookLayouts();
    sdkMock.getBookLayouts.mockResolvedValue([
      {
        id: 'two',
        name: 'Two',
        description: 'Two photos',
        fullBleed: false,
        orientation: Orientation.Any,
        slots: [
          { x: 0, y: 0, width: 0.5, height: 1 },
          { x: 0.5, y: 0, width: 0.5, height: 1 },
        ],
        textAreas: [],
      },
    ]);
  });

  it('should outline the slot', async () => {
    render(BookSlotHighlight, { props: { book, page, slot: 1 } });

    const highlight = await screen.findByTestId('book-slot-highlight');
    expect(highlight.style.left).toBe('51%');
    expect(highlight.style.width).toBe('44%');
    expect(highlight).toHaveTextContent('book_review_slot_highlighted');
  });

  it('should show nothing without a slot', () => {
    render(BookSlotHighlight, { props: { book, page } });

    expect(screen.queryByTestId('book-slot-highlight')).not.toBeInTheDocument();
    expect(sdkMock.getBookLayouts).not.toHaveBeenCalled();
  });
});
