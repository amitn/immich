import type { BookStyle } from 'src/dtos/book.dto.js';
import type { BookMapLook, BookMapLookOption } from 'src/utils/book/map-styles.js';
import { getFontStack } from 'src/utils/book/fonts.js';
import { fromHex, rgbToHsl, toHex, withContrast } from 'src/utils/book/palette.js';

/**
 * The looks of styled maps: how the real map data (water, land, roads, places) is drawn, derived from the colours and
 * fonts of the book's style.
 */
export { bookMapLooks } from 'src/utils/book/map-styles.js';
export type { BookMapLook, BookMapLookOption } from 'src/utils/book/map-styles.js';

export const bookMapLookNames: Record<BookMapLook, string> = {
  wash: 'Watercolor wash',
  engraved: 'Engraved atlas',
  minimal: 'Minimal',
  vintage: 'Vintage chart',
};

type Fill = { color: string; opacity: number };
type Line = { color: string; width: number; opacity: number; dash?: number[] };

/** the route, the pins and the title cartouche drawn over the map */
export type MapOverlayTheme = {
  route: string;
  routeShadow: string;
  /** a dashed route (the sketch and the charts) or a solid one */
  routeDash: boolean;
  pin: string;
  pinStroke: string;
  /** the number in the head of a pin */
  pinText: string;
  label: string;
  halo: string;
  ink: string;
  /** the font of the place names of the photos */
  labelFont: string;
  italic: boolean;
  cartouche: { fill: string; stroke: string; text: string; italic: boolean; upper: boolean };
};

export type MapLook = {
  id: BookMapLook;
  /** the paper around the map and under the land */
  paper: string;
  land: string;
  sea: Fill;
  /** the coastline and the banks of lakes */
  coast: Line;
  /** water lines along the coast, in the sea: distance between lines in design pixels and their count */
  waterLines?: Line & { spacing: number; count: number };
  /** a band of deeper water colour along the coast, fading out to sea */
  coastBand?: Fill & { width: number };
  /** the edge of the water, darker as in a watercolour wash */
  pigmentEdge?: Line;
  river: Line;
  park: Fill;
  forest: Fill;
  farmland: Fill;
  urban: Fill;
  sand: Fill;
  /** parks and forests are hatched instead of washed */
  hatch?: Line & { spacing: number };
  buildings?: Fill & { stroke?: Line };
  roads: {
    highway: Line;
    major: Line;
    minor: Line;
    path?: Line;
    /** a casing drawn under the major roads (engraved: double lines) */
    casing?: Line;
  };
  rail: Line;
  boundary: Line;
  labels: {
    font: string;
    color: string;
    halo: string;
    water: string;
    /** towns and cities in capitals, letter-spaced */
    upperCities: boolean;
    italicWater: boolean;
    /** the size of a city label, in design pixels (a thousandth of the shorter side) */
    size: number;
  };
  /** hand-drawn edges: the displacement of the land and water, in design pixels */
  wobble?: number;
  grain: boolean;
  vignette: boolean;
  graticule?: Line;
  compass: 'simple' | 'rose' | 'arrow';
  frame: 'none' | 'rule' | 'double' | 'neatline';
  overlay: MapOverlayTheme;
};

const lightness = (hex: string) => rgbToHsl(fromHex(hex))[2];
const saturation = (hex: string) => rgbToHsl(fromHex(hex))[1];

/** a mix of two colours, `amount` of the second */
export const mix = (a: string, b: string, amount: number) => {
  const [ra, ga, ba] = fromHex(a);
  const [rb, gb, bb] = fromHex(b);
  return toHex([ra + (rb - ra) * amount, ga + (gb - ga) * amount, ba + (bb - ba) * amount]);
};

const isSans = (fontFamily: string) =>
  /sans-serif|helvetica|arial|inter|roboto|dejavu sans|noto sans|liberation sans/i.test(fontFamily) &&
  !/(^|,)\s*serif\s*(,|$)/i.test(fontFamily);

