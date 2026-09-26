import { bookStylePresets, defaultBookStyle } from 'src/dtos/book.dto.js';
import {
  AutoLayoutOptions,
  AutoLayoutPhoto,
  AutoLayoutPlan,
  getFactualCaption,
  getTargetPageCount,
  getVisitTitle,
  planAutoLayout,
} from 'src/utils/book/auto-layout.js';
import {
  VISIT_GAP_MS,
  getFoodTag,
  getRestaurantVisits,
  getRunsBetweenVisits,
  shareFoodTagsInStacks,
} from 'src/utils/book/food.js';
import { getLayout } from 'src/utils/book/layouts.js';
import { FoodTag, getDishTag, getMenuTag } from 'src/utils/food/tags.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const start = Date.UTC(2009, 5, 23, 19, 30);
const size = { pageWidthMm: 210, pageHeightMm: 210 };
const food = bookStylePresets.food.style;

let counter = 0;
const photo = (dto: Partial<AutoLayoutPhoto> = {}): AutoLayoutPhoto => {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    width: 3000,
    height: 2000,
    takenAt: start + counter * MINUTE,
    score: 0.5,
    faces: [],
    isFavorite: false,
    ...dto,
  };
};

const dish = (restaurant: string, name: string, dto: Partial<AutoLayoutPhoto> = {}) =>
  photo({ food: { restaurant, kind: 'dish', dish: name }, ...dto });

const menu = (restaurant: string, dto: Partial<AutoLayoutPhoto> = {}) =>
  photo({ width: 2000, height: 2700, food: { restaurant, kind: 'menu' }, score: 0.3, ...dto });

const nino = 'Trattoria da Nino';
const etna = 'Osteria Etna';

/** a dinner at Nino in Taormina: the menu, then the dishes 10 minutes apart */
const dinner = (restaurant: string, at: number, dishes: string[], dto: Partial<AutoLayoutPhoto> = {}) => [
  menu(restaurant, { takenAt: at, ...dto }),
  ...dishes.map((name, i) => dish(restaurant, name, { takenAt: at + (i + 1) * 10 * MINUTE, ...dto })),
];

const plan = (photos: AutoLayoutPhoto[], options: Partial<AutoLayoutOptions> = {}) =>
  planAutoLayout(photos, { size, style: food, includeMaps: false, ...options });

const slotsOf = (result: AutoLayoutPlan) => result.pages.flatMap((page) => page.slots);

const chapterOf = (result: AutoLayoutPlan, section: number) => result.pages.filter((page) => page.section === section);

beforeEach(() => {
  counter = 0;
});

describe('food tags', () => {
  it('should read the food tag of a photo, a dish before a menu', () => {
    expect(getFoodTag(['Trips/Sicily', getMenuTag(nino), getDishTag(nino, 'Caponata')])).toEqual({
      restaurant: nino,
      kind: 'dish',
      dish: 'Caponata',
    });
    expect(getFoodTag([getMenuTag(nino)])).toEqual({ restaurant: nino, kind: 'menu' });
    expect(getFoodTag(['Food', 'Food/Nino', 'Places/Taormina'])).toBeUndefined();
  });

  it('should give the copies of a dish its tag', () => {
    const tag: FoodTag = { restaurant: nino, kind: 'dish', dish: 'Caponata' };
    const [original, copy, other] = shareFoodTagsInStacks([
      photo({ stackId: 'stack', food: tag }),
      photo({ stackId: 'stack', kind: 'improved' }),
      photo({ stackId: 'other' }),
    ]);
    expect(original.food).toEqual(tag);
    expect(copy.food).toEqual(tag);
    expect(other.food).toBeUndefined();
  });
});

