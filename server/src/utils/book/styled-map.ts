import type { MapFeature } from 'src/utils/book/vector-tiles.js';
import { MapLook, mix } from 'src/utils/book/map-looks.js';
import { escapeXml } from 'src/utils/book/render.js';

/**
 * Draws the real map data of a styled map (see vector-tiles.ts) as SVG in one of the looks of map-looks.ts: water,
 * land, land use, roads, rail and the names of places, with collision-free labels.
 */

export type Box = { x: number; y: number; width: number; height: number };

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const fmt = (value: number) => (Math.round(value * 10) / 10).toString();

export type MapCategory =
  | 'water'
  | 'river'
  | 'stream'
  | 'park'
  | 'forest'
  | 'farmland'
  | 'urban'
  | 'sand'
  | 'building'
  | 'highway'
  | 'major'
  | 'minor'
  | 'path'
  | 'rail'
  | 'ferry'
  | 'boundary'
  | 'earth';

const PARK_KINDS = new Set([
  'park',
  'garden',
  'cemetery',
  'golf_course',
  'grass',
  'village_green',
  'allotments',
  'playground',
  'pitch',
  'zoo',
  'recreation_ground',
  'dog_park',
]);
const FOREST_KINDS = new Set(['forest', 'wood', 'scrub']);
const FARM_KINDS = new Set(['farmland', 'orchard', 'vineyard', 'meadow', 'farmyard', 'grassland', 'plant_nursery']);
const URBAN_KINDS = new Set([
  'urban_area',
  'residential',
  'commercial',
  'retail',
  'industrial',
  'school',
  'university',
  'college',
  'hospital',
  'railway',
  'military',
  'naval_base',
  'aerodrome',
  'airfield',
  'pedestrian',
  'parking',
  'brownfield',
  'construction',
]);
const SAND_KINDS = new Set(['beach', 'sand', 'barren', 'dune', 'bare_rock', 'glacier']);
const WATER_SKIP = new Set(['swimming_pool', 'fountain', 'ocean']);

/**
 * The category a feature is drawn in at a zoom, if any: the density of roads, paths and buildings grows with the
 * zoom, so a region map shows its main roads and a city map every street
 */
export const classifyFeature = (feature: MapFeature, zoom: number): MapCategory | undefined => {
  const { layer, kind, detail, type } = feature;
  switch (layer) {
    case 'earth': {
      return type === 'polygon' ? 'earth' : undefined;
    }
    case 'water': {
      if (type === 'polygon') {
        return WATER_SKIP.has(kind) ? undefined : 'water';
      }
      if (type === 'line') {
        if (kind === 'river' || kind === 'canal') {
          return zoom >= 8 ? 'river' : undefined;
        }
        return kind === 'stream' && zoom >= 13 ? 'stream' : undefined;
      }
      return;
    }
    case 'landcover':
    case 'landuse': {
      if (type !== 'polygon') {
        return;
      }
      if (FOREST_KINDS.has(kind)) {
        return 'forest';
      }
      if (PARK_KINDS.has(kind)) {
        return 'park';
      }
      if (FARM_KINDS.has(kind)) {
        return zoom <= 13 ? 'farmland' : undefined;
      }
      if (SAND_KINDS.has(kind)) {
        return 'sand';
      }
      if (URBAN_KINDS.has(kind)) {
        // at city scale every block is residential: only the squares and campuses stand out
        return zoom >= 14 && kind === 'residential' ? undefined : 'urban';
      }
      return;
    }
    case 'buildings': {
      return type === 'polygon' && zoom >= 14 && kind !== 'address' ? 'building' : undefined;
    }
    case 'roads': {
      if (type !== 'line' || feature.isTunnel) {
        return;
      }
      switch (kind) {
        case 'highway': {
          return feature.isLink && zoom < 13 ? undefined : 'highway';
        }
        case 'major_road': {
          if (feature.isLink && zoom < 13) {
            return;
          }
          if (detail === 'tertiary' && zoom < 12) {
            // drawn as the smaller roads on a region, not at all on a country
            return zoom >= 9 ? 'minor' : undefined;
          }
          return 'major';
        }
        case 'minor_road': {
          if (zoom < 12 || (detail === 'service' && zoom < 15)) {
            return;
          }
          return 'minor';
        }
        case 'other': {
          return zoom >= 14 ? 'minor' : undefined;
        }
        case 'path': {
          if (detail === 'pedestrian' && zoom >= 14) {
            return 'minor';
          }
          return zoom >= 15 && detail !== 'track' && detail !== 'crossing' && detail !== 'sidewalk'
            ? 'path'
            : undefined;
        }
        case 'rail': {
          return !detail || detail === 'rail' || detail === 'narrow_gauge' ? 'rail' : undefined;
        }
        case 'ferry': {
          return 'ferry';
        }
      }
      return;
    }
    case 'boundaries': {
      if (type !== 'line') {
        return;
      }
      const level = Number(detail ?? 99);
      return level <= 2 || (level <= 4 && zoom <= 8) ? 'boundary' : undefined;
    }
  }
};