/** a light page whose paper is warm (cream, ivory), not white */
const isWarmPaper = (hex: string) => {
  const [r, , b] = fromHex(hex);
  return lightness(hex) > 0.75 && r - b >= 8;
};

/**
 * The look a book's style asks for: the gallery theme is minimal, the travel theme a vintage chart, the wine theme an
 * engraved atlas, and food and cookbooks a watercolour wash; other styles by their paper and font (a sans-serif font
 * or a dark page is minimal, warm paper a wash, and white paper with a serif font an engraved atlas)
 */
export const resolveMapLook = (style: Required<BookStyle>, option?: BookMapLookOption | null): BookMapLook => {
  if (option && option !== 'auto') {
    return option;
  }
  switch (style.theme) {
    case 'gallery': {
      return 'minimal';
    }
    case 'travel': {
      return 'vintage';
    }
    case 'wine': {
      return 'engraved';
    }
    case 'food':
    case 'cookbook': {
      return 'wash';
    }
  }
  if (lightness(style.background) < 0.35 || isSans(style.fontFamily)) {
    return 'minimal';
  }
  return isWarmPaper(style.background) ? 'wash' : 'engraved';
};

/** the accent of the style, unless it is as grey as the text (then a warm red that reads as a route) */
const getRouteColor = (style: Required<BookStyle>, fallback: string) => {
  const accent = style.accentColor;
  return saturation(accent) < 0.25 || accent.toLowerCase() === style.textColor.toLowerCase() ? fallback : accent;
};

const washLook = (style: Required<BookStyle>): MapLook => {
  const paper = isWarmPaper(style.background) ? style.background : '#f6f0e2';
  const ink = withContrast(mix(style.textColor, '#6b5a45', 0.4), paper, 5);
  const route = withContrast(getRouteColor(style, '#b5452f'), paper, 3.5);
  const serif = getFontStack(style.fontFamily);
  return {
    id: 'wash',
    paper,
    land: paper,
    sea: { color: '#8fb8cc', opacity: 0.55 },
    coast: { color: '#5f8ea6', width: 1.1, opacity: 0.45 },
    pigmentEdge: { color: '#4f86a3', width: 5, opacity: 0.22 },
    river: { color: '#7eaec6', width: 2.2, opacity: 0.7 },
    park: { color: '#9dbb7c', opacity: 0.42 },
    forest: { color: '#7fa06a', opacity: 0.4 },
    farmland: { color: '#d8c98f', opacity: 0.28 },
    urban: { color: '#d7b99a', opacity: 0.3 },
    sand: { color: '#ead9a8', opacity: 0.55 },
    buildings: { color: '#c9a88a', opacity: 0.32 },
    roads: {
      highway: { color: '#b98a64', width: 2.8, opacity: 0.7 },
      major: { color: '#a58767', width: 1.8, opacity: 0.65 },
      minor: { color: '#9b8a75', width: 0.85, opacity: 0.5 },
      path: { color: '#9b8a75', width: 0.7, opacity: 0.45, dash: [3, 2.5] },
    },
    rail: { color: '#7a6a58', width: 1, opacity: 0.6, dash: [5, 3] },
    boundary: { color: '#a07b8f', width: 1.4, opacity: 0.5, dash: [8, 4] },
    labels: {
      font: serif,
      color: ink,
      halo: paper,
      water: '#46738c',
      upperCities: false,
      italicWater: true,
      size: 24,
    },
    wobble: 3.5,
    grain: true,
    vignette: true,
    compass: 'simple',
    frame: 'none',
    overlay: {
      route,
      routeShadow: paper,
      routeDash: false,
      pin: route,
      pinStroke: '#fffaf0',
      pinText: '#fffaf0',
      label: ink,
      halo: paper,
      ink,
      labelFont: serif,
      italic: true,
      cartouche: { fill: paper, stroke: ink, text: ink, italic: true, upper: false },
    },
  };
};

