import {
  BOOK_MAX_PAGES,
  BOOK_MIN_PAGES,
  BOOK_PAGE_SIZE_PRESETS,
  findBookPageSizePreset,
  getBookExportStatus,
  getBookFileName,
  getBookPageSizePreset,
  getCombinedExportStatus,
  getCompletedExports,
  getDefaultBookPageCount,
  isBookExporting,
  isExportActive,
  isMapPage,
  isTileMapStyle,
  normalizeBookPageCount,
  toExportFormats,
  type BookPageSizePresetId,
} from '$lib/utils/book-export';

describe('page size presets', () => {
  it('should define the four print sizes in millimetres', () => {
    expect(BOOK_PAGE_SIZE_PRESETS.map(({ id, widthMm, heightMm }) => [id, widthMm, heightMm])).toEqual([
      ['square-21', 210, 210],
      ['a4-portrait', 210, 297],
      ['a4-landscape', 297, 210],
      ['square-30', 300, 300],
    ]);
  });

  it('should have a unique id and label for each preset', () => {
    expect(new Set(BOOK_PAGE_SIZE_PRESETS.map(({ id }) => id)).size).toBe(BOOK_PAGE_SIZE_PRESETS.length);
    expect(new Set(BOOK_PAGE_SIZE_PRESETS.map(({ labelKey }) => labelKey)).size).toBe(BOOK_PAGE_SIZE_PRESETS.length);
  });

  it('should look presets up by id', () => {
    expect(getBookPageSizePreset('a4-landscape')).toMatchObject({ widthMm: 297, heightMm: 210 });
  });

  it('should fall back to the default preset', () => {
    expect(getBookPageSizePreset('letter' as BookPageSizePresetId).id).toBe('square-21');
  });

  it('should find the preset of a book', () => {
    expect(findBookPageSizePreset({ pageWidthMm: 210, pageHeightMm: 297 })?.id).toBe('a4-portrait');
    expect(findBookPageSizePreset({ pageWidthMm: 300.2, pageHeightMm: 299.9 })?.id).toBe('square-30');
    expect(findBookPageSizePreset({ pageWidthMm: 216, pageHeightMm: 279 })).toBeUndefined();
  });
});

describe(getDefaultBookPageCount.name, () => {
  it('should use the minimum for empty albums', () => {
    expect(getDefaultBookPageCount(0)).toBe(BOOK_MIN_PAGES);
    expect(getDefaultBookPageCount(-3)).toBe(BOOK_MIN_PAGES);
    expect(getDefaultBookPageCount(NaN)).toBe(BOOK_MIN_PAGES);
  });

  it('should plan about three photos per page plus a cover', () => {
    expect(getDefaultBookPageCount(1)).toBe(2);
    expect(getDefaultBookPageCount(30)).toBe(12);
    expect(getDefaultBookPageCount(60)).toBe(22);
  });

  it('should always return an even page count', () => {
    for (const count of [1, 2, 5, 7, 12, 33, 99, 250]) {
      expect(getDefaultBookPageCount(count) % 2).toBe(0);
    }
  });

  it('should not exceed the maximum', () => {
    expect(getDefaultBookPageCount(10_000)).toBe(BOOK_MAX_PAGES);
  });
});

describe(normalizeBookPageCount.name, () => {
  it('should leave the page count to the server when empty', () => {
    expect(normalizeBookPageCount(undefined)).toBeUndefined();
    expect(normalizeBookPageCount(null)).toBeUndefined();
    expect(normalizeBookPageCount(0)).toBeUndefined();
    expect(normalizeBookPageCount(NaN)).toBeUndefined();
  });

  it('should round and clamp', () => {
    expect(normalizeBookPageCount(11.6)).toBe(12);
    expect(normalizeBookPageCount(5000)).toBe(BOOK_MAX_PAGES);
  });
});

