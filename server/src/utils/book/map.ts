import { minBy } from 'lodash-es';
import { LRUMap } from 'mnemonist';
import sharp, { type Sharp } from 'sharp';
import type { BookMap, BookStyle } from 'src/dtos/book.dto.js';
import { getFontStack } from 'src/utils/book/fonts.js';
import { isMapLayout } from 'src/utils/book/layouts.js';
import { MapLook, getMapLook, resolveMapLook } from 'src/utils/book/map-looks.js';
import { TileStyle, getTileStyle } from 'src/utils/book/map-styles.js';
import { escapeXml } from 'src/utils/book/render.js';
import {
  getMapLabelCandidates,
  placeMapLabels,
  renderMapLabels,
  renderStyledBasemap,
  renderStyledFrame,
} from 'src/utils/book/styled-map.js';
import {
  MapFeature,
  TileKey,
  VectorTileSource,
  chooseVectorZoom,
  decodeVectorTile,
  getMapCredit,
  getTilePlacement,
  getTilesInView,
} from 'src/utils/book/vector-tiles.js';

export type MapPoint = { lat: number; lon: number; time: number; city?: string | null };

export type GeoBounds = { west: number; south: number; east: number; north: number };

/** a country polygon as rings of [lon, lat] */
export type CountryOutline = { name: string; rings: Array<Array<[number, number]>> };

/** the vector tiles of styled maps: where they come from, and how to load one (null for an empty tile) */
export type StyledMapSource = {
  source: VectorTileSource;
  getTile: (tile: TileKey) => Promise<Buffer | null>;
};

export type MapRenderContext = {
  /** locations to plot, in time order */
  points: MapPoint[];
  /** needed for the watercolor, toner and terrain styles */
  stadiaApiKey?: string;
  /**
   * the map data of styled maps (the tiles of Immich's own Map page); throws, with the reason, when styled maps are not
   * available (maps disabled, the style or the tiles cannot be loaded)
   */
  getStyledMapSource?: () => Promise<StyledMapSource>;
  /** the style of the book, whose colours and fonts styled maps are drawn with */
  style?: Required<BookStyle>;
  /** country outlines behind the route of long trips on sketch maps */
  getCountries?: (bounds: GeoBounds) => Promise<CountryOutline[]>;
  /** an illustrated version of the map, drawn instead of rendering one */
  illustrated?: string | Buffer | null;
  fontFamily?: string;
  fetch?: typeof fetch;
};

export type MapRenderPage = { map: BookMap | null; sectionTitle?: string | null };

export type MapRenderSize = { width: number; height: number; format?: 'jpeg' | 'png'; quality?: number };

export type MapRenderResult = {
  data: Buffer;
  /** what was drawn: the offline sketch, Stadia tiles, the styled map, or the illustrated map */
  source: 'sketch' | 'tiles' | 'styled' | 'illustrated';
  warnings: string[];
};

export const DEFAULT_MAP: BookMap = Object.freeze({ style: 'sketch', showRoute: true, labels: true });

/** the style of a book without one, for styled maps */
const DEFAULT_STYLED_BOOK_STYLE: Required<BookStyle> = Object.freeze({
  marginMm: 12,
  gutterMm: 4,
  background: '#ffffff',
  textColor: '#222222',
  fontFamily: 'serif',
  titleSizePt: 28,
  captionSizePt: 10,
  theme: 'plain',
  accentColor: '#222222',
});

export const MAP_ATTRIBUTION = '© Stadia Maps © Stamen Design © OpenStreetMap contributors';

const TILE_URL = 'https://tiles.stadiamaps.com/tiles';
/** @2x tiles are 512 pixels wide */
export const TILE_SIZE = 512;
const MAX_TILES = 64;
const TILE_CONCURRENCY = 4;
const TILE_TIMEOUT_MS = 8000;
const MAX_LAT = 85.05112878;
/** the smallest area a map shows, in world units (~3 km at the equator) */
const MIN_SPAN = 0.00008;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/**
 * the country outlines (Natural Earth 1:10m) are only accurate to about a kilometre, so they are drawn on maps at least
 * this wide
 */
export const MIN_OUTLINE_VIEW_KM = 30;
const MAX_LABELS = 14;
/** styled maps show at least this much ground across their shorter side, a few streets around a single place */
export const MIN_STYLED_VIEW_M = 1200;
/** the most vector tiles loaded for one map */
export const MAX_VECTOR_TILES = 20;
const VECTOR_TILE_CONCURRENCY = 3;
/** the layers of the vector tiles that styled maps draw */
const STYLED_LAYERS = new Set(['earth', 'water', 'landcover', 'landuse', 'buildings', 'roads', 'boundaries', 'places']);

