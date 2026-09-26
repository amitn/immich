import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEAL_OPTIONS,
  FoodPhoto,
  getFallbackMealNames,
  getMealType,
  groupMeals,
  summarizeMeal,
} from 'src/utils/food/meals.js';

const at = (iso: string) => new Date(`${iso}Z`).getTime();
const photo = (
  id: string,
  iso: string,
  kind: FoodPhoto['kind'] = 'dish',
  extra: Partial<FoodPhoto> = {},
): FoodPhoto => ({
  id,
  time: at(iso),
  kind,
  ...extra,
});

// Taormina, Corso Umberto, and a place about 400 m away
const nino = { latitude: 37.8526, longitude: 15.2869, city: 'Taormina', country: 'Italy' };
const ninoNearby = { latitude: 37.8531, longitude: 15.2874, city: 'Taormina', country: 'Italy' };
const bar = { latitude: 37.8505, longitude: 15.2905, city: 'Taormina', country: 'Italy' };

describe('groupMeals', () => {
  it('should keep a meal together', () => {
    const meals = groupMeals([
      photo('sign', '2024-06-12T20:02:00', 'sign', nino),
      photo('menu', '2024-06-12T20:10:00', 'menu', nino),
      photo('starter', '2024-06-12T20:35:00', 'dish', ninoNearby),
      photo('main', '2024-06-12T21:10:00', 'dish'),
      photo('dessert', '2024-06-12T21:50:00', 'dish', nino),
    ]);
    expect(meals.map((meal) => meal.map(({ id }) => id))).toEqual([['sign', 'menu', 'starter', 'main', 'dessert']]);
  });

  it('should split meals on a gap', () => {
    const meals = groupMeals([
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
    const meals = groupMeals(photos);
    expect(meals.map((meal) => meal.length)).toEqual([7, 1]);
  });

  it('should split meals at different places', () => {
    const meals = groupMeals([
      photo('a', '2024-06-12T20:00:00', 'dish', nino),
      photo('b', '2024-06-12T20:20:00', 'dish', bar),
    ]);
    expect(meals).toHaveLength(2);
  });

  it('should drop visits without a dish or a menu', () => {
    const meals = groupMeals([
      photo('storefront', '2024-06-12T10:00:00', 'sign', nino),
      photo('dish', '2024-06-12T20:00:00', 'dish', nino),
    ]);
    expect(meals.map((meal) => meal.map(({ id }) => id))).toEqual([['dish']]);
  });

  it('should accept other options', () => {
    const meals = groupMeals([photo('a', '2024-06-12T20:00:00'), photo('b', '2024-06-12T20:20:00')], {
      ...DEFAULT_MEAL_OPTIONS,
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

describe('summarizeMeal', () => {
  it('should summarize a meal', () => {
    const summary = summarizeMeal([
      photo('menu', '2024-06-12T19:55:00', 'menu', nino),
      photo('receipt', '2024-06-12T22:00:00', 'receipt'),
      photo('pasta', '2024-06-12T20:30:00', 'dish', nino),
      photo('sign', '2024-06-12T19:50:00', 'sign'),
    ]);
    expect(summary).toEqual({
      start: '2024-06-12T19:50:00',
      end: '2024-06-12T22:00:00',
      day: '2024-06-12',
      type: 'Dinner',
      city: 'Taormina',
      country: 'Italy',
      gps: [37.8526, 15.2869],
      dishIds: ['pasta'],
      menuIds: ['menu'],
      signIds: ['sign'],
      receiptIds: ['receipt'],
    });
  });

  it('should leave out the place when it is unknown', () => {
    const summary = summarizeMeal([photo('pasta', '2024-06-12T13:00:00')]);
    expect(summary.city).toBeUndefined();
    expect(summary.gps).toBeUndefined();
    expect(summary.type).toBe('Lunch');
  });
});

describe('getFallbackMealNames', () => {
  it('should name meals by type and city, adding the day and time when needed', () => {
    expect(
      getFallbackMealNames([
        { type: 'Dinner', city: 'Taormina', day: '2024-06-12', start: '2024-06-12T20:00:00' },
        { type: 'Lunch', city: 'Taormina', day: '2024-06-12', start: '2024-06-12T13:00:00' },
        { type: 'Dinner', city: 'Taormina', day: '2024-06-13', start: '2024-06-13T20:00:00' },
        { type: 'Dinner', city: 'Catania', day: '2024-06-14', start: '2024-06-14T19:00:00' },
        { type: 'Lunch', day: '2024-06-15', start: '2024-06-15T12:00:00' },
        { type: 'Dinner', city: 'Catania', day: '2024-06-15', start: '2024-06-15T19:00:00' },
        { type: 'Dinner', city: 'Catania', day: '2024-06-15', start: '2024-06-15T22:30:00' },
      ]),
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
