import sharp from 'sharp';
import { bookStylePresets, defaultBookStyle } from 'src/dtos/book.dto.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { getFontStack } from 'src/utils/book/fonts.js';
import { buildBookHtml } from 'src/utils/book/html.js';
import {
  RenderBookInput,
  RenderPageInput,
  RenderSource,
  balanceLines,
  escapeXml,
  fitText,
  getContrast,
  getReadableColor,
  planPage,
  ptToPx,
  wrapText,
} from 'src/utils/book/render.js';
import { automock } from 'test/utils.js';

const style = bookStylePresets.food.style;

const book: RenderBookInput = {
  title: 'Sicily, plate by plate',
  subtitle: 'Summer 2009',
  pageWidthMm: 210,
  pageHeightMm: 210,
  style,
  coverAssetId: null,
};

const plainBook: RenderBookInput = { ...book, style: { ...defaultBookStyle } };

const page = (dto: Partial<RenderPageInput> = {}): RenderPageInput => ({
  layout: 'single',
  sectionTitle: null,
  caption: null,
  background: null,
  assets: [],
  ...dto,
});

const source = (dto: Partial<RenderSource> = {}): RenderSource => ({
  input: '/path/to/preview.jpeg',
  width: 3000,
  height: 2000,
  ...dto,
});

const sources = new Map([
  ['dish', source()],
  ['menu', source({ width: 2000, height: 2700 })],
]);

const dish = (caption: string | null, slot = 0, assetId = 'dish') => ({ slot, assetId, crop: null, caption });

const plan = (dto: Partial<RenderPageInput>, input = book) =>
  planPage(input, page(dto), { dpi: 100, mode: 'print', sources });

const solid = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer();

const pixel = async (image: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
};

const isClose = (actual: number[], expected: number[]) =>
  actual.every((value, i) => Math.abs(value - expected[i]) <= 24);