const tileCache = new LRUMap<string, Buffer>(400);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Web Mercator, in world units: x and y from 0 to 1, y growing southwards */
export const project = (lat: number, lon: number) => {
  const phi = (clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
  return { x: (lon + 180) / 360, y: (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 };
};

export const unproject = (x: number, y: number) => ({
  lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  lon: x * 360 - 180,
});

/** longitudes shifted so that a trip across the antimeridian stays in one piece */
const unwrapLongitudes = (points: MapPoint[]) => {
  const lons = points.map((point) => point.lon);
  if (lons.length === 0 || Math.max(...lons) - Math.min(...lons) <= 180) {
    return points;
  }
  return points.map((point) => (point.lon < 0 ? { ...point, lon: point.lon + 360 } : point));
};

export type Viewport = {
  /** centre in world units */
  x: number;
  y: number;
  /** pixels per world unit */
  scale: number;
  width: number;
  height: number;
};

/** The viewport that fits every point with `padding` pixels on each side */
export const fitViewport = (
  points: Array<{ x: number; y: number }>,
  size: { width: number; height: number },
  padding: number,
  minSpan = MIN_SPAN,
): Viewport => {
  if (points.length === 0) {
    return { ...size, ...project(30, 10), scale: size.width * 1.2 };
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanX = Math.max(maxX - minX, minSpan);
  const spanY = Math.max(maxY - minY, minSpan);
  const scale = Math.min(Math.max(1, size.width - 2 * padding) / spanX, Math.max(1, size.height - 2 * padding) / spanY);
  return { ...size, x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale };
};

export const toPixel = (viewport: Viewport, point: { x: number; y: number }) => ({
  x: (point.x - viewport.x) * viewport.scale + viewport.width / 2,
  y: (point.y - viewport.y) * viewport.scale + viewport.height / 2,
});

export const getViewportBounds = (viewport: Viewport): GeoBounds => {
  const halfWidth = viewport.width / 2 / viewport.scale;
  const halfHeight = viewport.height / 2 / viewport.scale;
  const topLeft = unproject(viewport.x - halfWidth, clamp(viewport.y - halfHeight, 0, 1));
  const bottomRight = unproject(viewport.x + halfWidth, clamp(viewport.y + halfHeight, 0, 1));
  return { west: topLeft.lon, north: topLeft.lat, east: bottomRight.lon, south: bottomRight.lat };
};

/** the span in world units of `meters` of ground at a latitude */
export const metersToWorld = (meters: number, lat: number) =>
  meters / (EARTH_CIRCUMFERENCE_M * Math.max(0.01, Math.cos((clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180)));

/** metres per pixel at the centre of the viewport */
export const getMetersPerPixel = (viewport: Viewport) => {
  const { lat } = unproject(viewport.x, viewport.y);
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / viewport.scale;
};

/** a round distance (1, 2 or 5 × 10^n metres) close to `targetPx` pixels long */
export const getScaleBar = (metersPerPixel: number, targetPx: number) => {
  const target = metersPerPixel * targetPx;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const meters = [5, 2, 1].map((step) => step * magnitude).find((value) => value <= target) ?? magnitude;
  const label = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
  return { meters, pixels: meters / metersPerPixel, label };
};

/** the zoom whose tiles are at least as detailed as the viewport, with at most `maxTiles` tiles */
export const chooseZoom = (viewport: Viewport, maxZoom: number, tileSize = TILE_SIZE, maxTiles = MAX_TILES) => {
  let zoom = clamp(Math.ceil(Math.log2(viewport.scale / tileSize) - 1e-9), 0, maxZoom);
  while (zoom > 0 && getTileRange(viewport, zoom, tileSize).count > maxTiles) {
    zoom--;
  }
  return zoom;
};

export type TileRange = {
  zoom: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  count: number;
  /** the viewport inside the stitched tiles, in pixels */
  region: { left: number; top: number; width: number; height: number };
};

export const getTileRange = (viewport: Viewport, zoom: number, tileSize = TILE_SIZE): TileRange => {
  const n = 2 ** zoom;
  const halfWidth = viewport.width / 2 / viewport.scale;
  const halfHeight = viewport.height / 2 / viewport.scale;
  const left = (viewport.x - halfWidth) * n;
  const right = (viewport.x + halfWidth) * n;
  const top = clamp(viewport.y - halfHeight, 0, 1) * n;
  const bottom = clamp(viewport.y + halfHeight, 0, 1) * n;

  const x0 = Math.floor(left);
  const x1 = Math.max(x0, Math.ceil(right) - 1);
  const y0 = clamp(Math.floor(top), 0, n - 1);
  const y1 = clamp(Math.ceil(bottom) - 1, y0, n - 1);
  return {
    zoom,
    x0,
    x1,
    y0,
    y1,
    count: (x1 - x0 + 1) * (y1 - y0 + 1),
    region: {
      left: (left - x0) * tileSize,
      top: (top - y0) * tileSize,
      width: (right - left) * tileSize,
      height: (bottom - top) * tileSize,
    },
  };
};

export const getTileUrl = (style: TileStyle, zoom: number, x: number, y: number, apiKey: string) => {
  const n = 2 ** zoom;
  const wrapped = ((x % n) + n) % n;
  return `${TILE_URL}/${style.id}/${zoom}/${wrapped}/${y}@2x.${style.extension}?api_key=${encodeURIComponent(apiKey)}`;
};

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

const fetchTile = async (url: string, fetcher: typeof fetch) => {
  const key = url.replace(/\?.*$/, '');
  const cached = tileCache.get(key);
  if (cached) {
    return cached;
  }

  const response = await fetcher(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`tile request failed with status ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  tileCache.set(key, data);
  return data;
};

/** Stitches the Stadia tiles that cover the viewport into one image of the viewport's size */
export const renderTileBasemap = async (
  viewport: Viewport,
  style: TileStyle,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> => {
  const range = getTileRange(viewport, chooseZoom(viewport, style.maxZoom));
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      tiles.push({ x, y });
    }
  }

  const images = await mapLimit(tiles, TILE_CONCURRENCY, ({ x, y }) =>
    fetchTile(getTileUrl(style, range.zoom, x, y, apiKey), fetcher),
  );

  const width = (range.x1 - range.x0 + 1) * TILE_SIZE;
  const height = (range.y1 - range.y0 + 1) * TILE_SIZE;
  const layers = await Promise.all(
    tiles.map(async ({ x, y }, i) => ({
      // tiles are normally 512 pixels, but do not trust the server
      input: await sharp(images[i]).resize(TILE_SIZE, TILE_SIZE, { fit: 'fill' }).toBuffer(),
      left: (x - range.x0) * TILE_SIZE,
      top: (y - range.y0) * TILE_SIZE,
    })),
  );

  const { data, info } = await sharp({ create: { width, height, channels: 3, background: '#e8e4d8' } })
    .composite(layers)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const left = clamp(Math.round(range.region.left), 0, width - 1);
  const top = clamp(Math.round(range.region.top), 0, height - 1);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .extract({
      left,
      top,
      width: clamp(Math.round(range.region.width), 1, width - left),
      height: clamp(Math.round(range.region.height), 1, height - top),
    })
    .resize(viewport.width, viewport.height, { fit: 'fill' })
    .png()
    .toBuffer();
};

type Box = { x: number; y: number; width: number; height: number };

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export type LabelCandidate = {
  text: string;
  x: number;
  y: number;
  weight: number;
  /** distance between the point and the label, e.g. the pin radius */
  offset?: number;
};

/** one label per place name (ignoring case and spacing), at the average location of its photos, most photos first */
export const getPlaceLabels = (points: Array<{ x: number; y: number; city?: string | null }>): LabelCandidate[] => {
  const places = new Map<string, { text: string; x: number; y: number; count: number; first: number }>();
  for (const [index, point] of points.entries()) {
    const text = point.city?.trim().replaceAll(/\s+/g, ' ');
    if (!text) {
      continue;
    }
    const key = text.toLocaleLowerCase('en');
    const place = places.get(key);
    if (place) {
      place.x += point.x;
      place.y += point.y;
      place.count++;
    } else {
      places.set(key, { text, x: point.x, y: point.y, count: 1, first: index });
    }
  }

  return places
    .values()
    .toArray()
    .toSorted((a, b) => b.count - a.count || a.first - b.first)
    .map((place) => ({ text: place.text, x: place.x / place.count, y: place.y / place.count, weight: place.count }));
};

export type PlacedLabel = LabelCandidate & { box: Box; anchor: 'start' | 'middle' | 'end'; baseline: number };

/** Places labels next to their point without overlapping each other, the obstacles or the edges */
export const placeLabels = (
  candidates: LabelCandidate[],
  options: { width: number; height: number; fontPx: number; obstacles?: Box[]; margin?: number; max?: number },
): PlacedLabel[] => {
  const { fontPx, width, height } = options;
  const margin = options.margin ?? fontPx * 0.5;
  const placed: PlacedLabel[] = [];
  const taken = [...(options.obstacles ?? [])];

  for (const candidate of candidates) {
    if (placed.length >= (options.max ?? MAX_LABELS)) {
      break;
    }

    const gap = Math.max(fontPx * 0.6, candidate.offset ?? 0);
    const textWidth = candidate.text.length * fontPx * 0.56;
    const textHeight = fontPx * 1.15;
    const offsets: Array<{ box: Omit<Box, 'width' | 'height'>; anchor: PlacedLabel['anchor'] }> = [
      { box: { x: candidate.x + gap, y: candidate.y - textHeight / 2 }, anchor: 'start' },
      { box: { x: candidate.x - gap - textWidth, y: candidate.y - textHeight / 2 }, anchor: 'end' },
      { box: { x: candidate.x - textWidth / 2, y: candidate.y - gap - textHeight }, anchor: 'middle' },
      { box: { x: candidate.x - textWidth / 2, y: candidate.y + gap }, anchor: 'middle' },
      { box: { x: candidate.x + gap * 0.7, y: candidate.y - gap * 0.7 - textHeight }, anchor: 'start' },
      { box: { x: candidate.x + gap * 0.7, y: candidate.y + gap * 0.7 }, anchor: 'start' },
      { box: { x: candidate.x - gap * 0.7 - textWidth, y: candidate.y - gap * 0.7 - textHeight }, anchor: 'end' },
      { box: { x: candidate.x - gap * 0.7 - textWidth, y: candidate.y + gap * 0.7 }, anchor: 'end' },
    ];
    const positions = offsets.map(({ box, anchor }) => ({
      box: { ...box, width: textWidth, height: textHeight },
      anchor,
    }));

    const fit = positions.find(
      ({ box }) =>
        box.x >= margin &&
        box.y >= margin &&
        box.x + box.width <= width - margin &&
        box.y + box.height <= height - margin &&
        taken.every((other) => !intersects(box, other)),
    );
    if (!fit) {
      continue;
    }

    taken.push(fit.box);
    placed.push({ ...candidate, box: fit.box, anchor: fit.anchor, baseline: fit.box.y + fontPx * 0.9 });
  }

  return placed;
};

type Stop = { x: number; y: number; count: number };

/** groups nearby points into stops, in the order they were first visited */
export const getStops = (points: Array<{ x: number; y: number }>, radius: number): Stop[] => {
  const stops: Array<Stop & { sumX: number; sumY: number }> = [];
  for (const point of points) {
    const stop = stops.find((item) => Math.hypot(item.x - point.x, item.y - point.y) <= radius);
    if (stop) {
      stop.count++;
      stop.sumX += point.x;
      stop.sumY += point.y;
      stop.x = stop.sumX / stop.count;
      stop.y = stop.sumY / stop.count;
    } else {
      stops.push({ x: point.x, y: point.y, count: 1, sumX: point.x, sumY: point.y });
    }
  }
  return stops.map(({ x, y, count }) => ({ x, y, count }));
};

/** a deterministic pseudo-random sequence, so maps look the same every time */
const random = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const fmt = (value: number) => (Math.round(value * 10) / 10).toString();

/** a smooth path through the points (Catmull-Rom as cubic Béziers), with a little hand-drawn wobble */
export const getRoutePath = (points: Array<{ x: number; y: number }>, wobble: number, seed = 1) => {
  if (points.length < 2) {
    return '';
  }

  const next = random(seed);
  const jitter = () => (next() - 0.5) * 2 * wobble;
  const parts = [`M${fmt(points[0].x)},${fmt(points[0].y)}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6 + jitter(), y: p1.y + (p2.y - p0.y) / 6 + jitter() };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6 + jitter(), y: p2.y - (p3.y - p1.y) / 6 + jitter() };
    parts.push(`C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(p2.x)},${fmt(p2.y)}`);
  }
  return parts.join(' ');
};

type Theme = {
  route: string;
  routeShadow: string;
  pin: string;
  pinStroke: string;
  label: string;
  halo: string;
  ink: string;
  /** serif: the book's font; sans-serif; or a font stack */
  labelFont: string;
  italic: boolean;
  /** a dashed route (default) or a solid one */
  routeDash?: boolean;
  /** how much the route wobbles, in design pixels (default 2.5) */
  routeWobble?: number;
  /** numbers the stops in the heads of their pins, in this colour */
  pinText?: string;
  cartouche?: { fill: string; stroke: string; text: string; italic: boolean; upper: boolean };
  compass?: 'simple' | 'rose' | 'arrow';
};

const SKETCH_THEME: Theme = {
  route: '#a4372a',
  routeShadow: '#5b4a33',
  pin: '#a4372a',
  pinStroke: '#fbf5e6',
  label: '#3d3122',
  halo: '#f4ecd8',
  ink: '#5b4a33',
  labelFont: 'serif',
  italic: true,
};

const TILE_THEME: Theme = {
  route: '#c0392b',
  routeShadow: '#ffffff',
  pin: '#c0392b',
  pinStroke: '#ffffff',
  label: '#1f1f1f',
  halo: '#ffffff',
  ink: '#333333',
  labelFont: 'sans-serif',
  italic: false,
};

const DEFAULT_CARTOUCHE: NonNullable<Theme['cartouche']> = {
  fill: '#fbf7ec',
  stroke: '#5b4a33',
  text: '#3d3122',
  italic: true,
  upper: false,
};

/** the overlay of a styled map, in the colours and fonts of its look */
const getStyledTheme = (look: MapLook): Theme => ({
  ...look.overlay,
  labelFont: look.overlay.labelFont,
  routeWobble: look.id === 'minimal' ? 0.6 : look.id === 'wash' ? 2.5 : 1.2,
  compass: look.compass,
});

const renderCompass = (x: number, y: number, size: number, theme: Theme, fontFamily: string) => {
  const r = size / 2;
  const s = fmt;
  if (theme.compass === 'arrow') {
    return [
      `<g opacity="0.8">`,
      `<path d="M${s(x)},${s(y - r * 0.75)} L${s(x + r * 0.22)},${s(y + r * 0.45)} L${s(x)},${s(y + r * 0.25)} L${s(x - r * 0.22)},${s(y + r * 0.45)} Z" fill="${theme.ink}"/>`,
      `<text x="${s(x)}" y="${s(y - r * 0.95)}" font-family="${escapeXml(fontFamily)}" font-size="${s(size * 0.26)}" fill="${theme.ink}" text-anchor="middle">N</text>`,
      `</g>`,
    ].join('');
  }
  if (theme.compass === 'rose') {
    const point = (angle: number, length: number, width: number) => {
      const a = (angle * Math.PI) / 180;
      const tip = { x: x + Math.sin(a) * length, y: y - Math.cos(a) * length };
      const left = { x: x + Math.sin(a - Math.PI / 2) * width, y: y - Math.cos(a - Math.PI / 2) * width };
      const right = { x: x + Math.sin(a + Math.PI / 2) * width, y: y - Math.cos(a + Math.PI / 2) * width };
      return [
        `<polygon points="${s(x)},${s(y)} ${s(tip.x)},${s(tip.y)} ${s(left.x)},${s(left.y)}" fill="${theme.ink}"/>`,
        `<polygon points="${s(x)},${s(y)} ${s(tip.x)},${s(tip.y)} ${s(right.x)},${s(right.y)}" fill="${theme.halo}" stroke="${theme.ink}" stroke-width="${s(size * 0.012)}" stroke-linejoin="round"/>`,
      ].join('');
    };
    return [
      `<g opacity="0.9">`,
      `<circle cx="${s(x)}" cy="${s(y)}" r="${s(r * 0.78)}" fill="${theme.halo}" fill-opacity="0.55" stroke="${theme.ink}" stroke-width="${s(size * 0.012)}"/>`,
      `<circle cx="${s(x)}" cy="${s(y)}" r="${s(r * 0.7)}" fill="none" stroke="${theme.ink}" stroke-width="${s(size * 0.008)}" stroke-dasharray="${s(size * 0.01)} ${s(size * 0.025)}"/>`,
      ...[45, 135, 225, 315].map((angle) => point(angle, r * 0.55, r * 0.09)),
      ...[0, 90, 180, 270].map((angle) => point(angle, r * 0.95, r * 0.13)),
      `<circle cx="${s(x)}" cy="${s(y)}" r="${s(r * 0.05)}" fill="${theme.halo}" stroke="${theme.ink}" stroke-width="${s(size * 0.01)}"/>`,
      `<text x="${s(x)}" y="${s(y - r * 1.07)}" font-family="${escapeXml(fontFamily)}" font-size="${s(size * 0.22)}" font-weight="bold" fill="${theme.ink}" text-anchor="middle">N</text>`,
      `</g>`,
    ].join('');
  }
  return [
    `<g opacity="0.85">`,
    `<circle cx="${s(x)}" cy="${s(y)}" r="${s(r * 0.72)}" fill="none" stroke="${theme.ink}" stroke-width="${s(size * 0.025)}"/>`,
    `<polygon points="${s(x)},${s(y - r)} ${s(x + r * 0.2)},${s(y)} ${s(x)},${s(y + r * 0.15)} ${s(x - r * 0.2)},${s(y)}" fill="${theme.ink}"/>`,
    `<polygon points="${s(x)},${s(y + r * 0.8)} ${s(x + r * 0.16)},${s(y)} ${s(x - r * 0.16)},${s(y)}" fill="none" stroke="${theme.ink}" stroke-width="${s(size * 0.02)}"/>`,
    `<line x1="${s(x - r * 0.8)}" y1="${s(y)}" x2="${s(x + r * 0.8)}" y2="${s(y)}" stroke="${theme.ink}" stroke-width="${s(size * 0.02)}"/>`,
    `<text x="${s(x)}" y="${s(y - r * 1.08)}" font-family="${escapeXml(fontFamily)}" font-size="${s(size * 0.3)}" font-weight="bold" fill="${theme.ink}" text-anchor="middle">N</text>`,
    `</g>`,
  ].join('');
};

const renderScaleBar = (viewport: Viewport, u: number, theme: Theme, fontFamily: string, bottom: number, left = 24) => {
  const bar = getScaleBar(getMetersPerPixel(viewport), viewport.width * 0.18);
  if (!Number.isFinite(bar.pixels) || bar.pixels <= 0) {
    return '';
  }
  const x = left * u;
  const y = viewport.height - bottom;
  const h = 5 * u;
  const half = bar.pixels / 2;
  return [
    `<g opacity="0.85">`,
    `<rect x="${fmt(x)}" y="${fmt(y - h)}" width="${fmt(half)}" height="${fmt(h)}" fill="${theme.ink}"/>`,
    `<rect x="${fmt(x + half)}" y="${fmt(y - h)}" width="${fmt(half)}" height="${fmt(h)}" fill="${theme.halo}" stroke="${theme.ink}" stroke-width="${fmt(u)}"/>`,
    `<text x="${fmt(x)}" y="${fmt(y - h - 5 * u)}" font-family="${escapeXml(fontFamily)}" font-size="${fmt(18 * u)}" fill="${theme.ink}">${escapeXml(bar.label)}</text>`,
    `</g>`,
  ].join('');
};

const renderTitle = (
  title: string,
  width: number,
  u: number,
  fontFamily: string,
  cartouche: NonNullable<Theme['cartouche']> = DEFAULT_CARTOUCHE,
) => {
  const text = cartouche.upper ? title.toLocaleUpperCase() : title;
  const spacing = cartouche.upper ? 0.14 : 0;
  const charWidth = (cartouche.upper ? 0.68 : 0.56) + spacing;
  const fontPx = Math.min((cartouche.upper ? 36 : 44) * u, (width * 0.8) / Math.max(4, text.length * charWidth));
  const boxWidth = Math.min(width * 0.9, text.length * fontPx * charWidth + fontPx * 2);
  const boxHeight = fontPx * 1.8;
  const x = (width - boxWidth) / 2;
  const y = 22 * u;
  return [
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(boxWidth)}" height="${fmt(boxHeight)}" rx="${fmt(6 * u)}" fill="${cartouche.fill}" fill-opacity="0.9" stroke="${cartouche.stroke}" stroke-width="${fmt(1.5 * u)}"/>`,
    `<rect x="${fmt(x + 4 * u)}" y="${fmt(y + 4 * u)}" width="${fmt(boxWidth - 8 * u)}" height="${fmt(boxHeight - 8 * u)}" rx="${fmt(4 * u)}" fill="none" stroke="${cartouche.stroke}" stroke-opacity="0.5" stroke-width="${fmt(0.8 * u)}"/>`,
    `<text x="${fmt(width / 2)}" y="${fmt(y + boxHeight / 2 + fontPx * 0.34)}" font-family="${escapeXml(fontFamily)}" font-size="${fmt(fontPx)}"${cartouche.italic ? ' font-style="italic"' : ''}${spacing ? ` letter-spacing="${fmt(fontPx * spacing)}"` : ''} fill="${cartouche.text}" text-anchor="middle">${escapeXml(text)}</text>`,
  ].join('');
};

const SEA = '#cfdcd6';
const LAND = '#f4ead0';

const getOutlinePath = (countries: CountryOutline[], viewport: Viewport, u: number, lonShift: boolean) => {
  const paths: string[] = [];
  for (const country of countries) {
    for (const ring of country.rings) {
      const parts: string[] = [];
      let last: { x: number; y: number } | undefined;
      for (const [lon, lat] of ring) {
        const point = toPixel(viewport, project(lat, lonShift && lon < 0 ? lon + 360 : lon));
        if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1.5 * u) {
          continue;
        }
        parts.push(`${parts.length === 0 ? 'M' : 'L'}${fmt(point.x)},${fmt(point.y)}`);
        last = point;
      }
      if (parts.length > 2) {
        paths.push(`${parts.join('')}Z`);
      }
    }
  }
  return paths.join(' ');
};

