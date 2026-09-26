import type { BookStyle } from 'src/dtos/book.dto.js';

export type LayoutRect = { x: number; y: number; width: number; height: number };

/** `slotCaption` is the caption of one photo (`slot`), e.g. the name of a dish, drawn beside the photo instead of on it */
export type LayoutTextKind = 'title' | 'subtitle' | 'sectionTitle' | 'caption' | 'slotCaption';

export type LayoutTextArea = LayoutRect & {
  kind: LayoutTextKind;
  align: 'left' | 'center' | 'right';
  /** zero-based slot of a `slotCaption` area */
  slot?: number;
};

export type LayoutOrientation = 'any' | 'landscape' | 'portrait';

export type BookLayout = {
  id: string;
  name: string;
  /** shown to the agent when it chooses a layout */
  description: string;
  /** photo slots, normalized to the content box inside the margins (or the whole page for full-bleed layouts) */
  slots: LayoutRect[];
  text: LayoutTextArea[];
  /** orientation of the photos that fit the (first) slot best on a square page */
  orientation: LayoutOrientation;
  fullBleed?: boolean;
  /** area of the page map, normalized like the slots */
  map?: LayoutRect;
  /**
   * made for collection books (e.g. food books): source pages (the menu) and entries (dishes) with their names; the
   * automatic layout uses it only there
   */
  collection?: boolean;
};

export type PageSize = { pageWidthMm: number; pageHeightMm: number };

const third = 1 / 3;

