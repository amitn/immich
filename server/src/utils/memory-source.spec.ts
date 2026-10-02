import { MemoryType } from 'src/enum.js';
import { MemorySourceMemory, getMemorySource } from 'src/utils/memory-source.js';

const memory = (data: Record<string, unknown>, overrides: Partial<MemorySourceMemory> = {}): MemorySourceMemory => ({
  id: 'memory-1',
  type: MemoryType.Rule,
  data,
  memoryAt: new Date('2026-09-28T00:00:00.000Z'),
  assetIds: ['a', 'b', 'a'],
  ...overrides,
});

describe(getMemorySource.name, () => {
  it('should cover every day of a recent trip, not only its curated photos', () => {
    const source = getMemorySource(
      memory({
        ruleId: 'recent_trip',
        dedupeKey: 'recent_trip:gr|athens:2026-09-28',
        context: {
          placeLabel: 'Athens, Greece',
          tripWindowStart: '2026-09-12T08:15:00.000Z',
          tripWindowEnd: '2026-09-19T21:40:00.000Z',
        },
      }),
    );

    expect(source).toEqual({
      memoryId: 'memory-1',
      ruleId: 'recent_trip',
      kind: 'trip',
      title: 'Recent trip to Athens, Greece',
      subtitle: '12–19 September 2026',
      from: new Date('2026-09-12T00:00:00.000Z'),
      to: new Date('2026-09-19T23:59:59.999Z'),
      personIds: [],
      favoritesOnly: false,
      videosOnly: false,
      assetIds: ['a', 'b'],
      dedupeKey: 'recent_trip:gr|athens:2026-09-28',
      includeMaps: true,
      stylePreset: 'classic',
    });
  });

  it('should cover a trip anniversary from its first day to its last', () => {
    const source = getMemorySource(
      memory({
        ruleId: 'trip_anniversary',
        context: { placeLabel: 'Rome, Italy', tripStart: '2023-09-28T09:00:00.000Z', tripEnd: '2023-10-02T18:00:00Z' },
      }),
    );
    expect(source).toMatchObject({
      kind: 'trip',
      title: 'Your trip to Rome, Italy',
      from: new Date('2023-09-28T00:00:00.000Z'),
      to: new Date('2023-10-02T23:59:59.999Z'),
      includeMaps: true,
    });
  });

  it('should cover the year before a birthday, with the person in every photo', () => {
    const source = getMemorySource(
      memory({ ruleId: 'birthday', context: { personId: 'person-1', personName: 'Mia', variant: 'across_years' } }),
    );
    expect(source).toMatchObject({
      kind: 'birthday',
      title: 'Happy birthday, Mia',
      from: new Date('2025-09-28T00:00:00.000Z'),
      to: new Date('2026-09-28T23:59:59.999Z'),
      personIds: ['person-1'],
      stylePreset: 'soft',
      includeMaps: false,
    });
  });

  it.each([
    [
      'month_recap',
      { year: 2024, month: 2 },
      { title: 'February 2024', from: '2024-02-01T00:00:00.000Z', to: '2024-02-29T23:59:59.999Z' },
    ],
    [
      'favorites_throwback',
      { year: 2023, month: 9 },
      { title: 'Favorite moments from September 2023', favoritesOnly: true },
    ],
    ['video_moments', { year: 2022, month: 7 }, { title: 'Video moments from July 2022', videosOnly: true }],
    [
      'season_recap',
      { season: 'winter', seasonYear: 2024 },
      { title: 'Winter 2024', from: '2024-12-01T00:00:00.000Z', to: '2025-02-28T23:59:59.999Z' },
    ],
    [
      'people_together',
      { year: 2021, month: 5, personAId: 'p1', personAName: 'Ana', personBId: 'p2', personBName: 'Ben' },
      { title: 'Ana & Ben', personIds: ['p1', 'p2'], from: '2021-05-01T00:00:00.000Z' },
    ],
    [
      'person_throwback',
      { personId: 'p1', personName: 'Ana', chapterFrom: '2020-03-02T00:00:00.000Z', chapterTo: '2020-03-09T00:00Z' },
      { title: 'Times with Ana', personIds: ['p1'], to: '2020-03-09T23:59:59.999Z' },
    ],
  ])('should cover the window of %s', (ruleId, context, expected) => {
    const source = getMemorySource(memory({ ruleId, context }));
    expect(source).toMatchObject({
      ...expected,
      ...('from' in expected && { from: new Date(expected.from as string) }),
      ...('to' in expected && { to: new Date(expected.to as string) }),
    });
    expect(source.from).toBeInstanceOf(Date);
  });

  it('should use the photos of a theme or a place across years, which have no window', () => {
    for (const [ruleId, context, title] of [
      ['themed', { theme: 'sunset', year: 2024 }, 'Sunsets from 2024'],
      ['on_this_day_place', { city: 'Lisbon', years: [2019, 2022] }, 'On this day in Lisbon'],
    ] as const) {
      const source = getMemorySource(memory({ ruleId, context }));
      expect(source).toMatchObject({ kind: 'curated', title, assetIds: ['a', 'b'] });
      expect(source.from).toBeUndefined();
    }
  });

  it('should cover the whole day of an on-this-day memory', () => {
    const source = getMemorySource(
      memory({ year: 2019 }, { type: MemoryType.OnThisDay, memoryAt: new Date('2019-10-02T00:00:00.000Z') }),
      new Date('2026-10-02T12:00:00.000Z'),
    );
    expect(source).toMatchObject({
      ruleId: 'on_this_day',
      kind: 'day',
      title: '7 years ago',
      from: new Date('2019-10-02T00:00:00.000Z'),
      to: new Date('2019-10-02T23:59:59.999Z'),
    });
  });

  it('should keep an old memory with its own title, and fall back to its photos without a window', () => {
    expect(getMemorySource(memory({ ruleId: 'recent_trip', title: 'Crete', context: {} }))).toMatchObject({
      kind: 'curated',
      title: 'Crete',
    });
    expect(getMemorySource(memory({ ruleId: 'something_new' }))).toMatchObject({ kind: 'curated', title: 'Memories' });
  });
});
