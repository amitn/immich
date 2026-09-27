import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

/**
 * The vector tiles of styled maps: finding the tile source of a MapLibre style (the style of Immich's own Map page), the
 * tile maths, and decoding Mapbox Vector Tiles into features in page pixels, clipped to their tile so that the tiles
 * join without seams.
 */

/** where the vector tiles of a style come from */
export type VectorTileSource = {
  /** tile URL templates with {z}, {x} and {y} */
  tiles: string[];
  minZoom: number;
  maxZoom: number;
  /** the credit the tiles ask for, as plain text, e.g. "© OpenStreetMap" */
  attribution: string;
};

export type TileKey = { z: number; x: number; y: number };

/** the smallest and largest zoom of a vector source (MapLibre defaults) */
const DEFAULT_MIN_ZOOM = 0;
const DEFAULT_MAX_ZOOM = 14;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const decodeEntities = (text: string) =>
  text
    .replaceAll(/&copy;/gi, '©')
    .replaceAll(/&nbsp;/gi, ' ')
    .replaceAll(/&amp;/gi, '&')
    .replaceAll(/&lt;/gi, '<')
    .replaceAll(/&gt;/gi, '>')
    .replaceAll(/&quot;/gi, '"')
    .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));

/** An attribution without its HTML, e.g. `<a href="…">&copy; OpenStreetMap</a>` → "© OpenStreetMap" */
export const toPlainAttribution = (html: string) =>
  decodeEntities(html.replaceAll(/<[^>]*>/g, ' '))
    .replaceAll(/\s+/g, ' ')
    .trim();

/**
 * The credit drawn on a styled map: the source's own attribution, which always credits the OpenStreetMap contributors
 * (the licence of the data asks for it)
 */
export const getMapCredit = (attribution: string) => {
  const parts = attribution
    .split(/\s*[|,]\s*|\s+(?=©)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/^©?\s*openstreetmap$/i.test(part) ? '© OpenStreetMap contributors' : part));
  if (!parts.some((part) => /openstreetmap/i.test(part))) {
    parts.push('© OpenStreetMap contributors');
  }
  return [...new Set(parts)].join(' ');
};

export type StyleSource = { url: string } | { tiles: string[]; minZoom: number; maxZoom: number; attribution: string };

/** a URL relative to the style, keeping the {z}/{x}/{y} placeholders that `URL` would escape */
const resolveUrl = (url: string, base: string) => {
  try {
    return new URL(url, base).toString().replaceAll('%7B', '{').replaceAll('%7D', '}');
  } catch {
    return url;
  }
};

const toZoom = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(24, Math.round(value))) : fallback;

const getTiles = (value: unknown, base: string) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => resolveUrl(item, base))
    : [];

/**
 * The vector source of a MapLibre style: a TileJSON URL, or its tiles when the style lists them itself. Throws when the
 * style has no vector source, or only one that is not served over HTTP (PMTiles).
 */
