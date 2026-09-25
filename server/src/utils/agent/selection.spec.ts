import { describe, expect, it } from 'vitest';
import { SelectionCandidate, getMainPeople, getMainPersonMinimum, selectBest } from 'src/utils/agent/selection.js';

const HOUR = 3600 * 1000;

const candidate = (id: string, score: number, extra: Partial<SelectionCandidate> = {}): SelectionCandidate => ({
  id,
  time: Number(id.replaceAll(/\D/g, '') || 0) * HOUR,
  score,
  ...extra,
});

/** n photos an hour apart with decreasing scores */
const series = (n: number, extra: (i: number) => Partial<SelectionCandidate> = () => ({})) =>
  Array.from({ length: n }, (_, i) => candidate(`p${i}`, 1 - i / (n * 2), extra(i)));

describe('selectBest', () => {
  it('should return nothing without candidates', () => {
    expect(selectBest([], { count: 5 })).toEqual({
      ids: [],
      perPerson: {},
      perEvent: {},
      events: { covered: 0, total: 0 },
      clusters: { represented: 0, capped: 0 },
      unmet: ['count: 0/5 (not enough candidates)'],
    });
  });

  it('should pick the best photos', () => {
    const result = selectBest(
      [candidate('p1', 0.2), candidate('p2', 0.9), candidate('p3', 0.5), candidate('p4', 0.8)],
      { count: 2 },
    );
    expect(result.ids).toEqual(['p2', 'p4']);
    expect(result.unmet).toEqual([]);
  });

  it('should be deterministic regardless of input order', () => {
    const candidates = series(30, (i) => ({ cluster: i % 4 === 0 ? 1 : null, event: i % 3 }));
    const a = selectBest(candidates, { count: 10, maxPerEvent: 4 });
    const b = selectBest(candidates.toReversed(), { count: 10, maxPerEvent: 4 });
    expect(a).toEqual(b);
  });

  it('should break ties by time then id', () => {
    const result = selectBest(
      [
        { id: 'b', time: 10 * HOUR, score: 0.5 },
        { id: 'a', time: 10 * HOUR, score: 0.5 },
        { id: 'c', time: 0, score: 0.5 },
      ],
      { count: 2, chronological: false },
    );
    expect(result.ids).toEqual(['c', 'a']);
  });

  it('should sort chronologically by default', () => {
    const result = selectBest([candidate('p5', 0.9), candidate('p1', 0.8), candidate('p3', 0.7)], { count: 3 });
    expect(result.ids).toEqual(['p1', 'p3', 'p5']);
  });

  it('should keep pick order when not chronological', () => {
    const result = selectBest([candidate('p5', 0.9), candidate('p1', 0.8), candidate('p3', 0.7)], {
      count: 3,
      chronological: false,
    });
    expect(result.ids).toEqual(['p5', 'p1', 'p3']);
  });

  it('should limit photos per cluster', () => {
    const result = selectBest(
      [
        candidate('p1', 0.99, { cluster: 0 }),
        candidate('p2', 0.98, { cluster: 0 }),
        candidate('p3', 0.97, { cluster: 0 }),
        candidate('p4', 0.5),
      ],
      { count: 3, maxPerCluster: 1 },
    );
    expect(result.ids).toEqual(['p1', 'p4']);
    expect(result.clusters).toEqual({ represented: 1, capped: 1 });
    expect(result.unmet).toEqual(['count: 2/3 (limited by maxPerCluster/maxPerEvent)']);
  });

  it('should default to 2 photos per cluster', () => {
    const result = selectBest(
      series(5, () => ({ cluster: 7 })),
      { count: 5 },
    );
    expect(result.ids).toHaveLength(2);
  });

  it('should prefer a different cluster over a slightly better duplicate', () => {
    const result = selectBest(
      [
        candidate('p1', 0.9, { cluster: 0 }),
        candidate('p10', 0.88, { cluster: 0 }),
        candidate('p20', 0.8, { cluster: 1 }),
      ],
      { count: 2, chronological: false },
    );
    expect(result.ids).toEqual(['p1', 'p20']);
  });

  it('should ignore diversity when disabled', () => {
    const result = selectBest(
      [
        candidate('p1', 0.9, { cluster: 0 }),
        candidate('p10', 0.88, { cluster: 0 }),
        candidate('p20', 0.8, { cluster: 1 }),
      ],
      { count: 2, diversity: 0, chronological: false },
    );
    expect(result.ids).toEqual(['p1', 'p10']);
  });

  it('should avoid photos taken seconds apart', () => {
    const result = selectBest(
      [
        { id: 'a', time: 0, score: 0.9 },
        { id: 'b', time: 1000, score: 0.85 },
        { id: 'c', time: 5 * HOUR, score: 0.7 },
      ],
      { count: 2 },
    );
    expect(result.ids).toEqual(['a', 'c']);
  });

  it('should exclude photos', () => {
    const result = selectBest([candidate('p1', 0.9), candidate('p2', 0.8), candidate('p3', 0.1)], {
      count: 2,
      excludeIds: ['p1'],
    });
    expect(result.ids).toEqual(['p2', 'p3']);
  });

  it('should ignore duplicate candidates', () => {
    const result = selectBest([candidate('p1', 0.9), candidate('p1', 0.9)], { count: 2 });
    expect(result.ids).toEqual(['p1']);
  });

  it('should always include mustIncludeIds', () => {
    const result = selectBest(
      [candidate('p1', 0.9, { cluster: 0 }), candidate('p2', 0.8, { cluster: 0 }), candidate('p3', 0.1)],
      { count: 2, maxPerCluster: 1, mustIncludeIds: ['p3', 'p2'] },
    );
    expect(result.ids).toEqual(['p2', 'p3']);
  });

  it('should report mustIncludeIds that are not candidates or beyond count', () => {
    const result = selectBest([candidate('p1', 0.9), candidate('p2', 0.8)], {
      count: 1,
      excludeIds: ['p2'],
      mustIncludeIds: ['p1', 'p2', 'p9'],
    });
    expect(result.ids).toEqual(['p1']);
    expect(result.unmet).toEqual([
      'mustInclude p2: not a candidate or excluded',
      'mustInclude p9: not a candidate or excluded',
    ]);

    const over = selectBest([candidate('p1', 0.9), candidate('p2', 0.8)], { count: 1, mustIncludeIds: ['p1', 'p2'] });
    expect(over.ids).toEqual(['p1', 'p2']);
    expect(over.unmet).toEqual(['count: mustIncludeIds alone has 2 photos']);
  });

  describe('people', () => {
    const ann = 'ann';
    const bob = 'bob';

    it('should satisfy minimums for required people', () => {
      const candidates = [
        ...series(10, () => ({ personIds: [ann] })),
        candidate('p20', 0.1, { personIds: [bob] }),
        candidate('p21', 0.05, { personIds: [bob] }),
      ];
      const result = selectBest(candidates, { count: 5, requirePersonIds: [ann, bob], minPerPerson: 2 });
      expect(result.ids).toHaveLength(5);
      expect(result.ids).toContain('p20');
      expect(result.ids).toContain('p21');
      expect(result.perPerson).toEqual({ ann: 3, bob: 2 });
      expect(result.unmet).toEqual([]);
    });

    it('should default to one photo per required person', () => {
      const result = selectBest([...series(5), candidate('p9', 0.01, { personIds: [bob] })], {
        count: 2,
        requirePersonIds: [bob],
      });
      expect(result.ids).toContain('p9');
      expect(result.perPerson).toEqual({ bob: 1 });
    });

    it('should prefer photos with several required people', () => {
      const result = selectBest(
        [
          candidate('p1', 0.9, { personIds: [ann] }),
          candidate('p2', 0.85, { personIds: [bob] }),
          candidate('p3', 0.8, { personIds: [ann, bob] }),
        ],
        { count: 1, requirePersonIds: [ann, bob] },
      );
      expect(result.ids).toEqual(['p3']);
      expect(result.unmet).toEqual([]);
    });

    it('should report people without enough photos', () => {
      const result = selectBest([...series(5), candidate('p9', 0.1, { personIds: [bob] })], {
        count: 4,
        requirePersonIds: [bob, ann],
        minPerPerson: 2,
      });
      expect(result.ids).toHaveLength(4);
      expect(result.unmet).toEqual(['minPerPerson bob: 1/2 (1 candidates)', 'minPerPerson ann: 0/2 (0 candidates)']);
    });

    it('should share the budget fairly between people', () => {
      const candidates = [
        ...series(10, () => ({ personIds: [ann] })),
        ...Array.from({ length: 10 }, (_, i) => candidate(`p${i + 20}`, 0.3, { personIds: [bob] })),
      ];
      const result = selectBest(candidates, { count: 4, requirePersonIds: [ann, bob], minPerPerson: 5 });
      expect(result.perPerson).toEqual({ ann: 2, bob: 2 });
    });

    it('should favour people when asked', () => {
      const candidates = [candidate('p1', 0.9), candidate('p10', 0.8, { personIds: [ann] })];
      expect(selectBest(candidates, { count: 1 }).ids).toEqual(['p1']);
      expect(selectBest(candidates, { count: 1, preferPeople: true }).ids).toEqual(['p10']);
    });
  });

  describe('events', () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => candidate(`p${i}`, 0.9 - i / 100, { event: 0 })),
      ...Array.from({ length: 3 }, (_, i) => candidate(`p${i + 20}`, 0.3, { event: 1 })),
      candidate('p30', 0.2, { event: 2 }),
    ];

    it('should cap photos per event', () => {
      const result = selectBest(candidates, { count: 6, maxPerEvent: 2 });
      expect(result.perEvent).toEqual({ 0: 2, 1: 2, 2: 1 });
      expect(result.ids).toHaveLength(5);
    });

    it('should guarantee photos per event', () => {
      const result = selectBest(candidates, { count: 4, minPerEvent: 1 });
      expect(result.perEvent[1]).toBeGreaterThanOrEqual(1);
      expect(result.perEvent[2]).toBe(1);
      expect(result.events).toEqual({ covered: 3, total: 3 });
    });

    it('should cap minimums to the event size and report the budget shortfall', () => {
      const result = selectBest(candidates, { count: 3, minPerEvent: 2 });
      expect(result.perEvent).toEqual({ 0: 1, 1: 1, 2: 1 });
      expect(result.unmet).toEqual(['minPerEvent event 0: 1/2', 'minPerEvent event 1: 1/2']);
    });

    it('should spread picks over events proportionally', () => {
      const balanced = [
        ...Array.from({ length: 10 }, (_, i) => candidate(`p${i}`, 0.9, { event: 0, time: i * HOUR })),
        ...Array.from({ length: 10 }, (_, i) => candidate(`p${i + 20}`, 0.85, { event: 1, time: (i + 20) * HOUR })),
      ];
      const result = selectBest(balanced, { count: 6 });
      expect(result.perEvent).toEqual({ 0: 3, 1: 3 });
    });
  });

  it('should handle large inputs', () => {
    const candidates = Array.from({ length: 2000 }, (_, i) =>
      candidate(`p${i}`, ((i * 7919) % 1000) / 1000, {
        cluster: i % 50 === 0 ? null : Math.floor(i / 5),
        event: Math.floor(i / 100),
      }),
    );
    const result = selectBest(candidates, { count: 300, maxPerEvent: 20, minPerEvent: 5 });
    expect(result.ids).toHaveLength(300);
    expect(Math.max(...Object.values(result.perEvent))).toBeLessThanOrEqual(20);
    expect(Math.min(...Object.values(result.perEvent))).toBeGreaterThanOrEqual(5);
  });

  describe('people per event', () => {
    // three events of five photos; Ann is in the weakest photo of each event, Bob only in the first event
    const candidates = [0, 1, 2].flatMap((event) =>
      [0, 1, 2, 3, 4].map((i) =>
        candidate(`p${event * 10 + i}`, i === 0 ? 0.1 : 0.9 - i / 100, {
          event,
          personIds: [...(i === 0 ? ['ann'] : []), ...(event === 0 && i === 1 ? ['bob'] : [])],
        }),
      ),
    );

    it('should pick every required person in each event they appear in', () => {
      const result = selectBest(candidates, {
        count: 6,
        requirePersonIds: ['ann', 'bob'],
        minPerPerson: 1,
        minPerPersonPerEvent: 1,
      });
      expect(result.ids).toEqual(expect.arrayContaining(['p0', 'p10', 'p20', 'p1']));
      expect(result.perPerson).toEqual({ ann: 3, bob: 1 });
      expect(result.unmet).toEqual([]);
    });

    it('should report events that ran out of budget', () => {
      const result = selectBest(candidates, { count: 1, requirePersonIds: ['ann'], minPerPersonPerEvent: 1 });
      expect(result.ids).toHaveLength(1);
      expect(result.unmet).toEqual(['minPerPersonPerEvent ann event 1: 0/1', 'minPerPersonPerEvent ann event 2: 0/1']);
    });
  });
});

describe('getMainPeople', () => {
  it('should find the people who appear most often', () => {
    const photos = [
      ...Array.from({ length: 6 }, () => ({ personIds: ['ann'] })),
      ...Array.from({ length: 4 }, () => ({ personIds: ['bob', 'ann'] })),
      ...Array.from({ length: 2 }, () => ({ personIds: ['stranger'] })),
      ...Array.from({ length: 8 }, () => ({})),
    ];
    expect(getMainPeople(photos)).toEqual(['ann', 'bob']);
    expect(getMainPeople(photos, { maxPeople: 1 })).toEqual(['ann']);
    expect(getMainPeople(photos, { minShare: 0.3 })).toEqual(['ann']);
    expect(getMainPeople([])).toEqual([]);
  });

  it('should keep the per-book minimum within half the budget', () => {
    expect(getMainPersonMinimum(40, 2)).toBe(4);
    expect(getMainPersonMinimum(6, 2)).toBe(1);
    expect(getMainPersonMinimum(10, 1)).toBe(4);
    expect(getMainPersonMinimum(10, 0)).toBe(0);
  });
});
