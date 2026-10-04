import { MemoryExclusionType, type MemoryExclusionResponseDto } from '@immich/sdk';
import { formatExclusionDays, getExclusionName } from '$lib/utils/memory-exclusions';

const exclusion = (overrides: Partial<MemoryExclusionResponseDto>): MemoryExclusionResponseDto => ({
  id: 'e1',
  type: MemoryExclusionType.Person,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('memory exclusions', () => {
  it('formats a range of days in the viewer’s language', () => {
    // the spaces around the dash depend on the ICU data of the runtime
    expect(formatExclusionDays('2026-03-01', '2026-03-14', 'en-GB')).toMatch(/^1\s?–\s?14 March 2026$/);
    expect(formatExclusionDays('2026-03-01', '2026-03-01', 'en-GB')).toBe('1 March 2026');
    expect(formatExclusionDays('2026-03-01', '2026-03-14', 'de')).toMatch(/^1\.\s?–\s?14\. März 2026$/);
  });

  it('names a person, a pet, an album or the days left out', () => {
    expect(getExclusionName(exclusion({ person: { id: 'p1', name: 'Dana', isPet: false } }))).toBe('Dana');
    expect(getExclusionName(exclusion({ person: { id: 'p2', name: 'Rex', isPet: true } }))).toBe('Rex');
    expect(
      getExclusionName(exclusion({ type: MemoryExclusionType.Album, album: { id: 'a1', albumName: 'Work' } })),
    ).toBe('Work');
    expect(
      getExclusionName(
        exclusion({ type: MemoryExclusionType.DateRange, startDate: '2026-12-31', endDate: '2027-01-01' }),
        'en-GB',
      ),
    ).toMatch(/^31 December 2026\s–\s1 January 2027$/);
  });
});