export const getStyleVectorSource = (style: unknown, styleUrl: string): StyleSource => {
  if (!isObject(style) || !isObject(style.sources)) {
    throw new Error('the map style has no sources');
  }

  const vectors = Object.values(style.sources).filter(
    (source): source is Record<string, unknown> => isObject(source) && source.type === 'vector',
  );
  if (vectors.length === 0) {
    throw new Error('the map style has no vector tiles');
  }

  for (const source of vectors) {
    const tiles = getTiles(source.tiles, styleUrl).filter((url) => /^https?:\/\//.test(url));
    if (tiles.length > 0) {
      return {
        tiles,
        minZoom: toZoom(source.minzoom, DEFAULT_MIN_ZOOM),
        maxZoom: toZoom(source.maxzoom, DEFAULT_MAX_ZOOM),
        attribution: typeof source.attribution === 'string' ? toPlainAttribution(source.attribution) : '',
      };
    }
    if (typeof source.url === 'string' && /^https?:\/\//.test(resolveUrl(source.url, styleUrl))) {
      return { url: resolveUrl(source.url, styleUrl) };
    }
  }

  throw new Error('the vector tiles of the map style are not served over HTTP (e.g. PMTiles), which maps cannot use');
};

/** The tiles, zooms and attribution of a TileJSON document */
export const parseTileJson = (json: unknown, url: string): VectorTileSource => {
  if (!isObject(json)) {
    throw new Error('the tile source is not a TileJSON document');
  }
  const tiles = getTiles(json.tiles, url).filter((item) => /^https?:\/\//.test(item));
  if (tiles.length === 0) {
    throw new Error('the tile source lists no tiles');
  }
  if (json.scheme === 'tms') {
    throw new Error('TMS tile sources are not supported');
  }
  return {
    tiles,
    minZoom: toZoom(json.minzoom, DEFAULT_MIN_ZOOM),
    maxZoom: toZoom(json.maxzoom, DEFAULT_MAX_ZOOM),
    attribution: typeof json.attribution === 'string' ? toPlainAttribution(json.attribution) : '',
  };
};

/** The URL of a tile; the template is chosen by the tile, so a tile always comes from the same server */
export const getVectorTileUrl = (source: Pick<VectorTileSource, 'tiles'>, { z, x, y }: TileKey) => {
  const template = source.tiles[(x + y) % source.tiles.length];
  const n = 2 ** z;
  const wrapped = ((x % n) + n) % n;
  return template
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(wrapped))
    .replaceAll('{y}', String(y))
    .replaceAll('{-y}', String(n - 1 - y));
};

/** a viewport in Web Mercator world units (see `project` in map.ts) */
export type WorldView = {
  /** centre, 0..1 */
  x: number;
  y: number;
  /** pixels per world unit */
  scale: number;
  width: number;
  height: number;
};

/** The tiles of a zoom that cover the view */
export const getTilesInView = (view: WorldView, zoom: number): TileKey[] => {
  const n = 2 ** zoom;
  const halfWidth = view.width / 2 / view.scale;
  const halfHeight = view.height / 2 / view.scale;
  const x0 = Math.floor((view.x - halfWidth) * n);
  const x1 = Math.max(x0, Math.ceil((view.x + halfWidth) * n) - 1);
  const y0 = Math.max(0, Math.floor(Math.max(0, view.y - halfHeight) * n));
  const y1 = Math.min(n - 1, Math.max(y0, Math.ceil(Math.min(1, view.y + halfHeight) * n) - 1));
  const tiles: TileKey[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
};

/** vector tiles are drawn 512 pixels wide at their own zoom */
export const VECTOR_TILE_SIZE = 512;

/**
 * The zoom of the tiles for a view: the one whose detail suits the printed size of the map, `u` being the size of a
 * "design pixel" (a thousandth of the shorter side of the map), then lowered until at most `maxTiles` tiles cover it
 */
export const chooseVectorZoom = (
  view: WorldView,
  u: number,
  options: { minZoom: number; maxZoom: number; maxTiles: number },
) => {
  // the map as if it were drawn 1000 pixels across its shorter side
  const designScale = view.scale / Math.max(u, 1e-6);
  let zoom = Math.round(Math.log2(designScale / VECTOR_TILE_SIZE) - 0.35);
  zoom = Math.max(options.minZoom, Math.min(options.maxZoom, zoom));
  while (zoom > options.minZoom && getTilesInView(view, zoom).length > options.maxTiles) {
    zoom--;
  }
  return zoom;
};

export type MapGeometryType = 'point' | 'line' | 'polygon';

/** a feature of a vector tile in page pixels */
export type MapFeature = {
  layer: string;
  kind: string;
  detail?: string;
  type: MapGeometryType;
  /**
   * polygons: the rings clipped to the tile, closed; lines: the parts inside the tile; points: one point per part. Flat
   * lists of x, y.
   */
  parts: number[][];
  /** polygons only: their edges inside the tile, without the edges made by cutting the tiles (for outlines) */
  outline?: number[][];
  name?: string;
  minZoom?: number;
  rank?: number;
  population?: number;
  sortRank?: number;
  isTunnel?: boolean;
  isBridge?: boolean;
  isLink?: boolean;
};

/** where a tile is drawn: page pixels of the tile's corner and its size */
export type TilePlacement = { left: number; top: number; size: number };

/** The tile's corner and size in page pixels */
export const getTilePlacement = (view: WorldView, { z, x, y }: TileKey): TilePlacement => {
  const n = 2 ** z;
  return {
    left: (x / n - view.x) * view.scale + view.width / 2,
    top: (y / n - view.y) * view.scale + view.height / 2,
    size: view.scale / n,
  };
};

type Point = [number, number];

/** Sutherland–Hodgman: a closed ring clipped to the square [min, max]² */
export const clipRing = (ring: Point[], min: number, max: number): Point[] => {
  let output = ring;
  const edges: Array<{ inside: (p: Point) => boolean; cut: (a: Point, b: Point) => Point }> = [
    {
      inside: (p) => p[0] >= min,
      cut: (a, b) => [min, a[1] + ((b[1] - a[1]) * (min - a[0])) / (b[0] - a[0])],
    },
    {
      inside: (p) => p[0] <= max,
      cut: (a, b) => [max, a[1] + ((b[1] - a[1]) * (max - a[0])) / (b[0] - a[0])],
    },
    {
      inside: (p) => p[1] >= min,
      cut: (a, b) => [a[0] + ((b[0] - a[0]) * (min - a[1])) / (b[1] - a[1]), min],
    },
    {
      inside: (p) => p[1] <= max,
      cut: (a, b) => [a[0] + ((b[0] - a[0]) * (max - a[1])) / (b[1] - a[1]), max],
    },
  ];
  for (const edge of edges) {
    if (output.length === 0) {
      break;
    }
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i];
      const previous = input[(i + input.length - 1) % input.length];
      if (edge.inside(current)) {
        if (!edge.inside(previous)) {
          output.push(edge.cut(previous, current));
        }
        output.push(current);
      } else if (edge.inside(previous)) {
        output.push(edge.cut(previous, current));
      }
    }
  }
  return output;
};

