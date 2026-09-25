import sharp from 'sharp';
import { resolveMapStyle, tileStyles } from 'src/utils/book/map-styles.js';
import {
  MAP_ATTRIBUTION,
  MapPoint,
  TILE_SIZE,
  chooseZoom,
  clearTileCache,
  fitViewport,
  getPlaceLabels,
  getRoutePath,
  getScaleBar,
  getStops,
  getTileRange,
  getTileUrl,
  parsePolygon,
  placeLabels,
  project,
  renderMap,
  renderMapImage,
  toPixel,
  unproject,
} from 'src/utils/book/map.js';

const rome: MapPoint = { lat: 41.9028, lon: 12.4964, time: 1, city: 'Rome' };
const florence: MapPoint = { lat: 43.7696, lon: 11.2558, time: 2, city: 'Florence' };
const venice: MapPoint = { lat: 45.4408, lon: 12.3155, time: 3, city: 'Venice' };
const lisbon: MapPoint = { lat: 38.7223, lon: -9.1393, time: 4, city: 'Lisbon' };

const tile = (color = '#88aacc') =>
  sharp({ create: { width: TILE_SIZE, height: TILE_SIZE, channels: 3, background: color } })
    .png()
    .toBuffer();

const mockFetch = (handler: (url: string) => Promise<Response>) =>
  vi.fn((url: string | URL | Request) => handler(String(url)));

describe('project', () => {
  it('should map the equator and prime meridian to the centre of the world', () => {
    expect(project(0, 0)).toEqual({ x: 0.5, y: 0.5 });
    expect(project(0, -180).x).toBe(0);
    expect(project(0, 180).x).toBe(1);
  });

  it('should clamp to the Web Mercator latitude limit', () => {
    expect(project(85.05112878, 0).y).toBeCloseTo(0, 6);
    expect(project(90, 0).y).toBeCloseTo(0, 6);
    expect(project(-89, 0).y).toBeCloseTo(1, 6);
  });

  it('should round-trip through unproject', () => {
    const { x, y } = project(rome.lat, rome.lon);
    const back = unproject(x, y);
    expect(back.lat).toBeCloseTo(rome.lat, 8);
    expect(back.lon).toBeCloseTo(rome.lon, 8);
  });
});

describe('fitViewport', () => {
  it('should fit all points inside the padding', () => {
    const size = { width: 1000, height: 600 };
    const points = [rome, florence, venice, lisbon].map((point) => project(point.lat, point.lon));
    const viewport = fitViewport(points, size, 50);

    const pixels = points.map((point) => toPixel(viewport, point));
    for (const pixel of pixels) {
      expect(pixel.x).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(pixel.x).toBeLessThanOrEqual(950 + 1e-6);
      expect(pixel.y).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(pixel.y).toBeLessThanOrEqual(550 + 1e-6);
    }
    // the limiting axis touches the padding
    const xs = pixels.map((pixel) => pixel.x);
    const ys = pixels.map((pixel) => pixel.y);
    const touchesX = Math.abs(Math.min(...xs) - 50) < 1e-6 && Math.abs(Math.max(...xs) - 950) < 1e-6;
    const touchesY = Math.abs(Math.min(...ys) - 50) < 1e-6 && Math.abs(Math.max(...ys) - 550) < 1e-6;
    expect(touchesX || touchesY).toBe(true);
  });

  it('should not zoom in endlessly on a single point', () => {
    const point = project(rome.lat, rome.lon);
    const viewport = fitViewport([point], { width: 1000, height: 1000 }, 100);
    expect(toPixel(viewport, point)).toEqual({ x: 500, y: 500 });
    expect(Number.isFinite(viewport.scale)).toBe(true);
    // at least about 3 km across
    expect(800 / viewport.scale).toBeCloseTo(0.00008, 8);
  });
});

describe('getScaleBar', () => {
  it('should pick a round distance', () => {
    expect(getScaleBar(10, 180)).toEqual({ meters: 1000, pixels: 100, label: '1 km' });
    expect(getScaleBar(1, 180)).toEqual({ meters: 100, pixels: 100, label: '100 m' });
    expect(getScaleBar(3000, 200)).toEqual({ meters: 500_000, pixels: 500_000 / 3000, label: '500 km' });
  });
});