/** the sea as a wash, the land as paper with a hand-inked coast, rippled on the sea side */
const renderLand = (path: string, width: number, height: number, u: number) =>
  [
    `<rect width="${width}" height="${height}" fill="${SEA}" fill-opacity="0.85"/>`,
    `<path d="${path}" fill="none" stroke="#7f9f9f" stroke-opacity="0.18" stroke-width="${fmt(26 * u)}" stroke-linejoin="round"/>`,
    `<path d="${path}" fill="none" stroke="#6f9294" stroke-opacity="0.35" stroke-width="${fmt(9 * u)}" stroke-linejoin="round" stroke-dasharray="${fmt(2 * u)} ${fmt(5 * u)}"/>`,
    `<path d="${path}" fill="${LAND}" stroke="#7c6a4c" stroke-width="${fmt(1.6 * u)}" stroke-linejoin="round"/>`,
  ].join('');

const renderSketchBackground = (width: number, height: number, u: number, land: string) => {
  const lines: string[] = [];
  const step = 90 * u;
  for (let x = step; x < width; x += step) {
    lines.push(`M${fmt(x)},0V${fmt(height)}`);
  }
  for (let y = step; y < height; y += step) {
    lines.push(`M0,${fmt(y)}H${fmt(width)}`);
  }
  return [
    `<defs><radialGradient id="paper" cx="50%" cy="45%" r="75%"><stop offset="0%" stop-color="#f7f0de"/><stop offset="70%" stop-color="#f0e5cb"/><stop offset="100%" stop-color="#dfcca5"/></radialGradient>`,
    `<radialGradient id="vignette" cx="50%" cy="45%" r="75%"><stop offset="60%" stop-color="#8a6d3b" stop-opacity="0"/><stop offset="100%" stop-color="#8a6d3b" stop-opacity="0.28"/></radialGradient></defs>`,
    `<rect width="${width}" height="${height}" fill="url(#paper)"/>`,
    land,
    `<path d="${lines.join('')}" stroke="#9c8660" stroke-opacity="0.16" stroke-width="${fmt(u)}"/>`,
    `<rect width="${width}" height="${height}" fill="url(#vignette)"/>`,
  ].join('');
};

