import sharp from 'sharp';
import { NormalizedRect, defaultBookStyle } from 'src/dtos/book.dto.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import {
  HTML_CSP,
  HtmlImage,
  buildBookHtml,
  escapeHtml,
  formatDateRange,
  getEffectiveCrop,
  getHtmlFileName,
  getRegionSize,
  getSlotImageStyle,
  getSpreads,
  planHtmlImages,
} from 'src/utils/book/html.js';
import { PRINT_DPI, RenderBookInput, RenderPageInput, RenderPlacement, planPage } from 'src/utils/book/render.js';
import { automock } from 'test/utils.js';

const book: RenderBookInput = {
  title: 'Summer in Rome',
  subtitle: 'Italy 2025',
  pageWidthMm: 210,
  pageHeightMm: 297,
  style: { ...defaultBookStyle, marginMm: 10, gutterMm: 4 },
  coverAssetId: null,
};

const page = (dto: Partial<RenderPageInput> = {}): RenderPageInput => ({
  layout: 'single',
  sectionTitle: null,
  caption: null,
  background: null,
  assets: [],
  ...dto,
});

const placement = (slot: number, assetId: string, dto: Partial<RenderPlacement> = {}): RenderPlacement => ({
  slot,
  assetId,
  crop: null,
  caption: null,
  ...dto,
});

const image = (dto: Partial<HtmlImage> = {}): HtmlImage => ({
  data: Buffer.from('jpeg'),
  region: { x: 0, y: 0, width: 1, height: 1 },
  width: 3000,
  height: 2000,
  alt: 'IMG_0001.jpg',
  ...dto,
});

const slotStyles = (html: string) =>
  html
    .matchAll(/class="slot" style="left:([\d.-]+)%;top:([\d.-]+)%;width:([\d.-]+)%;height:([\d.-]+)%"/g)
    .map((match) => match.slice(1, 5).map(Number))
    .toArray();

const imageStyles = (html: string) =>
  html
    .matchAll(/style="width:([\d.-]+)%;height:([\d.-]+)%;transform:translate\(([\d.-]+)%,([\d.-]+)%\)"/g)
    .map((match) => match.slice(1, 5).map(Number))
    .toArray();