const engravedLook = (style: Required<BookStyle>): MapLook => {
  const ink = '#3b2f22';
  const paper = '#f3ead6';
  const route = withContrast(getRouteColor(style, '#8e2b20'), paper, 4);
  const serif = getFontStack(isSans(style.fontFamily) ? 'serif' : style.fontFamily);
  return {
    id: 'engraved',
    paper,
    land: '#efe3c5',
    sea: { color: '#f6f0e1', opacity: 1 },
    coast: { color: ink, width: 1.3, opacity: 0.9 },
    waterLines: { color: '#5b4a36', width: 0.6, opacity: 0.55, spacing: 5.5, count: 6 },
    river: { color: '#5b4a36', width: 1.3, opacity: 0.75 },
    park: { color: '#dccc9f', opacity: 0.5 },
    forest: { color: '#d3c291', opacity: 0.45 },
    farmland: { color: '#e5d4ad', opacity: 0.5 },
    urban: { color: '#e0c9a4', opacity: 0.55 },
    sand: { color: '#f1e6c8', opacity: 0.8 },
    hatch: { color: '#6d5a40', width: 0.5, opacity: 0.32, spacing: 4.5 },
    buildings: { color: '#d8c39c', opacity: 0.7, stroke: { color: ink, width: 0.3, opacity: 0.4 } },
    roads: {
      highway: { color: '#fbf6ea', width: 3, opacity: 1 },
      major: { color: '#fbf6ea', width: 2.2, opacity: 1 },
      minor: { color: ink, width: 0.6, opacity: 0.65 },
      path: { color: ink, width: 0.45, opacity: 0.45, dash: [2, 2] },
      casing: { color: ink, width: 1.2, opacity: 0.85 },
    },
    rail: { color: ink, width: 1.1, opacity: 0.8, dash: [6, 3] },
    boundary: { color: ink, width: 1, opacity: 0.55, dash: [6, 2, 1.5, 2] },
    labels: {
      font: serif,
      color: ink,
      halo: '#f3ead6',
      water: '#4e4232',
      upperCities: true,
      italicWater: true,
      size: 22,
    },
    grain: true,
    vignette: true,
    graticule: { color: ink, width: 0.5, opacity: 0.25 },
    compass: 'rose',
    frame: 'double',
    overlay: {
      route,
      routeShadow: '#fbf6ea',
      routeDash: true,
      pin: route,
      pinStroke: '#fbf6ea',
      pinText: '#fbf6ea',
      label: ink,
      halo: '#f3ead6',
      ink,
      labelFont: serif,
      italic: true,
      cartouche: { fill: '#f7f0df', stroke: ink, text: ink, italic: false, upper: true },
    },
  };
};

const minimalLook = (style: Required<BookStyle>): MapLook => {
  const dark = lightness(style.background) < 0.35;
  const paper = style.background;
  const text = withContrast(style.textColor, paper, 7);
  const grey = (amount: number) => mix(paper, text, amount);
  const sans = getFontStack(isSans(style.fontFamily) ? style.fontFamily : 'sans-serif');
  const route = withContrast(getRouteColor(style, text), paper, 4.5);
  return {
    id: 'minimal',
    paper,
    land: paper,
    sea: { color: mix(grey(dark ? 0.16 : 0.13), '#8fa3b0', dark ? 0.15 : 0.25), opacity: 1 },
    coast: { color: grey(0.38), width: 0.7, opacity: 1 },
    river: { color: mix(grey(0.2), '#8fa3b0', 0.25), width: 1.4, opacity: 1 },
    park: { color: grey(0.04), opacity: 1 },
    forest: { color: grey(0.045), opacity: 1 },
    farmland: { color: paper, opacity: 0 },
    urban: { color: grey(0.025), opacity: 1 },
    sand: { color: grey(0.02), opacity: 1 },
    buildings: { color: grey(0.06), opacity: 1 },
    roads: {
      highway: { color: grey(0.36), width: 1.7, opacity: 1 },
      major: { color: grey(0.28), width: 1.2, opacity: 1 },
      minor: { color: grey(0.18), width: 0.7, opacity: 1 },
      path: { color: grey(0.15), width: 0.45, opacity: 1, dash: [2, 2] },
    },
    rail: { color: grey(0.3), width: 0.8, opacity: 1, dash: [4, 2] },
    boundary: { color: grey(0.3), width: 0.8, opacity: 1, dash: [4, 3] },
    labels: {
      font: sans,
      color: grey(0.7),
      halo: paper,
      water: grey(0.5),
      upperCities: true,
      italicWater: false,
      size: 18,
    },
    grain: false,
    vignette: false,
    compass: 'arrow',
    frame: 'none',
    overlay: {
      route,
      routeShadow: paper,
      routeDash: false,
      pin: route,
      pinStroke: paper,
      pinText: paper,
      label: text,
      halo: paper,
      ink: grey(0.6),
      labelFont: sans,
      italic: false,
      cartouche: { fill: paper, stroke: grey(0.3), text, italic: false, upper: true },
    },
  };
};

