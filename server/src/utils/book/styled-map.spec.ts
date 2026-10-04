import { bookStylePresets, resolveBookStyle } from 'src/dtos/book.dto.js';
import { getMapLook } from 'src/utils/book/map-looks.js';
import {
  Box,
  MapLabelCandidate,
  classifyFeature,
  estimateTextWidth,
  formatDegrees,
  getGraticuleStep,
  getMapLabelCandidates,
  getRoadScale,
  placeMapLabels,
  renderStyledBasemap,
  renderStyledFrame,
} from 'src/utils/book/styled-map.js';
import { MapFeature, decodeVectorTile } from 'src/utils/book/vector-tiles.js';
import { loadTaorminaTile } from 'test/fixtures/map/tile.js';

const style = resolveBookStyle(bookStylePresets.classic.style);

const feature = (values: Partial<MapFeature>): MapFeature => ({
  layer: 'roads',
  kind: 'minor_road',
  type: 'line',
  parts: [[0, 0, 10, 10]],
  ...values,
});

const place = (values: Partial<MapFeature>): MapFeature =>
  feature({ layer: 'places', type: 'point', kind: 'locality', detail: 'town', parts: [[500, 500]], ...values });

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('styled maps', () => {
  describe('classifyFeature', () => {
    it('should draw more streets the closer the map', () => {
      const street = feature({ kind: 'minor_road', detail: 'residential' });
      expect(classifyFeature(street, 10)).toBeUndefined();
      expect(classifyFeature(street, 13)).toBe('minor');

      const footway = feature({ kind: 'path', detail: 'footway' });
      expect(classifyFeature(footway, 13)).toBeUndefined();
      expect(classifyFeature(footway, 15)).toBe('path');

      const tertiary = feature({ kind: 'major_road', detail: 'tertiary' });
      expect(classifyFeature(tertiary, 7)).toBeUndefined();
      expect(classifyFeature(tertiary, 10)).toBe('minor');
      expect(classifyFeature(tertiary, 13)).toBe('major');

      expect(classifyFeature(feature({ kind: 'highway' }), 6)).toBe('highway');
      expect(classifyFeature(feature({ kind: 'highway', isTunnel: true }), 12)).toBeUndefined();
      expect(classifyFeature(feature({ kind: 'rail', detail: 'rail' }), 10)).toBe('rail');
      expect(classifyFeature(feature({ kind: 'rail', detail: 'subway' }), 15)).toBeUndefined();
    });

    it('should sort land and water', () => {
      const polygon = (layer: string, kind: string) => feature({ layer, kind, type: 'polygon' });
      expect(classifyFeature(polygon('earth', 'earth'), 10)).toBe('earth');
      expect(classifyFeature(polygon('water', 'lake'), 10)).toBe('water');
      // the sea is what the land does not cover
      expect(classifyFeature(polygon('water', 'ocean'), 10)).toBeUndefined();
      expect(classifyFeature(polygon('water', 'swimming_pool'), 15)).toBeUndefined();
      expect(classifyFeature(polygon('landuse', 'park'), 15)).toBe('park');
      expect(classifyFeature(polygon('landcover', 'forest'), 6)).toBe('forest');
      expect(classifyFeature(polygon('landuse', 'farmland'), 10)).toBe('farmland');
      expect(classifyFeature(polygon('landuse', 'residential'), 11)).toBe('urban');
      expect(classifyFeature(polygon('landuse', 'residential'), 15)).toBeUndefined();
      expect(classifyFeature(polygon('landuse', 'beach'), 15)).toBe('sand');
      expect(classifyFeature(polygon('buildings', 'building'), 13)).toBeUndefined();
      expect(classifyFeature(polygon('buildings', 'building'), 15)).toBe('building');
      expect(classifyFeature(feature({ layer: 'water', kind: 'river' }), 10)).toBe('river');
      expect(classifyFeature(feature({ layer: 'water', kind: 'stream' }), 10)).toBeUndefined();
    });

    it('should widen the roads at city scale', () => {
      expect(getRoadScale(15)).toBeGreaterThan(getRoadScale(10));
      expect(getRoadScale(4)).toBeGreaterThan(0);
    });
  });

  describe('graticule', () => {
    it('should step in round degrees and minutes', () => {
      expect(getGraticuleStep(3)).toBe(1);
      expect(getGraticuleStep(0.6)).toBe(1 / 6);
      expect(getGraticuleStep(0.02)).toBe(1 / 120);
    });

    it('should format degrees, minutes and seconds', () => {
      expect(formatDegrees(37, 'lat')).toBe('37°N');
      expect(formatDegrees(37.5, 'lat')).toBe('37°30′N');
      expect(formatDegrees(38.575, 'lat')).toBe('38°34′30″N');
      expect(formatDegrees(-7.9, 'lon')).toBe('7°54′W');
      expect(formatDegrees(15.25, 'lon')).toBe('15°15′E');
    });
  });

  describe('labels', () => {
    const look = getMapLook('vintage', style);

    it('should name the places of the zoom, most important first, once each', () => {
      const candidates = getMapLabelCandidates(
        [
          place({ name: 'Letojanni', detail: 'village', rank: 4, parts: [[100, 100]] }),
          place({ name: 'Catania', detail: 'city', rank: 9, parts: [[400, 400]] }),
          place({ name: 'Catania', detail: 'city', rank: 9, parts: [[402, 400]] }),
          place({ name: 'Giarre', detail: 'town', rank: 6 }),
          place({ name: 'San Giovanni', kind: 'neighbourhood', detail: 'neighbourhood' }),
          feature({ layer: 'water', type: 'point', kind: 'sea', name: 'Ionian Sea', parts: [[800, 800]] }),
          feature({ layer: 'water', type: 'point', kind: 'fountain', name: 'Fontana', parts: [[800, 800]] }),
        ],
        10,
        look,
      );
      expect(candidates.map((candidate) => candidate.text)).toEqual(['Catania', 'Ionian Sea', 'Giarre', 'Letojanni']);
      expect(candidates[0].size).toBeGreaterThan(candidates[3].size);

      const city = getMapLabelCandidates([place({ name: 'San Giovanni', kind: 'neighbourhood' })], 15, look);
      expect(city.map((candidate) => candidate.text)).toEqual(['San Giovanni']);
    });

    it('should not overlap each other, the pins or the edges', () => {
      const pin: Box = { x: 480, y: 440, width: 40, height: 60 };
      const candidates: MapLabelCandidate[] = Array.from({ length: 40 }, (_, i) => ({
        text: `Place ${i}`,
        x: 200 + (i % 8) * 90,
        y: 200 + Math.floor(i / 8) * 60,
        priority: 100 - i,
        size: 22,
        kind: i % 2 === 0 ? 'town' : 'neighbourhood',
      }));
      const labels = placeMapLabels(candidates, {
        width: 1000,
        height: 1000,
        u: 1,
        zoom: 12,
        look,
        obstacles: [pin],
        max: 12,
      });

      expect(labels.length).toBeGreaterThan(3);
      expect(labels.length).toBeLessThanOrEqual(12);
      for (const [i, label] of labels.entries()) {
        expect(intersects(label.box, pin)).toBe(false);
        expect(label.box.x).toBeGreaterThanOrEqual(18);
        expect(label.box.x + label.box.width).toBeLessThanOrEqual(1000 - 18);
        for (const other of labels.slice(i + 1)) {
          expect(intersects(label.box, other.box)).toBe(false);
        }
      }
      // capitals in the vintage look
      expect(labels.find((label) => label.kind === 'town')?.display).toMatch(/^PLACE \d+$/);
    });

    it('should leave out the names the route already shows', () => {
      const labels = placeMapLabels([{ text: 'Taormina', x: 500, y: 500, priority: 1, size: 22, kind: 'town' }], {
        width: 1000,
        height: 1000,
        u: 1,
        zoom: 12,
        look,
        obstacles: [],
        max: 10,
        exclude: new Set(['taormina']),
      });
      expect(labels).toEqual([]);
    });

    it('should estimate capitals wider than small letters', () => {
      expect(estimateTextWidth('MESSINA', 20)).toBeGreaterThan(estimateTextWidth('Messina', 20));
      expect(estimateTextWidth('Messina', 20, 2)).toBeCloseTo(estimateTextWidth('Messina', 20) + 12);
    });
  });

  describe('renderStyledBasemap', () => {
    const features = decodeVectorTile(loadTaorminaTile(), { left: 0, top: 0, size: 1000 }, { tolerance: 0.5 });
    const input = {
      width: 1000,
      height: 1000,
      u: 1,
      zoom: 15,
      features,
      bounds: { west: 15.28, south: 37.84, east: 15.29, north: 37.85 },
      toPixel: (lat: number, lon: number) => ({ x: (lon - 15.28) * 100_000, y: (37.85 - lat) * 100_000 }),
      seed: 7,
    };
    const render = (id: 'wash' | 'engraved' | 'minimal' | 'vintage') =>
      renderStyledBasemap({ ...input, look: getMapLook(id, style) });

    it('should draw the land, the roads and the rail of the tile', () => {
      const { soft, crisp } = render('minimal');
      const look = getMapLook('minimal', style);
      expect(soft).toContain(`fill="${look.land}"`);
      expect(crisp).toContain(`stroke="${look.roads.major.color}"`);
      expect(crisp).toContain(`stroke="${look.rail.color}"`);
      // no filters in the minimal look
      expect(soft).not.toContain('filter=');
    });

    it('should give every look its own drawing', () => {
      expect(render('wash').defs).toContain('feDisplacementMap');
      expect(render('wash').soft).toContain('filter="url(#wobble)"');
      expect(render('engraved').defs).toContain('<pattern id="hatch-a"');
      expect(render('vintage').defs).toContain('id="band"');
      expect(render('vintage').graticule.length).toBeGreaterThan(0);
      expect(render('minimal').graticule).toEqual([]);
    });

    it('should frame the vintage chart with a neatline and the degrees', () => {
      const look = getMapLook('vintage', style);
      const { graticule } = render('vintage');
      const frame = renderStyledFrame({ width: 1000, height: 1000, u: 1, look, graticule, taken: [] });
      expect(frame.svg).toContain('fill-rule="evenodd"');
      expect(frame.svg).toMatch(/37°5\d′/);
      expect(frame.taken.length).toBeGreaterThan(0);
      expect(
        renderStyledFrame({ width: 1000, height: 1000, u: 1, look: getMapLook('minimal', style), graticule, taken: [] })
          .svg,
      ).toBe('');
    });
  });
});
