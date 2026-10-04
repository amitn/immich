import { describe, expect, it } from 'vitest';
import {
  EventPoint,
  groupEventsByDay,
  haversineKm,
  pickSpread,
  splitEvents,
  summarizeEvent,
  toLocalDay,
  toLocalIso,
} from 'src/utils/agent/events.js';

const at = (iso: string) => new Date(`${iso}Z`).getTime();
const point = (id: string, iso: string, extra: Partial<EventPoint> = {}): EventPoint => ({
  id,
  time: at(iso),
  ...extra,
});

const rome = { latitude: 41.9028, longitude: 12.4964 };
const florence = { latitude: 43.7696, longitude: 11.2558 };
const options = { maxGapMinutes: 180, maxDistanceKm: 30 };

describe('haversineKm', () => {
  it('should be 0 for the same point', () => {
    expect(haversineKm(rome, rome)).toBe(0);
  });

  it('should measure Rome to Florence', () => {
    expect(haversineKm(rome, florence)).toBeCloseTo(231, 0);
  });

  it('should be symmetric', () => {
    expect(haversineKm(rome, florence)).toBeCloseTo(haversineKm(florence, rome), 9);
  });

  it('should handle antipodes', () => {
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 })).toBeCloseTo(20_015, 0);
  });
});

describe('toLocalIso', () => {
  it('should drop milliseconds and the zone', () => {
    expect(toLocalIso(at('2024-06-01T14:03:22.123'))).toBe('2024-06-01T14:03:22');
    expect(toLocalDay(at('2024-06-01T23:59:59'))).toBe('2024-06-01');
  });
});

describe('splitEvents', () => {
  it('should return nothing for no points', () => {
    expect(splitEvents([], options)).toEqual([]);
  });

  it('should keep close photos together', () => {
    const events = splitEvents(
      [point('a', '2024-06-01T10:00:00'), point('b', '2024-06-01T11:00:00'), point('c', '2024-06-01T12:59:00')],
      options,
    );
    expect(events.map((event) => event.map(({ id }) => id))).toEqual([['a', 'b', 'c']]);
  });

  it('should split on a time gap', () => {
    const events = splitEvents(
      [point('a', '2024-06-01T10:00:00'), point('b', '2024-06-01T13:00:01'), point('c', '2024-06-01T13:30:00')],
      options,
    );
    expect(events.map((event) => event.map(({ id }) => id))).toEqual([['a'], ['b', 'c']]);
  });

  it('should respect a custom gap', () => {
    const events = splitEvents([point('a', '2024-06-01T10:00:00'), point('b', '2024-06-01T10:31:00')], {
      ...options,
      maxGapMinutes: 30,
    });
    expect(events).toHaveLength(2);
  });

  it('should sort unsorted input', () => {
    const events = splitEvents([point('b', '2024-06-01T11:00:00'), point('a', '2024-06-01T10:00:00')], options);
    expect(events[0].map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('should split on a location jump', () => {
    const events = splitEvents(
      [
        point('a', '2024-06-01T10:00:00', rome),
        point('b', '2024-06-01T10:30:00', rome),
        point('c', '2024-06-01T11:00:00', florence),
      ],
      options,
    );
    expect(events.map((event) => event.map(({ id }) => id))).toEqual([['a', 'b'], ['c']]);
  });

  it('should compare with the last located photo, skipping photos without GPS', () => {
    const events = splitEvents(
      [
        point('a', '2024-06-01T10:00:00', rome),
        point('b', '2024-06-01T10:30:00'),
        point('c', '2024-06-01T11:00:00', { latitude: 0, longitude: 0 }),
        point('d', '2024-06-01T11:30:00', florence),
      ],
      options,
    );
    expect(events.map((event) => event.map(({ id }) => id))).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('should not split small moves', () => {
    const nearby = { latitude: rome.latitude + 0.1, longitude: rome.longitude };
    const events = splitEvents(
      [point('a', '2024-06-01T10:00:00', rome), point('b', '2024-06-01T10:30:00', nearby)],
      options,
    );
    expect(events).toHaveLength(1);
  });

  it('should split by local day', () => {
    const events = splitEvents(
      [
        point('a', '2024-06-01T22:00:00'),
        point('b', '2024-06-01T23:59:00'),
        point('c', '2024-06-02T00:01:00'),
        point('d', '2024-06-05T10:00:00'),
      ],
      { ...options, byDay: true },
    );
    expect(events.map((event) => event.map(({ id }) => id))).toEqual([['a', 'b'], ['c'], ['d']]);
  });
});

describe('pickSpread', () => {
  const items = Array.from({ length: 10 }, (_, i) => i);

  it('should return everything when there are few items', () => {
    expect(pickSpread([1, 2], 6)).toEqual([1, 2]);
  });

  it('should include the first and last item', () => {
    expect(pickSpread(items, 4)).toEqual([0, 3, 6, 9]);
  });

  it('should pick the middle for one item', () => {
    expect(pickSpread(items, 1)).toEqual([5]);
  });

  it('should handle zero', () => {
    expect(pickSpread(items, 0)).toEqual([]);
  });
});

describe('summarizeEvent', () => {
  it('should summarize an event', () => {
    const points = [
      point('a', '2024-06-01T10:00:00', { city: 'Rome', country: 'Italy', people: ['Ann', 'Bob'] }),
      point('b', '2024-06-01T10:10:00', { city: 'Rome', country: 'Italy', people: ['Ann'] }),
      point('c', '2024-06-01T11:00:00', { city: 'Tivoli', country: 'Italy' }),
    ];
    expect(summarizeEvent(points, 3, 2)).toEqual({
      index: 3,
      start: '2024-06-01T10:00:00',
      end: '2024-06-01T11:00:00',
      day: '2024-06-01',
      city: 'Rome',
      country: 'Italy',
      count: 3,
      people: ['Ann', 'Bob'],
      sampleIds: ['a', 'c'],
    });
  });

  it('should omit unknown fields', () => {
    const summary = summarizeEvent([point('a', '2024-06-01T10:00:00')], 0);
    expect(summary).toEqual({
      index: 0,
      start: '2024-06-01T10:00:00',
      end: '2024-06-01T10:00:00',
      day: '2024-06-01',
      count: 1,
      sampleIds: ['a'],
    });
  });

  it('should keep the top 5 people', () => {
    const people = ['A', 'B', 'C', 'D', 'E', 'F'];
    const points = people.map((name, i) =>
      point(String(i), `2024-06-01T10:0${i}:00`, { people: people.slice(0, people.length - i) }),
    );
    expect(summarizeEvent(points, 0).people).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('groupEventsByDay', () => {
  it('should group events by their start day', () => {
    const events = splitEvents(
      [point('a', '2024-06-01T08:00:00'), point('b', '2024-06-01T18:00:00'), point('c', '2024-06-02T09:00:00')],
      options,
    ).map((event, index) => summarizeEvent(event, index));
    expect(groupEventsByDay(events)).toEqual([
      { day: '2024-06-01', count: 2, events: [0, 1] },
      { day: '2024-06-02', count: 1, events: [2] },
    ]);
  });
});
