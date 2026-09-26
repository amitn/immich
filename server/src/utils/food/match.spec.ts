import { describe, expect, it } from 'vitest';
import { assignMax, matchDishes } from 'src/utils/food/match.js';

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
