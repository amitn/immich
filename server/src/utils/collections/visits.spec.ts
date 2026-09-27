import { describe, expect, it } from 'vitest';
import { getDefaultFallbackName } from 'src/utils/collections/pack.js';
import { foodPack, getMealType } from 'src/utils/collections/packs/food/pack.js';
import {
  DEFAULT_VISIT_OPTIONS,
  VisitPhoto,
  getFallbackVisitNames,
  groupVisits,
  summarizeVisit,
} from 'src/utils/collections/visits.js';

const at = (iso: string) => new Date(`${iso}Z`).getTime();
const photo = (
  id: string,
  iso: string,
  kind: VisitPhoto['kind'] = 'subject',
  extra: Partial<VisitPhoto> = {},
): VisitPhoto => ({
  id,
  time: at(iso),
  kind,
  ...extra,
});

// Taormina, Corso Umberto, and a place about 400 m away
const nino = { latitude: 37.8526, longitude: 15.2869, city: 'Taormina', country: 'Italy' };
const ninoNearby = { latitude: 37.8531, longitude: 15.2874, city: 'Taormina', country: 'Italy' };
const bar = { latitude: 37.8505, longitude: 15.2905, city: 'Taormina', country: 'Italy' };

describe('groupVisits', () => {
  it('should keep a meal together', () => {
    const meals = groupVisits([
      photo('sign', '2024-06-12T20:02:00', 'sign', nino),
      photo('menu', '2024-06-12T20:10:00', 'source', nino),
      photo('starter', '2024-06-12T20:35:00', 'subject', ninoNearby),
      photo('main', '2024-06-12T21:10:00', 'subject'),
      photo('dessert', '2024-06-12T21:50:00', 'subject', nino),
    ]);
    expect(meals.map((meal) => meal.map(({ id }) => id))).toEqual([['sign', 'menu', 'starter', 'main', 'dessert']]);
  });

  it('should split meals on a gap', () => {
    const meals = groupVisits([
      photo('lunch', '2024-06-12T13:00:00'),
      photo('coffee', '2024-06-12T13:40:00'),
      photo('gelato', '2024-06-12T14:40:00'),
    ]);
    expect(meals.map((meal) => meal.map(({ id }) => id))).toEqual([['lunch', 'coffee'], ['gelato']]);
  });

  it('should split a meal that lasts too long', () => {
    const photos = Array.from({ length: 8 }, (_, i) =>
      photo(
        `p${i}`,
        `2024-06-12T${String(12 + Math.floor((i * 30) / 60)).padStart(2, '0')}:${String((i * 30) % 60).padStart(2, '0')}:00`,
      ),
    );
    expect(groupVisits(photos).map((meal) => meal.length)).toEqual([8]);
    expect(groupVisits(photos, { maxSpanMinutes: 180 }).map((meal) => meal.length)).toEqual([7, 1]);
  });

  it('should split meals at different places', () => {
    const meals = groupVisits([
      photo('a', '2024-06-12T20:00:00', 'subject', nino),
      photo('b', '2024-06-12T20:20:00', 'subject', bar),
    ]);
    expect(meals).toHaveLength(2);
  });

  it('should drop visits without a dish or a menu', () => {
    const meals = groupVisits([
      photo('storefront', '2024-06-12T10:00:00', 'sign', nino),
      photo('dish', '2024-06-12T20:00:00', 'subject', nino),
    ]);
    expect(meals.map((meal) => meal.map(({ id }) => id))).toEqual([['dish']]);
  });

  it('should attach a menu photographed after the meal and keep a menu on its own', () => {
    const meals = groupVisits([
      photo('dessert', '2024-06-12T14:01:00'),
      photo('signed-menu', '2024-06-12T16:08:00', 'source'),
      photo('other-menu', '2024-06-13T12:00:00', 'source'),
    ]);
    expect(meals.map((meal) => meal.map(({ id }) => id))).toEqual([['dessert', 'signed-menu'], ['other-menu']]);
  });

  it('should not attach a sign at another place', () => {
    const meals = groupVisits([
      photo('sign', '2024-06-12T19:00:00', 'sign', bar),
      photo('dish', '2024-06-12T20:00:00', 'subject', nino),
    ]);
    expect(meals.map((meal) => meal.map(({ id }) => id))).toEqual([['dish']]);
  });

  it('should find the three meals of the demo photos without GPS', () => {
    // times as the cameras recorded them: a long tasting lunch, a signed menu two hours later, a tasting menu of
    // three and a half hours on a camera on the wrong time zone, and a quick deli breakfast
    const frenchLaundry = [
      photo('fl-outside', '2014-01-11T11:28:22', 'sign'),
      photo('fl-relais', '2014-01-11T11:30:11', 'sign'),
      photo('fl-menu', '2014-01-11T11:43:00', 'source'),
      ...[
        '11:52:10',
        '11:52:55',
        '11:57:19',
        '12:08:01',
        '12:08:37',
        '12:22:28',
        '12:35:57',
        '12:49:44',
        '13:17:36',
        '13:28:42',
        '13:46:16',
        '14:01:40',
      ].map((time, i) => photo(`fl-dish-${i}`, `2014-01-11T${time}`)),
      photo('fl-signed-menu', '2014-01-11T16:08:21', 'source'),
    ];
    const noma = [
      photo('noma-front', '2016-03-23T17:19:46', 'sign'),
      photo('noma-sign', '2016-03-23T17:27:59', 'sign'),
      ...[
        '17:41:16',
        '17:49:34',
        '17:55:32',
        '17:59:58',
        '18:09:15',
        '18:18:52',
        '18:28:43',
        '18:37:32',
        '18:48:17',
        '18:56:58',
        '19:09:53',
        '19:38:21',
        '19:51:24',
        '20:01:39',
        '20:17:28',
      ].map((time, i) => photo(`noma-dish-${i}`, `2016-03-23T${time}`)),
      photo('noma-menu', '2016-03-23T20:51:08', 'source'),
    ];
    const katz = [
      photo('katz-outside', '2013-06-15T08:42:57', 'sign'),
      photo('katz-menu', '2013-06-15T08:53:24', 'source'),
      ...['08:55:32', '09:02:38', '09:03:35', '09:07:13', '09:14:03'].map((time, i) =>
        photo(`katz-dish-${i}`, `2013-06-15T${time}`),
      ),
    ];

    const meals = groupVisits([...noma, ...frenchLaundry, ...katz]);

    expect(meals.map((meal) => meal.length)).toEqual([katz.length, frenchLaundry.length, noma.length]);
    expect(summarizeVisit(meals[1], getMealType).sourceIds).toEqual(['fl-menu', 'fl-signed-menu']);
    expect(summarizeVisit(meals[2], getMealType)).toMatchObject({
      signIds: ['noma-front', 'noma-sign'],
      sourceIds: ['noma-menu'],
    });
  });

  it('should accept other options', () => {
    const meals = groupVisits([photo('a', '2024-06-12T20:00:00'), photo('b', '2024-06-12T20:20:00')], {
      ...DEFAULT_VISIT_OPTIONS,
      maxGapMinutes: 10,
    });
    expect(meals).toHaveLength(2);
  });
});