/** grey noise around 128, from the seeded random sequence so that maps look the same every time */
const greyNoise = (width: number, height: number, sigma: number, next: () => number) => {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    // the sum of three uniform values is close enough to a normal distribution
    const value = clamp(Math.round(128 + (next() + next() + next() - 1.5) * 2 * sigma), 0, 255);
    data.fill(value, i * 3, i * 3 + 3);
  }
  return sharp(data, { raw: { width, height, channels: 3 } });
};

const GRAIN_TILE = 256;

/** Paper grain, fine noise and soft blotches, as mid-grey layers blended with soft light (grey keeps the colours) */
const renderPaperTexture = async (width: number, height: number, u: number, seed: number) => {
  const next = random(seed);
  const blotchSize = Math.max(8, Math.max(width, height) / 40);
  const columns = Math.ceil(width / blotchSize) + 3;
  const rows = Math.ceil(height / blotchSize) + 3;
  const blotches = await greyNoise(columns, rows, 16, next)
    .resize(Math.round(columns * blotchSize), Math.round(rows * blotchSize), { kernel: 'cubic' })
    .extract({ left: Math.round(blotchSize), top: Math.round(blotchSize), width, height })
    .blur(Math.max(0.3, blotchSize / 4))
    .png()
    .toBuffer();

  // one grain is a pixel on screen and a little more in print
  const scale = Math.max(1, Math.round(u * 1.2));
  const tile = { width: Math.min(GRAIN_TILE * scale, width), height: Math.min(GRAIN_TILE * scale, height) };
  const grainColumns = Math.ceil(tile.width / scale);
  const grainRows = Math.ceil(tile.height / scale);
  const grain = await greyNoise(grainColumns, grainRows, 12, next)
    .resize(grainColumns * scale, grainRows * scale, { kernel: 'nearest' })
    .extract({ left: 0, top: 0, ...tile })
    .blur(0.4 * scale)
    .png()
    .toBuffer();

  return [
    { input: blotches, blend: 'soft-light' as const },
    { input: grain, blend: 'soft-light' as const, tile: true },
  ];
};

