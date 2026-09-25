import type { BookLayoutResponseDto } from '@immich/sdk';
import {
  cropFromView,
  getLayoutBox,
  getLayoutChoices,
  getMapFrame,
  getSlotFrames,
  getSlotRectsMm,
  isSameAspect,
  panView,
  planLayoutChange,
  toCropImageStyle,
  viewFromCrop,
} from '$lib/utils/book-geometry';

const size = { pageWidthMm: 210, pageHeightMm: 210 };
const style = { marginMm: 12, gutterMm: 4 };

const layout = (id: string, slots: BookLayoutResponseDto['slots'], extra: Partial<BookLayoutResponseDto> = {}) =>
  ({
    id,
    name: id,
    description: '',
    orientation: 'any',
    fullBleed: false,
    slots,
    textAreas: [],
    ...extra,
  }) as BookLayoutResponseDto;

const single = layout('single', [{ x: 0, y: 0, width: 1, height: 1 }]);
const fullBleed = layout('full-bleed', [{ x: 0, y: 0, width: 1, height: 1 }], { fullBleed: true });
const twoHorizontal = layout('two-horizontal', [
  { x: 0, y: 0, width: 0.5, height: 1 },
  { x: 0.5, y: 0, width: 0.5, height: 1 },
]);
const fourGrid = layout('four-grid', [
  { x: 0, y: 0, width: 0.5, height: 0.5 },
  { x: 0.5, y: 0, width: 0.5, height: 0.5 },
  { x: 0, y: 0.5, width: 0.5, height: 0.5 },
  { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
]);
const map = layout('map', [], { mapArea: { x: 0, y: 0, width: 1, height: 1 } });
const mapPhoto = layout('map-photo', [{ x: 0, y: 0.66, width: 0.5, height: 0.34 }], {
  mapArea: { x: 0, y: 0, width: 1, height: 0.66 },
});
const text = layout('text', []);

describe('book geometry', () => {
  describe('getLayoutBox', () => {
    it('should keep the margins', () => {
      expect(getLayoutBox(single, size, style)).toEqual({ x: 12, y: 12, width: 186, height: 186 });
    });

    it('should use the whole page for full-bleed layouts', () => {
      expect(getLayoutBox(fullBleed, size, style)).toEqual({ x: 0, y: 0, width: 210, height: 210 });
    });
  });

  describe('getSlotRectsMm', () => {
    it('should leave half a gutter between neighbouring slots, like the server', () => {
      expect(getSlotRectsMm(twoHorizontal, size, style)).toEqual([
        { x: 12, y: 12, width: 91, height: 186 },
        { x: 107, y: 12, width: 91, height: 186 },
      ]);
    });

    it('should not add a gutter at the edges of the box', () => {
      expect(getSlotRectsMm(single, size, style)).toEqual([{ x: 12, y: 12, width: 186, height: 186 }]);
    });
  });

  describe('getSlotFrames', () => {
    it('should give the slots as fractions of the page', () => {
      const [first, second] = getSlotFrames(twoHorizontal, { pageWidthMm: 200, pageHeightMm: 100 }, style);
      expect(first.left).toBeCloseTo(12 / 200);
      expect(first.top).toBeCloseTo(12 / 100);
      expect(first.width).toBeCloseTo((0.5 * 176 - 2) / 200);
      expect(first.height).toBeCloseTo(76 / 100);
      expect(second.left).toBeCloseTo((12 + 88 + 2) / 200);
    });

    it('should cover the whole page for full-bleed layouts', () => {
      expect(getSlotFrames(fullBleed, size, style)).toEqual([{ left: 0, top: 0, width: 1, height: 1 }]);
    });

    it('should return nothing for an invalid page size', () => {
      expect(getSlotFrames(single, { pageWidthMm: 0, pageHeightMm: 210 }, style)).toEqual([]);
    });
  });

  describe('getMapFrame', () => {
    it('should place the map area', () => {
      const frame = getMapFrame(mapPhoto, size, style)!;
      expect(frame.left).toBeCloseTo(12 / 210);
      expect(frame.height).toBeCloseTo((0.66 * 186 - 2) / 210);
    });

    it('should return null without a map area', () => {
      expect(getMapFrame(single, size, style)).toBeNull();
    });
  });

  describe('getLayoutChoices', () => {
    const layouts = [single, fullBleed, twoHorizontal, fourGrid, map, mapPhoto, text];
    const ids = (list: BookLayoutResponseDto[]) => list.map(({ id }) => id);

    it('should offer the layouts with enough slots for the photos of the page', () => {
      const { fitting, others } = getLayoutChoices(layouts, { photoCount: 2 });
      expect(ids(fitting)).toEqual(['two-horizontal', 'four-grid']);
      expect(ids(others)).toEqual(['single', 'full-bleed', 'text']);
    });

    it('should offer every photo layout to an empty page', () => {
      const { fitting, others } = getLayoutChoices(layouts, { photoCount: 0 });
      expect(ids(fitting)).toEqual(['single', 'full-bleed', 'two-horizontal', 'four-grid', 'text']);
      expect(others).toEqual([]);
    });

    it('should only offer map layouts to map pages', () => {
      expect(ids(getLayoutChoices(layouts, { photoCount: 1, isMap: true }).fitting)).toEqual([
        'single',
        'full-bleed',
        'two-horizontal',
        'four-grid',
        'map-photo',
      ]);
      expect(ids(getLayoutChoices(layouts, { photoCount: 1 }).fitting)).not.toContain('map-photo');
    });
  });

  describe('planLayoutChange', () => {
    const slots = (...assetIds: (string | null)[]) => assetIds.map((assetId, slot) => ({ slot, assetId }));

    it('should move the photos of dropped slots into free slots', () => {
      expect(planLayoutChange(slots('a', null, null, 'd'), 2)).toEqual([{ from: 3, to: 1 }]);
    });

    it('should not move anything when the photos fit', () => {
      expect(planLayoutChange(slots('a', 'b', null, null), 2)).toEqual([]);
      expect(planLayoutChange(slots('a', 'b'), 4)).toEqual([]);
    });

    it('should stop when there is no free slot left', () => {
      expect(planLayoutChange(slots(null, 'b', 'c', 'd'), 2)).toEqual([{ from: 2, to: 0 }]);
    });
  });

  describe('isSameAspect', () => {
    it('should tolerate rounding', () => {
      expect(isSameAspect(0.489, 0.4892)).toBe(true);
      expect(isSameAspect(1, 1.5)).toBe(false);
      expect(isSameAspect(0, 1)).toBe(false);
    });
  });

  describe('crop', () => {
    it('should show the largest crop with the slot aspect ratio at zoom 1', () => {
      // a 3:2 photo in a square slot
      expect(cropFromView({ zoom: 1, centerX: 0.5, centerY: 0.5 }, 1.5, 1)).toEqual({
        x: 0.1667,
        y: 0,
        width: 0.6667,
        height: 1,
      });
      // a 2:3 photo in a 2:1 slot
      expect(cropFromView({ zoom: 1, centerX: 0.5, centerY: 0.5 }, 2 / 3, 2)).toEqual({
        x: 0,
        y: 0.3333,
        width: 1,
        height: 0.3333,
      });
    });

    it('should zoom in around the centre and stay inside the photo', () => {
      expect(cropFromView({ zoom: 2, centerX: 0.5, centerY: 0.5 }, 1, 1)).toEqual({
        x: 0.25,
        y: 0.25,
        width: 0.5,
        height: 0.5,
      });
      expect(cropFromView({ zoom: 2, centerX: 0.95, centerY: 0 }, 1, 1)).toEqual({
        x: 0.5,
        y: 0,
        width: 0.5,
        height: 0.5,
      });
    });

    it('should clamp the zoom', () => {
      expect(cropFromView({ zoom: 0.2, centerX: 0.5, centerY: 0.5 }, 1, 1).width).toBe(1);
      expect(cropFromView({ zoom: 50, centerX: 0.5, centerY: 0.5 }, 1, 1).width).toBe(0.2);
    });

    it('should read the view back from a crop', () => {
      const crop = cropFromView({ zoom: 2.5, centerX: 0.4, centerY: 0.6 }, 1.5, 0.8);
      const view = viewFromCrop(crop, 1.5, 0.8);
      expect(view.zoom).toBeCloseTo(2.5, 2);
      expect(view.centerX).toBeCloseTo(0.4, 3);
      expect(view.centerY).toBeCloseTo(0.6, 3);
    });

    it('should show a crop with another aspect ratio the way the server trims it', () => {
      // a full, square crop of a square photo in a 2:1 slot: the slot shows half of the height
      expect(viewFromCrop({ x: 0, y: 0, width: 1, height: 1 }, 1, 2)).toEqual({ zoom: 1, centerX: 0.5, centerY: 0.5 });
      expect(viewFromCrop(null, 1, 2)).toEqual({ zoom: 1, centerX: 0.5, centerY: 0.5 });
    });

    it('should pan by fractions of the visible area', () => {
      const view = panView({ zoom: 2, centerX: 0.5, centerY: 0.5 }, { x: 0.5, y: -2 }, 1, 1);
      expect(view.centerX).toBeCloseTo(0.75);
      expect(view.centerY).toBeCloseTo(0.25);
    });

    it('should place the image so that the crop fills the frame', () => {
      expect(toCropImageStyle({ x: 0.25, y: 0, width: 0.5, height: 1 })).toBe(
        'width:200%;height:100%;left:-50%;top:0%',
      );
    });
  });
});