export const bookLayouts: readonly BookLayout[] = [
  {
    id: 'cover',
    name: 'Cover',
    description: 'Book cover: one large photo with the book title and subtitle below it. Use it for page 1.',
    slots: [{ x: 0, y: 0, width: 1, height: 0.78 }],
    text: [
      { kind: 'title', x: 0, y: 0.78, width: 1, height: 0.14, align: 'center' },
      { kind: 'subtitle', x: 0, y: 0.92, width: 1, height: 0.08, align: 'center' },
    ],
    orientation: 'landscape',
  },
  {
    id: 'full-bleed',
    name: 'Full bleed',
    description: 'One photo covering the whole page edge to edge, ignoring the margins. Best for strong landscapes.',
    slots: [{ x: 0, y: 0, width: 1, height: 1 }],
    text: [],
    orientation: 'any',
    fullBleed: true,
  },
  {
    id: 'single',
    name: 'Single',
    description: 'One photo filling the area inside the margins.',
    slots: [{ x: 0, y: 0, width: 1, height: 1 }],
    text: [],
    orientation: 'any',
  },
  {
    id: 'two-horizontal',
    name: 'Two side by side',
    description: 'Two photos side by side (left and right), each tall and narrow. Best for two portrait photos.',
    slots: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
    text: [],
    orientation: 'portrait',
  },
  {
    id: 'two-vertical',
    name: 'Two stacked',
    description: 'Two photos stacked (top and bottom), each wide. Best for two landscape photos.',
    slots: [
      { x: 0, y: 0, width: 1, height: 0.5 },
      { x: 0, y: 0.5, width: 1, height: 0.5 },
    ],
    text: [],
    orientation: 'landscape',
  },
  {
    id: 'three-row',
    name: 'Three in a row',
    description: 'Three portrait photos in a row across the middle of the page, with a caption area below.',
    slots: [
      { x: 0, y: 0.2, width: third, height: 0.55 },
      { x: third, y: 0.2, width: third, height: 0.55 },
      { x: 2 * third, y: 0.2, width: third, height: 0.55 },
    ],
    text: [{ kind: 'caption', x: 0, y: 0.8, width: 1, height: 0.12, align: 'center' }],
    orientation: 'portrait',
  },
  {
    id: 'hero-left-two',
    name: 'Hero left + two',
    description: 'A large portrait hero photo on the left (slot 1) and two smaller photos stacked on the right.',
    slots: [
      { x: 0, y: 0, width: 0.62, height: 1 },
      { x: 0.62, y: 0, width: 0.38, height: 0.5 },
      { x: 0.62, y: 0.5, width: 0.38, height: 0.5 },
    ],
    text: [],
    orientation: 'portrait',
  },
  {
    id: 'hero-top-two',
    name: 'Hero top + two',
    description: 'A large landscape hero photo on top (slot 1) and two smaller photos side by side below it.',
    slots: [
      { x: 0, y: 0, width: 1, height: 0.62 },
      { x: 0, y: 0.62, width: 0.5, height: 0.38 },
      { x: 0.5, y: 0.62, width: 0.5, height: 0.38 },
    ],
    text: [],
    orientation: 'landscape',
  },
  {
    id: 'four-grid',
    name: 'Four grid',
    description: 'Four photos in an even 2×2 grid.',
    slots: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ],
    text: [],
    orientation: 'any',
  },
  {
    id: 'hero-three',
    name: 'Hero + three',
    description: 'A large landscape hero photo on top (slot 1) and a row of three smaller photos below it.',
    slots: [
      { x: 0, y: 0, width: 1, height: 0.6 },
      { x: 0, y: 0.6, width: third, height: 0.4 },
      { x: third, y: 0.6, width: third, height: 0.4 },
      { x: 2 * third, y: 0.6, width: third, height: 0.4 },
    ],
    text: [],
    orientation: 'landscape',
  },
  {
    id: 'six-grid',
    name: 'Six grid',
    description: 'Six photos in a grid of two columns and three rows. Good for a dense sequence of moments.',
    slots: [
      { x: 0, y: 0, width: 0.5, height: third },
      { x: 0.5, y: 0, width: 0.5, height: third },
      { x: 0, y: third, width: 0.5, height: third },
      { x: 0.5, y: third, width: 0.5, height: third },
      { x: 0, y: 2 * third, width: 0.5, height: third },
      { x: 0.5, y: 2 * third, width: 0.5, height: third },
    ],
    text: [],
    orientation: 'landscape',
  },
  {
    id: 'section-opener',
    name: 'Section opener',
    description: 'Opens a chapter: a large section title at the top and one photo below it. Set the sectionTitle.',
    slots: [{ x: 0, y: 0.28, width: 1, height: 0.72 }],
    text: [{ kind: 'sectionTitle', x: 0, y: 0.04, width: 1, height: 0.24, align: 'center' }],
    orientation: 'landscape',
  },
  {
    id: 'map',
    name: 'Map',
    description:
      'A full-page map of the places of the section that follows it (or of chosen photos), with the route and an ' +
      'optional title. Opens a chapter of a trip.',
    slots: [],
    text: [],
    orientation: 'any',
    map: { x: 0, y: 0, width: 1, height: 1 },
  },
  {
    id: 'map-photo',
    name: 'Map + photo',
    description:
      'A map on the top two thirds of the page, with one landscape photo (slot 1), the section title and the ' +
      'caption below it. Opens a chapter of a trip.',
    slots: [{ x: 0, y: 0.66, width: 0.5, height: 0.34 }],
    text: [
      { kind: 'sectionTitle', x: 0.53, y: 0.68, width: 0.47, height: 0.14, align: 'left' },
      { kind: 'caption', x: 0.53, y: 0.82, width: 0.47, height: 0.16, align: 'left' },
    ],
    orientation: 'landscape',
    map: { x: 0, y: 0, width: 1, height: 0.66 },
  },
  {
    id: 'text',
    name: 'Text',
    description: 'A text-only page: an optional section title and the page caption (e.g. an introduction or a story).',
    slots: [],
    text: [
      { kind: 'sectionTitle', x: 0.1, y: 0.15, width: 0.8, height: 0.15, align: 'center' },
      { kind: 'caption', x: 0.1, y: 0.33, width: 0.8, height: 0.5, align: 'center' },
    ],
    orientation: 'any',
  },
  {
    id: 'menu',
    name: 'Menu',
    description:
      'Opens a restaurant chapter with its menu (or the chapter of any visit with its printed page: a wall label, a ' +
      'recipe card): a large portrait photo of the page (slot 1), kept whole enough to read, with the section title ' +
      'and the caption (e.g. the dishes that follow) beside it. Alias: source-page.',
    slots: [{ x: 0, y: 0.07, width: 0.64, height: 0.86 }],
    text: [
      { kind: 'sectionTitle', x: 0.67, y: 0.07, width: 0.33, height: 0.4, align: 'center' },
      { kind: 'caption', x: 0.67, y: 0.49, width: 0.33, height: 0.44, align: 'center' },
    ],
    orientation: 'portrait',
    collection: true,
  },
  {
    id: 'menu-wide',
    name: 'Menu (wide)',
    description:
      'Opens a restaurant chapter with a landscape photo of its menu (slot 1, e.g. a blackboard; or of the printed ' +
      'page of any visit) between the section title and the caption. Alias: source-page-wide.',
    slots: [{ x: 0.05, y: 0.22, width: 0.9, height: 0.62 }],
    text: [
      { kind: 'sectionTitle', x: 0, y: 0, width: 1, height: 0.2, align: 'center' },
      { kind: 'caption', x: 0, y: 0.86, width: 1, height: 0.14, align: 'center' },
    ],
    orientation: 'landscape',
    collection: true,
  },
  {
    id: 'recipe',
    name: 'Recipe',
    description:
      'Opens a recipe chapter (or any visit whose source text is typeset): the photo of the recipe card or page ' +
      '(slot 1) beside the section title, and the caption below them typeset as a recipe: an optional first line ' +
      'of meta (serves, times), then blocks under headings that end with a colon ("Ingredients:", one line per ' +
      'ingredient; "Method:", numbered steps "1. ..."; a sub-recipe such as "Frosting:"), separated by blank lines.',
    slots: [{ x: 0, y: 0, width: 0.56, height: 0.38 }],
    text: [
      { kind: 'sectionTitle', x: 0.59, y: 0, width: 0.41, height: 0.38, align: 'center' },
      { kind: 'caption', x: 0, y: 0.41, width: 1, height: 0.59, align: 'left' },
    ],
    orientation: 'landscape',
    collection: true,
  },
  {
    id: 'dish-opener',
    name: 'Dish opener',
    description:
      'Opens a restaurant chapter that has no menu photo (or any visit without its printed page): the section ' +
      'title, one dish or entry (slot 1) and its name below it. Alias: entry-opener.',
    slots: [{ x: 0, y: 0.2, width: 1, height: 0.66 }],
    text: [
      { kind: 'sectionTitle', x: 0, y: 0, width: 1, height: 0.2, align: 'center' },
      { kind: 'slotCaption', slot: 0, x: 0, y: 0.86, width: 1, height: 0.14, align: 'center' },
    ],
    orientation: 'landscape',
    collection: true,
  },
  {
    id: 'dish',
    name: 'Dish',
    description: 'One dish on its own page, with its name (the slot caption) below the photo.',
    slots: [{ x: 0, y: 0, width: 1, height: 0.8 }],
    text: [{ kind: 'slotCaption', slot: 0, x: 0, y: 0.8, width: 1, height: 0.2, align: 'center' }],
    orientation: 'landscape',
    collection: true,
  },
  {
    id: 'dish-portrait',
    name: 'Dish, portrait',
    description: 'One portrait dish on the left (slot 1), with its name (the slot caption) beside it, like a magazine.',
    slots: [{ x: 0, y: 0.04, width: 0.64, height: 0.92 }],
    text: [{ kind: 'slotCaption', slot: 0, x: 0.67, y: 0.36, width: 0.33, height: 0.28, align: 'left' }],
    orientation: 'portrait',
    collection: true,
  },
  {
    id: 'dish-pair',
    name: 'Two dishes',
    description: 'Two dishes side by side in near-square slots, each with its name (the slot caption) below it.',
    slots: [
      { x: 0, y: 0.14, width: 0.5, height: 0.56 },
      { x: 0.5, y: 0.14, width: 0.5, height: 0.56 },
    ],
    text: [
      { kind: 'slotCaption', slot: 0, x: 0, y: 0.7, width: 0.5, height: 0.15, align: 'center' },
      { kind: 'slotCaption', slot: 1, x: 0.5, y: 0.7, width: 0.5, height: 0.15, align: 'center' },
    ],
    orientation: 'any',
    collection: true,
  },
  {
    id: 'dish-pair-stacked',
    name: 'Two dishes, staggered',
    description:
      'Two landscape dishes in staggered rows, like a magazine: slot 1 top left with its name to the right, slot 2 ' +
      'bottom right with its name to the left.',
    slots: [
      { x: 0, y: 0, width: 0.66, height: 0.5 },
      { x: 0.34, y: 0.5, width: 0.66, height: 0.5 },
    ],
    text: [
      { kind: 'slotCaption', slot: 0, x: 0.68, y: 0.14, width: 0.32, height: 0.22, align: 'left' },
      { kind: 'slotCaption', slot: 1, x: 0, y: 0.64, width: 0.32, height: 0.22, align: 'right' },
    ],
    orientation: 'landscape',
    collection: true,
  },
  {
    id: 'dish-list',
    name: 'Three dishes, listed',
    description:
      'Three landscape dishes in rows like the lines of a menu: each photo on the left (slots 1 to 3) with its name ' +
      '(the slot caption) beside it.',
    slots: [
      { x: 0, y: 0, width: 0.52, height: third },
      { x: 0, y: third, width: 0.52, height: third },
      { x: 0, y: 2 * third, width: 0.52, height: third },
    ],
    text: [
      { kind: 'slotCaption', slot: 0, x: 0.56, y: 0.04, width: 0.44, height: third - 0.08, align: 'left' },
      { kind: 'slotCaption', slot: 1, x: 0.56, y: third + 0.04, width: 0.44, height: third - 0.08, align: 'left' },
      { kind: 'slotCaption', slot: 2, x: 0.56, y: 2 * third + 0.04, width: 0.44, height: third - 0.08, align: 'left' },
    ],
    orientation: 'landscape',
    collection: true,
  },
  {
    id: 'dish-trio',
    name: 'Three dishes',
    description: 'Three dishes in a row of near-square slots, each with its name (the slot caption) below it.',
    slots: [
      { x: 0, y: 0.24, width: third, height: 0.37 },
      { x: third, y: 0.24, width: third, height: 0.37 },
      { x: 2 * third, y: 0.24, width: third, height: 0.37 },
    ],
    text: [
      { kind: 'slotCaption', slot: 0, x: 0, y: 0.61, width: third, height: 0.17, align: 'center' },
      { kind: 'slotCaption', slot: 1, x: third, y: 0.61, width: third, height: 0.17, align: 'center' },
      { kind: 'slotCaption', slot: 2, x: 2 * third, y: 0.61, width: third, height: 0.17, align: 'center' },
    ],
    orientation: 'any',
    collection: true,
  },
];

