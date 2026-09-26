import { FoodTag, parseFoodTag } from 'src/utils/food/tags.js';

/** A photo with the food tag it carries, see `src/utils/food/tags.ts` */
export type FoodPhoto = { id: string; takenAt: number; stackId?: string | null; food?: FoodTag | null };

/** photos of one restaurant further apart than this are different visits */
export const VISIT_GAP_MS = 3 * 60 * 60 * 1000;
/** photos without a food tag taken this close to the tagged photos of a visit belong to it, e.g. the table */
export const VISIT_MARGIN_MS = 20 * 60 * 1000;

export type RestaurantVisit<T extends FoodPhoto> = { restaurant: string; photos: T[]; start: number; end: number };

export const isDishPhoto = (photo: Pick<FoodPhoto, 'food'>) => photo.food?.kind === 'dish';

export const isMenuPhoto = (photo: Pick<FoodPhoto, 'food'>) => photo.food?.kind === 'menu';

export const getDishName = (photo: Pick<FoodPhoto, 'food'>) =>
  photo.food?.kind === 'dish' ? photo.food.dish : undefined;

const restaurantKey = (name: string) => name.trim().toLowerCase();

/**
 * The food tag of a photo from the values of its tags: a dish before a menu (a photo of a dish next to the menu is a
 * dish), then the first in alphabetical order; other tags are ignored
 */
export const getFoodTag = (values: Iterable<string>): FoodTag | undefined => {
  const tags = [...values]
    .toSorted()
    .map((value) => parseFoodTag(value))
    .filter((tag): tag is FoodTag => !!tag);
  return tags.find((tag) => tag.kind === 'dish') ?? tags[0];
};

/** Gives the photos of a stack that have no food tag the tag of the stack (e.g. an improved copy of a dish) */
export const shareFoodTagsInStacks = <T extends FoodPhoto>(photos: T[]): T[] => {
  const byStack = new Map<string, FoodTag>();
  for (const photo of photos) {
    if (photo.stackId && photo.food && (!byStack.has(photo.stackId) || photo.food.kind === 'dish')) {
      byStack.set(photo.stackId, photo.food);
    }
  }
  return photos.map((photo) =>
    !photo.food && photo.stackId && byStack.has(photo.stackId) ? { ...photo, food: byStack.get(photo.stackId) } : photo,
  );
};

/**
 * The restaurant visits among the photos: the photos tagged with one restaurant, split where more than
 * `VISIT_GAP_MS` passes between two of them, with the untagged photos taken during the visit (up to
 * `VISIT_MARGIN_MS` before or after). The other photos are returned as they are. Both are in time order.
 */
export const getRestaurantVisits = <T extends FoodPhoto>(
  photos: T[],
): { visits: RestaurantVisit<T>[]; others: T[] } => {
  const byTime = (a: T, b: T) => a.takenAt - b.takenAt || a.id.localeCompare(b.id);
  const ordered = photos.toSorted(byTime);
  const tagged = Map.groupBy(
    ordered.filter((photo) => photo.food),
    (photo) => restaurantKey(photo.food!.restaurant),
  );

  const visits: RestaurantVisit<T>[] = [];
  for (const group of tagged.values()) {
    // the spelling used most often names the restaurant
    const names = Map.groupBy(group, (photo) => photo.food!.restaurant.trim());
    const restaurant = [...names].toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0][0];
    let current: T[] = [];
    for (const photo of group) {
      if (current.length > 0 && photo.takenAt - current.at(-1)!.takenAt > VISIT_GAP_MS) {
        visits.push({ restaurant, photos: current, start: current[0].takenAt, end: current.at(-1)!.takenAt });
        current = [];
      }
      current.push(photo);
    }
    visits.push({ restaurant, photos: current, start: current[0].takenAt, end: current.at(-1)!.takenAt });
  }

  const others: T[] = [];
  for (const photo of ordered) {
    if (photo.food) {
      continue;
    }
    const visit = visits
      .filter((item) => photo.takenAt >= item.start - VISIT_MARGIN_MS && photo.takenAt <= item.end + VISIT_MARGIN_MS)
      .toSorted(
        (a, b) =>
          Math.abs(photo.takenAt - (a.start + a.end) / 2) - Math.abs(photo.takenAt - (b.start + b.end) / 2) ||
          a.start - b.start,
      )[0];
    if (visit) {
      visit.photos.push(photo);
    } else {
      others.push(photo);
    }
  }

  for (const visit of visits) {
    visit.photos.sort(byTime);
  }
  return { visits: visits.toSorted((a, b) => a.start - b.start || a.restaurant.localeCompare(b.restaurant)), others };
};

/** Splits time-ordered photos into the runs between the visits (a run for every gap, empty runs left out) */
export const getRunsBetweenVisits = <T extends FoodPhoto>(photos: T[], visits: RestaurantVisit<FoodPhoto>[]): T[][] => {
  const starts = visits.map((visit) => visit.start).toSorted((a, b) => a - b);
  const runs = Map.groupBy(photos, (photo) => starts.filter((start) => start <= photo.takenAt).length);
  return [...runs].toSorted((a, b) => a[0] - b[0]).map(([, run]) => run);
};
