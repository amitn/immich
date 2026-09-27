import sharp from 'sharp';
import { bookStylePresets } from 'src/dtos/book.dto.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import {
  CollageAspectRatio,
  CollagePhoto,
  MAX_COLLAGE_PHOTOS,
  MIN_COLLAGE_PHOTOS,
  chooseCollageLayout,
  collageAspectRatios,
  collageLayouts,
  collageOnlyLayouts,
  getBaseLayoutId,
  getCollageLayout,
  getCollageLayoutsFor,
  getCollageName,
  getCollagePageSize,
  rankCollageLayouts,
  withTitle,
} from 'src/utils/book/collage.js';
import { LayoutRect, bookLayouts, getSlotRectsMm, getTextRectsMm } from 'src/utils/book/layouts.js';
import { getDpiForLongEdge, planPage } from 'src/utils/book/render.js';
import { automock } from 'test/utils.js';

const style = bookStylePresets.classic.style;

const portrait = (id: string): CollagePhoto => ({ id, width: 3000, height: 4000, faces: [] });
const landscape = (id: string): CollagePhoto => ({ id, width: 4000, height: 3000, faces: [] });
const portraits = (count: number) => Array.from({ length: count }, (_, i) => portrait(`p${i}`));
const landscapes = (count: number) => Array.from({ length: count }, (_, i) => landscape(`l${i}`));

const best = (photos: CollagePhoto[], aspectRatio: CollageAspectRatio) =>
  rankCollageLayouts(photos, getCollagePageSize(aspectRatio), style)[0];

const overlaps = (a: LayoutRect, b: LayoutRect) =>
  a.x < b.x + b.width - 1e-9 &&
  b.x < a.x + a.width - 1e-9 &&
  a.y < b.y + b.height - 1e-9 &&
  b.y < a.y + a.height - 1e-9;

describe('collage layouts', () => {
  it('should have layouts for every number of photos', () => {
    for (let count = MIN_COLLAGE_PHOTOS; count <= MAX_COLLAGE_PHOTOS; count++) {
      expect(getCollageLayoutsFor(count).length, `${count} photos`).toBeGreaterThanOrEqual(3);
    }
    expect(getCollageLayoutsFor(1)).toEqual([]);
    expect(getCollageLayoutsFor(10)).toEqual([]);
  });

  it('should reuse the photo layouts of the book catalogue, without text, maps or collection entries', () => {
    const fromBook = collageLayouts.filter((layout) => bookLayouts.includes(layout)).map(({ id }) => id);
    expect(fromBook).toEqual([
      'two-horizontal',
      'two-vertical',
      'hero-left-two',
      'hero-top-two',
      'four-grid',
      'hero-three',
      'six-grid',
    ]);
    expect(getCollageLayout('six-grid')?.id).toBe('six-grid');
    expect(getCollageLayout('three-row')).toBeUndefined();
    expect(getCollageLayout('dish-pair')).toBeUndefined();
    expect(getCollageLayout('full-bleed')).toBeUndefined();
    expect(getCollageLayout('collage-9-grid')?.slots).toHaveLength(9);
  });

  it('should give every layout a unique id', () => {
    const ids = collageLayouts.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(collageOnlyLayouts.every(({ id }) => id.startsWith('collage-'))).toBe(true);
  });

  it('should tile the page with the slots of every layout', () => {
    for (const layout of collageLayouts) {
      const area = layout.slots.reduce((sum, slot) => sum + slot.width * slot.height, 0);
      expect(area, layout.id).toBeCloseTo(1, 6);
      for (const [i, slot] of layout.slots.entries()) {
        expect(slot.x).toBeGreaterThanOrEqual(-1e-9);
        expect(slot.y).toBeGreaterThanOrEqual(-1e-9);
        expect(slot.x + slot.width).toBeLessThanOrEqual(1 + 1e-9);
        expect(slot.y + slot.height).toBeLessThanOrEqual(1 + 1e-9);
        for (const other of layout.slots.slice(i + 1)) {
          expect(overlaps(slot, other), `${layout.id}: slots overlap`).toBe(false);
        }
      }
    }
  });

  it('should size the page by the aspect ratio, 200 mm on the long side', () => {
    expect(getCollagePageSize('1:1')).toEqual({ pageWidthMm: 200, pageHeightMm: 200 });
    expect(getCollagePageSize('4:5')).toEqual({ pageWidthMm: 160, pageHeightMm: 200 });
    expect(getCollagePageSize('9:16')).toEqual({ pageWidthMm: 112.5, pageHeightMm: 200 });
    expect(getCollagePageSize('16:9')).toEqual({ pageWidthMm: 200, pageHeightMm: 112.5 });
  });
});