describe('tiles', () => {
  it('should choose the zoom whose tiles are at least as detailed as the map', () => {
    const viewport = { x: 0.5, y: 0.5, scale: TILE_SIZE * 2 ** 10, width: 1024, height: 1024 };
    expect(chooseZoom(viewport, 16)).toBe(10);
    expect(chooseZoom({ ...viewport, scale: TILE_SIZE * 2 ** 10 * 1.2 }, 16)).toBe(11);
    expect(chooseZoom({ ...viewport, scale: TILE_SIZE * 2 ** 10 * 1.2 }, 9)).toBe(9);
  });

  it('should limit the number of tiles', () => {
    const viewport = { x: 0.5, y: 0.5, scale: TILE_SIZE * 2 ** 10, width: 8000, height: 8000 };
    const zoom = chooseZoom(viewport, 16, TILE_SIZE, 64);
    expect(zoom).toBeLessThan(10);
    expect(getTileRange(viewport, zoom).count).toBeLessThanOrEqual(64);
  });

  it('should compute the tile range and the viewport inside the stitched tiles', () => {
    // the centre of the world at zoom 2 is the corner of tiles 1 and 2
    const viewport = { x: 0.5, y: 0.5, scale: TILE_SIZE * 4, width: 512, height: 256 };
    const range = getTileRange(viewport, 2);
    expect(range).toEqual({
      zoom: 2,
      x0: 1,
      x1: 2,
      y0: 1,
      y1: 2,
      count: 4,
      region: { left: 256, top: 384, width: 512, height: 256 },
    });
  });

  it('should build tile URLs and wrap around the antimeridian', () => {
    expect(getTileUrl(tileStyles.watercolor, 3, 9, 2, 'k&y')).toBe(
      'https://tiles.stadiamaps.com/tiles/stamen_watercolor/3/1/2@2x.jpg?api_key=k%26y',
    );
    expect(getTileUrl(tileStyles.toner, 3, -1, 2, 'key')).toBe(
      'https://tiles.stadiamaps.com/tiles/stamen_toner/3/7/2@2x.png?api_key=key',
    );
    expect(getTileUrl(tileStyles.terrain, 0, 0, 0, 'key')).toMatch(/stamen_terrain\/0\/0\/0@2x\.png/);
  });
});

describe('labels', () => {
  it('should de-duplicate place names and weight them by photos', () => {
    const labels = getPlaceLabels([
      { x: 10, y: 10, city: 'Rome' },
      { x: 20, y: 30, city: ' rome ' },
      { x: 500, y: 500, city: 'Florence' },
      { x: 30, y: 20, city: 'ROME' },
      { x: 0, y: 0, city: null },
      { x: 0, y: 0, city: '  ' },
    ]);
    expect(labels).toEqual([
      { text: 'Rome', x: 20, y: 20, weight: 3 },
      { text: 'Florence', x: 500, y: 500, weight: 1 },
    ]);
  });

  it('should not let labels overlap each other or the obstacles', () => {
    const candidates = [
      { text: 'Alpha', x: 500, y: 500, weight: 3 },
      { text: 'Beta', x: 505, y: 500, weight: 2 },
      { text: 'Gamma', x: 500, y: 505, weight: 1 },
    ];
    const obstacle = { x: 490, y: 490, width: 20, height: 20 };
    const placed = placeLabels(candidates, { width: 1000, height: 1000, fontPx: 20, obstacles: [obstacle] });

    expect(placed.map((label) => label.text)).toEqual(['Alpha', 'Beta', 'Gamma']);
    const boxes = [obstacle, ...placed.map((label) => label.box)];
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it('should keep labels inside the map and skip the ones that do not fit', () => {
    const [label] = placeLabels([{ text: 'Right edge', x: 990, y: 500, weight: 1 }], {
      width: 1000,
      height: 1000,
      fontPx: 20,
    });
    expect(label.anchor).toBe('end');
    expect(label.box.x + label.box.width).toBeLessThanOrEqual(1000);

    expect(
      placeLabels([{ text: 'Too long for this map', x: 50, y: 50, weight: 1 }], {
        width: 100,
        height: 100,
        fontPx: 20,
      }),
    ).toEqual([]);
  });
});

describe('getStops', () => {
  it('should group nearby points, including revisits', () => {
    const stops = getStops(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 100, y: 0 },
        { x: 2, y: 2 },
      ],
      10,
    );
    expect(stops).toEqual([
      { x: 2, y: 2 / 3, count: 3 },
      { x: 100, y: 0, count: 1 },
    ]);
  });
});