/** Liang–Barsky: the part of a segment inside the square [min, max]², if any */
const clipSegment = (a: Point, b: Point, min: number, max: number): [Point, Point] | undefined => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const checks: Array<[number, number]> = [
    [-dx, a[0] - min],
    [dx, max - a[0]],
    [-dy, a[1] - min],
    [dy, max - a[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) {
        return;
      }
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) {
        return;
      }
      t0 = Math.max(t0, t);
    } else {
      if (t < t0) {
        return;
      }
      t1 = Math.min(t1, t);
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
};

/** The parts of a polyline inside the square [min, max]²; `skipBorder` drops the segments that run along its edge */
export const clipLine = (line: Point[], min: number, max: number, skipBorder = false): Point[][] => {
  const parts: Point[][] = [];
  let current: Point[] = [];
  const onBorder = (a: Point, b: Point) =>
    (a[0] === b[0] && (a[0] <= min || a[0] >= max)) || (a[1] === b[1] && (a[1] <= min || a[1] >= max));

  for (let i = 0; i < line.length - 1; i++) {
    const segment = clipSegment(line[i], line[i + 1], min, max);
    if (!segment || (skipBorder && onBorder(segment[0], segment[1]))) {
      if (current.length > 1) {
        parts.push(current);
      }
      current = [];
      continue;
    }
    const last = current.at(-1);
    if (!last || last[0] !== segment[0][0] || last[1] !== segment[0][1]) {
      if (current.length > 1) {
        parts.push(current);
      }
      current = [segment[0]];
    }
    current.push(segment[1]);
  }
  if (current.length > 1) {
    parts.push(current);
  }
  return parts;
};

/**
 * The points of a line in page pixels, dropping those closer than `tolerance` to the last one kept; the last point,
 * and the points on the edge of the clip (`keep`), are always kept, so that neighbouring tiles still meet
 */
const toPixels = (
  points: Point[],
  placement: TilePlacement,
  extent: number,
  tolerance: number,
  closed: boolean,
  keep?: (point: Point) => boolean,
) => {
  const scale = placement.size / extent;
  const flat: number[] = [];
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  for (const [index, point] of points.entries()) {
    const [px, py] = point;
    const x = placement.left + px * scale;
    const y = placement.top + py * scale;
    const isLast = index === points.length - 1;
    if (
      flat.length > 0 &&
      !isLast &&
      Math.abs(x - lastX) < tolerance &&
      Math.abs(y - lastY) < tolerance &&
      !keep?.(point)
    ) {
      continue;
    }
    flat.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
    lastX = x;
    lastY = y;
  }
  const minPoints = closed ? 3 : 2;
  return flat.length / 2 >= minPoints ? flat : undefined;
};