describe('getRestaurantVisits', () => {
  it('should group the photos by restaurant, then by time', () => {
    const lunch = dinner(nino, start, ['Arancini']);
    const street = photo({ takenAt: start + 3 * HOUR });
    const etnaDinner = dinner(etna, start + 5 * HOUR, ['Pasta alla Norma']);
    const nextDay = dinner(nino, start + DAY, ['Caponata']);

    const { visits, others } = getRestaurantVisits([...nextDay, street, ...etnaDinner, ...lunch]);

    expect(visits.map(({ restaurant, photos }) => [restaurant, photos.map(({ id }) => id)])).toEqual([
      [nino, lunch.map(({ id }) => id)],
      [etna, etnaDinner.map(({ id }) => id)],
      [nino, nextDay.map(({ id }) => id)],
    ]);
    expect(others).toEqual([street]);
  });

  it('should split a restaurant where the photos are hours apart', () => {
    const photos = [
      dish(nino, 'Caponata', { takenAt: start }),
      dish(nino, 'Cannoli', { takenAt: start + VISIT_GAP_MS + 1 }),
    ];
    expect(getRestaurantVisits(photos).visits).toHaveLength(2);
  });

  it('should add the untagged photos taken during a visit, and name it the way it is tagged most often', () => {
    const table = photo({ takenAt: start + 15 * MINUTE });
    const before = photo({ takenAt: start - 2 * HOUR });
    const photos = [
      dish(nino, 'Caponata', { takenAt: start }),
      table,
      dish('Trattoria da Nino ', 'Cannoli', { takenAt: start + 30 * MINUTE }),
      dish('trattoria da nino', 'Granita', { takenAt: start + 40 * MINUTE }),
      dish(nino, 'Arancini', { takenAt: start + 50 * MINUTE }),
      before,
    ];

    const { visits, others } = getRestaurantVisits(photos);

    expect(visits).toHaveLength(1);
    expect(visits[0].restaurant).toBe(nino);
    expect(visits[0].photos).toContain(table);
    expect(others).toEqual([before]);
  });

  it('should split the other photos into the runs between the visits', () => {
    const before = photo({ takenAt: start - HOUR });
    const between = photo({ takenAt: start + 3 * HOUR });
    const after = photo({ takenAt: start + DAY + 3 * HOUR });
    const { visits } = getRestaurantVisits([
      ...dinner(nino, start, ['Caponata']),
      ...dinner(etna, start + DAY, ['Cannoli']),
    ]);
    expect(getRunsBetweenVisits([before, between, after], visits)).toEqual([[before], [between], [after]]);
  });
});

describe('getVisitTitle', () => {
  it('should name the restaurant, the place and the date', () => {
    const photos = [dish(nino, 'Caponata', { city: 'Taormina' })];
    expect(getVisitTitle(nino, photos)).toBe('Trattoria da Nino · Taormina, 23 June 2009');
    expect(getVisitTitle(nino, [dish(nino, 'Caponata', { country: 'Italy' })])).toBe(
      'Trattoria da Nino · Italy, 23 June 2009',
    );
    expect(getVisitTitle(nino, [dish(nino, 'Caponata')], true)).toMatch(
      /^Trattoria da Nino · 23 June 2009, \d+:\d\d pm$/,
    );
  });
});

describe('getFactualCaption', () => {
  it('should name the place of the photos that are not dishes', () => {
    expect(getFactualCaption([dish(nino, 'Caponata', { city: 'Taormina' })], 'dish')).toBeUndefined();
    expect(getFactualCaption([dish(nino, 'Caponata', { city: 'Taormina' }), photo({ city: 'Messina' })], 'dish')).toBe(
      'Messina',
    );
    expect(getFactualCaption([photo({ city: 'Taormina' })], 'dish', { sectionTitle: 'Taormina' })).toBeUndefined();
  });
});