describe('escapeHtml', () => {
  it('should escape markup and quotes', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('getHtmlFileName', () => {
  it('should slugify the title', () => {
    expect(getHtmlFileName('Summer in Rome!')).toBe('summer-in-rome.html');
    expect(getHtmlFileName('Été à Zürich / 2025')).toBe('ete-a-zurich-2025.html');
    expect(getHtmlFileName('"><script>')).toBe('script.html');
  });

  it('should fall back to a generic name', () => {
    expect(getHtmlFileName('東京')).toBe('photo-book.html');
  });
});

describe('getSpreads', () => {
  it('should keep the cover alone and pair the other pages', () => {
    expect(getSpreads(0)).toEqual([]);
    expect(getSpreads(1)).toEqual([[1]]);
    expect(getSpreads(4)).toEqual([[1], [2, 3], [4]]);
    expect(getSpreads(5)).toEqual([[1], [2, 3], [4, 5]]);
  });
});

describe('formatDateRange', () => {
  it('should format a single day and a range', () => {
    const day = new Date('2025-06-01T10:00:00.000Z');
    expect(formatDateRange({ start: day, end: day })).toBe('June 1, 2025');
    expect(formatDateRange({ start: day, end: new Date('2025-06-14T10:00:00.000Z') })).toMatch(/^June 1\s–\s14, 2025$/);
  });
});

describe('getEffectiveCrop', () => {
  it('should trim a landscape crop around its centre to fit a square slot', () => {
    const crop = getEffectiveCrop({ x: 0, y: 0, width: 1, height: 1 }, { width: 3000, height: 2000 }, 1);
    expect(crop.x).toBeCloseTo(1 / 6, 6);
    expect(crop.width).toBeCloseTo(2 / 3, 6);
    expect(crop).toEqual(expect.objectContaining({ y: 0, height: 1 }));
  });

  it('should trim a portrait crop vertically for a landscape slot', () => {
    const crop = getEffectiveCrop({ x: 0.2, y: 0.1, width: 0.4, height: 0.8 }, { width: 2000, height: 2000 }, 2);
    expect(crop.x).toBeCloseTo(0.2, 6);
    expect(crop.width).toBeCloseTo(0.4, 6);
    expect(crop.height).toBeCloseTo(0.2, 6);
    expect(crop.y).toBeCloseTo(0.4, 6);
  });

  it('should keep a crop that already matches the slot', () => {
    const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.5 };
    expect(getEffectiveCrop(crop, { width: 4000, height: 3000 }, 4 / 3)).toEqual(crop);
  });
});

describe('getSlotImageStyle', () => {
  it('should scale and move a full image so its centre fills a square slot', () => {
    const style = getSlotImageStyle(
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 1, height: 1 },
      { width: 3000, height: 2000 },
      1,
    );
    expect(style.width).toBeCloseTo(150, 6);
    expect(style.height).toBeCloseTo(100, 6);
    expect(style.x).toBeCloseTo(-100 / 6, 6);
    expect(style.y).toBeCloseTo(0, 6);
  });

  it('should show the whole image when the embedded region is the visible crop', () => {
    const crop = { x: 0.25, y: 0.1, width: 0.5, height: 0.75 };
    const style = getSlotImageStyle(crop, crop, { width: 3000, height: 2000 }, 1);
    expect(style).toEqual({ width: 100, height: 100, x: -0, y: -0 });
  });

  it.each([
    { crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, region: { x: 0, y: 0, width: 0.8, height: 0.9 }, aspect: 1 },
    { crop: { x: 0.5, y: 0, width: 0.5, height: 1 }, region: { x: 0.4, y: 0, width: 0.6, height: 1 }, aspect: 0.7 },
    { crop: { x: 0, y: 0.3, width: 1, height: 0.2 }, region: { x: 0, y: 0.2, width: 1, height: 0.5 }, aspect: 3 },
  ])('should map the slot back onto the visible crop ($aspect)', ({ crop, region, aspect }) => {
    const size = { width: 4000, height: 3000 };
    const visible = getEffectiveCrop(crop, size, aspect);
    const style = getSlotImageStyle(crop, region, size, aspect);

    // the slot's edges, as fractions of the embedded image
    const left = -style.x / 100;
    const top = -style.y / 100;
    const width = 100 / style.width;
    const height = 100 / style.height;

    expect(region.x + left * region.width).toBeCloseTo(visible.x, 6);
    expect(region.y + top * region.height).toBeCloseTo(visible.y, 6);
    expect(width * region.width).toBeCloseTo(visible.width, 6);
    expect(height * region.height).toBeCloseTo(visible.height, 6);
    // the image keeps its aspect ratio: CSS size ratio × slot aspect = embedded image aspect
    expect(
      ((style.width / style.height) * aspect) / ((region.width * size.width) / (region.height * size.height)),
    ).toBeCloseTo(1, 6);
  });
});

describe('planHtmlImages', () => {
  const sizes = new Map([
    ['a', { width: 6000, height: 4000 }],
    ['b', { width: 1000, height: 1000 }],
  ]);

  it('should embed the union of the visible crops of a photo used twice', () => {
    const requests = planHtmlImages(
      book,
      [
        page({ layout: 'single', assets: [placement(0, 'a', { crop: { x: 0, y: 0, width: 0.5, height: 1 } })] }),
        page({
          layout: 'four-grid',
          assets: [placement(0, 'a', { crop: { x: 0.6, y: 0.5, width: 0.2, height: 0.3 } })],
        }),
      ],
      sizes,
    );

    expect(requests.size).toBe(1);
    const { region, scale } = requests.get('a')!;
    expect(region.x).toBeCloseTo(0.0214, 3); // the first crop is trimmed to the slot's aspect ratio
    expect(region.y).toBeCloseTo(0, 4);
    expect(region.x + region.width).toBeCloseTo(0.7681, 3);
    expect(region.height).toBeCloseTo(1, 4);
    // the long edge of the embedded image is capped
    expect(Math.max(...Object.values(getRegionSize(region, sizes.get('a')!, scale)))).toBeLessThanOrEqual(2000);
  });

  it('should size images at twice their CSS size and never enlarge them', () => {
    const requests = planHtmlImages(
      { ...book, pageWidthMm: 200, pageHeightMm: 200, style: { ...book.style, marginMm: 0, gutterMm: 0 } },
      [page({ layout: 'four-grid', assets: [placement(0, 'a'), placement(1, 'b')] })],
      sizes,
    );

    // a quarter of the page: 500 CSS px wide, so 1000px
    const a = requests.get('a')!;
    expect(getRegionSize(a.region, sizes.get('a')!, a.scale)).toEqual({ width: 1000, height: 1000 });
    const b = requests.get('b')!;
    expect(b.scale).toBe(1);
    expect(getRegionSize(b.region, sizes.get('b')!, b.scale)).toEqual({ width: 1000, height: 1000 });
  });

  it('should skip empty slots, unknown sizes and map pages', () => {
    const requests = planHtmlImages(
      book,
      [
        page({ layout: 'single', assets: [placement(0, 'unknown')] }),
        page({ layout: 'map', assets: [placement(0, 'a')] }),
        page({ layout: 'two-vertical', assets: [placement(1, 'b')] }),
      ],
      sizes,
    );
    expect(requests.keys().toArray()).toEqual(['b']);
  });

  it('should include the cover photo', () => {
    const requests = planHtmlImages({ ...book, coverAssetId: 'b' }, [page({ layout: 'cover' })], sizes);
    expect(requests.keys().toArray()).toEqual(['b']);
  });
});

describe('buildBookHtml', () => {
  const images = new Map([
    ['a', image()],
    ['b', image({ width: 2000, height: 3000, alt: 'portrait.jpg' })],
  ]);

  it('should build one section per page and group spreads', () => {
    const pages = [page({ layout: 'cover' }), page(), page(), page()];
    const html = buildBookHtml(book, pages, { images });

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.match(/<section class="page"/g)).toHaveLength(4);
    expect(html.match(/<div class="spread">/g)).toHaveLength(3);
    expect(html).toMatch(/<div class="spread"><section class="page" id="page-1"[^>]*>.*?<\/section><\/div>/);
    expect(html).toMatch(/<div class="spread"><section class="page" id="page-2".*?<section class="page" id="page-3"/);
    expect(html).toContain('4 pages');
  });

  it('should include a strict content security policy', () => {
    const html = buildBookHtml(book, [page()], { images });
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${HTML_CSP}">`);
    expect(HTML_CSP).toContain("default-src 'none'");
    expect(HTML_CSP).toContain('img-src data:');
    expect(HTML_CSP).not.toMatch(/https?:/);
  });

  it('should not reference anything outside the file', () => {
    const html = buildBookHtml(book, [page({ layout: 'cover' }), page({ assets: [placement(0, 'a')] })], {
      images,
      dateRange: { start: new Date('2025-06-01'), end: new Date('2025-06-09') },
    });
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\s(src|href)="(?!data:)/);
    expect(html).not.toContain('<link');
    expect(html).toContain('Made with Immich');
  });

  it('should include the title, date range and print page size', () => {
    const html = buildBookHtml(book, [page()], {
      images,
      dateRange: { start: new Date('2025-06-01T12:00:00Z'), end: new Date('2025-06-09T12:00:00Z') },
    });
    expect(html).toContain('<title>Summer in Rome</title>');
    expect(html).toMatch(/Italy 2025 · June 1\s–\s9, 2025 · 1 page/);
    expect(html).toContain('@page{size:210mm 297mm;margin:0}');
  });

  it('should escape user text', () => {
    const xss = '<script>alert(1)</script>"><img src=x onerror=alert(2)>';
    const html = buildBookHtml(
      { ...book, title: xss, subtitle: xss, coverAssetId: 'a' },
      [
        page({ layout: 'cover' }),
        page({
          layout: 'section-opener',
          sectionTitle: xss,
          caption: xss,
          assets: [placement(0, 'a', { caption: xss })],
        }),
        page({ layout: 'text', caption: xss, background: 'red;background-image:url(x)' }),
      ],
      { images: new Map([['a', image({ alt: xss })]]) },
    );

    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).not.toContain('alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('url(x)');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x onerror=alert(2)&gt;');
    expect(html).toContain(`<title>&lt;script&gt;`);
  });

  it('should place the slots exactly where the PDF renderer does', () => {
    const size = { ...book, pageWidthMm: 297, pageHeightMm: 210 };
    for (const layout of ['cover', 'hero-left-two', 'four-grid', 'six-grid', 'full-bleed', 'section-opener']) {
      const input = page({ layout, assets: Array.from({ length: 6 }, (_, slot) => placement(slot, 'a')) });
      const plan = planPage(size, input, { dpi: PRINT_DPI, mode: 'print', sources: new Map() });
      const styles = slotStyles(buildBookHtml(size, [input], { images }));

      expect(styles).toHaveLength(plan.slots.length);
      for (const [index, [left, top, width, height]] of styles.entries()) {
        const { rect } = plan.slots[index];
        // within a pixel of the 300 dpi page
        expect(Math.abs((left / 100) * plan.spec.width - rect.left)).toBeLessThanOrEqual(1);
        expect(Math.abs((top / 100) * plan.spec.height - rect.top)).toBeLessThanOrEqual(1);
        expect(Math.abs((width / 100) * plan.spec.width - rect.width)).toBeLessThanOrEqual(1);
        expect(Math.abs((height / 100) * plan.spec.height - rect.height)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('should reproduce the stored crop with a transform', () => {
    const html = buildBookHtml(
      { ...book, pageWidthMm: 200, pageHeightMm: 200 },
      [page({ layout: 'full-bleed', assets: [placement(0, 'a')] })],
      {
        images,
      },
    );
    const [[width, height, x, y]] = imageStyles(html);
    expect(width).toBeCloseTo(150, 3);
    expect(height).toBe(100);
    expect(x).toBeCloseTo(-16.6667, 3);
    expect(y).toBe(0);
  });

  it('should embed a photo used twice only once', () => {
    const html = buildBookHtml(book, [page({ assets: [placement(0, 'a')] }), page({ assets: [placement(0, 'a')] })], {
      images,
    });
    expect(html.match(/data:image\/jpeg;base64,/g)).toHaveLength(1);
    expect(html).toContain('id="img-1" src="data:image/jpeg;base64,');
    expect(html).toContain('data-same="img-1"');
  });

  it('should use captions or file names as alt text', () => {
    const html = buildBookHtml(
      book,
      [page({ layout: 'two-vertical', assets: [placement(0, 'a', { caption: 'At the beach' }), placement(1, 'b')] })],
      { images },
    );
    expect(html).toContain('alt="At the beach"');
    expect(html).toContain('alt="portrait.jpg"');
    expect(html).toMatch(/<div class="text band bottom"[^>]*><p>At the beach<\/p><\/div>/);
  });

  it('should render text as HTML styled from the book', () => {
    const html = buildBookHtml(
      { ...book, style: { ...book.style, fontFamily: 'Georgia, serif', textColor: '#112233', background: '#fdf6e3' } },
      [
        page({ layout: 'cover' }),
        page({ layout: 'text', sectionTitle: 'Day one', caption: 'We arrived.\nIt rained.' }),
      ],
      { images },
    );
    expect(html).toContain('--font:Georgia, serif');
    expect(html).toContain('background:#fdf6e3');
    expect(html).toMatch(/<h2>Summer in Rome<\/h2>/);
    expect(html).toMatch(/<p>Italy 2025<\/p>/);
    expect(html).toMatch(/<h2>Day one<\/h2>/);
    expect(html).toContain('We arrived.\nIt rained.');
    expect(html).toMatch(/color:#112233/);
  });

  it('should skip empty slots and missing photos', () => {
    const html = buildBookHtml(
      book,
      [page({ layout: 'four-grid', assets: [placement(0, 'a'), placement(1, 'missing')] })],
      {
        images,
      },
    );
    expect(slotStyles(html)).toHaveLength(1);
  });

  it('should show pre-rendered pages as one image', () => {
    const html = buildBookHtml(book, [page({ layout: 'map', sectionTitle: 'Route <1>' })], {
      images,
      pageImages: new Map([[0, Buffer.from('map')]]),
    });
    expect(html).toContain(
      `class="page-image" id="img-1" src="data:image/jpeg;base64,${Buffer.from('map').toString('base64')}"`,
    );
    expect(html).toContain('alt="Route &lt;1&gt;"');
  });

  it('should label the navigation', () => {
    const html = buildBookHtml(book, [page(), page()], { images });
    expect(html).toContain('<main id="pages"');
    expect(html).toContain('<nav class="pager js-only" aria-label="Page navigation">');
    expect(html).toContain('aria-label="Previous pages"');
    expect(html).toContain('aria-label="Next pages"');
    expect(html).toContain('<footer>');
  });

  it('should include a script that parses', () => {
    const html = buildBookHtml(book, [page()], { images });
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
    expect(() => new Function(script)).not.toThrow();
  });

  describe('pressing Esc', () => {
    const STOP = new Error('stop at the pages');

    /** runs the script up to the point where it looks for the pages */
    const run = (framed: boolean) => {
      const html = buildBookHtml(book, [page()], { images });
      const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
      const listeners: Array<(event: Partial<KeyboardEvent>) => void> = [];
      const parent = { postMessage: vi.fn() };
      const window: Record<string, unknown> = {};
      window.parent = framed ? parent : window;
      const document = {
        addEventListener: (type: string, listener: (typeof listeners)[number]) => {
          if (type === 'keydown') {
            listeners.push(listener);
          }
        },
        get documentElement(): never {
          throw STOP;
        },
      };
      expect(() => new Function('window', 'document', script)(window, document)).toThrow(STOP);
      const press = (key: string) => {
        for (const listener of listeners) {
          listener({ key });
        }
      };
      return { press, postMessage: parent.postMessage };
    };

    it('should ask the Immich preview around the page to close', () => {
      const { press, postMessage } = run(true);
      press('Escape');
      expect(postMessage).toHaveBeenCalledWith({ type: 'immich-book-preview', action: 'close' }, '*');
    });

    it('should ignore other keys', () => {
      const { press, postMessage } = run(true);
      press('ArrowRight');
      press('Enter');
      expect(postMessage).not.toHaveBeenCalled();
    });

    it('should do nothing when the page is not framed', () => {
      const { press, postMessage } = run(false);
      expect(() => press('Escape')).not.toThrow();
      expect(postMessage).not.toHaveBeenCalled();
    });
  });
});

/** four coloured quadrants, so a misplaced crop shows up as a wrong colour */
const quadrants = (width: number, height: number) => {
  const half = { width: width / 2, height: height / 2 };
  const tile = (background: string) =>
    sharp({ create: { ...half, channels: 3, background } })
      .png()
      .toBuffer();
  return Promise.all(['#ff0000', '#00ff00', '#0000ff', '#ffff00'].map((color) => tile(color))).then((tiles) =>
    sharp({ create: { width, height, channels: 3, background: '#000000' } })
      .composite([
        { input: tiles[0], left: 0, top: 0 },
        { input: tiles[1], left: half.width, top: 0 },
        { input: tiles[2], left: 0, top: half.height },
        { input: tiles[3], left: half.width, top: half.height },
      ])
      .jpeg({ quality: 95 })
      .toBuffer(),
  );
};

const pixel = async (input: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true });
  const offset = (Math.floor(y) * info.width + Math.floor(x)) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
};

describe('buildBookHtml with real images', () => {
  const media = new MediaRepository(
    automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }] as never, strict: false }),
  );

  it('should embed JPEGs that show the same pixels as the PDF page', async () => {
    const source = await quadrants(1200, 800);
    const size = { width: 1200, height: 800 };
    const square: RenderBookInput = { ...book, pageWidthMm: 200, pageHeightMm: 200 };
    const crop: NormalizedRect = { x: 0.3, y: 0.25, width: 0.4, height: 0.5 };
    const pages = [
      page({ layout: 'cover', assets: [placement(0, 'a')] }),
      page({ layout: 'full-bleed', assets: [placement(0, 'a', { crop })] }),
    ];

    const images = new Map<string, HtmlImage>();
    for (const [assetId, request] of planHtmlImages(square, pages, new Map([['a', size]]))) {
      const { width, height } = getRegionSize(request.region, size, request.scale);
      const { data } = await media.composeBookPage({
        width,
        height,
        background: '#ffffff',
        quality: 82,
        overlay: null,
        slots: [{ left: 0, top: 0, width, height, input: source, crop: request.region }],
      });
      images.set(assetId, { data, region: request.region, ...size, alt: 'quadrants.jpg' });
    }

    const html = buildBookHtml(square, pages, { images });

    const uris = html
      .matchAll(/src="data:image\/jpeg;base64,([A-Za-z0-9+/=]+)"/g)
      .map((match) => match[1])
      .toArray();
    expect(uris).toHaveLength(1);
    const embedded = Buffer.from(uris[0], 'base64');
    const metadata = await sharp(embedded).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(html).toContain('data-same="img-1"');

    // the full-bleed page, as the PDF renderer draws it
    const plan = planPage(square, pages[1], {
      dpi: 50,
      mode: 'print',
      sources: new Map([['a', { input: source, ...size }]]),
    });
    const { data: pdfPage } = await media.composeBookPage(plan.spec);

    // the same page, as a browser would draw the embedded image with the page's CSS
    const [, [width, height, x, y]] = imageStyles(html);
    const slot = plan.slots[0].rect;
    const cssWidth = (slot.width * width) / 100;
    const cssHeight = (slot.height * height) / 100;
    const browser = await sharp(embedded)
      .resize(Math.round(cssWidth), Math.round(cssHeight), { fit: 'fill' })
      .extract({
        left: Math.round((-x / 100) * cssWidth),
        top: Math.round((-y / 100) * cssHeight),
        width: slot.width,
        height: slot.height,
      })
      .toBuffer();

    for (const [px, py] of [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.1, 0.9],
      [0.9, 0.9],
      [0.45, 0.45],
      [0.55, 0.55],
    ]) {
      const expected = await pixel(pdfPage, slot.left + px * slot.width, slot.top + py * slot.height);
      const actual = await pixel(browser, px * slot.width, py * slot.height);
      expect(actual.every((value, i) => Math.abs(value - expected[i]) <= 40)).toBe(true);
    }
  });
});
