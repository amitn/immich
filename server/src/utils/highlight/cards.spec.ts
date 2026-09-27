import sharp from 'sharp';
import { bookStylePresets } from 'src/dtos/book.dto.js';
import { getCardSvg, getLowerThirdSvg, renderCard, renderOverlay } from 'src/utils/highlight/cards.js';

const classic = bookStylePresets.classic.style;
const food = bookStylePresets.food.style;
const museum = bookStylePresets.museum.style;

const pixel = async (image: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + info.channels)];
};

describe('getCardSvg', () => {
  it('should draw the title, dates and places in the fonts and colors of the style', () => {
    const svg = getCardSvg(
      { title: 'Sicily & friends', subtitle: '12–14 June 2024', detail: 'Taormina & Catania' },
      classic,
      'title',
    );
    expect(svg).toContain('width="1920" height="1080"');
    expect(svg).toContain(`fill="${classic.background}"`);
    expect(svg).toContain('Sicily &amp; friends');
    expect(svg).toContain('12–14 June 2024');
    expect(svg).toContain('Taormina &amp; Catania');
    expect(svg).toContain('Liberation Serif');
  });

  it('should set a food card like a printed menu: small caps, a frame and an ornament', () => {
    const svg = getCardSvg({ title: 'Trattoria da Nino', subtitle: 'Taormina, 23 June 2009' }, food, 'chapter');
    expect(svg).toContain('font-variant="small-caps"');
    expect(svg).toContain(`fill="${food.background}"`);
    expect(svg).toContain(food.accentColor);
    // the diamond of the ornament and the hairline frame
    expect(svg).toMatch(/<path d="M[\d.]+ [\d.]+L/);
    expect(svg).toContain('<rect x=');
  });

  it('should set a gallery card left-aligned in a sans-serif', () => {
    const svg = getCardSvg({ title: 'Musée d’Orsay', subtitle: '3 May 2025' }, museum, 'chapter');
    expect(svg).toContain('text-anchor="start"');
    expect(svg).not.toContain('small-caps');
    expect(svg).toContain('Liberation Sans');
  });

  it('should render a full-frame JPEG with the paper color', async () => {
    const image = await renderCard(getCardSvg({ title: 'Sicily' }, food, 'title'));
    const { width, height, format } = await sharp(image).metadata();
    expect({ width, height, format }).toEqual({ width: 1920, height: 1080, format: 'jpeg' });
    const [r, g, b] = await pixel(image, 20, 20);
    // #f6f0e4
    expect(Math.abs(r - 0xf6) + Math.abs(g - 0xf0) + Math.abs(b - 0xe4)).toBeLessThan(12);
  });
});

describe('getLowerThirdSvg', () => {
  it('should name a dish on a label in the colors of the style', () => {
    const svg = getLowerThirdSvg('Pasta alla Norma', food);
    expect(svg).toContain('Pasta alla Norma');
    expect(svg).toContain(`fill="${food.background}"`);
    expect(svg).toContain('font-variant="small-caps"');
  });

  it('should set an artwork label with the title in italics and the details below', () => {
    const svg = getLowerThirdSvg('The Starry Night\nVincent van Gogh, 1889, oil on canvas', museum);
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('The Starry Night');
    expect(svg).toContain('Vincent van Gogh, 1889, oil on canvas');
  });

  it('should be empty without a caption', () => {
    expect(getLowerThirdSvg('  ', classic)).not.toContain('<text');
  });

  it('should render a transparent frame with the label at the bottom left', async () => {
    const image = await renderOverlay(getLowerThirdSvg('Caponata', classic));
    const { width, height, hasAlpha } = await sharp(image).metadata();
    expect({ width, height, hasAlpha }).toEqual({ width: 1920, height: 1080, hasAlpha: true });
    const clear = await pixel(image, 960, 100);
    const label = await pixel(image, 110, 1080 - 110);
    expect(clear.at(3)).toBe(0);
    expect(label.at(3)).toBeGreaterThan(200);
  });
});