const layoutMap = new Map(bookLayouts.map((layout) => [layout.id, layout]));

export const layoutIds = bookLayouts.map((layout) => layout.id);

/**
 * Other names of layouts, for the collections of any pack: the menu layouts show any printed source page (a wall
 * label, a recipe card), and the dish opener any entry. Books store the layouts under their own ids, never these.
 */
export const LAYOUT_ALIASES: ReadonlyMap<string, string> = new Map([
  ['source-page', 'menu'],
  ['source-page-wide', 'menu-wide'],
  ['entry-opener', 'dish-opener'],
]);

/** the layout of an id or an alias; its `id` is the one to store */
export const getLayout = (id: string): BookLayout | undefined => layoutMap.get(LAYOUT_ALIASES.get(id) ?? id);

export const mmToPx = (mm: number, dpi: number) => (mm * dpi) / 25.4;

export const mmToPt = (mm: number) => (mm * 72) / 25.4;

const EPSILON = 1e-6;

/** The area the layout is placed in, in millimeters */
export const getLayoutBox = (layout: BookLayout, size: PageSize, style: BookStyle): LayoutRect => {
  if (layout.fullBleed) {
    return { x: 0, y: 0, width: size.pageWidthMm, height: size.pageHeightMm };
  }

  const margin = style.marginMm;
  return { x: margin, y: margin, width: size.pageWidthMm - 2 * margin, height: size.pageHeightMm - 2 * margin };
};