describe('planAutoLayout in a food book', () => {
  const trip = () => [
    photo({ takenAt: start - DAY, city: 'Catania', score: 0.9 }),
    ...dinner(nino, start, ['Spaghetti alle vongole', 'Pesce spada', 'Caponata', 'Cannoli'], { city: 'Taormina' }),
    ...Array.from({ length: 4 }, (_, i) => photo({ takenAt: start + DAY - 6 * HOUR + i * MINUTE, city: 'Savoca' })),
    ...dinner(etna, start + DAY, ['Arancini', 'Pasta alla Norma', 'Granita'], { city: 'Catania' }),
  ];

  it('should make one chapter per restaurant visit, titled with the restaurant, the place and the date', () => {
    const result = plan(trip());
    const restaurants = result.sections.filter((section) => section.restaurant);

    expect(restaurants.map(({ title, restaurant }) => [restaurant, title])).toEqual([
      [nino, 'Trattoria da Nino · Taormina, 23 June 2009'],
      [etna, 'Osteria Etna · Catania, 24 June 2009'],
    ]);
    expect(result.sections.some((section) => !section.restaurant)).toBe(true);
    for (const page of result.pages.filter((item) => item.section !== undefined)) {
      const section = result.sections[page.section!];
      const photos = new Set(section.photoIds);
      expect(page.slots.every((slot) => photos.has(slot.assetId))).toBe(true);
    }
  });

  it('should open a restaurant chapter with its menu, legible and hardly cropped', () => {
    const result = plan(trip());
    const index = result.sections.findIndex((section) => section.restaurant === nino);
    const [opener] = chapterOf(result, index);

    expect(['menu', 'menu-wide']).toContain(opener.layout);
    expect(opener.sectionTitle).toBe('Trattoria da Nino · Taormina, 23 June 2009');
    expect(opener.slots[0].assetId).toBe(result.sections[index].photoIds[0]);
    const crop = opener.slots[0].crop;
    expect(crop.width * crop.height).toBeGreaterThan(0.9);
    expect(opener.caption).toBe('Spaghetti alle vongole\nPesce spada\nCaponata\nCannoli');
  });

  it('should put the menu page right after the map of a chapter with GPS', () => {
    const photos = trip().map((item) => ({ ...item, lat: 37.85, lon: 15.28 }));
    const result = plan(photos, { includeMaps: true, targetPageCount: 16 });
    const index = result.sections.findIndex((section) => section.restaurant === nino);
    const [map, menuPage] = chapterOf(result, index);

    expect(map.layout).toBe('map');
    expect(map.map?.title).toBe(nino);
    expect(map.caption).toBe('Taormina, 23 June 2009');
    expect(menuPage.layout).toMatch(/^menu/);
  });

  it('should caption every dish with its name and leave the other photos to the place captions', () => {
    const photos = trip();
    const result = plan(photos);
    const dishes = new Map(
      photos
        .filter((item) => item.food?.kind === 'dish')
        .map((item) => [item.id, item.food?.kind === 'dish' ? item.food.dish : '']),
    );

    for (const slot of slotsOf(result)) {
      expect(slot.caption).toBe(dishes.get(slot.assetId));
    }
    expect(slotsOf(result).filter((slot) => slot.caption)).toHaveLength(dishes.size);
    expect(result.pages.some((page) => page.caption === 'Savoca')).toBe(true);
  });

  it('should give the dishes layouts with room for their names', () => {
    const photos = [
      photo({ takenAt: start - DAY }),
      ...dinner(
        nino,
        start,
        Array.from({ length: 12 }, (_, i) => `Course ${i + 1}`),
      ),
    ];
    const result = plan(photos, { targetPageCount: 8 });
    const dishPages = result.pages.filter((page) => page.slots.some((slot) => slot.caption));

    expect(dishPages.length).toBeGreaterThan(0);
    for (const page of dishPages) {
      expect(page.slots.length).toBeLessThanOrEqual(4);
    }
    expect(dishPages.filter((page) => getLayout(page.layout)?.food).length).toBeGreaterThanOrEqual(
      dishPages.length / 2,
    );
  });

  it('should open a visit without a menu with a dish and its name', () => {
    const photos = [
      photo({ takenAt: start - DAY }),
      ...['Caponata', 'Cannoli', 'Granita'].map((name, i) => dish(nino, name, { takenAt: start + i * 10 * MINUTE })),
    ];
    const result = plan(photos);
    const [opener] = chapterOf(
      result,
      result.sections.findIndex((section) => section.restaurant),
    );

    expect(opener.layout).toBe('dish-opener');
    expect(opener.sectionTitle).toMatch(/^Trattoria da Nino · /);
    expect(opener.slots[0].caption).toBeDefined();
  });

  it('should keep one menu page per visit', () => {
    const photos = [photo({ takenAt: start - DAY }), ...dinner(nino, start, ['Caponata', 'Cannoli']), menu(nino)];
    const result = plan(photos);
    const menus = result.pages.filter((page) => page.layout.startsWith('menu'));

    expect(menus).toHaveLength(1);
    expect(Object.values(result.dropReasons)).toEqual(['duplicate']);
  });

  it('should give two visits of a restaurant on one day different titles', () => {
    const photos = [
      photo({ takenAt: start - DAY }),
      ...dinner(nino, start - 7 * HOUR, ['Arancini']),
      ...dinner(nino, start, ['Caponata']),
    ];
    const titles = plan(photos)
      .sections.filter((section) => section.restaurant)
      .map(({ title }) => title);

    expect(titles).toHaveLength(2);
    expect(new Set(titles).size).toBe(2);
  });

  it('should keep the dish names to the dish caption mode', () => {
    const result = plan(trip(), { captions: 'place' });
    expect(slotsOf(result).every((slot) => !slot.caption)).toBe(true);
    expect(result.pages.find((page) => page.layout.startsWith('menu'))?.caption).toBeUndefined();
  });

  it('should lay out tagged photos as a food book in any style', () => {
    const result = plan(trip(), { style: defaultBookStyle });
    expect(result.sections.filter((section) => section.restaurant)).toHaveLength(2);
    expect(slotsOf(result).some((slot) => slot.caption)).toBe(true);
  });

  it('should not use the food layouts without food tags', () => {
    const photos = Array.from({ length: 12 }, (_, i) => photo({ takenAt: start + i * 10 * MINUTE }));
    for (const options of [{}, { style: defaultBookStyle }]) {
      const result = plan(photos, options);
      expect(result.pages.every((page) => !getLayout(page.layout)?.food)).toBe(true);
      expect(result.sections.every((section) => !section.restaurant)).toBe(true);
    }
  });

  it('should give a food book more pages', () => {
    expect(getTargetPageCount(30, { dishes: 20, menus: 2 })).toBeGreaterThan(getTargetPageCount(30));
    const photos = dinner(
      nino,
      start,
      Array.from({ length: 14 }, (_, i) => `Course ${i + 1}`),
    );
    expect(plan(photos).pages.length).toBeGreaterThan(plan(photos, { food: false }).pages.length);
  });
});