const renderFrame = (width: number, height: number, u: number) =>
  `<rect x="${fmt(8 * u)}" y="${fmt(8 * u)}" width="${fmt(width - 16 * u)}" height="${fmt(height - 16 * u)}" fill="none" stroke="#5b4a33" stroke-opacity="0.6" stroke-width="${fmt(1.5 * u)}"/>`;

/** label size of the places, in thousandths of the shorter side of the map */
const LABEL_PX = 30;

/**
 * a map pin whose tip marks the stop, with a soft shadow; the first stop has a filled head, unless the stops are
 * numbered in the order they were visited
 */
const renderPin = (
  stop: { x: number; y: number },
  r: number,
  theme: Theme,
  u: number,
  first: boolean,
  number?: number,
  fontFamily?: string,
) => {
  const { x, y } = stop;
  const cy = y - r * 1.9;
  const side = r * Math.sin(Math.PI / 3);
  const shoulder = cy + r * Math.cos(Math.PI / 3);
  const head =
    number === undefined
      ? `<circle cx="${fmt(x)}" cy="${fmt(cy)}" r="${fmt(r * 0.42)}" fill="${first ? theme.ink : theme.pinStroke}" stroke="${theme.pinStroke}" stroke-width="${fmt(first ? 2 * u : 0)}"/>`
      : `<text x="${fmt(x)}" y="${fmt(cy + r * 0.36)}" font-family="${escapeXml(fontFamily ?? getFontStack('sans-serif'))}" font-size="${fmt(r * (number >= 10 ? 0.9 : 1.05))}" font-weight="bold" fill="${theme.pinText ?? theme.pinStroke}" text-anchor="middle">${number}</text>`;
  return [
    `<ellipse cx="${fmt(x)}" cy="${fmt(y)}" rx="${fmt(r * 0.7)}" ry="${fmt(r * 0.25)}" fill="#2b2115" fill-opacity="0.3"/>`,
    `<path d="M${fmt(x)},${fmt(y)} L${fmt(x - side)},${fmt(shoulder)} A${fmt(r)},${fmt(r)} 0 1 1 ${fmt(x + side)},${fmt(shoulder)} Z" fill="${theme.pin}" stroke="${theme.pinStroke}" stroke-width="${fmt(2 * u)}" stroke-linejoin="round"/>`,
    head,
  ].join('');
};