const vintageLook = (style: Required<BookStyle>): MapLook => {
  const paper = isWarmPaper(style.background) ? style.background : '#f4efe3';
  const navy = withContrast(style.theme === 'travel' ? style.textColor : '#1f2f4a', paper, 7);
  const red = withContrast(getRouteColor(style, '#b0412e'), paper, 3.5);
  const serif = getFontStack(isSans(style.fontFamily) ? 'serif' : style.fontFamily);
  return {
    id: 'vintage',
    paper,
    land: mix(paper, '#e2cfa3', 0.55),
    sea: { color: mix(paper, '#c9d8d3', 0.75), opacity: 1 },
    coast: { color: navy, width: 1.2, opacity: 0.85 },
    coastBand: { color: '#8fb0b4', opacity: 0.45, width: 26 },
    waterLines: { color: navy, width: 0.5, opacity: 0.3, spacing: 7, count: 3 },
    river: { color: mix(navy, '#6f9aa6', 0.5), width: 1.4, opacity: 0.8 },
    park: { color: '#c4c79a', opacity: 0.45 },
    forest: { color: '#b3b98a', opacity: 0.45 },
    farmland: { color: '#e4d3a4', opacity: 0.35 },
    urban: { color: '#d8bf98', opacity: 0.5 },
    sand: { color: '#efdfb4', opacity: 0.7 },
    buildings: { color: '#cdb48a', opacity: 0.55 },
    roads: {
      highway: { color: navy, width: 1.8, opacity: 0.75 },
      major: { color: navy, width: 1.3, opacity: 0.65 },
      minor: { color: navy, width: 0.6, opacity: 0.45 },
      path: { color: navy, width: 0.45, opacity: 0.35, dash: [2, 2] },
    },
    rail: { color: navy, width: 0.9, opacity: 0.6, dash: [5, 2] },
    boundary: { color: red, width: 1, opacity: 0.45, dash: [7, 3] },
    labels: {
      font: serif,
      color: navy,
      halo: paper,
      water: mix(navy, '#4d7384', 0.5),
      upperCities: true,
      italicWater: true,
      size: 22,
    },
    grain: true,
    vignette: true,
    graticule: { color: navy, width: 0.6, opacity: 0.35 },
    compass: 'rose',
    frame: 'neatline',
    overlay: {
      route: red,
      routeShadow: paper,
      routeDash: true,
      pin: red,
      pinStroke: paper,
      pinText: paper,
      label: navy,
      halo: paper,
      ink: navy,
      labelFont: serif,
      italic: true,
      cartouche: { fill: paper, stroke: navy, text: navy, italic: false, upper: true },
    },
  };
};

/** The look of a styled map, with the colours and fonts of the book's style */
export const getMapLook = (id: BookMapLook, style: Required<BookStyle>): MapLook => {
  switch (id) {
    case 'engraved': {
      return engravedLook(style);
    }
    case 'minimal': {
      return minimalLook(style);
    }
    case 'vintage': {
      return vintageLook(style);
    }
    default: {
      return washLook(style);
    }
  }
};