const GEOMETRY_TYPES: Record<number, MapGeometryType | undefined> = { 1: 'point', 2: 'line', 3: 'polygon' };

const str = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** the name of a feature, in English when the tiles have it, e.g. Χανιά → Chania */
const getName = (properties: VectorTileFeature['properties']) =>
  str(properties['name:en']) ?? str(properties.name) ?? undefined;

export type DecodeOptions = {
  /** layers to keep, default all */
  layers?: Set<string>;
  /** drop features whose min_zoom is above this zoom */
  maxFeatureZoom?: number;
  /** the same for points (the names of places), which a printed map has room for a little earlier */
  maxLabelZoom?: number;
  /** the smallest distance between two kept points, in pixels */
  tolerance: number;
  /** keep the features of this layer? */
  filter?: (layer: string, kind: string, detail: string | undefined) => boolean;
};

/**
 * Decodes a Mapbox Vector Tile into features in page pixels. Polygons are clipped to the tile (a hair wider, so that
 * neighbours overlap instead of leaving a seam) and keep their real edges as outlines; lines are clipped to the tile.
 */
export const decodeVectorTile = (
  data: Buffer | Uint8Array,
  placement: TilePlacement,
  options: DecodeOptions,
): MapFeature[] => {
  const tile = new VectorTile(new PbfReader(data));
  const features: MapFeature[] = [];

  for (const [layerName, layer] of Object.entries(tile.layers)) {
    if (options.layers && !options.layers.has(layerName)) {
      continue;
    }

    const extent = layer.extent || 4096;
    // a pixel of overlap between neighbouring tiles
    const overlap = extent / Math.max(1, placement.size);
    const onEdge = ([x, y]: Point) => x <= -overlap || x >= extent + overlap || y <= -overlap || y >= extent + overlap;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const type = GEOMETRY_TYPES[feature.type];
      if (!type) {
        continue;
      }
      const { properties } = feature;
      const kind = str(properties.kind) ?? '';
      const detail = str(properties.kind_detail) ?? (typeof properties.kind_detail === 'number' ? String(properties.kind_detail) : undefined);
      const minZoom = num(properties.min_zoom);
      const maxZoom = type === 'point' ? (options.maxLabelZoom ?? options.maxFeatureZoom) : options.maxFeatureZoom;
      if (maxZoom !== undefined && minZoom !== undefined && minZoom > maxZoom + 0.5) {
        continue;
      }
      if (options.filter && !options.filter(layerName, kind, detail)) {
        continue;
      }

      const geometry = feature.loadGeometry().map((ring) => ring.map((point) => [point.x, point.y] as Point));
      const parts: number[][] = [];
      const outline: number[][] = [];
      if (type === 'point') {
        for (const [point] of geometry) {
          if (point && point[0] >= 0 && point[0] < extent && point[1] >= 0 && point[1] < extent) {
            const scale = placement.size / extent;
            parts.push([placement.left + point[0] * scale, placement.top + point[1] * scale]);
          }
        }
      } else if (type === 'line') {
        for (const line of geometry) {
          for (const piece of clipLine(line, 0, extent)) {
            const flat = toPixels(piece, placement, extent, options.tolerance, false);
            if (flat) {
              parts.push(flat);
            }
          }
        }
      } else {
        for (const ring of geometry) {
          const clipped = clipRing(ring, -overlap, extent + overlap);
          const flat =
            clipped.length >= 3 ? toPixels(clipped, placement, extent, options.tolerance, true, onEdge) : undefined;
          if (flat) {
            parts.push(flat);
          }
          const closed = ring.length > 0 ? [...ring, ring[0]] : ring;
          for (const piece of clipLine(closed, 0, extent, true)) {
            const line = toPixels(piece, placement, extent, options.tolerance, false);
            if (line) {
              outline.push(line);
            }
          }
        }
      }
      if (parts.length === 0) {
        continue;
      }

      features.push({
        layer: layerName,
        kind,
        detail,
        type,
        parts,
        ...(type === 'polygon' && { outline }),
        name: getName(properties),
        minZoom,
        rank: num(properties.population_rank),
        population: num(properties.population),
        sortRank: num(properties.sort_rank),
        isTunnel: properties.is_tunnel === true,
        isBridge: properties.is_bridge === true,
        isLink: properties.is_link === true,
      });
    }
  }
  return features;
};
