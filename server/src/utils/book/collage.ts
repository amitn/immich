import type { BookStyle, NormalizedRect } from 'src/dtos/book.dto.js';
import { BookLayout, LayoutRect, PageSize, bookLayouts, getLayout, getSlotRectsMm } from 'src/utils/book/layouts.js';
import { getSmartCrop } from 'src/utils/book/render.js';

/**
 * Collages: one page of a "book" at a chosen aspect ratio, laid out and drawn by the book layout engine and renderer
 * (see `planPage`), with the book styles. The layouts are the photo-only layouts of the book catalogue, plus denser ones
 * made for collages (up to nine photos).
 */

export const collageAspectRatios = ['1:1', '4:5', '9:16', '16:9'] as const;
export type CollageAspectRatio = (typeof collageAspectRatios)[number];

export const MIN_COLLAGE_PHOTOS = 2;
export const MAX_COLLAGE_PHOTOS = 9;
/** the photos a collage of a memory has, unless asked for more or fewer */
export const DEFAULT_MEMORY_COLLAGE_PHOTOS = 6;

/** the long side of a collage page: the book styles (margins, gutters and fonts in mm and pt) read as on a book page */
export const COLLAGE_LONG_SIDE_MM = 200;
/** the long edge of the preview in the dialog, and of the saved (or downloaded) collage */
export const COLLAGE_PREVIEW_PX = 1000;
export const COLLAGE_FULL_PX = 3000;

/** the page of a collage, e.g. 160 × 200 mm for 4:5 */
export const getCollagePageSize = (aspectRatio: CollageAspectRatio): PageSize => {
  const [width, height] = aspectRatio.split(':').map(Number);
  return width >= height
    ? { pageWidthMm: COLLAGE_LONG_SIDE_MM, pageHeightMm: (COLLAGE_LONG_SIDE_MM * height) / width }
    : { pageWidthMm: (COLLAGE_LONG_SIDE_MM * width) / height, pageHeightMm: COLLAGE_LONG_SIDE_MM };
};

type Cell = [x: number, y: number, width: number, height: number];

const cells = (list: Cell[]): LayoutRect[] => list.map(([x, y, width, height]) => ({ x, y, width, height }));

/** rows of equal height, each split into its count of equal cells */
const rowsOf = (counts: number[]): LayoutRect[] =>
  counts.flatMap((count, row) =>
    Array.from({ length: count }, (_, column) => ({
      x: column / count,
      y: row / counts.length,
      width: 1 / count,
      height: 1 / counts.length,
    })),
  );

/** columns of equal width, each split into its count of equal cells */
const columnsOf = (counts: number[]): LayoutRect[] =>
  rowsOf(counts).map(({ x, y, width, height }) => ({ x: y, y: x, width: height, height: width }));

/** a grid of `columns` × `rows` with a hero of 2 × 2 cells in the top left corner */
const heroGrid = (columns: number, rows: number): LayoutRect[] => {
  const slots: LayoutRect[] = [{ x: 0, y: 0, width: 2 / columns, height: 2 / rows }];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (row < 2 && column < 2) {
        continue;
      }
      slots.push({ x: column / columns, y: row / rows, width: 1 / columns, height: 1 / rows });
    }
  }
  return slots;
};

const collage = (id: string, name: string, description: string, slots: LayoutRect[]): BookLayout => ({
  id: `collage-${id}`,
  name,
  description,
  slots,
  text: [],
  orientation: 'any',
});