describe(rankCollageLayouts.name, () => {
  it.each<[string, CollagePhoto[], CollageAspectRatio, string]>([
    ['two portraits, side by side on a wide collage', portraits(2), '16:9', 'two-horizontal'],
    ['two landscapes, stacked on a tall collage', landscapes(2), '4:5', 'two-vertical'],
    ['three landscapes, in rows on a story', landscapes(3), '9:16', 'collage-3-rows'],
    ['three portraits, in columns on a screen', portraits(3), '16:9', 'collage-3-columns'],
    ['three portraits, a hero and two on a square', portraits(3), '1:1', 'hero-left-two'],
    ['three landscapes, a hero on top on a square', landscapes(3), '1:1', 'hero-top-two'],
    ['four portraits, in a grid on 4:5', portraits(4), '4:5', 'four-grid'],
    ['four portraits, in columns on a screen', portraits(4), '16:9', 'collage-4-columns'],
    ['four landscapes, in rows on a story', landscapes(4), '9:16', 'collage-4-rows'],
    ['six landscapes, three across on a screen', landscapes(6), '16:9', 'collage-6-grid-wide'],
    ['six landscapes, two across on a square', landscapes(6), '1:1', 'six-grid'],
    ['nine portraits, in a grid on 4:5', portraits(9), '4:5', 'collage-9-grid'],
    ['nine landscapes, a hero on a screen', landscapes(9), '16:9', 'collage-9-hero'],
  ])('should lay out %s', (_, photos, aspectRatio, layout) => {
    expect(best(photos, aspectRatio).layout.id).toBe(layout);
  });

  it('should rank every layout for the number of photos, best first', () => {
    const choices = rankCollageLayouts(landscapes(5), getCollagePageSize('1:1'), style);
    expect(choices.map(({ layout }) => layout.id).toSorted()).toEqual(
      getCollageLayoutsFor(5)
        .map(({ id }) => id)
        .toSorted(),
    );
    expect(choices.map(({ cost }) => cost)).toEqual(choices.map(({ cost }) => cost).toSorted((a, b) => a - b));
  });

  it('should put a portrait in the tall hero slot', () => {
    const photos = [landscape('a'), portrait('b'), portrait('c')];
    const choice = best(photos, '1:1');
    expect(choice.layout.id).toBe('hero-left-two');
    expect(choice.order[0].height).toBeGreaterThan(choice.order[0].width);
  });

  it('should place mixed photos by orientation beyond the exhaustive search', () => {
    const photos = [...landscapes(4), ...portraits(4), portrait('p9')];
    for (const aspectRatio of collageAspectRatios) {
      const { layout, order, crops } = best(photos, aspectRatio);
      const shapes = getSlotRectsMm(layout, getCollagePageSize(aspectRatio), style).map((r) => r.width / r.height);
      // the photos keep most of themselves
      const kept = crops.map((crop) => crop.width * crop.height);
      expect(Math.min(...kept)).toBeGreaterThan(0.2);
      expect(kept.reduce((sum, value) => sum + value, 0) / kept.length).toBeGreaterThan(0.5);
      // the widest slot holds a landscape, the tallest a portrait, when the layout has both
      const widest = shapes.indexOf(Math.max(...shapes));
      const tallest = shapes.indexOf(Math.min(...shapes));
      if (!(shapes[widest] > 1.1 && shapes[tallest] < 0.9)) {
        continue;
      }

      expect(order[widest].width).toBeGreaterThan(order[widest].height);
      expect(order[tallest].width).toBeLessThan(order[tallest].height);
    }
  });

  it('should keep a face in the crop', () => {
    const face = { x: 0.05, y: 0.3, width: 0.12, height: 0.15 };
    const photos = [{ ...landscape('face'), faces: [face] }, landscape('b')];
    const { order, crops } = best(photos, '4:5');
    const crop = crops[order.findIndex(({ id }) => id === 'face')];
    expect(crop.x).toBeLessThanOrEqual(face.x);
    expect(crop.x + crop.width).toBeGreaterThanOrEqual(face.x + face.width);
  });

  it('should be fast enough for a live preview', () => {
    const start = performance.now();
    for (const aspectRatio of collageAspectRatios) {
      for (let count = MIN_COLLAGE_PHOTOS; count <= MAX_COLLAGE_PHOTOS; count++) {
        rankCollageLayouts([...landscapes(count - 1), portrait('p')], getCollagePageSize(aspectRatio), style);
      }
    }
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe(withTitle.name, () => {
  it('should squeeze the photos above a title band at the foot of the page', () => {
    const size = getCollagePageSize('1:1');
    const layout = withTitle(getCollageLayout('four-grid')!, size, style);
    expect(layout.id).toBe('four-grid+title');
    expect(getBaseLayoutId(layout)).toBe('four-grid');
    const [title] = getTextRectsMm(layout, size, style);
    expect(title.kind).toBe('title');
    const bottom = Math.max(...getSlotRectsMm(layout, size, style).map((rect) => rect.y + rect.height));
    expect(bottom).toBeLessThanOrEqual(title.y);
    // about two lines of the 28 pt title
    expect(title.height).toBeGreaterThan(12);
    expect(title.height).toBeLessThan(30);
  });

  it('should choose among the layouts with a title band', () => {
    const size = getCollagePageSize('16:9');
    const { chosen, choices } = chooseCollageLayout(portraits(3), size, style, { title: true });
    expect(chosen.layout.id).toMatch(/\+title$/);
    expect(chosen.layout.text).toEqual([expect.objectContaining({ kind: 'title' })]);
    expect(choices).toHaveLength(getCollageLayoutsFor(3).length);
  });
});

describe(chooseCollageLayout.name, () => {
  const size = getCollagePageSize('1:1');

  it('should use the chosen layout', () => {
    expect(chooseCollageLayout(landscapes(4), size, style, { layout: 'collage-4-columns' }).chosen.layout.id).toBe(
      'collage-4-columns',
    );
    expect(
      chooseCollageLayout(landscapes(4), size, style, { layout: 'collage-4-columns', title: true }).chosen.layout.id,
    ).toBe('collage-4-columns+title');
  });

  it('should fall back to the best layout for another number of photos', () => {
    const { chosen, choices } = chooseCollageLayout(landscapes(4), size, style, { layout: 'six-grid' });
    expect(chosen).toBe(choices[0]);
  });
});

describe(getCollageName.name, () => {
  it('should name a collage by its title, or else its dates', () => {
    expect(getCollageName('  Palermo  ', '3 May 2025')).toBe('Palermo');
    expect(getCollageName('', '3 May 2025')).toBe('3 May 2025');
    expect(getCollageName(undefined, '3–5 May 2025')).toBe('3–5 May 2025');
    expect(getCollageName('Food/Drink', '')).toBe('Food-Drink');
  });
});

const solid = (color: string, width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();

const pixel = async (image: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const offset = (Math.round(y) * info.width + Math.round(x)) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
};

const hex = (color: string) => [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));

const near = (actual: number[], expected: number[]) => actual.every((value, i) => Math.abs(value - expected[i]) <= 24);

describe('collage render', () => {
  const media = new MediaRepository(
    automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }] as never, strict: false }),
  );
  const colors = ['#d02020', '#20a040', '#2040d0'];

  it('should draw the photos in their slots and the title in its band', async () => {
    const photos = [landscape('a'), portrait('b'), landscape('c')];
    const inputs = new Map([
      ['a', await solid(colors[0], 120, 90)],
      ['b', await solid(colors[1], 90, 120)],
      ['c', await solid(colors[2], 120, 90)],
    ]);
    const size = getCollagePageSize('16:9');
    const { chosen } = chooseCollageLayout(photos, size, style, { title: true });
    const dpi = getDpiForLongEdge(size, 600);
    const plan = planPage(
      { ...size, title: 'Palermo', subtitle: null, style, coverAssetId: null },
      {
        layout: chosen.layout.id,
        sectionTitle: null,
        caption: null,
        background: null,
        assets: chosen.order.map((photo, slot) => ({
          slot,
          assetId: photo.id,
          crop: chosen.crops[slot],
          caption: null,
        })),
      },
      {
        dpi,
        mode: 'review',
        layout: chosen.layout,
        sources: new Map(photos.map((photo) => [photo.id, { input: inputs.get(photo.id)!, ...photo }])),
      },
    );
    expect(plan.unknownLayout).toBe(false);
    expect(plan.text).toEqual([expect.objectContaining({ kind: 'title', text: 'Palermo' })]);

    const { data, slots } = await media.composeBookPage(plan.spec);
    expect(slots.every((slot) => slot && !('error' in slot))).toBe(true);
    const metadata = await sharp(data).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 600, height: 338 });

    for (const [index, slot] of plan.slots.entries()) {
      const color = colors[['a', 'b', 'c'].indexOf(chosen.order[index].id)];
      const center = await pixel(data, slot.rect.left + slot.rect.width / 2, slot.rect.top + slot.rect.height / 2);
      expect(near(center, hex(color)), `slot ${index + 1}: ${center.join(',')} is not ${color}`).toBe(true);
    }

    // the band under the photos is the page, with the dark title in it
    const band = plan.text[0].rect;
    const { data: raw, info } = await sharp(data)
      .extract({ left: band.left, top: band.top, width: band.width, height: band.height })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const dark = raw.filter((value) => value < 100).length / (info.width * info.height);
    expect(dark).toBeGreaterThan(0.005);
    expect(dark).toBeLessThan(0.3);
  });
});