describe('getRoutePath', () => {
  it('should draw a deterministic smooth path through the points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ];
    const path = getRoutePath(points, 2, 42);
    expect(path).toMatch(/^M0,0 C.* 100,50 C.* 200,0$/);
    expect(getRoutePath(points, 2, 42)).toBe(path);
    expect(getRoutePath([{ x: 0, y: 0 }], 2)).toBe('');
  });
});

describe('parsePolygon', () => {
  it('should parse a Postgres polygon', () => {
    expect(parsePolygon('((12.5,41.9),(-9.1,38.7),(1e1,-2.5))')).toEqual([
      [12.5, 41.9],
      [-9.1, 38.7],
      [10, -2.5],
    ]);
  });
});

describe('resolveMapStyle', () => {
  it('should resolve auto to the default style and fall back to sketch without a key', () => {
    expect(resolveMapStyle('auto', { defaultStyle: 'toner', stadiaApiKey: 'key' })).toEqual({
      style: 'toner',
      fallback: false,
    });
    expect(resolveMapStyle(undefined, { defaultStyle: 'watercolor', stadiaApiKey: '' })).toEqual({
      style: 'sketch',
      fallback: true,
    });
    expect(resolveMapStyle('sketch', { defaultStyle: 'watercolor', stadiaApiKey: '' })).toEqual({
      style: 'sketch',
      fallback: false,
    });
  });
});

