import { describe, expect, it } from 'vitest';
import { alignCourses, assignMax, groupDishPhotos, matchCourses, matchDishes } from 'src/utils/food/match.js';

const vector = (...values: number[]) => {
  const norm = Math.hypot(...values);
  return Float32Array.from(values.map((value) => value / norm));
};

const minutes = (value: number) => value * 60_000;

// three menu items along the first three axes; the fourth axis is what photos share (a table, a plate)
const carbonara = { embedding: vector(1, 0, 0, 0) };
const vongole = { embedding: vector(0, 1, 0, 0) };
const tiramisu = { embedding: vector(0, 0, 1, 0) };

describe('assignMax', () => {
  it('should find the best one-to-one assignment', () => {
    expect(
      assignMax([
        [9, 8, 1],
        [9, 1, 1],
        [1, 1, 5],
      ]),
    ).toEqual([1, 0, 2]);
  });

  it('should leave rows without a column when there are more rows', () => {
    expect(assignMax([[1], [5], [3]])).toEqual([-1, 0, -1]);
  });

  it('should handle more columns than rows', () => {
    expect(assignMax([[1, 2, 7]])).toEqual([2]);
  });

  it('should handle empty input', () => {
    expect(assignMax([])).toEqual([]);
    expect(assignMax([[], []])).toEqual([-1, -1]);
  });
});

describe('matchDishes', () => {
  it('should match photos to items and group photos of the same dish', () => {
    const matches = matchDishes(
      [
        { id: 'carbonara-1', time: minutes(0), embedding: vector(0.9, 0.05, 0, 0.3) },
        { id: 'vongole', time: minutes(10), embedding: vector(0.05, 0.9, 0, 0.3) },
        { id: 'carbonara-2', time: minutes(2), embedding: vector(0.88, 0.06, 0, 0.32) },
        { id: 'tiramisu', time: minutes(50), embedding: vector(0, 0.05, 0.9, 0.3) },
      ],
      [carbonara, vongole, tiramisu],
    );

    expect(matches.map(({ ids, item, unsure }) => ({ ids, item, unsure }))).toEqual([
      { ids: ['carbonara-1', 'carbonara-2'], item: 0, unsure: false },
      { ids: ['vongole'], item: 1, unsure: false },
      { ids: ['tiramisu'], item: 2, unsure: false },
    ]);
    expect(matches[0].score).toBeGreaterThan(0.9);
    expect(matches[0].suggestions.map(({ item }) => item)).toEqual([0, 1, 2]);
    expect(matches[0].suggestions[0].similarity).toBeGreaterThan(0.9);
  });

  it('should give different dishes different items and mark the second choice unsure', () => {
    const matches = matchDishes(
      [
        { id: 'a', time: minutes(0), embedding: vector(0.9, 0.3, 0, 0) },
        { id: 'b', time: minutes(40), embedding: vector(0.64, 0.63, 0, 0.3) },
      ],
      [carbonara, vongole],
    );

    expect(matches.map(({ ids, item, unsure }) => ({ ids, item, unsure }))).toEqual([
      { ids: ['a'], item: 0, unsure: false },
      { ids: ['b'], item: 1, unsure: true },
    ]);
    expect(matches[1].suggestions[0].item).toBe(0);
  });

  it('should mark a photo that looks like two items unsure', () => {
    const [match] = matchDishes([{ id: 'a', time: 0, embedding: vector(0.7, 0.7, 0, 0.2) }], [carbonara, vongole]);
    expect(match.unsure).toBe(true);
    expect(match.score).toBeLessThan(0.6);
  });

  it('should leave a dish that is not on the menu unmatched, against a generic dish', () => {
    const baseline = vector(0.3, 0.3, 0.3, 1);
    const matches = matchDishes(
      [
        { id: 'a', time: minutes(0), embedding: vector(0.9, 0.1, 0, 0) },
        { id: 'b', time: minutes(40), embedding: vector(0.2, 0.1, 0.9, 0.3) },
      ],
      [carbonara],
      { baselines: [baseline] },
    );
    expect(matches.map(({ ids, item, unsure }) => ({ ids, item, unsure }))).toEqual([
      { ids: ['a'], item: 0, unsure: false },
      { ids: ['b'], item: undefined, unsure: true },
    ]);
  });

  it('should let two plates of the same dish share it', () => {
    const matches = matchDishes(
      [
        { id: 'a', time: minutes(0), embedding: vector(0.9, 0.1, 0, 0.3) },
        { id: 'b', time: minutes(40), embedding: vector(0.85, 0.05, 0.1, 0.1) },
      ],
      [carbonara, vongole],
    );
    expect(matches.map(({ ids, item, unsure, shared }) => ({ ids, item, unsure, shared }))).toEqual([
      { ids: ['a'], item: 0, unsure: false, shared: true },
      { ids: ['b'], item: 0, unsure: false, shared: true },
    ]);
  });

  it('should match a tasting menu with courses that are not on it', () => {
    // a French Laundry-like lunch: two desserts for one "assortment of desserts" course, an amuse-bouche and
    // coffee that are not on the menu; axes: oysters, lamb, desserts, bread/coffee/snacks, the table
    const oysters = { embedding: vector(1, 0, 0, 0, 0) };
    const lamb = { embedding: vector(0, 1, 0, 0, 0) };
    const desserts = { embedding: vector(0, 0, 1, 0, 0) };
    const baselines = [vector(0.2, 0.2, 0.2, 1, 0.3)];

    const matches = matchDishes(
      [
        { id: 'gougeres', time: minutes(0), embedding: vector(0.1, 0.05, 0.05, 0.9, 0.4) },
        { id: 'oysters', time: minutes(5), embedding: vector(0.9, 0.05, 0, 0.1, 0.4) },
        { id: 'lamb', time: minutes(80), embedding: vector(0.05, 0.9, 0, 0.1, 0.4) },
        { id: 'meringue', time: minutes(91), embedding: vector(0, 0.05, 0.85, 0.1, 0.4) },
        { id: 'chocolate-cake', time: minutes(109), embedding: vector(0.2, 0.1, 0.6, 0.4, 0) },
        { id: 'cappuccino', time: minutes(124), embedding: vector(0.02, 0.02, 0.2, 0.9, 0.4) },
      ],
      [oysters, lamb, desserts],
      { baselines },
    );

    expect(matches.map(({ ids, item }) => ({ ids, item }))).toEqual([
      { ids: ['gougeres'], item: undefined },
      { ids: ['oysters'], item: 0 },
      { ids: ['lamb'], item: 1 },
      { ids: ['meringue'], item: 2 },
      { ids: ['chocolate-cake'], item: 2 },
      { ids: ['cappuccino'], item: undefined },
    ]);
    expect(matches[0].offMenu).toBeGreaterThan(0.5);
    expect(matches[0].unsure).toBe(true);
  });

  it('should return the groups without suggestions when there are no items', () => {
    const matches = matchDishes([{ id: 'a', time: 0, embedding: vector(1, 0, 0, 0) }], []);
    expect(matches).toEqual([{ ids: ['a'], score: 0, unsure: true, suggestions: [] }]);
  });
});