/** Maps a normalized layout rect into the box, leaving half a gutter on every edge that borders another area */
const placeRect = (rect: LayoutRect, box: LayoutRect, gutter: number): LayoutRect => {
  const half = gutter / 2;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  const x1 = box.x + rect.x * box.width + (rect.x > EPSILON ? half : 0);
  const y1 = box.y + rect.y * box.height + (rect.y > EPSILON ? half : 0);
  const x2 = box.x + right * box.width - (right < 1 - EPSILON ? half : 0);
  const y2 = box.y + bottom * box.height - (bottom < 1 - EPSILON ? half : 0);

  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
};

/** Slot rectangles in millimeters, with margins and gutters applied */
export const getSlotRectsMm = (layout: BookLayout, size: PageSize, style: BookStyle): LayoutRect[] => {
  const box = getLayoutBox(layout, size, style);
  return layout.slots.map((slot) => placeRect(slot, box, style.gutterMm));
};

/** Text areas in millimeters, with margins and gutters applied */
export const getTextRectsMm = (layout: BookLayout, size: PageSize, style: BookStyle): LayoutTextArea[] => {
  const box = getLayoutBox(layout, size, style);
  return layout.text.map((area) => ({ ...area, ...placeRect(area, box, style.gutterMm) }));
};

/** The map area in millimeters, with margins and gutters applied */
export const getMapRectMm = (layout: BookLayout, size: PageSize, style: BookStyle): LayoutRect | null =>
  layout.map ? placeRect(layout.map, getLayoutBox(layout, size, style), style.gutterMm) : null;