/** the most stops numbered on a map; more are drawn as plain pins */
const MAX_NUMBERED_STOPS = 30;

type OverlayInput = {
  viewport: Viewport;
  points: Array<{ x: number; y: number; city?: string | null }>;
  map: BookMap;
  theme: Theme;
  fontFamily: string;
  /** the Stadia credit (true), a credit of the map data, or none */
  attribution: boolean | string;
  seed: number;
  /** room kept free along the edges, e.g. for a frame, in design pixels */
  inset?: number;
};

type OverlayResult = {
  svg: string;
  /** what the overlay covers: pins, labels, title, compass, scale bar and credit */
  taken: Box[];
  /** the place names the overlay shows, lower case */
  names: Set<string>;
};

/** route, pins, labels, compass, scale bar, title and attribution */
const renderOverlay = (input: OverlayInput): OverlayResult => {
  const { viewport, points, map, theme, fontFamily, attribution, seed } = input;
  const { width, height } = viewport;
  const u = Math.min(width, height) / 1000;
  const inset = (input.inset ?? 0) * u;
  const parts: string[] = [];
  const labelFont =
    theme.labelFont === 'serif'
      ? fontFamily
      : theme.labelFont === 'sans-serif'
        ? getFontStack('sans-serif')
        : theme.labelFont;

  const route = points.filter(
    (point, i) => i === 0 || Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y) >= 6 * u,
  );
  if (map.showRoute && route.length > 1) {
    const path = getRoutePath(route, (theme.routeWobble ?? 2.5) * u, seed);
    const dash = theme.routeDash === false ? '' : ` stroke-dasharray="${fmt(12 * u)} ${fmt(7 * u)}"`;
    parts.push(
      `<path d="${path}" fill="none" stroke="${theme.routeShadow}" stroke-opacity="${theme.routeDash === false ? 0.75 : 0.35}" stroke-width="${fmt(7 * u)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      `<path d="${path}" fill="none" stroke="${theme.route}" stroke-width="${fmt(3.2 * u)}"${dash} stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }

  const stops = getStops(points, 14 * u);
  const numbered = !!theme.pinText && stops.length > 1 && stops.length <= MAX_NUMBERED_STOPS;
  const radius = (stop: Stop) => (numbered ? 13 + 2 * Math.log2(stop.count) : 11 + 2.5 * Math.log2(stop.count)) * u;
  const obstacles: Box[] = [];
  for (const [index, stop] of stops.entries()) {
    const r = radius(stop);
    obstacles.push({ x: stop.x - r * 1.1, y: stop.y - r * 2.9, width: r * 2.2, height: r * 3 });
    parts.push(renderPin(stop, r, theme, u, index === 0, numbered ? index + 1 : undefined, labelFont));
  }

  const titleHeight = map.title ? 22 * u + Math.min(44 * u, width) * 1.8 : 0;
  if (map.title) {
    obstacles.push({ x: 0, y: 0, width, height: titleHeight + 12 * u });
  }
  const compassSize = (theme.compass === 'rose' ? 76 : 56) * u;
  const compass = {
    x: width - inset - compassSize * 0.85,
    y: inset + compassSize * 1.05 + 16 * u,
  };
  obstacles.push(
    {
      x: compass.x - compassSize * 0.85,
      y: compass.y - compassSize * 1.05 - 16 * u,
      width: compassSize * 1.7 + inset,
      height: compassSize * 1.9 + 16 * u,
    },
    { x: 0, y: height - 70 * u - inset, width: width * 0.3 + inset, height: 70 * u + inset },
  );
  const credit = attribution === true ? MAP_ATTRIBUTION : attribution || '';
  const creditPx = Math.max(9, 11 * u);
  const creditWidth = credit.length * creditPx * 0.52 + 12 * u;
  if (credit) {
    obstacles.push({
      x: width - inset - creditWidth,
      y: height - inset - creditPx * 2,
      width: creditWidth + inset,
      height: creditPx * 2 + inset,
    });
  }

  const taken = [...obstacles];
  const names = new Set<string>();
  if (map.labels) {
    const fontPx = LABEL_PX * u;
    // labels sit next to the pin closest to the middle of their photos
    // next to the head of the pin
    const candidates = getPlaceLabels(points).map((label) => {
      const stop = minBy(stops, (item) => Math.hypot(item.x - label.x, item.y - label.y))!;
      const r = radius(stop);
      return { ...label, x: stop.x, y: stop.y - r * 1.9, offset: r + 6 * u };
    });
    const labels = placeLabels(candidates, { width, height, fontPx, obstacles, margin: 14 * u + inset });
    for (const label of labels) {
      const x =
        label.anchor === 'start'
          ? label.box.x
          : label.anchor === 'end'
            ? label.box.x + label.box.width
            : label.box.x + label.box.width / 2;
      taken.push(label.box);
      names.add(label.text.toLocaleLowerCase('en'));
      parts.push(
        `<text x="${fmt(x)}" y="${fmt(label.baseline)}" font-family="${escapeXml(labelFont)}" font-size="${fmt(fontPx)}"${theme.italic ? ' font-style="italic"' : ' font-weight="bold"'} fill="${theme.label}" stroke="${theme.halo}" stroke-opacity="0.9" stroke-width="${fmt(6 * u)}" stroke-linejoin="round" paint-order="stroke" text-anchor="${label.anchor}">${escapeXml(label.text)}</text>`,
      );
    }
  }

  // the compass, scale bar and title of styled maps use the font of their look, the others the book's font
  const chromeFont = theme.compass ? labelFont : fontFamily;
  parts.push(
    renderCompass(compass.x, compass.y, compassSize, theme, chromeFont),
    renderScaleBar(viewport, u, theme, chromeFont, 28 * u + inset, 24 + (input.inset ?? 0)),
  );

  if (map.title) {
    parts.push(renderTitle(map.title, width, u, chromeFont, theme.cartouche));
  }

  if (attribution === true) {
    parts.push(
      `<rect x="${fmt(width - creditWidth)}" y="${fmt(height - creditPx * 1.7)}" width="${fmt(creditWidth)}" height="${fmt(creditPx * 1.7)}" fill="#ffffff" fill-opacity="0.7"/>`,
      `<text x="${fmt(width - 6 * u)}" y="${fmt(height - creditPx * 0.5)}" font-family="${escapeXml(getFontStack('sans-serif'))}" font-size="${fmt(creditPx)}" fill="#333333" text-anchor="end">${escapeXml(credit)}</text>`,
    );
  } else if (credit) {
    parts.push(
      `<text x="${fmt(width - inset - 8 * u)}" y="${fmt(height - inset - creditPx * 0.7)}" font-family="${escapeXml(getFontStack('sans-serif'))}" font-size="${fmt(creditPx)}" fill="${theme.ink}" fill-opacity="0.85" stroke="${theme.halo}" stroke-opacity="0.8" stroke-width="${fmt(creditPx * 0.25)}" stroke-linejoin="round" paint-order="stroke" text-anchor="end">${escapeXml(credit)}</text>`,
    );
  }

  return { svg: parts.join(''), taken, names };
};

