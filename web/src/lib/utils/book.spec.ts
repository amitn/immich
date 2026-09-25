import { firstPageForView, toSpreads, toViews, viewIndexForPage } from '$lib/utils/book';

describe(toSpreads.name, () => {
  it('should handle an empty book', () => {
    expect(toSpreads([])).toEqual([]);
  });

  it('should put the first page on its own', () => {
    expect(toSpreads([1])).toEqual([[1]]);
    expect(toSpreads([1, 2])).toEqual([[1], [2]]);
  });

  it('should pair the following pages', () => {
    expect(toSpreads([1, 2, 3])).toEqual([[1], [2, 3]]);
    expect(toSpreads([1, 2, 3, 4, 5])).toEqual([[1], [2, 3], [4, 5]]);
  });

  it('should leave a trailing single page', () => {
    expect(toSpreads([1, 2, 3, 4])).toEqual([[1], [2, 3], [4]]);
  });
});

describe(toViews.name, () => {
  it('should show one page per view in single mode', () => {
    expect(toViews([1, 2, 3], 'single')).toEqual([[1], [2], [3]]);
  });

  it('should show spreads in spread mode', () => {
    expect(toViews([1, 2, 3], 'spread')).toEqual([[1], [2, 3]]);
  });
});

describe(viewIndexForPage.name, () => {
  it('should map pages to views', () => {
    expect([0, 1, 2, 3, 4, 5].map((page) => viewIndexForPage(page, 'spread'))).toEqual([0, 1, 1, 2, 2, 3]);
    expect([0, 1, 2].map((page) => viewIndexForPage(page, 'single'))).toEqual([0, 1, 2]);
  });

  it('should round trip with firstPageForView', () => {
    for (const mode of ['single', 'spread'] as const) {
      for (let view = 0; view < 6; view++) {
        expect(viewIndexForPage(firstPageForView(view, mode), mode)).toBe(view);
      }
    }
  });

  it('should clamp negative indexes', () => {
    expect(viewIndexForPage(-1, 'spread')).toBe(0);
    expect(firstPageForView(-1, 'single')).toBe(0);
  });
});