/** the layouts made for collages; the book catalogue has no layouts for five, seven, eight or nine photos */
export const collageOnlyLayouts: readonly BookLayout[] = [
  collage('2-hero-left', 'Hero left + one', 'A large photo on the left and a narrower one beside it.', [
    ...cells([
      [0, 0, 0.64, 1],
      [0.64, 0, 0.36, 1],
    ]),
  ]),
  collage('2-hero-top', 'Hero top + one', 'A large photo on top and a wide strip below it.', [
    ...cells([
      [0, 0, 1, 0.64],
      [0, 0.64, 1, 0.36],
    ]),
  ]),
  collage('3-columns', 'Three columns', 'Three tall photos side by side.', rowsOf([3])),
  collage('3-rows', 'Three rows', 'Three wide photos stacked.', rowsOf([1, 1, 1])),
  collage('4-hero-left', 'Hero left + three', 'A large photo on the left and three stacked on the right.', [
    ...cells([[0, 0, 0.62, 1]]),
    ...columnsOf([3]).map(({ y, height }) => ({ x: 0.62, y, width: 0.38, height })),
  ]),
  collage('4-columns', 'Four columns', 'Four tall photos side by side.', rowsOf([4])),
  collage('4-rows', 'Four rows', 'Four wide photos stacked.', rowsOf([1, 1, 1, 1])),
  collage('4-mosaic', 'Mosaic of four', 'Two columns of a tall and a short photo, staggered.', [
    ...cells([
      [0, 0, 0.5, 0.6],
      [0, 0.6, 0.5, 0.4],
      [0.5, 0, 0.5, 0.4],
      [0.5, 0.4, 0.5, 0.6],
    ]),
  ]),
  collage('5-two-three', 'Two over three', 'Two photos in the top row and three below them.', rowsOf([2, 3])),
  collage('5-columns', 'Two and three columns', 'Two photos in the left column and three in the right one.', [
    ...columnsOf([2, 3]),
  ]),
  collage('5-hero-left', 'Hero left + four', 'A large photo on the left and a grid of four on the right.', [
    ...cells([[0, 0, 0.5, 1]]),
    ...rowsOf([2, 2]).map(({ x, y, width, height }) => ({ x: 0.5 + x / 2, y, width: width / 2, height })),
  ]),
  collage('5-hero-top', 'Hero top + four', 'A large photo on top and a row of four below it.', [
    ...cells([[0, 0, 1, 0.62]]),
    ...rowsOf([4]).map(({ x, width }) => ({ x, y: 0.62, width, height: 0.38 })),
  ]),
  collage('6-grid-wide', 'Six grid, three across', 'Six photos in two rows of three.', rowsOf([3, 3])),
  collage(
    '6-hero',
    'Hero + five',
    'A large photo in the top left corner, framed by five smaller ones.',
    heroGrid(3, 3),
  ),
  collage('7-hero-top', 'Hero top + six', 'A large photo on top and two rows of three below it.', [
    ...cells([[0, 0, 1, 0.5]]),
    ...rowsOf([3, 3]).map(({ x, y, width, height }) => ({ x, y: 0.5 + y / 2, width, height: height / 2 })),
  ]),
  collage('7-hero-left', 'Hero left + six', 'A large photo on the left and a grid of six on the right.', [
    ...cells([[0, 0, 0.5, 1]]),
    ...rowsOf([2, 2, 2]).map(({ x, y, width, height }) => ({ x: 0.5 + x / 2, y, width: width / 2, height })),
  ]),
  collage('7-rows', 'Rows of two, three and two', 'Seven photos in three rows.', rowsOf([2, 3, 2])),
  collage('8-rows', 'Rows of three, two and three', 'Eight photos in three rows.', rowsOf([3, 2, 3])),
  collage('8-grid-wide', 'Eight grid, four across', 'Eight photos in two rows of four.', rowsOf([4, 4])),
  collage('8-grid-tall', 'Eight grid, two across', 'Eight photos in four rows of two.', rowsOf([2, 2, 2, 2])),
  collage('9-grid', 'Nine grid', 'Nine photos in an even 3 × 3 grid.', rowsOf([3, 3, 3])),
  collage('9-hero', 'Hero + eight', 'A large photo in the top left corner of a grid of four by three.', heroGrid(4, 3)),
  collage('9-rows', 'Rows of four, two and three', 'Nine photos in three rows.', rowsOf([4, 2, 3])),
];

/** the book layouts that suit a collage: photos only, no text, map or collection entries, two photos or more */
const isCollageBookLayout = (layout: BookLayout) =>
  layout.slots.length >= MIN_COLLAGE_PHOTOS &&
  layout.text.length === 0 &&
  !layout.map &&
  !layout.collection &&
  !layout.fullBleed;

export const collageLayouts: readonly BookLayout[] = [
  ...bookLayouts.filter((layout) => isCollageBookLayout(layout)),
  ...collageOnlyLayouts,
];

const collageLayoutMap = new Map(collageLayouts.map((layout) => [layout.id, layout]));

export const getCollageLayout = (id: string): BookLayout | undefined => {
  const layout = collageLayoutMap.get(id) ?? getLayout(id);
  return layout && isCollageBookLayout(layout) ? layout : undefined;
};

export const getCollageLayoutsFor = (count: number) => collageLayouts.filter((layout) => layout.slots.length === count);

/** the id of the layout a collage with a title is drawn with, see `withTitle` */
const TITLE_SUFFIX = '+title';

/**
 * The layout with a band for the title at the foot of the page: the photos are squeezed into the rest, and the band is
 * about two lines of the style's title font high
 */
export const withTitle = (layout: BookLayout, size: PageSize, style: Required<BookStyle>): BookLayout => {
  const contentHeightMm = size.pageHeightMm - 2 * style.marginMm;
  const titleMm = ((style.titleSizePt * 25.4) / 72) * 1.9;
  const band = Math.min(0.3, Math.max(0.08, titleMm / Math.max(1, contentHeightMm)));
  return {
    ...layout,
    id: `${layout.id}${TITLE_SUFFIX}`,
    slots: layout.slots.map((slot) => ({ ...slot, y: slot.y * (1 - band), height: slot.height * (1 - band) })),
    text: [{ kind: 'title', x: 0, y: 1 - band, width: 1, height: band, align: 'center' }],
  };
};

export type CollagePhoto = {
  id: string;
  /** size as displayed (orientation applied) */
  width: number;
  height: number;
  /** face boxes, normalized to 0..1 */
  faces: NormalizedRect[];
};