/** a unit vector along axis `axis` of `size`, with `weight` on it and the rest spread over the others by `noise` */
const axis = (size: number, index: number, weight = 1, noise: number[] = []) =>
  vector(...Array.from({ length: size }, (_, i) => (i === index ? weight : (noise[i] ?? 0))));

describe('groupDishPhotos', () => {
  const options = { sameDishDistance: 0.03, sameDishMinutes: 5 };

  it('should group a burst of near-identical photos', () => {
    const groups = groupDishPhotos(
      [
        { id: 'a', time: 0, embedding: vector(1, 0.1, 0.05) },
        { id: 'b', time: 20_000, embedding: vector(1, 0.12, 0.06) },
        { id: 'c', time: minutes(12), embedding: vector(0.1, 1, 0.05) },
      ],
      options,
    );
    expect(groups).toEqual([[0, 1], [2]]);
  });

  it('should keep courses that look alike apart', () => {
    // plated courses on white tablecloths: 0.95 alike, 12 minutes apart
    const plate = (lean: number) => vector(1, lean, 0.2);
    const groups = groupDishPhotos(
      [
        { id: 'trout', time: 0, embedding: plate(0.3) },
        { id: 'crab', time: minutes(12), embedding: plate(0.6) },
        { id: 'poularde', time: minutes(25), embedding: plate(0.45) },
      ],
      options,
    );
    expect(groups).toEqual([[0], [1], [2]]);
    // and the same photo taken again much later is another plate
    expect(
      groupDishPhotos(
        [
          { id: 'a', time: 0, embedding: plate(0.3) },
          { id: 'b', time: minutes(20), embedding: plate(0.3) },
        ],
        options,
      ),
    ).toEqual([[0], [1]]);
  });
});

