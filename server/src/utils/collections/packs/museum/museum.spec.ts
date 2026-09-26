import { buildOverpassQuery, parseOverpassPlaces } from 'src/utils/collections/overpass.js';
import { MUSEUM_NAME_RULES, MUSEUM_OSM_FILTERS, cleanMuseumLine } from 'src/utils/collections/packs/museum/museum.js';
import { museumPack } from 'src/utils/collections/packs/museum/pack.js';
import { findPlaceNames } from 'src/utils/collections/place.js';

const box = (text: string, left: number, top: number, height = 0.03) => {
  const right = Math.min(1, left + text.length * height * 0.45);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.97 };
};

/** the lines of a wall label */
const label = (artist: string, title: string, extra: string[] = []) =>
  [artist, title, 'Huile sur toile', ...extra].map((text, index) => box(text, 0.1, 0.2 + index * 0.05));

describe('museum names', () => {
  it('should read the name of a museum on its sign', () => {
    const [name] = findPlaceNames(
      [{ assetId: 'sign', kind: 'sign', ocr: [box('MUSEU DE ÉVORA', 0.2, 0.3, 0.08), box('Entrada', 0.3, 0.5, 0.03)] }],
      MUSEUM_NAME_RULES,
    );
    expect(name).toMatchObject({ name: 'Museu de Évora', source: 'sign' });
  });

  it('should read the museum of a label, not the artists repeated on every label or the lenders of the works', () => {
    const names = findPlaceNames(
      [
        { assetId: 'a', kind: 'source', ocr: label('Gregório Lopes (act. 1513-1550)', 'Calvary') },
        { assetId: 'b', kind: 'source', ocr: label('Gregório Lopes (act. 1513-1550)', 'Ressurrection') },
        {
          assetId: 'c',
          kind: 'source',
          ocr: label('Claude MONET', 'Falaise de Fécamp, 1897', ["Dépot du Musée d'Orsay, 2015"]),
        },
        {
          assetId: 'd',
          kind: 'source',
          ocr: label('Joseph-Désiré Court (1797-1865)', 'Portrait-étude', [
            "Agen, Musée des Beaux-Arts -Acquis en juin 2017- N° d'inv: 2017.2.1",
          ]),
        },
      ],
      MUSEUM_NAME_RULES,
    );
    expect(names.map(({ name }) => name)).toEqual(['Musée des Beaux-Arts, Agen']);
  });

  it('should leave departments and directions alone', () => {
    expect(
      findPlaceNames([{ assetId: 'sign', kind: 'sign', ocr: [box('Archaeology', 0.4, 0.5, 0.04)] }], MUSEUM_NAME_RULES),
    ).toEqual([]);
    expect(cleanMuseumLine("Agen, Musée des Beaux-Arts -Acquis en juin 2017-N°d'inv: 2017.2.1")).toBe(
      'Musée des Beaux-Arts, Agen',
    );
    expect(cleanMuseumLine('Rijksmuseum')).toBe('Rijksmuseum');
    expect(MUSEUM_NAME_RULES.words.test('Rijksmuseum')).toBe(true);
  });

  it('should name a visit without a museum after its city or its day', () => {
    expect(museumPack.place.fallbackName({ city: 'Florence', day: '2024-05-02', start: '' })).toBe(
      'Museum visit in Florence',
    );
    expect(museumPack.place.fallbackName({ day: '2022-09-27', start: '' })).toBe('Museum visit on 2022-09-27');
  });

  it('should look museums and galleries up on OpenStreetMap', () => {
    const query = buildOverpassQuery({ latitude: 38.5724, longitude: -7.9076 }, MUSEUM_OSM_FILTERS, 150);
    expect(query).toContain('["tourism"~"^(museum|gallery)$"]["name"]');
    expect(query).toContain('["amenity"~"^(arts_centre)$"]["name"]');
    const places = parseOverpassPlaces(
      {
        elements: [
          {
            type: 'way',
            id: 1,
            center: { lat: 38.5725, lon: -7.9076 },
            tags: { name: 'Museu de Évora', tourism: 'museum' },
          },
          {
            type: 'node',
            id: 2,
            lat: 38.573,
            lon: -7.908,
            tags: { name: 'Fórum Eugénio de Almeida', amenity: 'arts_centre' },
          },
        ],
      },
      { latitude: 38.5724, longitude: -7.9076 },
      MUSEUM_OSM_FILTERS,
    );
    expect(places.map(({ name, type }) => [name, type])).toEqual([
      ['Museu de Évora', 'museum'],
      ['Fórum Eugénio de Almeida', 'arts_centre'],
    ]);
  });
});
