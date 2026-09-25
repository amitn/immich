import sharp from 'sharp';
import { defaultBookStyle } from 'src/dtos/book.dto.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { getLayout, getSlotRectsMm, toPxRect } from 'src/utils/book/layouts.js';
import {
  RenderBookInput,
  RenderPageInput,
  RenderSource,
  escapeXml,
  fitText,
  getContactSheetLayout,
  getCropRegion,
  getDefaultCrop,
  getDpiForLongEdge,
  getEffectiveDpi,
  getPageWarnings,
  normalizeFaces,
  planContactSheet,
  planPage,
  wrapText,
} from 'src/utils/book/render.js';
import { automock } from 'test/utils.js';

const book: RenderBookInput = {
  title: 'Summer <2025> & friends',
  subtitle: 'Italy',
  pageWidthMm: 210,
  pageHeightMm: 210,
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

const source = (dto: Partial<RenderSource> = {}): RenderSource => ({
  input: '/path/to/preview.jpeg',
  width: 6000,
  height: 4000,
  ...dto,
});

const placement = (
  slot: number,
  assetId: string,
  crop = null as null | { x: number; y: number; width: number; height: number },
) => ({ slot, assetId, crop, caption: null });

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

describe('getDefaultCrop', () => {
  it('should centre a square crop in a landscape photo', () => {
    expect(getDefaultCrop({ width: 3000, height: 2000 }, [], 1)).toEqual({
      x: 0.1667,
      y: 0,
      width: 0.6667,
      height: 1,
    });
  });

  it('should centre a landscape crop in a portrait photo', () => {
    expect(getDefaultCrop({ width: 2000, height: 3000 }, [], 1.5)).toEqual({
      x: 0,
      y: 0.2778,
      width: 1,
      height: 0.4444,
    });
  });

  it('should use the full photo when the aspect ratios match', () => {
    expect(getDefaultCrop({ width: 3000, height: 2000 }, [], 1.5)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('should use the full photo when the dimensions are unknown', () => {
    expect(getDefaultCrop({ width: 0, height: 0 }, [], 1)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('should keep the faces centred', () => {
    const faces = [
      { x: 0.5, y: 0.3, width: 0.05, height: 0.1 },
      { x: 0.6, y: 0.35, width: 0.05, height: 0.1 },
    ];
    const crop = getDefaultCrop({ width: 3000, height: 2000 }, faces, 1);
    expect(crop.x + crop.width / 2).toBeCloseTo(0.575, 3);
    expect(crop.y).toBe(0);
  });

  it('should keep the crop inside the photo when the faces are near an edge', () => {
    const crop = getDefaultCrop({ width: 3000, height: 2000 }, [{ x: 0.9, y: 0.4, width: 0.08, height: 0.1 }], 1);
    expect(crop.x + crop.width).toBeCloseTo(1, 3);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1);
  });
});

describe('normalizeFaces', () => {
  it('should normalize face boxes by the image size they were detected on', () => {
    expect(
      normalizeFaces([
        {
          imageWidth: 1000,
          imageHeight: 500,
          boundingBoxX1: 250,
          boundingBoxY1: 0,
          boundingBoxX2: 750,
          boundingBoxY2: 250,
        },
        { imageWidth: 0, imageHeight: 0, boundingBoxX1: 1, boundingBoxY1: 1, boundingBoxX2: 2, boundingBoxY2: 2 },
      ]),
    ).toEqual([{ x: 0.25, y: 0, width: 0.5, height: 0.5 }]);
  });
});

describe('getCropRegion', () => {
  it('should convert a normalized crop to pixels', () => {
    expect(getCropRegion({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, 400, 200)).toEqual({
      left: 100,
      top: 100,
      width: 200,
      height: 100,
    });
  });

  it('should stay inside the image', () => {
    expect(getCropRegion({ x: 0.9999, y: 0, width: 0.5, height: 1 }, 100, 100)).toEqual({
      left: 99,
      top: 0,
      width: 1,
      height: 100,
    });
  });
});

describe('getEffectiveDpi', () => {
  it('should use the limiting dimension', () => {
    expect(getEffectiveDpi({ width: 3000, height: 1000 }, { width: 254, height: 50.8 })).toBe(300);
  });
});

describe('getDpiForLongEdge', () => {
  it('should compute the dpi for a target size', () => {
    expect(getDpiForLongEdge({ pageWidthMm: 254, pageHeightMm: 127 }, 1000)).toBe(100);
  });
});

describe('text helpers', () => {
  it('should escape xml', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;',
    );
  });

  it('should wrap text', () => {
    // 8 characters per line
    expect(wrapText('one two three four', 45, 10)).toEqual(['one two', 'three', 'four']);
    expect(wrapText('first\nsecond', 1000, 10)).toEqual(['first', 'second']);
    expect(wrapText('abcdefghijkl', 45, 10)).toEqual(['abcdefgh', 'ijkl']);
  });

  it('should shrink and truncate text that does not fit', () => {
    const { lines, fontPx } = fitText('word '.repeat(200), { width: 200, height: 40 }, 20);
    expect(fontPx).toBeLessThan(20);
    expect(lines.length * fontPx * 1.25).toBeLessThanOrEqual(40.001);
    expect(lines.at(-1)).toMatch(/…$/);
  });
});

describe('planPage', () => {
  const sources = new Map([['asset-1', source()]]);

  it('should compute the page and slot pixel rects with margins and gutters', () => {
    const plan = planPage(
      book,
      page({ layout: 'two-horizontal', assets: [{ slot: 0, assetId: 'asset-1', crop: null, caption: null }] }),
      { dpi: 300, mode: 'print', sources },
    );

    expect(plan.spec.width).toBe(2480);
    expect(plan.spec.height).toBe(2480);

    const [left, right] = plan.slots.map((slot) => slot.rect);
    expect(left.left).toBe(118);
    expect(left.top).toBe(118);
    expect(right.left + right.width).toBe(2480 - 118);
    expect(right.left - (left.left + left.width)).toBe(Math.round((4 * 300) / 25.4));

    expect(plan.spec.slots).toEqual([
      { ...left, input: '/path/to/preview.jpeg', crop: { x: 0, y: 0, width: 1, height: 1 } },
      null,
    ]);
  });

  it('should match the layout helper', () => {
    const plan = planPage(book, page({ layout: 'six-grid' }), { dpi: 150, mode: 'review', sources });
    const expected = getSlotRectsMm(getLayout('six-grid')!, book, book.style).map((rect) => toPxRect(rect, 150));
    expect(plan.slots.map((slot) => slot.rect)).toEqual(expected);
  });

  it('should draw the escaped title and subtitle on the cover', () => {
    const plan = planPage(book, page({ layout: 'cover' }), { dpi: 100, mode: 'print', sources });
    expect(plan.spec.overlay).toContain('Summer &lt;2025&gt; &amp; friends');
    expect(plan.spec.overlay).toContain('Italy');
    expect(plan.spec.overlay).toContain('font-family="serif"');
  });

  it('should use the cover asset for an empty cover slot', () => {
    const plan = planPage({ ...book, coverAssetId: 'asset-1' }, page({ layout: 'cover' }), {
      dpi: 100,
      mode: 'review',
      sources,
    });
    expect(plan.slots[0].assetId).toBe('asset-1');
    expect(plan.spec.slots[0]).not.toBeNull();
  });

  it('should draw placeholders for empty slots in review mode only', () => {
    const review = planPage(book, page({ layout: 'two-vertical' }), { dpi: 100, mode: 'review', sources });
    expect(review.spec.overlay).toContain('Slot 1 (empty)');
    expect(review.spec.overlay).toContain('Slot 2 (empty)');

    const print = planPage(book, page({ layout: 'two-vertical' }), { dpi: 100, mode: 'print', sources });
    expect(print.spec.overlay).toBeNull();
  });

  it('should draw the section title and the page caption', () => {
    const plan = planPage(book, page({ layout: 'section-opener', sectionTitle: 'Rome', caption: 'Day one' }), {
      dpi: 100,
      mode: 'print',
      sources,
    });
    expect(plan.spec.overlay).toContain('>Rome<');
    expect(plan.spec.overlay).toContain('>Day one<');
  });

  it('should use the page background', () => {
    const plan = planPage(book, page({ background: '#000000' }), { dpi: 100, mode: 'print', sources });
    expect(plan.spec.background).toBe('#000000');
  });

  it('should fall back to the single layout for unknown layouts', () => {
    const plan = planPage(book, page({ layout: 'nope' }), { dpi: 100, mode: 'print', sources });
    expect(plan.layout.id).toBe('single');
    expect(getPageWarnings(plan, null, 1)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'unknown-layout' })]),
    );
  });
});

describe('getPageWarnings', () => {
  it('should warn about empty slots and missing assets', () => {
    const plan = planPage(book, page({ layout: 'two-vertical', assets: [placement(1, 'gone')] }), {
      dpi: 100,
      mode: 'review',
      sources: new Map(),
    });
    expect(getPageWarnings(plan, null, 3)).toEqual([
      { page: 3, slot: 1, type: 'empty-slot', message: 'Page 3, slot 1 is empty' },
      expect.objectContaining({ page: 3, slot: 2, type: 'missing-asset' }),
    ]);
  });

  it('should estimate the print resolution in review mode', () => {
    const plan = planPage(book, page({ assets: [placement(0, 'small')] }), {
      dpi: 100,
      mode: 'review',
      sources: new Map([['small', source({ width: 1000, height: 1000 })]]),
    });
    // 1000px over 190mm = 134 dpi
    expect(getPageWarnings(plan, null, 1)).toEqual([
      expect.objectContaining({ type: 'low-dpi', dpi: 134, message: expect.stringContaining('estimated') }),
    ]);
  });

  it('should not warn about sharp photos', () => {
    const plan = planPage(book, page({ assets: [placement(0, 'big')] }), {
      dpi: 100,
      mode: 'review',
      sources: new Map([['big', source({ width: 4000, height: 4000 })]]),
    });
    expect(getPageWarnings(plan, null, 1)).toEqual([]);
  });

  it('should use the measured source size in print mode', () => {
    const plan = planPage(book, page({ assets: [placement(0, 'big')] }), {
      dpi: 300,
      mode: 'print',
      sources: new Map([['big', source({ width: 4000, height: 4000, fallback: 'the preview is used' })]]),
    });
    const warnings = getPageWarnings(plan, { data: Buffer.from(''), slots: [{ width: 1000, height: 1000 }] }, 1);
    expect(warnings).toEqual([
      { page: 1, slot: 1, type: 'fallback-source', message: 'Page 1, slot 1: the preview is used' },
      expect.objectContaining({ type: 'low-dpi', dpi: 134, message: expect.not.stringContaining('estimated') }),
    ]);
  });

  it('should report slots that could not be drawn', () => {
    const plan = planPage(book, page({ assets: [placement(0, 'broken')] }), {
      dpi: 300,
      mode: 'print',
      sources: new Map([['broken', source()]]),
    });
    expect(getPageWarnings(plan, { data: Buffer.from(''), slots: [{ error: 'bad file' }] }, 1)).toEqual([
      expect.objectContaining({ type: 'render-error', message: expect.stringContaining('bad file') }),
    ]);
  });

  it('should warn when the crop does not match the slot', () => {
    const plan = planPage(book, page({ assets: [placement(0, 'wide', { x: 0, y: 0, width: 1, height: 1 })] }), {
      dpi: 100,
      mode: 'review',
      sources: new Map([['wide', source({ width: 6000, height: 3000 })]]),
    });
    expect(getPageWarnings(plan, null, 1)).toEqual([expect.objectContaining({ type: 'crop-trimmed' })]);
  });
});

describe('contact sheets', () => {
  it('should place pages in two-page spreads', () => {
    const image = Buffer.from('');
    const spec = planContactSheet(
      [1, 2, 3, 4].map((number) => ({ number, image })),
      { width: 100, height: 100 },
      { spreadsPerRow: 2 },
    );
    const [one, two, three, four] = spec.slots.map((slot) => slot!);
    const gap = 16;
    // page 1 is alone on the right of the first spread, then 2-3 and 4-5
    expect(one).toMatchObject({ left: gap + 100, top: gap });
    expect(two).toMatchObject({ left: gap + 200 + gap, top: gap });
    expect(three).toMatchObject({ left: two.left + 100, top: gap });
    expect(four.left).toBe(gap);
    expect(four.top).toBeGreaterThan(one.top + 100);
    expect(spec.overlay).toContain('>4<');
  });

  it('should keep large books within bounds', () => {
    const { spreadsPerRow, thumb } = getContactSheetLayout({ pageWidthMm: 210, pageHeightMm: 210 }, 21);
    expect(spreadsPerRow).toBe(3);
    const rows = Math.ceil(21 / spreadsPerRow);
    expect(rows * thumb.height).toBeLessThanOrEqual(2400);
    expect(spreadsPerRow * 2 * thumb.width).toBeLessThanOrEqual(1800);
  });
});

describe('composeBookPage', () => {
  const media = new MediaRepository(
    automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }] as never, strict: false }),
  );

  it('should compose a real page', async () => {
    const red = await solid(300, 200, '#ff0000');
    const blue = await solid(200, 300, '#0000ff');
    const plan = planPage(
      { ...book, title: 'Test' },
      page({
        layout: 'two-horizontal',
        caption: 'A caption',
        assets: [
          { slot: 0, assetId: 'red', crop: null, caption: null },
          { slot: 1, assetId: 'blue', crop: null, caption: 'Blue' },
        ],
      }),
      {
        dpi: 50,
        mode: 'review',
        sources: new Map([
          ['red', source({ input: red, width: 300, height: 200 })],
          ['blue', source({ input: blue, width: 200, height: 300 })],
        ]),
      },
    );

    const result = await media.composeBookPage(plan.spec);
    const metadata = await sharp(result.data).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(plan.spec.width);
    expect(metadata.height).toBe(plan.spec.height);
    expect(result.slots).toEqual([
      { width: 300, height: 200 },
      { width: 200, height: 300 },
    ]);

    const [left, right] = plan.slots.map((slot) => slot.rect);
    expect(isClose(await pixel(result.data, left.left + 5, left.top + 5), [255, 0, 0])).toBe(true);
    expect(isClose(await pixel(result.data, right.left + 5, right.top + 5), [0, 0, 255])).toBe(true);
    expect(isClose(await pixel(result.data, 2, 2), [255, 255, 255])).toBe(true);
  });

  it('should apply the crop after the EXIF orientation', async () => {
    // left half red, right half blue, rotated 90° clockwise when displayed: red on top
    const redHalf = await solid(100, 100, '#ff0000');
    const rotated = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#0000ff' } })
      .composite([{ input: redHalf, left: 0, top: 0 }])
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const spec = {
      width: 50,
      height: 50,
      background: '#ffffff',
      quality: 90,
      overlay: null,
      slots: [{ left: 0, top: 0, width: 50, height: 50, input: rotated, crop: { x: 0, y: 0, width: 1, height: 0.5 } }],
    };

    const result = await media.composeBookPage(spec);
    expect(result.slots).toEqual([{ width: 100, height: 100 }]);
    expect(isClose(await pixel(result.data, 25, 25), [255, 0, 0])).toBe(true);
  });

  it('should report unreadable sources and still render the page', async () => {
    const result = await media.composeBookPage({
      width: 20,
      height: 20,
      background: '#ffffff',
      quality: 80,
      overlay: null,
      slots: [
        {
          left: 0,
          top: 0,
          width: 10,
          height: 10,
          input: Buffer.from('not an image'),
          crop: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
    });
    expect(result.slots[0]).toEqual({ error: expect.any(String) });
    const metadata = await sharp(result.data).metadata();
    expect(metadata.width).toBe(20);
  });
});
