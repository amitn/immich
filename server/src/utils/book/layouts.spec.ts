import { defaultBookStyle } from 'src/dtos/book.dto.js';
import {
  LayoutRect,
  bookLayouts,
  getLayout,
  getSlotAspectRatios,
  getSlotRectsMm,
  getTextRectsMm,
  toPxRect,
  validatePageStyle,
} from 'src/utils/book/layouts.js';

const square = { pageWidthMm: 210, pageHeightMm: 210 };
const style = { ...defaultBookStyle, marginMm: 10, gutterMm: 4 };

const overlaps = (a: LayoutRect, b: LayoutRect) =>
  a.x < b.x + b.width - 1e-9 &&
  b.x < a.x + a.width - 1e-9 &&
  a.y < b.y + b.height - 1e-9 &&
  b.y < a.y + a.height - 1e-9;

describe('book layouts', () => {
  it('should include the required layouts', () => {
    expect(bookLayouts.map((layout) => layout.id)).toEqual(
      expect.arrayContaining([
        'cover',
        'full-bleed',
        'single',
        'two-horizontal',
        'two-vertical',
        'three-row',
        'hero-left-two',
        'hero-top-two',
        'four-grid',
        'hero-three',
        'six-grid',
        'section-opener',
        'text',
        'map',
        'map-photo',
      ]),
    );
  });

  it('should include the food layouts, with a caption area for every photo of a dish layout', () => {
    const food = bookLayouts.filter((layout) => layout.collection).map((layout) => layout.id);
    expect(food).toEqual([
      'menu',
      'menu-wide',
      'dish-opener',
      'dish',
      'dish-portrait',
      'dish-pair',
      'dish-pair-stacked',
      'dish-list',
      'dish-trio',
    ]);
    for (const layout of bookLayouts) {
      const captions = layout.text.filter((area) => area.kind === 'slotCaption');
      expect(captions.every((area) => area.slot !== undefined && area.slot < layout.slots.length)).toBe(true);
      if (layout.id.startsWith('dish')) {
        expect(captions.map((area) => area.slot!).toSorted((a, b) => a - b)).toEqual(
          layout.slots.map((_, index) => index),
        );
      }
    }
  });

  it('should keep a menu photo whole in the menu layouts', () => {
    const food = { ...style, marginMm: 18, gutterMm: 6 };
    expect(getSlotAspectRatios(getLayout('menu')!, square, food)[0]).toBeCloseTo(0.75, 1);
    expect(getSlotAspectRatios(getLayout('menu-wide')!, square, food)[0]).toBeCloseTo(4 / 3, 0);
    expect(getSlotAspectRatios(getLayout('dish-list')!, square, food)[0]).toBeCloseTo(1.5, 0);
  });

  it('should have unique ids', () => {
    expect(new Set(bookLayouts.map((layout) => layout.id)).size).toBe(bookLayouts.length);
  });

  describe.each(bookLayouts.map((layout) => [layout.id, layout] as const))('%s', (_, layout) => {
    const areas = [...layout.slots, ...layout.text, ...(layout.map ? [layout.map] : [])];

    it('should keep every slot and text area inside the page', () => {
      for (const area of areas) {
        expect(area.x).toBeGreaterThanOrEqual(0);
        expect(area.y).toBeGreaterThanOrEqual(0);
        expect(area.width).toBeGreaterThan(0);
        expect(area.height).toBeGreaterThan(0);
        expect(area.x + area.width).toBeLessThanOrEqual(1 + 1e-9);
        expect(area.y + area.height).toBeLessThanOrEqual(1 + 1e-9);
      }
    });

    it('should not overlap', () => {
      for (const [i, a] of areas.entries()) {
        for (const b of areas.slice(i + 1)) {
          expect(overlaps(a, b)).toBe(false);
        }
      }
    });

    it('should keep the gutter between slots on the page', () => {
      const rects = getSlotRectsMm(layout, square, style);
      for (const [i, a] of rects.entries()) {
        for (const b of rects.slice(i + 1)) {
          const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
          const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
          expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(style.gutterMm - 1e-9);
        }
      }
    });

    it('should have a description', () => {
      expect(layout.description.length).toBeGreaterThan(10);
    });
  });

  describe('getSlotRectsMm', () => {
    it('should apply the margins', () => {
      expect(getSlotRectsMm(getLayout('single')!, square, style)).toEqual([{ x: 10, y: 10, width: 190, height: 190 }]);
    });

    it('should ignore the margins for full-bleed', () => {
      expect(getSlotRectsMm(getLayout('full-bleed')!, square, style)).toEqual([
        { x: 0, y: 0, width: 210, height: 210 },
      ]);
    });

    it('should split the gutter between adjacent slots', () => {
      expect(getSlotRectsMm(getLayout('two-horizontal')!, square, style)).toEqual([
        { x: 10, y: 10, width: 93, height: 190 },
        { x: 107, y: 10, width: 93, height: 190 },
      ]);
    });

    it('should leave a gutter between a slot and a text area', () => {
      const layout = getLayout('cover')!;
      const [slot] = getSlotRectsMm(layout, square, style);
      const [title] = getTextRectsMm(layout, square, style);
      expect(title.y - (slot.y + slot.height)).toBeCloseTo(style.gutterMm);
    });
  });

  describe('getSlotAspectRatios', () => {
    it('should return the aspect ratio of every slot', () => {
      expect(getSlotAspectRatios(getLayout('four-grid')!, square, style)).toEqual([1, 1, 1, 1]);
      const [left, right] = getSlotAspectRatios(getLayout('two-horizontal')!, square, style);
      expect(left).toBeCloseTo(93 / 190);
      expect(right).toBeCloseTo(93 / 190);
    });

    it('should depend on the page size', () => {
      const landscape = { pageWidthMm: 297, pageHeightMm: 210 };
      const [slot] = getSlotAspectRatios(getLayout('single')!, landscape, style);
      expect(slot).toBeCloseTo(277 / 190);
    });

    it('should return no aspect ratios for the text layout', () => {
      expect(getSlotAspectRatios(getLayout('text')!, square, style)).toEqual([]);
    });
  });

  describe('toPxRect', () => {
    it('should convert millimeters to pixels', () => {
      expect(toPxRect({ x: 0, y: 0, width: 25.4, height: 50.8 }, 300)).toEqual({
        left: 0,
        top: 0,
        width: 300,
        height: 600,
      });
    });

    it('should keep adjacent rects free of rounding gaps', () => {
      const [a, b] = getSlotRectsMm(getLayout('two-horizontal')!, square, { ...style, gutterMm: 0 });
      const pa = toPxRect(a, 97);
      const pb = toPxRect(b, 97);
      expect(pa.left + pa.width).toBe(pb.left);
    });
  });

  describe('validatePageStyle', () => {
    it('should accept the default style', () => {
      expect(validatePageStyle(square, defaultBookStyle)).toBeNull();
    });

    it('should reject margins that leave no space', () => {
      expect(validatePageStyle({ pageWidthMm: 80, pageHeightMm: 80 }, { ...style, marginMm: 30 })).toMatch(/too large/);
    });
  });
});
