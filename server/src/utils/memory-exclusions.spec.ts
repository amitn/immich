import {
  NO_MEMORY_EXCLUSIONS,
  getDateRangeBounds,
  getDocumentTagPatterns,
  getMemoryContextPersonIds,
  hasMemoryExclusions,
  isDocumentTag,
  isInDateRanges,
  isMemoryAboutExcludedPerson,
  mergeMemoryExclusions,
  withoutExcludedPeople,
} from 'src/utils/memory-exclusions.js';

const exclusions = (overrides: Partial<typeof NO_MEMORY_EXCLUSIONS> = {}) => ({
  ...NO_MEMORY_EXCLUSIONS,
  ...overrides,
});

describe('memory exclusions', () => {
  describe('hasMemoryExclusions', () => {
    it('is false when nothing is left out', () => {
      expect(hasMemoryExclusions(undefined)).toBe(false);
      expect(hasMemoryExclusions(NO_MEMORY_EXCLUSIONS)).toBe(false);
    });

    it.each([
      ['a person', { personIds: ['p1'] }],
      ['a date range', { dateRanges: [{ from: '2026-01-01', to: '2026-01-02' }] }],
      ['an album', { albumIds: ['a1'] }],
      ['the documents', { documents: true }],
    ])('is true with %s', (_, overrides) => {
      expect(hasMemoryExclusions(exclusions(overrides))).toBe(true);
    });
  });

  it('merges the exclusions of one request with the stored ones', () => {
    const stored = exclusions({ personIds: ['p1'], albumIds: ['a1'] });
    expect(
      mergeMemoryExclusions(stored, {
        personIds: ['p1', 'p2'],
        dateRanges: [{ from: '2026-03-01', to: '2026-03-31' }],
        documents: true,
      }),
    ).toEqual({
      personIds: ['p1', 'p2'],
      albumIds: ['a1'],
      dateRanges: [{ from: '2026-03-01', to: '2026-03-31' }],
      documents: true,
    });
    expect(mergeMemoryExclusions(stored)).toEqual(stored);
  });

  describe('date ranges', () => {
    it('covers whole local days, the last one included', () => {
      expect(getDateRangeBounds({ from: '2026-03-01', to: '2026-03-14' })).toEqual({
        start: new Date('2026-03-01T00:00:00.000Z'),
        end: new Date('2026-03-15T00:00:00.000Z'),
      });
    });

    it('rejects a malformed day', () => {
      expect(() => getDateRangeBounds({ from: '2026-3-1', to: '2026-03-14' })).toThrow();
    });

    it('tells whether a local time is in a range', () => {
      const ranges = [{ from: '2026-03-01', to: '2026-03-14' }];
      expect(isInDateRanges(new Date('2026-03-01T00:00:00.000Z'), ranges)).toBe(true);
      expect(isInDateRanges(new Date('2026-03-14T23:59:59.999Z'), ranges)).toBe(true);
      expect(isInDateRanges(new Date('2026-03-15T00:00:00.000Z'), ranges)).toBe(false);
      expect(isInDateRanges(new Date('2026-02-28T23:59:59.999Z'), ranges)).toBe(false);
    });
  });

  describe('documents', () => {
    it.each(['Auto/Screenshots', 'Auto/screenshot', 'Auto/Receipts', 'Auto/Documents', 'Auto/Scanned documents'])(
      'treats the classification tag %s as a document',
      (value) => {
        expect(isDocumentTag(value)).toBe(true);
      },
    );

    it.each(['Food/Da Enzo/Menu', 'Travel/Crete/Tickets', 'Art/Louvre/Label', 'Wine/Noma/Wine list'])(
      'treats the journal source photo %s as a document',
      (value) => {
        expect(isDocumentTag(value)).toBe(true);
      },
    );

    it.each(['Auto/Sunsets', 'Food/Da Enzo/Cacio e pepe', 'Menu', 'Travel/Crete', 'Holidays/Receipts/Menu/x'])(
      'keeps %s',
      (value) => {
        expect(isDocumentTag(value)).toBe(false);
      },
    );

    it('has a LIKE pattern for the classification and every journal source', () => {
      const { classification, journals } = getDocumentTagPatterns();
      expect(classification).toEqual(['Auto/%screenshot%', 'Auto/%receipt%', 'Auto/%document%']);
      expect(journals).toEqual(expect.arrayContaining(['Food/%/Menu', 'Travel/%/Tickets', 'Art/%/Label']));
    });
  });

  describe('people in the context of a memory', () => {
    it('reads the people a rule is about', () => {
      expect(getMemoryContextPersonIds({ personId: 'p1' })).toEqual(['p1']);
      expect(getMemoryContextPersonIds({ personAId: 'p1', personBId: 'p2' })).toEqual(['p1', 'p2']);
      expect(getMemoryContextPersonIds({ year: 2026 })).toEqual([]);
      expect(getMemoryContextPersonIds(undefined)).toEqual([]);
    });

    it('tells whether a memory is about an excluded person', () => {
      const excluded = exclusions({ personIds: ['p2'] });
      expect(isMemoryAboutExcludedPerson({ personId: 'p2' }, excluded)).toBe(true);
      expect(isMemoryAboutExcludedPerson({ personAId: 'p1', personBId: 'p2' }, excluded)).toBe(true);
      expect(isMemoryAboutExcludedPerson({ personId: 'p1' }, excluded)).toBe(false);
      expect(isMemoryAboutExcludedPerson({ personId: 'p2' }, NO_MEMORY_EXCLUSIONS)).toBe(false);
    });

    it('leaves the excluded people out of the lists of a recap', () => {
      const context = {
        year: 2026,
        topPeople: [
          { id: 'p1', name: 'Ana' },
          { id: 'p2', name: 'Ben' },
        ],
        topPets: [{ id: 'pet', name: 'Rex' }],
      };
      expect(withoutExcludedPeople(context, exclusions({ personIds: ['p2', 'pet'] }))).toEqual({
        year: 2026,
        topPeople: [{ id: 'p1', name: 'Ana' }],
        topPets: [],
      });
      expect(withoutExcludedPeople(context, exclusions({ personIds: ['nobody'] }))).toBe(context);
      expect(withoutExcludedPeople(undefined, exclusions({ personIds: ['p2'] }))).toBeUndefined();
    });
  });
});
