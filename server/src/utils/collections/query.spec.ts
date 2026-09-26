import { REDACTED } from 'src/utils/collections/packs/travel/privacy.js';
import {
  CollectionTagRow,
  getVisitGapMinutes,
  groupCollectionVisits,
  parseDateBound,
  queryCollectionVisits,
  readCollectionRows,
  summarizeCollections,
} from 'src/utils/collections/query.js';
import { BUILT_IN_COLLECTION_PACKS, getCollectionPack } from 'src/utils/collections/registry.js';
import { demoCollectionRows } from 'test/fixtures/collections/demo-tags.js';

const packs = [...BUILT_IN_COLLECTION_PACKS];

let next = 0;
const row = (value: string, time: string, extra: Partial<CollectionTagRow> = {}): CollectionTagRow => ({
  assetId: `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
  value,
  localDateTime: new Date(`${time}Z`),
  city: null,
  country: null,
  people: [],
  ...extra,
});

/** the demo meals, and a museum visit, two quiches, a trip and a second meal at Noma */
const library = () => [
  ...demoCollectionRows(),
  row('Food/Noma Australia/Rum lamington', '2016-03-30T20:00:00', { city: 'Sydney', country: 'Australia' }),
  row('Food/Noma Australia/Golden petits fours', '2016-03-30T20:30:00', {
    city: 'Sydney',
    country: 'Australia',
    people: ['Anna'],
  }),
  row('Art/Musée d’Orsay/Water Lilies — Claude Monet, 1906, oil on canvas', '2025-05-02T11:00:00', {
    city: 'Paris',
    country: 'France',
    people: ['Anna', 'Ben'],
  }),
  row('Art/Musée d’Orsay/Label', '2025-05-02T11:01:00', { city: 'Paris', country: 'France' }),
  row('Art/Rijksmuseum/The Night Watch — Rembrandt van Rijn, 1642, oil on canvas', '2024-08-10T14:00:00', {
    city: 'Amsterdam',
    country: 'Netherlands',
  }),
  row('Recipes/Quiche Lorraine/Step 1: Blind-bake the crust', '2024-02-03T17:00:00'),
  row('Recipes/Quiche Lorraine/Result', '2024-02-03T18:30:00'),
  row('Recipes/Quiche Lorraine/Recipe', '2024-02-03T16:55:00'),
  row('Recipes/Quiche Lorraine/Result', '2025-11-20T19:00:00'),
  row('Travel/Crete, October 2016/Bus Chania → Sougia', '2016-10-04T09:00:00', { city: 'Chania', country: 'Greece' }),
  row('Travel/Crete, October 2016/Ferry Sougia → Agia Roumeli', '2016-10-05T10:00:00', { country: 'Greece' }),
  row('Travel/Crete, October 2016/Flight A3 123 ATH → CHQ PNR: A41NQS', '2016-10-03T07:00:00'),
  row('Travel/Crete, October 2016/Tickets', '2016-10-03T06:00:00'),
  // not a collection tag, or a tag of an unknown pack
  row('Food/Noma Australia', '2016-03-23T20:00:00'),
  row('Holidays/Crete', '2016-10-04T09:00:00'),
];

const photos = () => readCollectionRows(library(), packs);

describe(readCollectionRows.name, () => {
  it('should read the tags of every pack and skip other tags', () => {
    const read = photos();
    expect(read).toHaveLength(library().length - 2);
    expect(new Set(read.map(({ pack }) => pack.id))).toEqual(new Set(['food', 'museum', 'cookbook', 'travel']));
    expect(read.find(({ assetId }) => assetId === 'f47aed56-a50d-4c63-b16c-e74fc54d6944')).toMatchObject({
      place: 'The French Laundry',
      kind: 'source',
    });
  });

  it('should redact the names of the travel pack', () => {
    const flight = photos().find(({ entry }) => entry?.startsWith('Flight'))!;
    expect(flight.entry).not.toContain('A41NQS');
    expect(flight.entry).toContain(REDACTED);
  });
});

describe(getVisitGapMinutes.name, () => {
  it('should use the longest gap of the pack', () => {
    expect(getVisitGapMinutes(getCollectionPack('food')!)).toBe(180);
    expect(getVisitGapMinutes(getCollectionPack('cookbook')!)).toBe(48 * 60);
    expect(getVisitGapMinutes(getCollectionPack('travel')!)).toBe(2 * 24 * 60);
  });
});

describe(groupCollectionVisits.name, () => {
  it('should group the photos of a place into visits', () => {
    const visits = groupCollectionVisits(photos());
    const summary = visits.map(({ pack, place, photos }) => `${pack.id}:${place}:${photos.length}`);
    expect(summary).toEqual([
      "food:Katz's Delicatessen:6",
      'food:The French Laundry:14',
      'food:Noma Australia:16',
      'food:Noma Australia:2',
      'travel:Crete, October 2016:4',
      'cookbook:Quiche Lorraine:3',
      'museum:Rijksmuseum:1',
      'museum:Musée d’Orsay:2',
      'cookbook:Quiche Lorraine:1',
    ]);
  });

  it('should keep a menu photographed two hours after the meal with it', () => {
    const [, frenchLaundry] = groupCollectionVisits(photos());
    expect(frenchLaundry.photos.map(({ assetId }) => assetId)).toContain('a363d7df-e4c1-405e-ada9-5bf7f8e1d34d');
  });
});

describe(queryCollectionVisits.name, () => {
  it('should answer "what did I eat at The French Laundry?"', () => {
    const result = queryCollectionVisits(photos(), { place: ['french laundry'] });
    expect(result.total).toEqual({ visits: 1, places: 1, entries: 12, photos: 12 });
    expect(result.visits).toHaveLength(1);
    const [visit] = result.visits!;
    expect(visit).toMatchObject({ pack: 'food', place: 'The French Laundry', date: '2014-01-11', type: 'Lunch' });
    expect(visit.entries.map(({ name }) => name)).toEqual([
      'Gougères',
      'Salmon Tartare Cornet',
      '"Oysters and Pearls"',
      'Bread and Butter',
      'Salad of Hawaiian Hearts of Peach Palm',
      'Citrus-Cured Scottish Sea Trout',
      'Alaskan King Crab "Boudin"',
      'Four Story Hill Farm Milk-Poached Poularde',
      'Andante Dairy "Acapella"',
      'Citrus Pre-Dessert',
      '"Assortment of Desserts"',
      'Coffee and Doughnuts',
    ]);
    expect(visit.entries[0]).toEqual({ name: 'Gougères', photoIds: ['7144b65c-9b36-4845-9280-0522144198e6'] });
    expect(visit.sources).toBe(2);
    expect(visit).not.toHaveProperty('sourcePhotoIds');
  });

  it('should list the source photos when asked', () => {
    const result = queryCollectionVisits(photos(), { place: ['katz'] }, { sources: true });
    expect(result.visits![0].sourcePhotoIds).toEqual(['ad3e0356-6091-420b-92d9-e3ffe04cbf3b']);
  });

  it('should never list the travel documents', () => {
    const result = queryCollectionVisits(photos(), { place: ['crete'] }, { sources: true });
    expect(result.visits![0].sources).toBe(1);
    expect(result.visits![0]).not.toHaveProperty('sourcePhotoIds');
    expect(JSON.stringify(result)).not.toContain('A41NQS');
  });

  it('should not find redacted text', () => {
    expect(queryCollectionVisits(photos(), { entry: ['A41NQS'] }).total.visits).toBe(0);
  });

  it('should match a place loosely, newest visit first, with the last and first time', () => {
    const result = queryCollectionVisits(photos(), { place: ['noma'] });
    expect(result.visits!.map(({ date }) => date)).toEqual(['2016-03-30', '2016-03-23']);
    expect(result.last).toMatchObject({ place: 'Noma Australia', date: '2016-03-30', city: 'Sydney' });
    expect(result.first).toMatchObject({ place: 'Noma Australia', date: '2016-03-23' });
    expect(result.visits![0]).toMatchObject({ people: ['Anna'], city: 'Sydney', country: 'Australia' });
  });

  it('should answer "when did we last make the quiche?" from the name of the recipe', () => {
    const result = queryCollectionVisits(photos(), { text: ['quiche'] });
    expect(result.total.visits).toBe(2);
    expect(result.last).toMatchObject({ pack: 'cookbook', place: 'Quiche Lorraine', date: '2025-11-20' });
    expect(result.visits![1].entries.map(({ name }) => name)).toEqual(['Step 1: Blind-bake the crust', 'Result']);
  });

  it('should find the desserts across restaurants, and only them', () => {
    const result = queryCollectionVisits(photos(), { entry: ['dessert', 'petits fours'] }, { order: 'asc' });
    expect(result.visits!.map(({ place, entries }) => [place, entries.map(({ name }) => name)])).toEqual([
      ['The French Laundry', ['Citrus Pre-Dessert', '"Assortment of Desserts"']],
      ['Noma Australia', ['Golden petits fours']],
      ['Noma Australia', ['Golden petits fours']],
    ]);
    expect(result.total).toMatchObject({ visits: 3, places: 2, entries: 3, photos: 4 });
  });

  it('should answer "which museums did we visit in 2025?" with places', () => {
    const all = photos();
    const from = parseDateBound('2025', 'from')!.getTime();
    const to = parseDateBound('2025', 'to')!.getTime();
    const result = queryCollectionVisits(
      all.filter(({ pack, time }) => pack.id === 'museum' && time >= from && time < to),
      {},
      { detail: 'places' },
    );
    expect(result.places).toEqual([
      {
        pack: 'museum',
        place: 'Musée d’Orsay',
        visits: 1,
        dates: ['2025-05-02'],
        city: 'Paris',
        country: 'France',
        entries: 1,
        photoIds: [expect.any(String)],
      },
    ]);
  });

  it('should filter on the city and the country, without accents', () => {
    expect(queryCollectionVisits(photos(), { country: ['netherlands'] }).visits!.map(({ place }) => place)).toEqual([
      'Rijksmuseum',
    ]);
    expect(queryCollectionVisits(photos(), { city: ['chania'] }).visits!.map(({ place }) => place)).toEqual([
      'Crete, October 2016',
    ]);
    expect(queryCollectionVisits(photos(), { place: ['musee dorsay'] }).total.visits).toBe(1);
  });

  it('should find the visits the people were at, from any photo taken during them', () => {
    const anna = { name: 'Anna', times: [new Date('2014-01-11T15:00:00Z').getTime()] };
    const ben = { name: 'Ben', times: [new Date('2014-01-11T12:00:00Z').getTime(), new Date('2030-01-01Z').getTime()] };
    const result = queryCollectionVisits(photos(), { people: [anna, ben] });
    expect(result.visits!.map(({ place, people }) => [place, people])).toEqual([
      ['The French Laundry', ['Anna', 'Ben']],
    ]);
    // an hour after the menu photographed at 16:08 is still the visit, two hours is not
    const late = (time: string) => ({ name: 'Anna', times: [new Date(time).getTime()] });
    expect(queryCollectionVisits(photos(), { people: [late('2014-01-11T17:00:00Z')] }).total.visits).toBe(1);
    expect(queryCollectionVisits(photos(), { people: [late('2014-01-11T18:10:00Z')] }).total.visits).toBe(0);
    expect(queryCollectionVisits(photos(), { people: [{ name: 'Carl', times: [] }] }).total.visits).toBe(0);
  });

  it('should cap the entries and the photos, with counts', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, index) => row('Food/Chez Panisse/Salad', `2020-01-01T12:0${index}:00`)),
      ...Array.from({ length: 4 }, (_, index) => row(`Food/Chez Panisse/Dish ${index}`, `2020-01-01T13:0${index}:00`)),
    ];
    const result = queryCollectionVisits(
      readCollectionRows(rows, packs),
      {},
      { entriesPerVisit: 2, photosPerEntry: 2 },
    );
    const [visit] = result.visits!;
    expect(visit.entries).toEqual([
      { name: 'Salad', photoIds: [rows[0].assetId, rows[1].assetId], n: 5 },
      { name: 'Dish 0', photoIds: [rows[5].assetId] },
    ]);
    expect(visit.moreEntries).toBe(3);
  });

  it('should limit the visits', () => {
    const result = queryCollectionVisits(photos(), {}, { limit: 2 });
    expect(result.visits).toHaveLength(2);
    expect(result.moreVisits).toBe(7);
    expect(result.total.visits).toBe(9);
  });

  it('should return nothing for an unknown place', () => {
    expect(queryCollectionVisits(photos(), { place: ['el bulli'] })).toEqual({
      total: { visits: 0, places: 0, entries: 0, photos: 0 },
      visits: [],
    });
  });
});

describe(summarizeCollections.name, () => {
  it('should summarize every pack', () => {
    const summary = summarizeCollections(photos(), packs);
    expect(summary.map(({ pack }) => pack)).toEqual(packs.map(({ id }) => id));
    expect(summary.find(({ pack }) => pack === 'food')).toEqual({
      pack: 'food',
      title: 'Food',
      place: 'restaurant',
      entry: 'menu items',
      visit: 'meals',
      photos: 38,
      visits: 4,
      places: 3,
      entries: 32,
      sources: 4,
      years: [2013, 2014, 2016],
      first: '2013-06-15',
      last: '2016-03-30',
      recentPlaces: [
        { name: 'Noma Australia', visits: 2, last: '2016-03-30' },
        { name: 'The French Laundry', visits: 1, last: '2014-01-11' },
        { name: "Katz's Delicatessen", visits: 1, last: '2013-06-15' },
      ],
    });
    expect(summary.find(({ pack }) => pack === 'cookbook')).toMatchObject({
      visits: 2,
      places: 1,
      years: [2024, 2025],
    });
  });

  it('should summarize the demo library', () => {
    const summary = summarizeCollections(readCollectionRows(demoCollectionRows(), packs), packs);
    expect(summary.find(({ pack }) => pack === 'food')).toMatchObject({
      photos: 36,
      visits: 3,
      places: 3,
      entries: 32,
      sources: 4,
      years: [2013, 2014, 2016],
    });
    expect(summary.find(({ pack }) => pack === 'museum')).toMatchObject({ photos: 0, visits: 0, years: [] });
  });
});

describe(parseDateBound.name, () => {
  it.each([
    ['2025', 'from', '2025-01-01T00:00:00.000Z'],
    ['2025', 'to', '2026-01-01T00:00:00.000Z'],
    ['2016-10', 'to', '2016-11-01T00:00:00.000Z'],
    ['2016-10-04', 'from', '2016-10-04T00:00:00.000Z'],
    ['2016-10-04', 'to', '2016-10-05T00:00:00.000Z'],
    ['2016-10-04T18:00:00', 'from', '2016-10-04T18:00:00.000Z'],
    ['2016-10-04T18:00:00+02:00', 'from', '2016-10-04T18:00:00.000Z'],
    ['2016-10-04T18:00', 'to', '2016-10-04T18:00:00.001Z'],
  ] as const)('should read %s as the %s bound', (value, bound, expected) => {
    expect(parseDateBound(value, bound)?.toISOString()).toBe(expected);
  });

  it.each(['yesterday', '2025-13', '2025-02-30', ''])('should reject %s', (value) => {
    expect(parseDateBound(value, 'from')).toBeUndefined();
  });
});