describe('the food style', () => {
  it('should use fonts that are installed on the server, in the pages, the PDF and the HTML export', () => {
    const stack = getFontStack(style.fontFamily);
    expect(stack).toMatch(/^FreeSerif, 'Liberation Serif', 'Times New Roman', /);
    expect(stack.endsWith(', serif')).toBe(true);
    expect(stack.split(', ').filter((name) => name === 'FreeSerif')).toHaveLength(1);
    expect(style.theme).toBe('food');
  });

  it('should frame the page like a printed menu, but not a full-bleed page or a plain book', () => {
    expect(plan({}).decorations.filter((decoration) => decoration.kind === 'frame')).toHaveLength(2);
    expect(plan({ layout: 'full-bleed' }).decorations).toEqual([]);
    expect(plan({}, plainBook).decorations).toEqual([]);
  });

  it('should set the restaurant in small caps over an ornament, and the place and date in italics', () => {
    const result = plan({
      layout: 'menu',
      sectionTitle: 'Trattoria da Nino · Taormina, 23 June 2009',
      caption: 'Caponata\nCannoli',
      assets: [dish(null, 0, 'menu')],
    });

    const [name, detail, caption] = result.text;
    expect(name).toMatchObject({ kind: 'sectionTitle', text: 'Trattoria da Nino', smallCaps: true, balance: true });
    expect(name.letterSpacing).toBeGreaterThan(0);
    expect(detail).toMatchObject({ kind: 'subtitle', text: 'Taormina, 23 June 2009', italic: true });
    expect(detail.color).toBe(style.accentColor);
    expect(detail.rect.top).toBeGreaterThan(name.rect.top);
    expect(caption).toMatchObject({ kind: 'caption', text: 'Caponata\nCannoli', italic: true, valign: 'top' });
    expect(result.decorations.filter((decoration) => decoration.kind === 'diamond')).toHaveLength(1);
    expect(result.spec.overlay).toContain('font-variant="small-caps"');
    expect(result.spec.overlay).toContain(`font-family="${escapeXml(getFontStack('FreeSerif, serif'))}"`);
  });

  it('should keep a title without a place and date whole', () => {
    const result = plan({ layout: 'section-opener', sectionTitle: 'Osteria Etna', assets: [dish(null)] });
    expect(result.text.map(({ text }) => text)).toEqual(['Osteria Etna']);
  });

  it('should set the name of a dish below its photo, over a short rule', () => {
    const result = plan({ layout: 'dish', assets: [dish('Spaghetti alle vongole')] });

    const caption = result.text.find((block) => block.kind === 'slotCaption')!;
    const photo = result.slots[0].rect;
    expect(caption).toMatchObject({ text: 'Spaghetti alle vongole', italic: true, valign: 'top' });
    expect(caption.band).toBeUndefined();
    expect(caption.rect.top).toBeGreaterThanOrEqual(photo.top + photo.height);
    expect(caption.fontPx).toBeGreaterThan(ptToPx(style.captionSizePt, 100));
    const rule = result.decorations.find((decoration) => decoration.kind === 'line');
    expect(rule?.kind === 'line' && rule.y1).toBeGreaterThan(photo.top + photo.height);
  });

  it('should set a caption beside its photo on the staggered layout', () => {
    const result = plan({ layout: 'dish-pair-stacked', assets: [dish('Caponata'), dish('Cannoli', 1)] });
    const first = result.text.find((block) => block.text === 'Caponata')!;
    const second = result.text.find((block) => block.text === 'Cannoli')!;
    expect(first).toMatchObject({ align: 'left', valign: 'middle' });
    expect(second).toMatchObject({ align: 'right', valign: 'middle' });
    expect(first.rect.left).toBeGreaterThanOrEqual(result.slots[0].rect.left + result.slots[0].rect.width);
  });

  it('should draw the captions of the dish layouts beside the photos in any style, and on the photos elsewhere', () => {
    const below = plan({ layout: 'dish', assets: [dish('Caponata')] }, plainBook).text[0];
    expect(below).toMatchObject({ kind: 'slotCaption', color: defaultBookStyle.textColor });
    expect(below.band).toBeUndefined();

    expect(plan({ layout: 'single', assets: [dish('Caponata')] }).text[0]).toMatchObject({
      band: true,
      bandColor: style.background,
      color: style.textColor,
    });
    expect(plan({ layout: 'single', assets: [dish('Caponata')] }, plainBook).text[0]).toMatchObject({
      band: true,
      color: '#ffffff',
    });
  });

  it('should skip the caption area of an empty slot', () => {
    expect(plan({ layout: 'dish', assets: [] }).text).toEqual([]);
  });

  it('should keep the text readable on a dark page', () => {
    const result = plan({ layout: 'dish', background: '#26221f', assets: [dish('Caponata')] });
    expect(getContrast(result.text[0].color, '#26221f')).toBeGreaterThanOrEqual(3);
    expect(getReadableColor('#2a2420', '#f6f0e4')).toBe('#2a2420');
    expect(getReadableColor('#2a2420', '#1a1a1a')).toBe('#f1e9dc');
  });

  it('should draw the ornaments into the overlay', () => {
    const svg = plan({ layout: 'section-opener', sectionTitle: 'Osteria Etna', assets: [dish(null)] }).spec.overlay!;
    expect(svg).toMatch(/<rect [^>]*fill="none" stroke="#8c3b2a"/);
    expect(svg).toMatch(/<path d="M[^"]+Z" fill="#8c3b2a"\/>/);
    expect(svg).toContain('letter-spacing=');
  });

  it('should render a page of dishes on paper', async () => {
    const media = new MediaRepository(
      automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }] as never, strict: false }),
    );
    const red = await solid(300, 200, '#b8412b');
    const result = planPage(
      book,
      page({
        layout: 'dish-pair',
        assets: [dish('Caponata', 0, 'a'), dish('Four Story Hill Farm Milk-Poached Poularde', 1, 'b')],
      }),
      {
        dpi: 60,
        mode: 'review',
        sources: new Map([
          ['a', source({ input: red, width: 300, height: 200 })],
          ['b', source({ input: red, width: 300, height: 200 })],
        ]),
      },
    );

    const { data } = await media.composeBookPage(result.spec);
    expect(isClose(await pixel(data, 3, 3), [0xf6, 0xf0, 0xe4])).toBe(true);
    const photo = result.slots[0].rect;
    expect(isClose(await pixel(data, photo.left + 10, photo.top + 10), [0xb8, 0x41, 0x2b])).toBe(true);
  });

  it('should export the small caps, the balanced lines and the ornaments to HTML', () => {
    const html = buildBookHtml(
      book,
      [page({ layout: 'dish-opener', sectionTitle: 'Osteria Etna · Catania', assets: [dish('Arancini')] })],
      {
        images: new Map([
          [
            'dish',
            {
              data: Buffer.from('jpeg'),
              region: { x: 0, y: 0, width: 1, height: 1 },
              width: 3000,
              height: 2000,
              alt: 'dish',
            },
          ],
        ]),
      },
    );
    expect(html).toContain('font-variant:small-caps');
    expect(html).toContain('letter-spacing:0.12em');
    expect(html).toContain('text-wrap:balance');
    expect(html).toMatch(/<svg class="deco" viewBox="0 0 \d+ \d+" preserveAspectRatio="none" aria-hidden="true">/);
    expect(html).toContain('<div class="text top"');
    expect(html).toContain('>Arancini</p>');
  });
});

describe('balanceLines', () => {
  it('should wrap into lines of about the same length', () => {
    const text = 'Four Story Hill Farm Milk-Poached Poularde';
    const lines = wrapText(text, 180, 10);
    expect(lines).toHaveLength(2);
    const balanced = balanceLines(text, lines, 180, 10);
    expect(balanced).toHaveLength(2);
    expect(Math.abs(balanced[0].length - balanced[1].length)).toBeLessThan(Math.abs(lines[0].length - lines[1].length));
    expect(balanceLines('One line', ['One line'], 350, 10)).toEqual(['One line']);
  });

  it('should shrink a title before breaking a word', () => {
    const { lines } = fitText('Trattoria da Nino', { width: 60, height: 100 }, 12);
    expect(lines.flatMap((line) => line.split(' '))).toEqual(['Trattoria', 'da', 'Nino']);
  });
});
