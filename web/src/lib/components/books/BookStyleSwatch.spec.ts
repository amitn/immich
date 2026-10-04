import { BookStyleTheme } from '@immich/sdk';
import { render } from '@testing-library/svelte';
import { bookUserStyleFactory } from '@test-data/factories/book-factory';
import BookStyleSwatch from './BookStyleSwatch.svelte';

describe('BookStyleSwatch component', () => {
  const { style } = bookUserStyleFactory.build();

  const swatch = (theme?: BookStyleTheme) => {
    const { container } = render(BookStyleSwatch, { props: { style: { ...style, theme } } });
    return container.querySelector<HTMLElement>('span[aria-hidden="true"]')!;
  };

  it('should draw the page in the colours and font of a style of your own', () => {
    const page = swatch(BookStyleTheme.Plain);
    expect(page.dataset.look).toBe('plain');
    expect(page.style.backgroundColor).toBe('#f7f3e8');
    expect(page.textContent).toContain('Aa');
    const text = [...page.querySelectorAll<HTMLElement>('span')].find(
      (element) => element.textContent?.trim() === 'Aa',
    );
    expect(text?.style.fontFamily).toContain('FreeSerif');
    expect(text?.style.color).toBe('#34402f');
  });

  it.each([BookStyleTheme.Food, BookStyleTheme.Wine, BookStyleTheme.Cookbook, BookStyleTheme.Travel])(
    'should draw the %s theme as a printed page with a frame in the accent colour',
    (theme) => {
      const page = swatch(theme);
      expect(page.dataset.look).toBe('printed');
      const frame = page.querySelector<HTMLElement>('span.absolute');
      expect(frame?.style.borderColor).toBe('#a8862f');
    },
  );

  it('should draw the gallery theme with one photo shown whole and a label', () => {
    const page = swatch(BookStyleTheme.Gallery);
    expect(page.dataset.look).toBe('gallery');
    expect(page.querySelector('span.absolute')).toBeNull();
    expect(page.querySelector('.italic')).toHaveTextContent('Aa');
  });

  it('should draw the kids art theme as an artwork taped to the page', () => {
    const page = swatch(BookStyleTheme.KidsArt);
    expect(page.dataset.look).toBe('mounted');
    expect(page.querySelector('[data-tape]')).not.toBeNull();
    expect(page.querySelector('span.absolute.border')).toBeNull();
  });

  it('should show a neutral page while the style loads', () => {
    const { container } = render(BookStyleSwatch, { props: {} });
    const page = container.querySelector<HTMLElement>('span[aria-hidden="true"]')!;
    expect(page).toHaveClass('animate-pulse');
    expect(page.dataset.look).toBeUndefined();
  });
});
