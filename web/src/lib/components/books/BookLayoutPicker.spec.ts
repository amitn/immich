import { Kind2 } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import BookLayoutPicker from '$lib/components/books/BookLayoutPicker.svelte';
import { bookLayoutFactory, bookLayouts } from '@test-data/factories/book-page-factory';

describe('BookLayoutPicker component', () => {
  const layouts = [
    bookLayouts.single,
    bookLayouts.twoHorizontal,
    bookLayouts.fourGrid,
    bookLayouts.map,
    bookLayoutFactory('map-photo', [{ x: 0, y: 0.66, width: 0.5, height: 0.34 }], {
      mapArea: { x: 0, y: 0, width: 1, height: 0.66 },
    }),
  ];
  const size = { pageWidthMm: 210, pageHeightMm: 210 };
  const style = { marginMm: 12, gutterMm: 4 };
  const onSelect = vi.fn();

  const names = () => screen.getAllByRole('button').map((button) => button.querySelector('.font-medium')?.textContent);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should only offer the layouts with room for the photos of the page', () => {
    render(BookLayoutPicker, { layouts, size, style, photoCount: 2, onSelect });

    expect(names()).toEqual(['two-horizontal', 'four-grid']);
  });

  it('should show the layouts with fewer slots on request, with how many photos they remove', async () => {
    render(BookLayoutPicker, { layouts, size, style, photoCount: 2, onSelect });

    await fireEvent.click(screen.getByRole('switch'));

    expect(names()).toEqual(['two-horizontal', 'four-grid', 'single']);
    expect(screen.getByText('book_layout_removes_photos')).toBeInTheDocument();
  });

  it('should offer map layouts only to map pages', () => {
    const { unmount } = render(BookLayoutPicker, { layouts, size, style, photoCount: 0, onSelect });
    expect(names()).toEqual(['single', 'two-horizontal', 'four-grid']);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    unmount();

    render(BookLayoutPicker, { layouts, size, style, photoCount: 0, isMap: true, onSelect });
    expect(names()).toEqual(['single', 'two-horizontal', 'four-grid', 'map', 'map-photo']);
  });

  it('should mark the current layout and select a layout', async () => {
    render(BookLayoutPicker, { layouts, size, style, photoCount: 1, current: 'single', onSelect });

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');

    await fireEvent.click(buttons[2]);
    expect(onSelect).toHaveBeenCalledWith(bookLayouts.fourGrid);
  });

  it('should draw a schematic of each layout', () => {
    render(BookLayoutPicker, { layouts, size, style, photoCount: 0, onSelect });

    const [single, two, four] = screen
      .getAllByRole('button')
      .map((button) => button.querySelectorAll(':scope svg rect'));
    expect(single).toHaveLength(1);
    expect(two).toHaveLength(2);
    expect(four).toHaveLength(4);
  });

  it('should draw the name of a dish below its photo like a caption', () => {
    const dish = bookLayoutFactory('dish', [{ x: 0, y: 0, width: 1, height: 0.8 }], {
      food: true,
      textAreas: [{ kind: Kind2.SlotCaption, slot: 0, x: 0, y: 0.8, width: 1, height: 0.2 }],
    });
    const { container } = render(BookLayoutPicker, { layouts: [dish], size, style, photoCount: 1, onSelect });

    expect(names()).toEqual(['dish']);
    expect(container.querySelector(':scope svg .fill-gray-400')).toBeInTheDocument();
    expect(container.querySelector(':scope svg .fill-gray-300')).toBeInTheDocument();
    expect(container.querySelector(':scope svg .fill-gray-500')).not.toBeInTheDocument();
  });
});