type Collected = Record<MapCategory, MapFeature[]>;

const collect = (features: MapFeature[], zoom: number) => {
  const groups = Object.fromEntries(
    (
      [
        'water',
        'river',
        'stream',
        'park',
        'forest',
        'farmland',
        'urban',
        'sand',
        'building',
        'highway',
        'major',
        'minor',
        'path',
        'rail',
        'ferry',
        'boundary',
        'earth',
      ] as MapCategory[]
    ).map((category) => [category, [] as MapFeature[]]),
  ) as Collected;
  for (const feature of features) {
    const category = classifyFeature(feature, zoom);
    if (category) {
      groups[category].push(feature);
    }
  }
  return groups;
};

const toPath = (parts: number[][], closed: boolean) => {
  const out: string[] = [];
  for (const flat of parts) {
    if (flat.length < 4) {
      continue;
    }
    out.push(`M${fmt(flat[0])},${fmt(flat[1])}`);
    for (let i = 2; i < flat.length; i += 2) {
      out.push(`L${fmt(flat[i])},${fmt(flat[i + 1])}`);
    }
    if (closed) {
      out.push('Z');
    }
  }
  return out.join('');
};

const fillPath = (features: MapFeature[]) => features.map((feature) => toPath(feature.parts, true)).join('');
const linePath = (features: MapFeature[]) => features.map((feature) => toPath(feature.parts, false)).join('');
const outlinePath = (features: MapFeature[]) =>
  features.map((feature) => toPath(feature.outline ?? [], false)).join('');

type LineStyle = { color: string; width: number; opacity: number; dash?: number[] };

const stroke = (d: string, line: LineStyle, u: number, scale = 1, extra = '') =>
  d
    ? `<path d="${d}" fill="none" stroke="${line.color}" stroke-opacity="${line.opacity}" stroke-width="${fmt(line.width * scale * u)}" stroke-linecap="round" stroke-linejoin="round"${
        line.dash
          ? ` stroke-dasharray="${line.dash.map((value) => fmt(value * u * Math.max(1, scale))).join(' ')}"`
          : ''
      }${extra}/>`
    : '';

/**
 * a fill drawn opaque in a group with the opacity, so that overlapping pieces do not darken; nonzero, as the rings of
 * vector tiles wind one way around the outside and the other around holes, and the tiles overlap a little
 */
const wash = (d: string, fill: { color: string; opacity: number }, extra = '') =>
  d && fill.opacity > 0
    ? `<g opacity="${fill.opacity}"${extra}><path d="${d}" fill="${fill.color}" fill-rule="nonzero"/></g>`
    : '';

/** how much wider roads are drawn at a zoom: streets are wide at city scale, roads thin on a region */
export const getRoadScale = (zoom: number) => Math.min(2, Math.max(0.55, 0.55 + (zoom - 8) * 0.24));

export type GraticuleLine = { value: number; d: string; label: string; axis: 'lat' | 'lon'; at: number };

const DEGREE_STEPS = [1 / 120, 1 / 60, 1 / 30, 1 / 12, 1 / 6, 0.25, 0.5, 1, 2, 5, 10, 15, 30];

/** a round step in degrees that draws 2 to 5 lines across the span */
export const getGraticuleStep = (spanDegrees: number) =>
  DEGREE_STEPS.find((step) => spanDegrees / step <= 4.5) ?? DEGREE_STEPS.at(-1)!;

const pad = (number: number) => String(number).padStart(2, '0');

/** 37°50′N, 15°17′E, 38°34′30″N */
export const formatDegrees = (value: number, axis: 'lat' | 'lon') => {
  const hemisphere = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const totalSeconds = Math.round(Math.abs(value) * 3600);
  const degrees = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (seconds !== 0) {
    return `${degrees}°${pad(minutes)}′${pad(seconds)}″${hemisphere}`;
  }
  return minutes === 0 ? `${degrees}°${hemisphere}` : `${degrees}°${pad(minutes)}′${hemisphere}`;
};