export const isMapLayout = (id: string) => !!getLayout(id)?.map;

/** width / height of every slot of the layout on a page of the given size and style */
export const getSlotAspectRatios = (layout: BookLayout, size: PageSize, style: BookStyle): number[] =>
  getSlotRectsMm(layout, size, style).map((rect) => (rect.height > 0 ? rect.width / rect.height : 1));

export type PxRect = { left: number; top: number; width: number; height: number };

/** Converts a rect in millimeters to whole pixels, so that adjacent rects keep an exact gutter */
export const toPxRect = (rect: LayoutRect, dpi: number): PxRect => {
  const left = Math.round(mmToPx(rect.x, dpi));
  const top = Math.round(mmToPx(rect.y, dpi));
  const right = Math.round(mmToPx(rect.x + rect.width, dpi));
  const bottom = Math.round(mmToPx(rect.y + rect.height, dpi));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
};

/** Returns an error message when the margins and gutters leave no usable space on the page */
export const validatePageStyle = (size: PageSize, style: BookStyle): string | null => {
  const shortSide = Math.min(size.pageWidthMm, size.pageHeightMm);
  // the densest layout has three slots along one side
  if (2 * style.marginMm + 2 * style.gutterMm + 30 > shortSide) {
    return `Margins (${style.marginMm}mm) and gutters (${style.gutterMm}mm) are too large for a ${size.pageWidthMm}×${size.pageHeightMm}mm page`;
  }
  return null;
};