export type CollageChoice = {
  layout: BookLayout;
  /** the photo in each slot */
  order: CollagePhoto[];
  crops: NormalizedRect[];
  cost: number;
};

/** exhaustive orders up to this many photos; more are placed by orientation and improved by swaps */
const MAX_PERMUTED = 5;

const permutations = <T>(items: T[]): T[][] =>
  items.length <= 1
    ? [items]
    : items.flatMap((item, i) =>
        permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
      );

const aspectOf = (photo: CollagePhoto) => (photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1);

/**
 * Fits the photos into the slots of every layout for their count and ranks the layouts, best first. A photo costs what
 * its crop to the slot loses (more when it cuts a face), as in the book's automatic layout, so that portrait photos go
 * into tall slots and landscapes into wide ones; the aspect ratio of the page changes the shapes of the slots, and with
 * them the ranking.
 */
export const rankCollageLayouts = (
  photos: CollagePhoto[],
  size: PageSize,
  style: Required<BookStyle>,
  options: { title?: boolean } = {},
): CollageChoice[] => {
  const crops = new Map<string, ReturnType<typeof getSmartCrop>>();
  const getCrop = (photo: CollagePhoto, aspect: number) => {
    const key = `${photo.id}:${aspect.toFixed(4)}`;
    let crop = crops.get(key);
    if (!crop) {
      crop = getSmartCrop(photo, photo.faces, aspect);
      crops.set(key, crop);
    }
    return crop;
  };

  const choices: CollageChoice[] = [];
  for (const base of getCollageLayoutsFor(photos.length)) {
    const layout = options.title ? withTitle(base, size, style) : base;
    const shapes = getSlotRectsMm(layout, size, style).map((rect, index) => ({
      aspect: rect.height > 0 ? rect.width / rect.height : 1,
      area: layout.slots[index].width * layout.slots[index].height,
    }));
    const slotCost = (photo: CollagePhoto, index: number) => {
      const crop = getCrop(photo, shapes[index].aspect);
      // a crop that loses much of a small slot matters less than one that loses much of the hero
      return (3 * (1 - crop.kept) + 0.5 * crop.droppedFaces + (crop.feasible ? 0 : 2)) * (0.5 + shapes[index].area);
    };
    const costOf = (order: CollagePhoto[]) => order.reduce((sum, photo, index) => sum + slotCost(photo, index), 0);

    let best: { order: CollagePhoto[]; cost: number };
    if (photos.length <= MAX_PERMUTED) {
      best = { order: photos, cost: Infinity };
      for (const order of permutations(photos)) {
        const cost = costOf(order);
        if (cost < best.cost - 1e-9) {
          best = { order, cost };
        }
      }
    } else {
      // the widest photos in the widest slots, then swaps while they help
      const slotsByAspect = shapes.map((shape, index) => ({ ...shape, index })).toSorted((a, b) => a.aspect - b.aspect);
      const photosByAspect = photos.toSorted((a, b) => aspectOf(a) - aspectOf(b));
      const order: CollagePhoto[] = Array.from({ length: photos.length });
      for (const [rank, slot] of slotsByAspect.entries()) {
        order[slot.index] = photosByAspect[rank];
      }
      const swap = (i: number, j: number) => {
        const photo = order[i];
        order[i] = order[j];
        order[j] = photo;
      };
      let cost = costOf(order);
      for (let improved = true; improved;) {
        improved = false;
        for (let i = 0; i < order.length; i++) {
          for (let j = i + 1; j < order.length; j++) {
            swap(i, j);
            const next = costOf(order);
            if (next < cost - 1e-9) {
              cost = next;
              improved = true;
            } else {
              swap(i, j);
            }
          }
        }
      }
      best = { order, cost };
    }

    choices.push({
      layout,
      order: best.order,
      crops: best.order.map((photo, index) => getCrop(photo, shapes[index].aspect).crop),
      cost: best.cost,
    });
  }

  return choices.toSorted((a, b) => a.cost - b.cost);
};

/** the layout of a collage: the chosen one (when it fits the number of photos), or else the best */
export const chooseCollageLayout = (
  photos: CollagePhoto[],
  size: PageSize,
  style: Required<BookStyle>,
  options: { title?: boolean; layout?: string } = {},
) => {
  const choices = rankCollageLayouts(photos, size, style, options);
  const requested = options.layout?.replace(TITLE_SUFFIX, '');
  const chosen =
    (requested && choices.find(({ layout }) => layout.id.replace(TITLE_SUFFIX, '') === requested)) || choices[0];
  return { chosen, choices };
};

/** the id of a layout without the title band, as the user chose it */
export const getBaseLayoutId = (layout: BookLayout) => layout.id.replace(TITLE_SUFFIX, '');

/** the title of a collage, a tag name part: its title, or else the dates of its photos */
export const getCollageName = (title: string | undefined, dates: string) =>
  (title?.trim() || dates).replaceAll('/', '-').trim() || 'Collage';