describe('maps', () => {
  it('should only need a Stadia Maps key for tile styles', () => {
    expect(isTileMapStyle('auto')).toBe(false);
    expect(isTileMapStyle('sketch')).toBe(false);
    expect(isTileMapStyle('watercolor')).toBe(true);
    expect(isTileMapStyle('toner')).toBe(true);
    expect(isTileMapStyle('terrain')).toBe(true);
  });

  it('should detect map pages', () => {
    expect(isMapPage({ layout: 'map', map: null })).toBe(true);
    expect(isMapPage({ layout: 'map-photo', map: null })).toBe(true);
    expect(isMapPage({ layout: 'custom', map: { style: 'sketch', showRoute: true, labels: true } })).toBe(true);
    expect(isMapPage({ layout: 'full', map: null })).toBe(false);
    expect(isMapPage({ layout: 'grid-4' })).toBe(false);
  });
});

describe('export status', () => {
  const book = (exportStatus: string | null, htmlExportStatus?: string | null) =>
    ({ exportStatus, htmlExportStatus }) as Parameters<typeof getBookExportStatus>[0];

  it('should map the export choice to formats', () => {
    expect(toExportFormats('pdf')).toEqual(['pdf']);
    expect(toExportFormats('html')).toEqual(['html']);
    expect(toExportFormats('both')).toEqual(['pdf', 'html']);
  });

  it('should read the status of each format', () => {
    expect(getBookExportStatus(book('completed', 'running'), 'pdf')).toBe('completed');
    expect(getBookExportStatus(book('completed', 'running'), 'html')).toBe('running');
  });

  it('should treat a missing html status as not exported', () => {
    expect(getBookExportStatus(book('completed'), 'html')).toBeNull();
  });

  it('should detect active exports', () => {
    expect(isExportActive('pending')).toBe(true);
    expect(isExportActive('running')).toBe(true);
    expect(isExportActive('completed')).toBe(false);
    expect(isExportActive(null)).toBe(false);
    expect(isBookExporting(book('completed', 'pending'))).toBe(true);
    expect(isBookExporting(book('completed', 'pending'), ['pdf'])).toBe(false);
    expect(isBookExporting(book(null))).toBe(false);
  });

  it('should combine statuses', () => {
    expect(getCombinedExportStatus(book(null, null), ['pdf', 'html'])).toBeNull();
    expect(getCombinedExportStatus(book('completed', 'pending'), ['pdf', 'html'])).toBe('pending');
    expect(getCombinedExportStatus(book('pending', 'running'), ['pdf', 'html'])).toBe('running');
    expect(getCombinedExportStatus(book('failed', 'running'), ['pdf', 'html'])).toBe('running');
    expect(getCombinedExportStatus(book('failed', 'completed'), ['pdf', 'html'])).toBe('failed');
    expect(getCombinedExportStatus(book('completed', 'completed'), ['pdf', 'html'])).toBe('completed');
    expect(getCombinedExportStatus(book('completed', null), ['pdf', 'html'])).toBeNull();
    expect(getCombinedExportStatus(book('completed', null), ['pdf'])).toBe('completed');
  });

  it('should list the completed exports', () => {
    expect(getCompletedExports(book('completed', 'completed'))).toEqual(['pdf', 'html']);
    expect(getCompletedExports(book('failed', 'completed'))).toEqual(['html']);
    expect(getCompletedExports(book(null))).toEqual([]);
  });
});

describe(getBookFileName.name, () => {
  it('should use the title and extension', () => {
    expect(getBookFileName({ title: 'Italy 2025' }, 'pdf')).toBe('Italy 2025.pdf');
    expect(getBookFileName({ title: 'Italy 2025' }, 'html')).toBe('Italy 2025.html');
  });

  it('should strip characters that are invalid in file names', () => {
    expect(getBookFileName({ title: 'Rome / Florence: "best of"?' }, 'pdf')).toBe('Rome Florence best of.pdf');
    expect(getBookFileName({ title: '  ' }, 'html')).toBe('photo-book.html');
  });
});
