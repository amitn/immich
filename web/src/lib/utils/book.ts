export type BookViewMode = 'single' | 'spread';

/**
 * Group pages the way they are printed: the first page (the cover or first right-hand page) on
 * its own, then facing pages side by side, and a trailing single page if the count is even.
 */
export const toSpreads = <T>(pages: T[]): T[][] => {
  if (pages.length === 0) {
    return [];
  }

  const spreads: T[][] = [[pages[0]]];
  for (let i = 1; i < pages.length; i += 2) {
    spreads.push(pages.slice(i, i + 2));
  }
  return spreads;
};

export const toViews = <T>(pages: T[], mode: BookViewMode): T[][] =>
  mode === 'spread' ? toSpreads(pages) : pages.map((page) => [page]);

/** Index of the view that contains the page at `pageIndex` */
export const viewIndexForPage = (pageIndex: number, mode: BookViewMode) => {
  if (mode === 'single' || pageIndex <= 0) {
    return Math.max(0, pageIndex);
  }
  return Math.floor((pageIndex - 1) / 2) + 1;
};

/** Index of the first page shown in the view at `viewIndex` */
export const firstPageForView = (viewIndex: number, mode: BookViewMode) => {
  if (mode === 'single' || viewIndex <= 0) {
    return Math.max(0, viewIndex);
  }
  return (viewIndex - 1) * 2 + 1;
};