describe('renderMap', () => {
  const trip = [rome, florence, venice];
  const map = { style: 'sketch' as const, showRoute: true, labels: true, title: 'Italy <3' };

  beforeEach(() => {
    clearTileCache();
  });

  it('should render a sketch map as a JPEG of the requested size', async () => {
    const result = await renderMap({ points: trip }, { map }, { width: 640, height: 480 });
    expect(result).toEqual({ data: expect.any(Buffer), source: 'sketch', warnings: [] });
    await expect(sharp(result.data).metadata()).resolves.toEqual(
      expect.objectContaining({ format: 'jpeg', width: 640, height: 480 }),
    );
  });

  it('should render a PNG through renderMapImage', async () => {
    const data = await renderMapImage({ points: trip }, { map }, { width: 300, height: 300, format: 'png' });
    await expect(sharp(data).metadata()).resolves.toEqual(
      expect.objectContaining({ format: 'png', width: 300, height: 300 }),
    );
  });

  it('should render a map without locations with a warning', async () => {
    const result = await renderMap({ points: [] }, { map: null, sectionTitle: 'Nowhere' }, { width: 200, height: 200 });
    expect(result.source).toBe('sketch');
    expect(result.warnings).toEqual([expect.stringMatching(/GPS/)]);
  });

  it('should draw country outlines for long trips only', async () => {
    const getCountries = vi.fn().mockResolvedValue([
      {
        name: 'Portugal',
        rings: [
          [
            [-9.5, 42],
            [-6.2, 42],
            [-7.4, 37],
            [-8.9, 37],
          ],
        ],
      },
    ]);

    await renderMap({ points: trip.slice(0, 2), getCountries }, { map }, { width: 200, height: 200 });
    expect(getCountries).not.toHaveBeenCalled();

    const result = await renderMap({ points: [lisbon, rome], getCountries }, { map }, { width: 200, height: 200 });
    expect(getCountries).toHaveBeenCalledWith({
      west: expect.any(Number),
      south: expect.any(Number),
      east: expect.any(Number),
      north: expect.any(Number),
    });
    const [bounds] = getCountries.mock.calls[0];
    expect(bounds.west).toBeLessThan(lisbon.lon);
    expect(bounds.east).toBeGreaterThan(rome.lon);
    expect(result.source).toBe('sketch');
  });

  it('should fall back to a sketch without a Stadia API key', async () => {
    const fetch = mockFetch(() => Promise.reject(new Error('should not be called')));
    const result = await renderMap(
      { points: trip, fetch },
      { map: { ...map, style: 'watercolor' } },
      { width: 200, height: 200 },
    );
    expect(result.source).toBe('sketch');
    expect(result.warnings).toEqual([expect.stringMatching(/Stadia Maps API key/)]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should stitch Stadia tiles under the route', async () => {
    const png = await tile('#3366cc');
    const fetch = mockFetch(() => Promise.resolve(new Response(new Uint8Array(png))));
    const result = await renderMap(
      { points: trip, stadiaApiKey: 'secret', fetch },
      { map: { ...map, style: 'toner' } },
      { width: 400, height: 300 },
    );

    expect(result).toEqual({ data: expect.any(Buffer), source: 'tiles', warnings: [] });
    expect(fetch).toHaveBeenCalled();
    for (const [url] of fetch.mock.calls) {
      expect(String(url)).toMatch(
        /^https:\/\/tiles\.stadiamaps\.com\/tiles\/stamen_toner\/\d+\/\d+\/\d+@2x\.png\?api_key=secret$/,
      );
    }

    const { data, info } = await sharp(result.data).raw().toBuffer({ resolveWithObject: true });
    expect(info).toEqual(expect.objectContaining({ width: 400, height: 300 }));
    // the top-left corner shows the tile colour, not the paper of a sketch
    for (const [i, value] of [0x33, 0x66, 0xcc].entries()) {
      expect(Math.abs(data[i] - value)).toBeLessThan(12);
    }
  });

  it('should cache tiles in memory', async () => {
    const png = await tile();
    const fetch = mockFetch(() => Promise.resolve(new Response(new Uint8Array(png))));
    const ctx = { points: trip, stadiaApiKey: 'secret', fetch };
    const page = { map: { ...map, style: 'terrain' as const } };

    await renderMap(ctx, page, { width: 300, height: 300 });
    const calls = fetch.mock.calls.length;
    await renderMap(ctx, page, { width: 300, height: 300 });
    expect(fetch.mock.calls.length).toBe(calls);
  });

  it('should fall back to a sketch when the tiles cannot be loaded', async () => {
    const fetch = mockFetch(() => Promise.resolve(new Response('nope', { status: 401 })));
    const result = await renderMap(
      { points: trip, stadiaApiKey: 'bad', fetch },
      { map: { ...map, style: 'watercolor' } },
      { width: 300, height: 200 },
    );
    expect(result.source).toBe('sketch');
    expect(result.warnings).toEqual([expect.stringMatching(/tiles could not be loaded.*401/)]);
    await expect(sharp(result.data).metadata()).resolves.toEqual(expect.objectContaining({ width: 300, height: 200 }));
  });

  it('should fall back to a sketch when fetching fails', async () => {
    const fetch = mockFetch(() => Promise.reject(new Error('network down')));
    const result = await renderMap(
      { points: trip, stadiaApiKey: 'key', fetch },
      { map: { ...map, style: 'toner' } },
      { width: 300, height: 200 },
    );
    expect(result.source).toBe('sketch');
    expect(result.warnings).toEqual([expect.stringMatching(/network down/)]);
  });

  it('should draw the illustrated map when there is one', async () => {
    const illustrated = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer();
    const result = await renderMap({ points: trip, illustrated }, { map }, { width: 300, height: 300 });
    expect(result.source).toBe('illustrated');
    const { data } = await sharp(result.data).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
    expect(data[1]).toBeLessThan(20);
  });

  it('should credit the tile providers', () => {
    expect(MAP_ATTRIBUTION).toBe('© Stadia Maps © Stamen Design © OpenStreetMap contributors');
  });
});