const svg = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;

const encode = (image: Sharp, size: MapRenderSize) =>
  size.format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: size.quality ?? 90 }).toBuffer();

const seedOf = (points: MapPoint[]) => {
  let hash = 2_166_136_261;
  for (const point of points) {
    hash = Math.imul(hash ^ Math.round(point.lat * 1e4 + point.lon * 1e3), 16_777_619);
  }
  return hash;
};

/** The features of the vector tiles that cover the view, at the zoom that suits the size of the map */
export const loadStyledFeatures = async (
  mapSource: StyledMapSource,
  view: Viewport,
  u: number,
): Promise<{ zoom: number; features: MapFeature[]; tiles: TileKey[] }> => {
  const { source } = mapSource;
  const zoom = chooseVectorZoom(view, u, {
    minZoom: source.minZoom,
    maxZoom: source.maxZoom,
    maxTiles: MAX_VECTOR_TILES,
  });
  const tiles = getTilesInView(view, zoom);
  const data = await mapLimit(tiles, VECTOR_TILE_CONCURRENCY, (tile) => mapSource.getTile(tile));
  const features = tiles.flatMap((tile, index) => {
    const tileData = data[index];
    return tileData
      ? decodeVectorTile(tileData, getTilePlacement(view, tile), {
          layers: STYLED_LAYERS,
          maxFeatureZoom: zoom,
          maxLabelZoom: zoom + 1,
          tolerance: 0.5 * u,
        })
      : [];
  });
  return { zoom, features, tiles };
};

/** the most names of places drawn on a styled map, by its size */
const getMaxMapLabels = (width: number, height: number) =>
  Math.round(Math.min(18, Math.max(6, (width * height) / Math.min(width, height) ** 2) * 9));

type StyledMapInput = {
  mapSource: StyledMapSource;
  view: Viewport;
  points: Array<{ x: number; y: number; city?: string | null }>;
  map: BookMap;
  look: MapLook;
  fontFamily: string;
  seed: number;
  size: MapRenderSize;
};

/**
 * A styled map: the vector tiles of the map data drawn in the look of the book, with the names of places, then the
 * route, pins, title and the credit of the data over it
 */
const renderStyledMap = async ({ mapSource, view, points, map, look, fontFamily, seed, size }: StyledMapInput) => {
  const { width, height } = view;
  const u = Math.min(width, height) / 1000;
  const { zoom, features } = await loadStyledFeatures(mapSource, view, u);
  const bounds = getViewportBounds(view);
  const pixel = (lat: number, lon: number) => toPixel(view, project(lat, lon));

  const inset = look.frame === 'neatline' ? 20 : look.frame === 'double' ? 14 : 0;
  const overlay = renderOverlay({
    viewport: view,
    points,
    map,
    theme: getStyledTheme(look),
    fontFamily,
    attribution: getMapCredit(mapSource.source.attribution),
    seed,
    inset,
  });

  const basemap = renderStyledBasemap({ width, height, u, zoom, features, look, bounds, toPixel: pixel, seed });
  const frame = renderStyledFrame({ width, height, u, look, graticule: basemap.graticule, taken: overlay.taken });
  const labels = placeMapLabels(getMapLabelCandidates(features, zoom, look), {
    width,
    height,
    u,
    zoom,
    look,
    obstacles: [...overlay.taken, ...frame.taken],
    max: getMaxMapLabels(width, height),
    exclude: overlay.names,
    inset,
  });

  let image = sharp(Buffer.from(svg(width, height, `<defs>${basemap.defs}</defs>${basemap.body}`)));
  if (look.grain) {
    const paper = await image.png().toBuffer();
    image = sharp(paper).composite(await renderPaperTexture(width, height, u, seed));
  }
  const vignette = look.vignette
    ? `<defs><radialGradient id="vignette" cx="50%" cy="48%" r="75%"><stop offset="65%" stop-color="${look.labels.color}" stop-opacity="0"/><stop offset="100%" stop-color="${look.labels.color}" stop-opacity="0.16"/></radialGradient></defs><rect width="${width}" height="${height}" fill="url(#vignette)"/>`
    : '';
  const top = svg(width, height, vignette + renderMapLabels(labels, look, u) + frame.svg + overlay.svg);
  const flattened = await image.png().toBuffer();
  return encode(sharp(flattened).composite([{ input: Buffer.from(top), left: 0, top: 0 }]), size);
};

/**
 * Renders the map of a book page: the illustrated version when there is one, otherwise the route, stops and place
 * names over the real map data drawn in the look of the book (styled), over Stadia tiles (watercolor, toner, terrain)
 * or on an offline sketch. The styled and tile styles fall back to the sketch when their data cannot be loaded, and
 * the tile styles without an API key.
 */
