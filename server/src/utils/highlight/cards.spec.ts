import sharp from 'sharp';
import { bookStylePresets } from 'src/dtos/book.dto.js';
import { getCardSvg, getLowerThirdSvg, renderCard, renderOverlay } from 'src/utils/highlight/cards.js';

const classic = bookStylePresets.classic.style;
const food = bookStylePresets.food.style;
const museum = bookStylePresets.museum.style;

const VERTICAL = { width: 1080, height: 1920 };
const SAFE_TOP = 0.14 * 1920;
const SAFE_BOTTOM = 0.8 * 1920;

/** the baselines and font sizes of the text of an SVG */
const textsOf = (svg: string) =>
  svg
    .matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="([\d.]+)"/g)
    .map(([, x, y, size]) => ({ x: Number(x), y: Number(y), size: Number(size) }))
    .toArray();

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

describe('getCardSvg in a vertical frame', () => {
  const text = {
    title: 'A long weekend in the Aeolian islands',
    subtitle: '12–14 June 2024',
    detail: 'Lipari, Salina & Stromboli',
  };

  it.each([
    ['classic', classic],
    ['food', food],
    ['museum', museum],
  ])('should keep the text of a %s card in the safe band, larger', (_, style) => {
    for (const kind of ['title', 'chapter'] as const) {
      const svg = getCardSvg(text, style, kind, VERTICAL);
      expect(svg).toContain('width="1080" height="1920"');
      const texts = textsOf(svg);
      expect(texts.length).toBeGreaterThanOrEqual(3);
      for (const line of texts) {
        // the top of the letters and the baseline, inside the band
        expect(line.y - line.size).toBeGreaterThanOrEqual(SAFE_TOP);
        expect(line.y).toBeLessThanOrEqual(SAFE_BOTTOM);
      }
      const landscape = textsOf(getCardSvg(text, style, kind));
      expect(Math.min(...texts.map((line) => line.size))).toBeGreaterThan(
        Math.min(...landscape.map((line) => line.size)),
      );
    }
  });

  it('should render a portrait JPEG', async () => {
    const image = await renderCard(getCardSvg({ title: 'Sicily' }, classic, 'title', VERTICAL));
    const { width, height } = await sharp(image).metadata();
    expect({ width, height }).toEqual(VERTICAL);
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

  it('should set a vertical label larger, above the bottom of the safe band', async () => {
    const caption = 'Pasta alla Norma\nAubergine, ricotta salata, basil';
    const svg = getLowerThirdSvg(caption, food, VERTICAL);
    const [, y, height] = /<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/.exec(svg)!.map(Number);
    expect(y).toBeGreaterThan(SAFE_TOP);
    expect(y + height).toBeLessThanOrEqual(SAFE_BOTTOM);
    expect(y + height).toBeGreaterThan(SAFE_BOTTOM - 100);
    const texts = textsOf(svg);
    const landscape = textsOf(getLowerThirdSvg(caption, food));
    expect(texts[0].size).toBeGreaterThan(landscape[0].size);
    for (const line of texts) {
      expect(line.y).toBeLessThanOrEqual(SAFE_BOTTOM);
    }

    const image = await renderOverlay(svg);
    const { width, height: imageHeight } = await sharp(image).metadata();
    expect({ width, height: imageHeight }).toEqual(VERTICAL);
    // clear below the band, where the apps draw their buttons
    const below = await pixel(image, 100, 1920 - 200);
    const label = await pixel(image, 80, Math.round(y + height / 2));
    expect(below.at(3)).toBe(0);
    expect(label.at(3)).toBeGreaterThan(200);
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
