import { BookExportFormat, BookExportStatus, BookMapStyle, BookMapStyleOption } from '@immich/sdk';
import {
  BOOK_MAX_PAGES,
  BOOK_MIN_PAGES,
  BOOK_PAGE_SIZE_PRESETS,
  findBookPageSizePreset,
  getBookExportedAt,
  getBookExportStatus,
  getBookFileName,
  getBookPageSizePreset,
  getCombinedExportStatus,
  getCompletedExports,
  getDefaultBookPageCount,
  isBookExporting,
  isBookExportOutdated,
  isExportActive,
  isMapPage,
  isTileMapStyle,
  normalizeBookPageCount,
  toBookMapStyleOption,
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
    expect(isTileMapStyle(BookMapStyleOption.Auto)).toBe(false);
    expect(isTileMapStyle(BookMapStyleOption.Sketch)).toBe(false);
    expect(isTileMapStyle(BookMapStyleOption.Watercolor)).toBe(true);
    expect(isTileMapStyle(BookMapStyleOption.Toner)).toBe(true);
    expect(isTileMapStyle(BookMapStyleOption.Terrain)).toBe(true);
  });

  it('should keep the style of an existing map', () => {
    expect(toBookMapStyleOption(BookMapStyle.Watercolor)).toBe(BookMapStyleOption.Watercolor);
    expect(toBookMapStyleOption(BookMapStyle.Sketch)).toBe(BookMapStyleOption.Sketch);
    expect(toBookMapStyleOption(undefined)).toBe(BookMapStyleOption.Auto);
  });

  it('should detect map pages', () => {
    expect(isMapPage({ layout: 'map', map: null })).toBe(true);
    expect(isMapPage({ layout: 'map-photo', map: null })).toBe(true);
    expect(isMapPage({ layout: 'custom', map: { style: BookMapStyle.Sketch, showRoute: true, labels: true } })).toBe(
      true,
    );
    expect(isMapPage({ layout: 'full', map: null })).toBe(false);
    expect(isMapPage({ layout: 'grid-4' })).toBe(false);
  });
});

describe('export status', () => {
  const { Pending, Running, Completed, Failed } = BookExportStatus;
  const { Pdf, Html } = BookExportFormat;
  const book = (exportStatus: BookExportStatus | null, htmlExportStatus: BookExportStatus | null = null) => ({
    exportStatus,
    htmlExportStatus,
  });

  it('should map the export choice to formats', () => {
    expect(toExportFormats(Pdf)).toEqual([Pdf]);
    expect(toExportFormats(Html)).toEqual([Html]);
    expect(toExportFormats('both')).toEqual([Pdf, Html]);
  });

  it('should read the status of each format', () => {
    expect(getBookExportStatus(book(Completed, Running), Pdf)).toBe(Completed);
    expect(getBookExportStatus(book(Completed, Running), Html)).toBe(Running);
  });

  it('should treat a missing html status as not exported', () => {
    expect(getBookExportStatus(book(Completed), Html)).toBeNull();
  });

  it('should detect active exports', () => {
    expect(isExportActive(Pending)).toBe(true);
    expect(isExportActive(Running)).toBe(true);
    expect(isExportActive(Completed)).toBe(false);
    expect(isExportActive(null)).toBe(false);
    expect(isBookExporting(book(Completed, Pending))).toBe(true);
    expect(isBookExporting(book(Completed, Pending), [Pdf])).toBe(false);
    expect(isBookExporting(book(null))).toBe(false);
  });

  it('should combine statuses', () => {
    expect(getCombinedExportStatus(book(null, null), [Pdf, Html])).toBeNull();
    expect(getCombinedExportStatus(book(Completed, Pending), [Pdf, Html])).toBe(Pending);
    expect(getCombinedExportStatus(book(Pending, Running), [Pdf, Html])).toBe(Running);
    expect(getCombinedExportStatus(book(Failed, Running), [Pdf, Html])).toBe(Running);
    expect(getCombinedExportStatus(book(Failed, Completed), [Pdf, Html])).toBe(Failed);
    expect(getCombinedExportStatus(book(Completed, Completed), [Pdf, Html])).toBe(Completed);
    expect(getCombinedExportStatus(book(Completed, null), [Pdf, Html])).toBeNull();
    expect(getCombinedExportStatus(book(Completed, null), [Pdf])).toBe(Completed);
  });

  it('should read when each format was exported', () => {
    const exported = { exportedAt: '2026-01-01T10:00:00.000Z', htmlExportedAt: null };
    expect(getBookExportedAt(exported, Pdf)).toBe('2026-01-01T10:00:00.000Z');
    expect(getBookExportedAt(exported, Html)).toBeNull();
  });

  it('should only report completed exports as outdated', () => {
    const stale = { exportStale: true, htmlExportStale: false };
    expect(isBookExportOutdated({ ...book(Completed, Completed), ...stale }, Pdf)).toBe(true);
    expect(isBookExportOutdated({ ...book(Completed, Completed), ...stale }, Html)).toBe(false);
    expect(isBookExportOutdated({ ...book(Running, null), ...stale }, Pdf)).toBe(false);
    expect(isBookExportOutdated({ ...book(Completed, null), exportStale: false, htmlExportStale: true }, Html)).toBe(
      false,
    );
  });

  it('should list the completed exports', () => {
    expect(getCompletedExports(book(Completed, Completed))).toEqual([Pdf, Html]);
    expect(getCompletedExports(book(Failed, Completed))).toEqual([Html]);
    expect(getCompletedExports(book(null))).toEqual([]);
  });
});

describe(getBookFileName.name, () => {
  it('should use the title and extension', () => {
    expect(getBookFileName({ title: 'Italy 2025' }, BookExportFormat.Pdf)).toBe('Italy 2025.pdf');
    expect(getBookFileName({ title: 'Italy 2025' }, BookExportFormat.Html)).toBe('Italy 2025.html');
  });

  it('should strip characters that are invalid in file names', () => {
    expect(getBookFileName({ title: 'Rome / Florence: "best of"?' }, BookExportFormat.Pdf)).toBe(
      'Rome Florence best of.pdf',
    );
    expect(getBookFileName({ title: '  ' }, BookExportFormat.Html)).toBe('photo-book.html');
  });
});
