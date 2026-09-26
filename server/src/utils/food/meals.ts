import { haversineKm, sortByTime, toLocalDay, toLocalIso } from 'src/utils/agent/events.js';
import { FoodKind } from 'src/utils/food/classify.js';

export type FoodPhoto = {
  id: string;
  /** local wall-clock time in ms, i.e. `localDateTime.getTime()` */
  time: number;
  kind: Exclude<FoodKind, 'other'>;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  country?: string | null;
};

export type MealOptions = {
  /** a longer gap between food photos starts a new meal */
  maxGapMinutes: number;
  /** a meal lasts at most this long */
  maxSpanMinutes: number;
  /** a photo further than this from the meal's place starts a new meal */
  maxDistanceMeters: number;
};

export const DEFAULT_MEAL_OPTIONS: MealOptions = { maxGapMinutes: 45, maxSpanMinutes: 180, maxDistanceMeters: 150 };

export type MealType = 'Breakfast' | 'Lunch' | 'Dinner';

type Located = { latitude: number; longitude: number };

const isLocated = (photo: FoodPhoto): photo is FoodPhoto & Located =>
  typeof photo.latitude === 'number' &&
  typeof photo.longitude === 'number' &&
  Number.isFinite(photo.latitude) &&
  Number.isFinite(photo.longitude) &&
  !(photo.latitude === 0 && photo.longitude === 0);

const centroid = (points: Located[]): Located | undefined =>
  points.length === 0
    ? undefined
    : {
        latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
        longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
      };

/**
 * Groups food photos (dishes, menus, signs and receipts) into restaurant visits: photos taken at most
 * `maxGapMinutes` apart, within `maxSpanMinutes` of the first one and, when both are located, within
 * `maxDistanceMeters` of the place of the meal so far. Visits without a dish or a menu (a storefront passed by) are
 * dropped. Ordered by time, as is each meal.
 */
export const groupMeals = <T extends FoodPhoto>(photos: T[], options: MealOptions = DEFAULT_MEAL_OPTIONS): T[][] => {
  const meals: T[][] = [];
  let current: T[] = [];
  let located: Located[] = [];

  const flush = () => {
    if (current.some((photo) => photo.kind === 'dish' || photo.kind === 'menu')) {
      meals.push(current);
    }
    current = [];
    located = [];
  };

  for (const photo of sortByTime(photos)) {
    const first = current[0];
    const previous = current.at(-1);
    if (first && previous) {
      const place = centroid(located);
      const tooLate =
        photo.time - previous.time > options.maxGapMinutes * 60_000 ||
        photo.time - first.time > options.maxSpanMinutes * 60_000;
      const tooFar = !!place && isLocated(photo) && haversineKm(place, photo) * 1000 > options.maxDistanceMeters;
      if (tooLate || tooFar) {
        flush();
      }
    }

    current.push(photo);
    if (isLocated(photo)) {
      located.push(photo);
    }
  }
  flush();

  return meals;
};

/** breakfast before 11:00, lunch until 16:00, dinner after (local time) */
export const getMealType = (time: number): MealType => {
  const hour = new Date(time).getUTCHours();
  if (hour >= 4 && hour < 11) {
    return 'Breakfast';
  }
  if (hour >= 11 && hour < 16) {
    return 'Lunch';
  }
  return 'Dinner';
};

const mostCommon = (values: Array<string | null | undefined>) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0];
};

export type MealSummary = {
  start: string;
  end: string;
  day: string;
  type: MealType;
  city?: string;
  country?: string;
  /** [latitude, longitude] of the meal, the average of its located photos */
  gps?: [number, number];
  dishIds: string[];
  menuIds: string[];
  signIds: string[];
  receiptIds: string[];
};

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

export const summarizeMeal = (photos: FoodPhoto[]): MealSummary => {
  const sorted = sortByTime(photos);
  const first = sorted[0];
  const last = sorted.at(-1)!;
  const place = centroid(sorted.filter((photo) => isLocated(photo)) as Located[]);
  const city = mostCommon(sorted.map((photo) => photo.city));
  const country = mostCommon(sorted.map((photo) => photo.country));
  const ids = (kind: FoodPhoto['kind']) => sorted.filter((photo) => photo.kind === kind).map(({ id }) => id);

  return {
    start: toLocalIso(first.time),
    end: toLocalIso(last.time),
    day: toLocalDay(first.time),
    // the dishes tell when the meal was eaten better than a sign photographed on the way in
    type: getMealType((sorted.find((photo) => photo.kind === 'dish') ?? first).time),
    ...(city && { city }),
    ...(country && { country }),
    ...(place && { gps: [round(place.latitude, 5), round(place.longitude, 5)] as [number, number] }),
    dishIds: ids('dish'),
    menuIds: ids('menu'),
    signIds: ids('sign'),
    receiptIds: ids('receipt'),
  };
};

/**
 * Names for meals whose restaurant is unknown, e.g. "Dinner in Taormina"; the day is added when the name would repeat
 * ("Dinner in Taormina, 2024-06-12"), and the time when a day has two such meals.
 */
const count = (names: string[], name: string) => names.filter((candidate) => candidate === name).length;

export const getFallbackMealNames = (meals: Array<Pick<MealSummary, 'type' | 'city' | 'day' | 'start'>>) => {
  const base = meals.map(({ type, city, day }) => (city ? `${type} in ${city}` : `${type} on ${day}`));

  const withDay = base.map((name, index) =>
    count(base, name) > 1 && meals[index].city ? `${name}, ${meals[index].day}` : name,
  );
  return withDay.map((name, index) =>
    count(withDay, name) > 1 ? `${name} ${meals[index].start.slice(11, 16)}` : name,
  );
};