export type StyledMapInput = {
  width: number;
  height: number;
  /** a thousandth of the shorter side */
  u: number;
  zoom: number;
  features: MapFeature[];
  look: MapLook;
  /** the geographic bounds of the page, and the projection to page pixels, for the graticule */
  bounds: { west: number; south: number; east: number; north: number };
  toPixel: (lat: number, lon: number) => { x: number; y: number };
  seed: number;
};

/** the water lines of an engraved map: rings of ink along the coast, drawn as wide strokes cut by narrower ones */
const renderWaterLines = (coast: string, look: MapLook, u: number) => {
  const lines = look.waterLines;
  if (!lines || !coast) {
    return '';
  }
  const ink = mix(look.sea.color, lines.color, lines.opacity);
  const parts: string[] = [];
  for (let i = lines.count; i >= 1; i--) {
    // the lines thin out and spread away from the coast
    const distance = lines.spacing * (i + (i * (i - 1)) / 6);
    const width = lines.width * (1 - (i - 1) / (lines.count * 1.6));
    parts.push(
      `<path d="${coast}" fill="none" stroke="${ink}" stroke-width="${fmt((2 * distance + width) * u)}" stroke-linejoin="round" stroke-linecap="round"/>`,
      `<path d="${coast}" fill="none" stroke="${look.sea.color}" stroke-width="${fmt(Math.max(0.1, 2 * distance - width) * u)}" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  }
  return `<g>${parts.join('')}</g>`;
};

const renderGraticule = (input: StyledMapInput) => {
  const { look, bounds, toPixel, width, height, u } = input;
  if (!look.graticule) {
    return { svg: '', lines: [] as GraticuleLine[] };
  }
  const step = getGraticuleStep(Math.min(bounds.east - bounds.west, bounds.north - bounds.south) * 1.3);
  const lines: GraticuleLine[] = [];
  for (let lon = Math.ceil(bounds.west / step) * step; lon <= bounds.east; lon += step) {
    const x = toPixel(0, lon).x;
    if (x > 0 && x < width) {
      lines.push({
        value: lon,
        d: `M${fmt(x)},0V${fmt(height)}`,
        label: formatDegrees(lon, 'lon'),
        axis: 'lon',
        at: x,
      });
    }
  }
  for (let lat = Math.ceil(bounds.south / step) * step; lat <= bounds.north; lat += step) {
    const y = toPixel(lat, bounds.west).y;
    if (y > 0 && y < height) {
      lines.push({ value: lat, d: `M0,${fmt(y)}H${fmt(width)}`, label: formatDegrees(lat, 'lat'), axis: 'lat', at: y });
    }
  }
  const svg = stroke(
    lines.map((line) => line.d).join(''),
    { ...look.graticule, dash: look.id === 'vintage' ? undefined : [1, 3] },
    u,
  );
  return { svg, lines };
};

const hatchPattern = (id: string, look: MapLook, u: number, angle: number) => {
  const hatch = look.hatch!;
  const spacing = hatch.spacing * u;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${fmt(spacing)}" height="${fmt(spacing)}" patternTransform="rotate(${angle})"><line x1="0" y1="0" x2="0" y2="${fmt(spacing)}" stroke="${hatch.color}" stroke-opacity="${hatch.opacity}" stroke-width="${fmt(hatch.width * u)}"/></pattern>`;
};

/**
 * The basemap of a styled map as SVG: the sea, the land, land use, water, buildings, roads, rail, the coast and the
 * graticule. Labels are drawn separately (see `getMapLabels`), over it and under the route and pins.
 */
export const renderStyledBasemap = (input: StyledMapInput) => {
  const { width, height, u, zoom, look } = input;
  const groups = collect(input.features, zoom);
  const roadScale = getRoadScale(zoom);
  const defs: string[] = [];
  const body: string[] = [];

  if (look.wobble) {
    defs.push(
      `<filter id="wobble" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">`,
      `<feTurbulence type="fractalNoise" baseFrequency="${(0.012 / u).toPrecision(3)}" numOctaves="2" seed="${input.seed % 997}" result="noise"/>`,
      `<feDisplacementMap in="SourceGraphic" in2="noise" scale="${fmt(look.wobble * u)}" xChannelSelector="R" yChannelSelector="G"/>`,
      `</filter>`,
      `<filter id="bleed" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><feGaussianBlur stdDeviation="${fmt(2.2 * u)}"/></filter>`,
      `<filter id="blotch" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">`,
      `<feTurbulence type="fractalNoise" baseFrequency="${(0.004 / u).toPrecision(3)}" numOctaves="2" seed="${(input.seed + 11) % 997}" result="noise"/>`,
      `<feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.25" result="mask"/>`,
      `<feComposite in="SourceGraphic" in2="mask" operator="in"/>`,
      `</filter>`,
    );
  }
  if (look.coastBand) {
    defs.push(
      `<filter id="band" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><feGaussianBlur stdDeviation="${fmt(look.coastBand.width * 0.35 * u)}"/></filter>`,
    );
  }
  if (look.hatch) {
    defs.push(hatchPattern('hatch-a', look, u, 45), hatchPattern('hatch-b', look, u, -45));
  }

  const coast = outlinePath(groups.earth);
  const land = fillPath(groups.earth);
  // no land in the tiles: the whole view is land (inland) unless it has no tiles at all
  const allSea = groups.earth.length === 0 && input.features.length > 0 && groups.water.length > 0 && !land;

  // the sea
  body.push(`<rect width="${width}" height="${height}" fill="${look.paper}"/>`);
  if (look.sea.opacity > 0) {
    body.push(
      look.wobble
        ? `<g filter="url(#blotch)"><rect width="${width}" height="${height}" fill="${mix(look.sea.color, '#2f5f7a', 0.25)}" opacity="${look.sea.opacity * 0.5}"/></g><rect width="${width}" height="${height}" fill="${look.sea.color}" opacity="${look.sea.opacity * 0.75}"/>`
        : `<rect width="${width}" height="${height}" fill="${look.sea.color}" opacity="${look.sea.opacity}"/>`,
    );
  }
  if (look.coastBand && coast) {
    body.push(
      `<g filter="url(#band)" opacity="${look.coastBand.opacity}"><path d="${coast}" fill="none" stroke="${look.coastBand.color}" stroke-width="${fmt(look.coastBand.width * u)}" stroke-linejoin="round"/></g>`,
    );
  }
  body.push(renderWaterLines(coast, look, u));
  if (look.pigmentEdge && coast) {
    body.push(`<g filter="url(#bleed)">${stroke(coast, look.pigmentEdge, u, 1)}</g>`);
  }

  // the land, land use and inland water, displaced together when the look has hand-drawn edges
  const shaped: string[] = [];
  if (land || (groups.earth.length === 0 && !allSea)) {
    shaped.push(
      land
        ? `<path d="${land}" fill="${look.land}" fill-rule="nonzero"/>`
        : `<rect width="${width}" height="${height}" fill="${look.land}"/>`,
    );
  }

  // land use, from the widest to the smallest
  shaped.push(
    wash(fillPath(groups.farmland), look.farmland),
    wash(fillPath(groups.urban), look.urban),
    wash(fillPath(groups.sand), look.sand),
    wash(fillPath(groups.forest), look.forest),
    wash(fillPath(groups.park), look.park),
  );
  if (look.hatch) {
    const forest = fillPath(groups.forest);
    const park = fillPath(groups.park);
    shaped.push(
      forest ? `<path d="${forest}" fill="url(#hatch-a)" fill-rule="nonzero"/>` : '',
      forest ? `<path d="${forest}" fill="url(#hatch-b)" fill-rule="nonzero"/>` : '',
      park ? `<path d="${park}" fill="url(#hatch-a)" fill-rule="nonzero"/>` : '',
    );
  }

  // lakes and rivers
  const water = fillPath(groups.water);
  const banks = outlinePath(groups.water);
  if (water) {
    shaped.push(
      `<path d="${water}" fill="${look.wobble ? mix(look.paper, look.sea.color, look.sea.opacity) : look.sea.color}" fill-rule="nonzero"/>`,
    );
  }
  shaped.push(
    stroke(linePath(groups.river), look.river, u, Math.min(1.6, roadScale)),
    stroke(linePath(groups.stream), { ...look.river, width: look.river.width * 0.5 }, u, 1),
  );
  if (look.pigmentEdge && banks) {
    shaped.push(`<g filter="url(#bleed)">${stroke(banks, look.pigmentEdge, u, 0.7)}</g>`);
  }
  if (look.wobble) {
    // the coast moves with the land
    shaped.push(stroke(coast, look.coast, u), stroke(banks, { ...look.coast, width: look.coast.width * 0.7 }, u));
  }
  body.push(look.wobble ? `<g filter="url(#wobble)">${shaped.join('')}</g>` : shaped.join(''));
  // what is above is soft (washes and hand-drawn edges), what follows crisp lines
  const soft = [...body];
  body.length = 0;

  // buildings
  if (look.buildings && groups.building.length > 0) {
    const d = fillPath(groups.building);
    body.push(wash(d, look.buildings), look.buildings.stroke ? stroke(d, look.buildings.stroke, u) : '');
  }

  // the coast and the banks, over the land use
  if (!look.wobble) {
    body.push(stroke(coast, look.coast, u), stroke(banks, { ...look.coast, width: look.coast.width * 0.7 }, u));
  }

  // roads, the smallest first
  const { roads } = look;
  const minor = linePath(groups.minor);
  const major = linePath(groups.major);
  const highway = linePath(groups.highway);
  if (roads.path) {
    body.push(stroke(linePath(groups.path), roads.path, u, Math.max(1, roadScale * 0.7)));
  }
  body.push(stroke(minor, roads.minor, u, roadScale));
  if (roads.casing) {
    body.push(
      stroke(major, { ...roads.casing, width: roads.major.width + roads.casing.width * 2 }, u, roadScale),
      stroke(highway, { ...roads.casing, width: roads.highway.width + roads.casing.width * 2 }, u, roadScale),
    );
  }
  body.push(
    stroke(major, roads.major, u, roadScale),
    stroke(highway, roads.highway, u, roadScale),
    stroke(linePath(groups.rail), look.rail, u, Math.min(1.5, roadScale)),
    stroke(linePath(groups.ferry), { ...look.river, width: look.river.width * 0.6, dash: [6, 4] }, u, 1),
    stroke(linePath(groups.boundary), look.boundary, u),
  );

  const graticule = renderGraticule(input);
  body.push(graticule.svg);

  return {
    defs: defs.join(''),
    /** the sea, the land, land use and water: washes that can be drawn at a lower resolution and scaled up */
    soft: soft.join(''),
    /** buildings, roads, rail, borders and the graticule */
    crisp: body.join(''),
    graticule: graticule.lines,
  };
};

export type MapLabelCandidate = {
  text: string;
  x: number;
  y: number;
  /** larger first */
  priority: number;
  size: number;
  kind: 'city' | 'town' | 'village' | 'neighbourhood' | 'region' | 'country' | 'water' | 'island';
};

const PLACE_SIZES: Record<MapLabelCandidate['kind'], number> = {
  country: 1.15,
  region: 0.85,
  city: 1,
  town: 0.82,
  village: 0.68,
  neighbourhood: 0.6,
  water: 0.85,
  island: 0.72,
};

const getPlaceKind = (feature: MapFeature, zoom: number): MapLabelCandidate['kind'] | undefined => {
  if (feature.layer === 'places') {
    switch (feature.kind) {
      case 'country': {
        return zoom <= 7 ? 'country' : undefined;
      }
      case 'region': {
        return zoom >= 5 && zoom <= 9 ? 'region' : undefined;
      }
      case 'locality': {
        if (feature.detail === 'city') {
          return 'city';
        }
        if (feature.detail === 'town') {
          return 'town';
        }
        return zoom >= 10 ? 'village' : undefined;
      }
      case 'neighbourhood':
      case 'macrohood': {
        return zoom >= 13 ? 'neighbourhood' : undefined;
      }
    }
    return;
  }
  if (feature.layer === 'water' && feature.type === 'point') {
    if (['ocean', 'sea', 'bay', 'strait', 'gulf', 'fjord'].includes(feature.kind)) {
      return 'water';
    }
    return ['lake', 'water'].includes(feature.kind) && zoom >= 9 && zoom <= 14 ? 'water' : undefined;
  }
  if (feature.layer === 'earth' && feature.type === 'point' && feature.kind === 'island') {
    return zoom <= 12 ? 'island' : undefined;
  }
};

const KIND_PRIORITY: Record<MapLabelCandidate['kind'], number> = {
  country: 90,
  water: 70,
  city: 80,
  region: 50,
  town: 60,
  island: 55,
  village: 40,
  neighbourhood: 30,
};

/** The places and waters of the tiles worth naming at this zoom, most important first, one per name */
export const getMapLabelCandidates = (features: MapFeature[], zoom: number, look: MapLook): MapLabelCandidate[] => {
  const byName = new Map<string, MapLabelCandidate>();
  for (const feature of features) {
    if (feature.type !== 'point' || !feature.name) {
      continue;
    }
    const kind = getPlaceKind(feature, zoom);
    if (!kind) {
      continue;
    }
    const [x, y] = feature.parts[0];
    const rank = feature.rank ?? 0;
    const candidate: MapLabelCandidate = {
      text: feature.name.trim(),
      x,
      y,
      kind,
      priority: KIND_PRIORITY[kind] + rank - (feature.minZoom ?? 0) * 0.5,
      size: look.labels.size * PLACE_SIZES[kind],
    };
    const key = candidate.text.toLocaleLowerCase('en');
    const existing = byName.get(key);
    if (!existing || existing.priority < candidate.priority) {
      byName.set(key, candidate);
    }
  }
  return byName
    .values()
    .toArray()
    .toSorted((a, b) => b.priority - a.priority);
};

const CHAR_WIDTHS = { upper: 0.7, lower: 0.5, space: 0.3, other: 0.55 };

/** the width of a line of text, estimated from its letters */
export const estimateTextWidth = (text: string, fontPx: number, letterSpacing = 0) => {
  let width = 0;
  for (const char of text) {
    if (char === ' ') {
      width += CHAR_WIDTHS.space;
    } else if (char !== char.toLowerCase()) {
      width += CHAR_WIDTHS.upper;
    } else if (char === char.toUpperCase()) {
      width += CHAR_WIDTHS.other;
    } else {
      width += CHAR_WIDTHS.lower;
    }
  }
  return width * fontPx + letterSpacing * Math.max(0, [...text].length - 1);
};

export type PlacedMapLabel = MapLabelCandidate & {
  box: Box;
  anchor: 'start' | 'middle' | 'end';
  baseline: number;
  dot: boolean;
  display: string;
  fontPx: number;
  letterSpacing: number;
};

const usesDot = (candidate: MapLabelCandidate, zoom: number) =>
  candidate.kind === 'town' || candidate.kind === 'village' || (candidate.kind === 'city' && zoom <= 11);

const labelStyle = (candidate: MapLabelCandidate, look: MapLook, u: number) => {
  const upper =
    (look.labels.upperCities && ['city', 'town', 'region', 'country'].includes(candidate.kind)) ||
    candidate.kind === 'neighbourhood' ||
    candidate.kind === 'region' ||
    candidate.kind === 'country';
  const spaced = upper || candidate.kind === 'water';
  const fontPx = candidate.size * u;
  return {
    display: upper ? candidate.text.toLocaleUpperCase() : candidate.text,
    fontPx,
    letterSpacing: spaced ? fontPx * (candidate.kind === 'water' || candidate.kind === 'region' ? 0.22 : 0.12) : 0,
  };
};

/**
 * Places the names of places without overlapping each other, the obstacles (pins, the route's labels, the title) or
 * the edges: towns next to their dot, cities, districts and waters centred on their point. At most `max`.
 */
export const placeMapLabels = (
  candidates: MapLabelCandidate[],
  options: {
    width: number;
    height: number;
    u: number;
    zoom: number;
    look: MapLook;
    obstacles: Box[];
    max: number;
    /** names not to draw (lower case), e.g. those the route already shows */
    exclude?: Set<string>;
    /** room kept free along the edges, in design pixels */
    inset?: number;
  },
): PlacedMapLabel[] => {
  const { width, height, u, zoom, look } = options;
  const margin = (18 + (options.inset ?? 0)) * u;
  const taken = [...options.obstacles];
  const placed: PlacedMapLabel[] = [];

  for (const candidate of candidates) {
    if (placed.length >= options.max) {
      break;
    }
    if (options.exclude?.has(candidate.text.toLocaleLowerCase('en'))) {
      continue;
    }

    const { display, fontPx, letterSpacing } = labelStyle(candidate, look, u);
    const textWidth = estimateTextWidth(display, fontPx, letterSpacing);
    const textHeight = fontPx * 1.2;
    const dot = usesDot(candidate, zoom);
    const gap = dot ? fontPx * 0.45 : 0;
    const positions: Array<{ x: number; y: number; anchor: PlacedMapLabel['anchor'] }> = dot
      ? [
          { x: candidate.x + gap, y: candidate.y - textHeight / 2, anchor: 'start' },
          { x: candidate.x - gap - textWidth, y: candidate.y - textHeight / 2, anchor: 'end' },
          { x: candidate.x - textWidth / 2, y: candidate.y - gap - textHeight, anchor: 'middle' },
          { x: candidate.x - textWidth / 2, y: candidate.y + gap, anchor: 'middle' },
        ]
      : [
          { x: candidate.x - textWidth / 2, y: candidate.y - textHeight / 2, anchor: 'middle' },
          { x: candidate.x - textWidth / 2, y: candidate.y - textHeight * 1.3, anchor: 'middle' },
          { x: candidate.x - textWidth / 2, y: candidate.y + textHeight * 0.3, anchor: 'middle' },
        ];

    const dotBox: Box | undefined = dot
      ? { x: candidate.x - 3 * u, y: candidate.y - 3 * u, width: 6 * u, height: 6 * u }
      : undefined;
    if (dotBox && taken.some((other) => intersects(dotBox, other))) {
      continue;
    }

    const fit = positions.find(({ x, y }) => {
      const box = { x, y, width: textWidth, height: textHeight };
      return (
        x >= margin &&
        y >= margin &&
        x + textWidth <= width - margin &&
        y + textHeight <= height - margin &&
        taken.every((other) => !intersects(box, other))
      );
    });
    if (!fit) {
      continue;
    }

    const box = { x: fit.x, y: fit.y, width: textWidth, height: textHeight };
    // a little room around each label
    taken.push({
      x: box.x - fontPx * 0.4,
      y: box.y - fontPx * 0.2,
      width: box.width + fontPx * 0.8,
      height: box.height + fontPx * 0.4,
    });
    if (dotBox) {
      taken.push(dotBox);
    }
    placed.push({
      ...candidate,
      box,
      anchor: fit.anchor,
      baseline: box.y + fontPx * 0.92,
      dot,
      display,
      fontPx,
      letterSpacing,
    });
  }
  return placed;
};

/** The placed names as SVG text with a halo of the paper */
export const renderMapLabels = (labels: PlacedMapLabel[], look: MapLook, u: number) =>
  labels
    .map((label) => {
      const x =
        label.anchor === 'start'
          ? label.box.x
          : label.anchor === 'end'
            ? label.box.x + label.box.width
            : label.box.x + label.box.width / 2;
      const water = label.kind === 'water' || label.kind === 'island';
      const color = label.kind === 'water' ? look.labels.water : look.labels.color;
      const italic = (water && look.labels.italicWater) || (look.id === 'wash' && label.kind !== 'neighbourhood');
      const weight = label.kind === 'city' && look.id !== 'minimal' ? ' font-weight="bold"' : '';
      const opacity = label.kind === 'neighbourhood' || label.kind === 'region' ? ' fill-opacity="0.75"' : '';
      const dot = label.dot
        ? `<circle cx="${fmt(label.x)}" cy="${fmt(label.y)}" r="${fmt((label.kind === 'village' ? 2.2 : 3) * u)}" fill="${look.labels.color}" stroke="${look.labels.halo}" stroke-width="${fmt(1.2 * u)}"/>`
        : '';
      return (
        dot +
        `<text x="${fmt(x)}" y="${fmt(label.baseline)}" font-family="${escapeXml(look.labels.font)}" font-size="${fmt(label.fontPx)}"${weight}${italic ? ' font-style="italic"' : ''}${label.letterSpacing ? ` letter-spacing="${fmt(label.letterSpacing)}"` : ''} fill="${color}"${opacity} stroke="${look.labels.halo}" stroke-opacity="0.85" stroke-width="${fmt(Math.max(2, label.fontPx * 0.22))}" stroke-linejoin="round" paint-order="stroke" text-anchor="${label.anchor}">${escapeXml(label.display)}</text>`
      );
    })
    .join('');

/**
 * The frame of a styled map: a double rule (engraved) or a neatline of alternating bars (vintage), with the degrees of
 * the graticule along the edges where nothing else is
 */
export const renderStyledFrame = (input: {
  width: number;
  height: number;
  u: number;
  look: MapLook;
  graticule: GraticuleLine[];
  taken: Box[];
}): { svg: string; taken: Box[] } => {
  const { width, height, u, look } = input;
  const ink = look.labels.color;
  const parts: string[] = [];
  const taken: Box[] = [];
  const rect = (inset: number, strokeWidth: number, extra = '') =>
    `<rect x="${fmt(inset * u)}" y="${fmt(inset * u)}" width="${fmt(width - 2 * inset * u)}" height="${fmt(height - 2 * inset * u)}" fill="none" stroke="${ink}" stroke-width="${fmt(strokeWidth * u)}"${extra}/>`;

  let inner = 0;
  if (look.frame === 'double') {
    parts.push(rect(8, 1.8), rect(13, 0.7));
    inner = 13;
  } else if (look.frame === 'neatline') {
    const outer = 8;
    inner = 19;
    const box = (inset: number) =>
      `M${fmt(inset * u)},${fmt(inset * u)}H${fmt(width - inset * u)}V${fmt(height - inset * u)}H${fmt(inset * u)}Z`;
    // the band of the neatline is paper, over the map that runs under it
    parts.push(`<path d="${box(0)}${box(inner)}" fill="${look.paper}" fill-rule="evenodd"/>`);
    // alternating bars between the ticks of the graticule, four to a step
    const bars: string[] = [];
    const bar = (axis: 'lat' | 'lon', from: number, to: number) => {
      const a = Math.max(inner * u, Math.min(from, to));
      const b = Math.min((axis === 'lon' ? width : height) - inner * u, Math.max(from, to));
      if (b <= a) {
        return;
      }
      const band = (inner - outer) * u;
      if (axis === 'lon') {
        bars.push(
          `M${fmt(a)},${fmt(outer * u)}H${fmt(b)}v${fmt(band / 2)}H${fmt(a)}Z`,
          `M${fmt(a)},${fmt(height - outer * u - band / 2)}H${fmt(b)}v${fmt(band / 2)}H${fmt(a)}Z`,
        );
      } else {
        bars.push(
          `M${fmt(outer * u)},${fmt(a)}V${fmt(b)}h${fmt(band / 2)}V${fmt(a)}Z`,
          `M${fmt(width - outer * u - band / 2)},${fmt(a)}V${fmt(b)}h${fmt(band / 2)}V${fmt(a)}Z`,
        );
      }
    };
    for (const axis of ['lon', 'lat'] as const) {
      const ticks = input.graticule
        .filter((line) => line.axis === axis)
        .map((line) => line.at)
        .toSorted((a, b) => a - b);
      const length = axis === 'lon' ? width : height;
      const step = ticks.length >= 2 ? (ticks[1] - ticks[0]) / 4 : 60 * u;
      const start = ticks.length > 0 ? ticks[0] - Math.ceil(ticks[0] / step) * step : 0;
      let index = 0;
      for (let at = start; at < length; at += step, index++) {
        if (index % 2 === 0) {
          bar(axis, at, at + step);
        }
      }
    }
    parts.push(
      `<path d="${bars.join('')}" fill="${ink}" fill-opacity="0.85"/>`,
      rect(outer, 1.2),
      rect(outer + (inner - outer) / 2, 0.5),
      rect(inner, 0.9),
    );
  }

  if (look.graticule && input.graticule.length > 0) {
    const fontPx = 12 * u;
    const edge = (inner + 5) * u;
    for (const line of input.graticule) {
      const textWidth = estimateTextWidth(line.label, fontPx);
      const box: Box =
        line.axis === 'lon'
          ? { x: line.at + 4 * u, y: edge, width: textWidth, height: fontPx * 1.2 }
          : { x: edge, y: line.at - 4 * u - fontPx * 1.2, width: textWidth, height: fontPx * 1.2 };
      if (
        box.x + box.width > width - edge ||
        box.y < edge ||
        [...input.taken, ...taken].some((other) => intersects(box, other))
      ) {
        continue;
      }
      taken.push(box);
      parts.push(
        `<text x="${fmt(box.x)}" y="${fmt(box.y + fontPx * 0.95)}" font-family="${escapeXml(look.labels.font)}" font-size="${fmt(fontPx)}" font-style="italic" fill="${ink}" fill-opacity="0.8" stroke="${look.paper}" stroke-opacity="0.8" stroke-width="${fmt(fontPx * 0.2)}" paint-order="stroke">${escapeXml(line.label)}</text>`,
      );
    }
  }

  return { svg: parts.join(''), taken };
};