describe('getMealType', () => {
  it.each([
    ['2024-06-12T08:30:00', 'Breakfast'],
    ['2024-06-12T12:45:00', 'Lunch'],
    ['2024-06-12T15:59:00', 'Lunch'],
    ['2024-06-12T20:15:00', 'Dinner'],
    ['2024-06-13T00:30:00', 'Dinner'],
  ])('should call a meal at %s %s', (iso, type) => {
    expect(getMealType(at(iso))).toBe(type);
  });
});

describe('summarizeVisit', () => {
  it('should summarize a meal', () => {
    const summary = summarizeVisit(
      [
        photo('menu', '2024-06-12T19:55:00', 'source', nino),
        photo('receipt', '2024-06-12T22:00:00', 'receipt'),
        photo('pasta', '2024-06-12T20:30:00', 'subject', nino),
        photo('sign', '2024-06-12T19:50:00', 'sign'),
      ],
      getMealType,
    );
    expect(summary).toEqual({
      start: '2024-06-12T19:50:00',
      end: '2024-06-12T22:00:00',
      day: '2024-06-12',
      type: 'Dinner',
      city: 'Taormina',
      country: 'Italy',
      gps: [37.8526, 15.2869],
      subjectIds: ['pasta'],
      sourceIds: ['menu'],
      signIds: ['sign'],
      receiptIds: ['receipt'],
    });
  });

  it('should leave out the place when it is unknown', () => {
    const summary = summarizeVisit([photo('pasta', '2024-06-12T13:00:00')], getMealType);
    expect(summary.city).toBeUndefined();
    expect(summary.gps).toBeUndefined();
    expect(summary.type).toBe('Lunch');
  });
});

describe('getFallbackVisitNames', () => {
  it('should name visits of a pack without kinds of visits by the visit and the city', () => {
    expect(
      getFallbackVisitNames(
        [
          { city: 'Florence', day: '2024-06-12', start: '2024-06-12T10:00:00' },
          { day: '2024-06-13', start: '2024-06-13T10:00:00' },
        ],
        getDefaultFallbackName({ visit: 'museum visit' }),
      ),
    ).toEqual(['Museum visit in Florence', 'Museum visit on 2024-06-13']);
  });

  it('should name meals by type and city, adding the day and time when needed', () => {
    expect(
      getFallbackVisitNames(
        [
          { type: 'Dinner', city: 'Taormina', day: '2024-06-12', start: '2024-06-12T20:00:00' },
          { type: 'Lunch', city: 'Taormina', day: '2024-06-12', start: '2024-06-12T13:00:00' },
          { type: 'Dinner', city: 'Taormina', day: '2024-06-13', start: '2024-06-13T20:00:00' },
          { type: 'Dinner', city: 'Catania', day: '2024-06-14', start: '2024-06-14T19:00:00' },
          { type: 'Lunch', day: '2024-06-15', start: '2024-06-15T12:00:00' },
          { type: 'Dinner', city: 'Catania', day: '2024-06-15', start: '2024-06-15T19:00:00' },
          { type: 'Dinner', city: 'Catania', day: '2024-06-15', start: '2024-06-15T22:30:00' },
        ],
        foodPack.place.fallbackName,
      ),
    ).toEqual([
      'Dinner in Taormina, 2024-06-12',
      'Lunch in Taormina',
      'Dinner in Taormina, 2024-06-13',
      'Dinner in Catania, 2024-06-14',
      'Lunch on 2024-06-15',
      'Dinner in Catania, 2024-06-15 19:00',
      'Dinner in Catania, 2024-06-15 22:30',
    ]);
  });
});