describe('alignCourses', () => {
  const penalties = {
    sharePenalty: Math.log(8),
    skipPenalty: 0,
    asidePenalty: 2,
    pacePenalty: 0,
    paceTolerance: 0.2,
    offPenalty: 0,
  };
  const log = (...values: number[]) => values.map((value) => Math.log(value));

  it('should take the courses in order, skip what no photo shows and leave the extras off the menu', () => {
    // three courses and "not on the menu"; the second dish looks a little more like the third course
    const logs = [
      log(0.1, 0.1, 0.1, 0.7), // amuse-bouche
      log(0.6, 0.2, 0.1, 0.1),
      log(0.1, 0.4, 0.45, 0.05),
      log(0.1, 0.2, 0.6, 0.1),
      log(0.05, 0.05, 0.1, 0.8), // coffee
    ];
    const { choices, marginals, offMarginals } = alignCourses(logs, [0, 1, 2], [], penalties);
    expect(choices.map(({ kind, item }) => (kind === 'off' ? null : item))).toEqual([null, 0, 1, 2, null]);
    // the probabilities over all alignments
    expect(marginals[2][1]).toBeGreaterThan(marginals[2][2]);
    expect(offMarginals[0]).toBeGreaterThan(0.5);
    for (const [dish, row] of marginals.entries()) {
      expect(row.reduce((sum, value) => sum + value, 0) + offMarginals[dish]).toBeCloseTo(1, 6);
    }
  });

  it('should let two dishes share a course and take a drink of the pairing out of order', () => {
    const logs = [
      log(0.7, 0.1, 0.1, 0.1),
      log(0.05, 0.05, 0.85, 0.05), // a drink of the pairing (item 2, aside)
      log(0.05, 0.85, 0.05, 0.05),
      log(0.05, 0.85, 0.05, 0.05), // another dessert of the same course
    ];
    const { choices } = alignCourses(logs, [0, 1], [2], penalties);
    expect(choices.map(({ kind, item }) => [kind, item])).toEqual([
      ['course', 0],
      ['aside', 2],
      ['course', 1],
      ['share', 1],
    ]);
  });
});

describe('matchCourses', () => {
  // a tasting menu of six courses, and a generic "not on the menu" text; CLIP tells the courses apart only a little
  const size = 8;
  const courses = Array.from({ length: 6 }, (_, index) => ({ embedding: axis(size, index), course: index }));
  const baselines = [axis(size, 6)];
  // each course photo is closest to its course, but also close to the course two places later
  const photo = (index: number, time: number, confuser = (index + 2) % 6) => ({
    id: `course-${index}`,
    time: minutes(time),
    embedding: axis(size, index, 0.5, { [confuser]: 0.47, 7: 0.7 } as unknown as number[]),
  });
  const photos = [
    { id: 'amuse', time: 0, embedding: axis(size, 6, 0.6, { 7: 0.7 } as unknown as number[]) },
    ...Array.from({ length: 6 }, (_, index) => photo(index, 10 + index * 15)),
    { id: 'coffee', time: minutes(110), embedding: axis(size, 6, 0.6, { 7: 0.7 } as unknown as number[]) },
  ];

  it('should follow the order of the courses of a tasting menu', () => {
    const { matches, ordered } = matchCourses(photos, courses, { baselines });
    expect(ordered).toBe(true);
    expect(matches.map(({ ids, item }) => [ids[0], item])).toEqual([
      ['amuse', undefined],
      ...Array.from({ length: 6 }, (_, index) => [`course-${index}`, index]),
      ['coffee', undefined],
    ]);
    for (const match of matches) {
      expect(match.score).toBeGreaterThanOrEqual(0);
      expect(match.score).toBeLessThanOrEqual(1);
    }
  });

  it('should not follow the order of a menu with prices', () => {
    const priced = courses.map((course) => ({ ...course, priced: true }));
    expect(matchCourses(photos, priced, { baselines }).ordered).toBe(false);
  });

  it('should not follow the order when the photos are not in it', () => {
    const times = [5, 0, 3, 1, 4, 2];
    const shuffled = photos.map((photo, index) =>
      index > 0 && index < 7 ? { ...photo, time: minutes(10 + times[index - 1] * 15) } : photo,
    );
    expect(matchCourses(shuffled, courses, { baselines }).ordered).toBe(false);
    expect(matchCourses(shuffled, courses, { baselines, order: 'none' }).ordered).toBe(false);
  });

  it('should not let a text that CLIP likes for every photo win every dish', () => {
    // "caviar" (the last item) is a little closer to every photo than the dishes' own items
    const items = [
      ...Array.from({ length: 4 }, (_, index) => ({ embedding: axis(5, index) })),
      { embedding: vector(0.25, 0.25, 0.25, 0.25, 0.93) },
    ];
    const dishes = [0, 1, 2, 3].map((index) => ({
      id: `dish-${index}`,
      time: minutes(index * 20),
      embedding: axis(5, index, 0.5, [0, 0, 0, 0, 0.87]),
    }));
    expect(matchDishes(dishes, items, { order: 'none' }).map(({ item }) => item)).toEqual([0, 1, 2, 3]);
    // measured on their own, caviar wins a dish
    expect(matchDishes(dishes, items, { order: 'none', centerDishes: 10 }).map(({ item }) => item)).toContain(4);
  });
});