export const renderMap = async (
  ctx: MapRenderContext,
  page: MapRenderPage,
  size: MapRenderSize,
): Promise<MapRenderResult> => {
  const width = Math.max(16, Math.round(size.width));
  const height = Math.max(16, Math.round(size.height));
  const map = page.map ?? { ...DEFAULT_MAP, ...(page.sectionTitle && { title: page.sectionTitle }) };
  const warnings: string[] = [];
  const fontFamily = getFontStack(ctx.fontFamily ?? 'serif');

  if (ctx.illustrated) {
    try {
      const image = sharp(ctx.illustrated, { failOn: 'none' }).rotate().resize(width, height, { fit: 'cover' });
      return { data: await encode(image, size), source: 'illustrated', warnings };
    } catch (error: any) {
      warnings.push(`The illustrated map could not be drawn (${error?.message ?? error}), so the map is rendered`);
    }
  }

  const located = unwrapLongitudes(
    ctx.points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)),
  );
  const lonShift = located.some((point) => point.lon > 180);
  const projected = located.map((point) => ({ ...project(point.lat, point.lon), city: point.city }));
  const u = Math.min(width, height) / 1000;
  const padding = Math.max(70 * u, Math.min(width, height) * 0.12);
  const titleRoom = map.title ? 90 * u : 0;
  const fit = (minSpan: number) => {
    const viewport = fitViewport(projected, { width, height: Math.max(1, height - titleRoom) }, padding, minSpan);
    const view: Viewport = { ...viewport, height, y: viewport.y - titleRoom / 2 / viewport.scale };
    return { view, points: projected.map((point) => ({ ...toPixel(view, point), city: point.city })) };
  };
  const { view, points } = fit(MIN_SPAN);
  if (located.length === 0) {
    warnings.push('None of the photos of this map have a GPS location');
  }

  const seed = seedOf(located);
  if (map.style === 'styled' && located.length > 0) {
    if (ctx.getStyledMapSource) {
      try {
        const mapSource = await ctx.getStyledMapSource();
        const center = unproject(view.x, view.y);
        const styled = fit(metersToWorld(MIN_STYLED_VIEW_M, center.lat));
        const style = ctx.style ?? { ...DEFAULT_STYLED_BOOK_STYLE, fontFamily: ctx.fontFamily ?? 'serif' };
        const look = getMapLook(resolveMapLook(style, map.look), style);
        const data = await renderStyledMap({ mapSource, ...styled, map, look, fontFamily, seed, size });
        return { data, source: 'styled', warnings };
      } catch (error: any) {
        warnings.push(`The map data could not be loaded (${error?.message ?? error}), so a sketch map is drawn instead`);
      }
    } else {
      warnings.push('Styled maps are not available here, so a sketch map is drawn instead');
    }
  }

  const tileStyle = getTileStyle(map.style);
  let basemap: Buffer | undefined;
  if (tileStyle && !ctx.stadiaApiKey) {
    warnings.push(`The ${map.style} map style needs a Stadia Maps API key, so a sketch map is drawn instead`);
  } else if (tileStyle && ctx.stadiaApiKey && located.length > 0) {
    try {
      basemap = await renderTileBasemap(view, tileStyle, ctx.stadiaApiKey, ctx.fetch);
    } catch (error: any) {
      warnings.push(`Map tiles could not be loaded (${error?.message ?? error}), so a sketch map is drawn instead`);
    }
  }

  if (basemap) {
    const overlay = renderOverlay({
      viewport: view,
      points,
      map,
      theme: TILE_THEME,
      fontFamily,
      attribution: true,
      seed,
    });
    const image = sharp(basemap).composite([{ input: Buffer.from(svg(width, height, overlay.svg)), left: 0, top: 0 }]);
    return { data: await encode(image, size), source: 'tiles', warnings };
  }

  let land = '';
  const viewKm = (getMetersPerPixel(view) * Math.max(width, height)) / 1000;
  if (ctx.getCountries && located.length > 0 && viewKm >= MIN_OUTLINE_VIEW_KM) {
    try {
      const bounds = getViewportBounds(view);
      const outlines = await ctx.getCountries(
        lonShift ? { ...bounds, west: bounds.west - 360, east: bounds.east - 360 } : bounds,
      );
      const path = getOutlinePath(outlines, view, u, lonShift);
      land = path ? renderLand(path, width, height, u) : '';
    } catch (error: any) {
      warnings.push(`Country outlines could not be loaded (${error?.message ?? error})`);
    }
  }

  const background = svg(width, height, renderSketchBackground(width, height, u, land));
  const overlay = svg(
    width,
    height,
    renderFrame(width, height, u) +
      renderOverlay({ viewport: view, points, map, theme: SKETCH_THEME, fontFamily, attribution: false, seed }).svg,
  );
  const paper = await sharp(Buffer.from(background))
    .composite(await renderPaperTexture(width, height, u, seed))
    .png()
    .toBuffer();
  const image = sharp(paper).composite([{ input: Buffer.from(overlay), left: 0, top: 0 }]);
  return { data: await encode(image, size), source: 'sketch', warnings };
};

/** The map image of a page (JPEG unless `format` is png); see `renderMap` */
export const renderMapImage = async (ctx: MapRenderContext, page: MapRenderPage, size: MapRenderSize) => {
  const { data } = await renderMap(ctx, page, size);
  return data;
};

/** clears the in-memory tile cache (for tests) */
export const clearTileCache = () => tileCache.clear();

/** Parses a Postgres polygon, `((x1,y1),(x2,y2),…)`, into [lon, lat] pairs */
export const parsePolygon = (value: string): Array<[number, number]> =>
  value
    .matchAll(/\(\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\)/g)
    .map((match) => [Number(match[1]), Number(match[2])] as [number, number])
    .toArray();

type MapSourcePage = { layout: string; map?: BookMap | null; assets: Array<{ assetId: string }> };

/**
 * The photos a map plots: its `assetIds`, or else the photos of its own page and of the pages that follow it, up to
 * the next map or section opener
 */
export const getMapAssetIds = (pages: MapSourcePage[], index: number): string[] => {
  const page = pages[index];
  if (!page) {
    return [];
  }
  if (page.map?.assetIds?.length) {
    return [...new Set(page.map.assetIds)];
  }

  const ids = page.assets.map(({ assetId }) => assetId);
  for (const next of pages.slice(index + 1)) {
    if (next.map || isMapLayout(next.layout) || next.layout === 'section-opener') {
      break;
    }
    ids.push(...next.assets.map(({ assetId }) => assetId));
  }
  return [...new Set(ids)];
};
