import {
  type BookMap,
  type BookStyle,
  type NormalizedRect,
  bookReviewIssueTypes,
  bookReviewSeverities,
} from 'src/dtos/book.dto.js';
import { MAIN_PEOPLE_DEFAULTS, getMainPeople } from 'src/utils/agent/selection.js';
import {
  AutoLayoutPhoto,
  DEFAULT_MAX_ARTWORK_SHARE,
  MAX_SINGLES_IN_A_ROW,
  getPhotoSimilarity,
  getPlacementDpi,
  isRightPage,
  isSinglePhotoPage,
} from 'src/utils/book/auto-layout.js';
import { getDishName, isMenuPhoto } from 'src/utils/book/food.js';
import { PageSize, getLayout, getSlotRectsMm } from 'src/utils/book/layouts.js';
import { isMapStyleFallback } from 'src/utils/book/map-styles.js';
import { FULL_CROP, MIN_PRINT_DPI } from 'src/utils/book/render.js';

export type BookReviewSeverity = (typeof bookReviewSeverities)[number];

export type BookReviewIssueType = (typeof bookReviewIssueTypes)[number];

export type BookReviewIssue = {
  severity: BookReviewSeverity;
  type: BookReviewIssueType;
  message: string;
  /** one-based page numbers */
  pages: number[];
  /** one-based slot number */
  slot?: number;
  assetIds?: string[];
  dpi?: number;
};

export type BookReviewPhoto = Pick<AutoLayoutPhoto, 'id' | 'width' | 'height' | 'score' | 'takenAt'> &
  Partial<Pick<AutoLayoutPhoto, 'stackId' | 'kind' | 'people' | 'embedding' | 'clusterId' | 'city' | 'food'>> & {
    /** how much the simulated fixes (straighten, auto-enhance) raise the score, see `ImproveService.estimate` */
    gain?: number;
  };

export type BookReviewPage = {
  layout: string;
  sectionTitle?: string | null;
  caption?: string | null;
  map?: BookMap | null;
  assets: Array<{ slot: number; assetId: string; crop: NormalizedRect | null; caption?: string | null }>;
};

export type BookReviewInput = {
  size: PageSize;
  style: BookStyle;
  pages: BookReviewPage[];
  /** the placed photos and the photos of the album */
  photos: BookReviewPhoto[];
  /** photos that could be in the book, e.g. the album */
  candidateIds?: string[];
  coverAssetId?: string | null;
  stadiaApiKey?: string;
  /** default: the people who appear most often in the photos */
  mainPersonIds?: string[];
  maxArtworkShare?: number;
  /** default 12 */
  unusedLimit?: number;
};

export type BookReviewSuggestion = { assetId: string; score: number; people?: string[]; city?: string };

export type BookReviewPlacement = { assetId: string; score: number; page: number; slot: number };

export type BookReview = {
  pageCount: number;
  counts: Record<BookReviewSeverity, number>;
  /** most severe first */
  issues: BookReviewIssue[];
  /** the best photos that are not in the book, photos of the main people first */
  unusedPhotos: BookReviewSuggestion[];
  /** the lowest scoring photos in the book, to compare with `unusedPhotos` */
  weakestPlaced: BookReviewPlacement[];
  people: Array<{ personId: string; name?: string; photos: number; placed: number }>;
};

/** more intentional pairs (an artwork next to its original) than this and the book repeats itself */
const MAX_PAIRS = 3;
/** photos at least this similar (see `getPhotoSimilarity`) on neighbouring pages are reported */
const SIMILAR_THRESHOLD = 0.5;
const WEAKEST_LIMIT = 6;
/** placed photos whose fixes would raise the score this much are reported */
export const REVIEW_MIN_GAIN = 0.04;
/** and the item is medium when one gains this much, or when there are this many */
const REVIEW_STRONG_GAIN = 0.08;
const REVIEW_MANY_IMPROVABLE = 5;

const formatPages = (pages: number[]) =>
  pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.slice(0, -1).join(', ')} and ${pages.at(-1)}`;

const round = (value: number) => Math.round(value * 100) / 100;

const order = (severity: BookReviewSeverity) => bookReviewSeverities.indexOf(severity);

/**
 * A checklist of what to fix in a book, most severe first: stacks shown twice, low print resolution, empty slots,
 * too much or back-to-back artwork, long runs of single photos, similar photos on neighbouring pages, maps whose
 * style falls back, main people with few photos, dishes without their names, restaurants without their menu page,
 * repeated layouts, pages without captions and photos that an improved copy would clearly help; with the best
 * unused photos and the weakest placed ones.
 */
export const reviewBook = (input: BookReviewInput): BookReview => {
  const { size, style, pages } = input;
  const photos = new Map(input.photos.map((photo) => [photo.id, photo]));
  const issues: BookReviewIssue[] = [];
  const add = (issue: BookReviewIssue) => {
    issues.push(issue);
  };

  const placements = pages.map((page) => {
    const assets = [...page.assets];
    if (page.layout === 'cover' && input.coverAssetId && assets.every((asset) => asset.slot !== 0)) {
      assets.push({ slot: 0, assetId: input.coverAssetId, crop: null });
    }
    return assets.toSorted((a, b) => a.slot - b.slot);
  });
  const photosOf = (index: number) =>
    placements[index].map((asset) => photos.get(asset.assetId)).filter((photo): photo is BookReviewPhoto => !!photo);
  const isArtwork = (index: number) => photosOf(index).some((photo) => photo.kind === 'artwork');

  // the same stack (or photo) on more than one page; both on one page is an intentional pair
  const stacks = new Map<string, { pages: Set<number>; assetIds: Set<string> }>();
  let pairs = 0;
  for (const [index, assets] of placements.entries()) {
    const keys = new Map<string, number>();
    for (const asset of assets) {
      const key = photos.get(asset.assetId)?.stackId ?? asset.assetId;
      const entry = stacks.get(key) ?? { pages: new Set(), assetIds: new Set() };
      entry.pages.add(index + 1);
      entry.assetIds.add(asset.assetId);
      stacks.set(key, entry);
      keys.set(key, (keys.get(key) ?? 0) + 1);
    }
    pairs += keys
      .values()
      .filter((count) => count > 1)
      .toArray().length;
  }
  for (const { pages: onPages, assetIds } of stacks.values()) {
    if (onPages.size <= 1) {
      continue;
    }

    const numbers = [...onPages];
    add({
      severity: 'high',
      type: 'duplicate-stack',
      message:
        `${formatPages(numbers)} show the same photo` +
        `${assetIds.size > 1 ? ' or copies of it (a crop, an artwork, an enhanced or improved copy)' : ''}; keep one, or put ` +
        'an artwork next to its original on one page',
      pages: numbers,
      assetIds: [...assetIds],
    });
  }
  if (pairs > MAX_PAIRS) {
    add({
      severity: 'low',
      type: 'too-many-pairs',
      message: `${pairs} pages pair a photo with its own copy or artwork; keep at most ${MAX_PAIRS}`,
      pages: placements.flatMap((_, index) => {
        const keys = placements[index].map((asset) => photos.get(asset.assetId)?.stackId ?? asset.assetId);
        return new Set(keys).size < keys.length ? [index + 1] : [];
      }),
    });
  }

  // print resolution and empty slots
  for (const [index, page] of pages.entries()) {
    const layout = getLayout(page.layout);
    if (!layout) {
      continue;
    }
    const rects = getSlotRectsMm(layout, size, style);
    for (const [slot, rect] of rects.entries()) {
      const placement = placements[index].find((asset) => asset.slot === slot);
      if (!placement) {
        add({
          severity: 'high',
          type: 'empty-slot',
          message: `Page ${index + 1}, slot ${slot + 1} is empty`,
          pages: [index + 1],
          slot: slot + 1,
        });
        continue;
      }
      const photo = photos.get(placement.assetId);
      if (!photo) {
        continue;
      }
      const dpi = getPlacementDpi(photo, placement.crop ?? FULL_CROP, rect);
      if (dpi < MIN_PRINT_DPI) {
        add({
          severity: 'high',
          type: 'low-dpi',
          message:
            `Page ${index + 1}, slot ${slot + 1} prints at ${Math.round(dpi)} dpi (minimum ${MIN_PRINT_DPI}); use a ` +
            'smaller slot, a looser crop or another photo',
          pages: [index + 1],
          slot: slot + 1,
          assetIds: [placement.assetId],
          dpi: Math.round(dpi),
        });
      }
    }
  }

  // artwork
  const artworkPages = pages.flatMap((_, index) => (isArtwork(index) ? [index + 1] : []));
  const maxArtwork = Math.max(1, Math.round(pages.length * (input.maxArtworkShare ?? DEFAULT_MAX_ARTWORK_SHARE)));
  if (artworkPages.length > maxArtwork) {
    add({
      severity: 'medium',
      type: 'too-much-artwork',
      message: `${artworkPages.length} pages show artwork; keep it to about ${maxArtwork} (one page in five)`,
      pages: artworkPages,
    });
  }
  for (const [i, number] of artworkPages.entries()) {
    if (artworkPages[i + 1] === number + 1) {
      add({
        severity: 'medium',
        type: 'artwork-back-to-back',
        message: `${formatPages([number, number + 1])} both show artwork; put photos between them`,
        pages: [number, number + 1],
      });
    }
  }

  // runs of single photos
  let run: number[] = [];
  const flushRun = () => {
    if (run.length > MAX_SINGLES_IN_A_ROW) {
      add({
        severity: 'medium',
        type: 'singles-in-a-row',
        message: `${run.length} single-photo pages in a row (pages ${run[0]}–${run.at(-1)}); combine some photos on one page`,
        pages: run,
      });
    }
    run = [];
  };
  for (const [index, page] of pages.entries()) {
    if (isSinglePhotoPage(page.layout) && placements[index].length > 0) {
      run.push(index + 1);
    } else {
      flushRun();
    }
  }
  flushRun();

  // similar photos on neighbouring pages
  for (let index = 0; index + 1 < pages.length; index++) {
    let best: { similarity: number; a: string; b: string } | undefined;
    for (const a of photosOf(index)) {
      for (const b of photosOf(index + 1)) {
        const similarity = getPhotoSimilarity(a, b);
        if (similarity >= SIMILAR_THRESHOLD && (!best || similarity > best.similarity)) {
          best = { similarity, a: a.id, b: b.id };
        }
      }
    }
    if (!best) {
      continue;
    }
    const facing = isRightPage(index + 2);
    add({
      severity: facing ? 'medium' : 'low',
      type: 'similar-neighbours',
      message:
        `${formatPages([index + 1, index + 2])} ${facing ? 'face each other and ' : ''}show very similar photos; ` +
        'replace one or move it further away',
      pages: [index + 1, index + 2],
      assetIds: [best.a, best.b],
    });
  }

  // maps drawn as sketches for lack of an API key
  const fallbackPages = pages.flatMap((page, index) =>
    page.map &&
    getLayout(page.layout)?.map &&
    !page.map.illustratedAssetId &&
    !page.map.artJobId &&
    isMapStyleFallback(page.map.style, input.stadiaApiKey)
      ? [index + 1]
      : [],
  );
  if (fallbackPages.length > 0) {
    const styles = [...new Set(fallbackPages.map((number) => pages[number - 1].map!.style))].join(' and ');
    add({
      severity: 'medium',
      type: 'map-style-fallback',
      message:
        `${formatPages(fallbackPages)} ask for ${styles} maps, which need a Stadia Maps API key (Administration → ` +
        'Settings → Photo books), so they are drawn as sketches; set the style to sketch or add the key',
      pages: fallbackPages,
    });
  }

  // people, and the best photos that are not in the book
  const placedIds = new Set(placements.flat().map((asset) => asset.assetId));
  const placedStacks = new Set([...placedIds].map((id) => photos.get(id)?.stackId ?? id));
  const placedClusters = new Set(
    [...placedIds].map((id) => photos.get(id)?.clusterId).filter((id): id is number => id !== null && id !== undefined),
  );
  const candidates = [...new Set(input.candidateIds)]
    .map((id) => photos.get(id))
    .filter((photo): photo is BookReviewPhoto => !!photo);
  const mainPersonIds =
    input.mainPersonIds ?? getMainPeople(candidates.map((photo) => ({ personIds: photo.people?.map(({ id }) => id) })));
  const mainPeople = new Set(mainPersonIds);
  const names = new Map<string, string>();
  for (const person of input.photos.flatMap((photo) => photo.people ?? [])) {
    if (person.name) {
      names.set(person.id, person.name);
    }
  }
  const hasMainPerson = (photo: BookReviewPhoto) => photo.people?.some(({ id }) => mainPeople.has(id)) ?? false;

  const unused = candidates
    .filter(
      (photo) =>
        !placedIds.has(photo.id) &&
        !placedStacks.has(photo.stackId ?? photo.id) &&
        photo.kind !== 'artwork' &&
        (photo.clusterId === null || photo.clusterId === undefined || !placedClusters.has(photo.clusterId)),
    )
    .toSorted(
      (a, b) =>
        b.score + (hasMainPerson(b) ? 0.1 : 0) - (a.score + (hasMainPerson(a) ? 0.1 : 0)) ||
        a.takenAt - b.takenAt ||
        a.id.localeCompare(b.id),
    );
  // one photo per stack and near-duplicate cluster
  const seen = new Set<string>();
  const suggestions: BookReviewSuggestion[] = [];
  for (const photo of unused) {
    const keys = [
      `s:${photo.stackId ?? photo.id}`,
      ...(photo.clusterId === null || photo.clusterId === undefined ? [] : [`c:${photo.clusterId}`]),
    ];
    if (keys.some((key) => seen.has(key))) {
      continue;
    }
    for (const key of keys) {
      seen.add(key);
    }
    const people = (photo.people ?? []).map(({ id }) => names.get(id)).filter((name): name is string => !!name);
    suggestions.push({
      assetId: photo.id,
      score: round(photo.score),
      ...(people.length > 0 && { people }),
      ...(photo.city && { city: photo.city }),
    });
  }

  const people = mainPersonIds.map((personId) => {
    const has = (photo: BookReviewPhoto | undefined) => photo?.people?.some(({ id }) => id === personId) ?? false;
    return {
      personId,
      ...(names.has(personId) && { name: names.get(personId) }),
      photos: candidates.filter((photo) => has(photo)).length,
      placed: [...placedIds].filter((id) => has(photos.get(id))).length,
    };
  });
  for (const person of people) {
    const wanted = Math.min(MAIN_PEOPLE_DEFAULTS.perBook, person.photos);
    if (person.placed >= wanted) {
      continue;
    }
    const ids = unused
      .filter((photo) => photo.people?.some(({ id }) => id === person.personId))
      .slice(0, 3)
      .map((photo) => photo.id);
    add({
      severity: 'medium',
      type: 'person-underrepresented',
      message:
        `${person.name ?? 'A main person'} is in ${person.photos} photos but only ${person.placed} in the book; ` +
        'swap in some of the listed photos',
      pages: [],
      assetIds: ids,
    });
  }

  // food books: dishes shown without their names, and restaurants whose menu is left out
  const dishPages = new Map<string, Set<number>>();
  const unnamed: Array<{ page: number; assetId: string; dish: string }> = [];
  for (const [index, page] of pages.entries()) {
    if (page.layout === 'cover') {
      continue;
    }
    for (const asset of placements[index]) {
      const dish = getDishName(photos.get(asset.assetId) ?? {});
      if (!dish) {
        continue;
      }
      const restaurant = photos.get(asset.assetId)!.food!.restaurant;
      dishPages.set(restaurant, (dishPages.get(restaurant) ?? new Set()).add(index + 1));
      if (!asset.caption?.trim()) {
        unnamed.push({ page: index + 1, assetId: asset.assetId, dish });
      }
    }
  }
  if (unnamed.length > 0) {
    const numbers = [...new Set(unnamed.map(({ page }) => page))];
    add({
      severity: 'low',
      type: 'missing-dish-name',
      message:
        `${formatPages(numbers)} show ${unnamed.length === 1 ? 'a dish' : `${unnamed.length} dishes`} without ` +
        `${unnamed.length === 1 ? 'its name' : 'their names'} (e.g. ${unnamed[0].dish}); set the slot captions to the ` +
        'dish names from their tags, or lay the book out again with captions "dish"',
      pages: numbers,
      assetIds: unnamed.map(({ assetId }) => assetId),
    });
  }
  const placedMenus = new Set(
    [...placedIds].flatMap((id) => {
      const photo = photos.get(id);
      return photo && isMenuPhoto(photo) ? [photo.food!.restaurant.toLowerCase()] : [];
    }),
  );
  for (const [restaurant, onPages] of dishPages) {
    if (placedMenus.has(restaurant.toLowerCase())) {
      continue;
    }
    const menus = input.photos
      .filter((photo) => isMenuPhoto(photo) && photo.food!.restaurant.toLowerCase() === restaurant.toLowerCase())
      .toSorted((a, b) => b.score - a.score || a.takenAt - b.takenAt);
    if (menus.length === 0) {
      continue;
    }
    const numbers = [...onPages].toSorted((a, b) => a - b);
    add({
      severity: 'medium',
      type: 'missing-menu-page',
      message:
        `${formatPages(numbers)} show dishes from ${restaurant}, but not its menu, which is in the album; add a ` +
        `page with the menu layout (menu-wide for a landscape photo) before page ${numbers[0]} and place the menu ` +
        'photo in it',
      pages: numbers,
      assetIds: menus.slice(0, 3).map(({ id }) => id),
    });
  }

  // repeated layouts and missing captions
  for (let index = 0; index + 1 < pages.length; index++) {
    const layout = pages[index].layout;
    if (layout === pages[index + 1].layout && placements[index].length > 0 && !getLayout(layout)?.map) {
      add({
        severity: 'low',
        type: 'repeated-layout',
        message: `${formatPages([index + 1, index + 2])} use the same layout (${layout}); vary it`,
        pages: [index + 1, index + 2],
      });
    }
  }
  const uncaptioned = pages.flatMap((page, index) =>
    page.layout !== 'cover' &&
    placements[index].length > 0 &&
    !page.caption?.trim() &&
    page.assets.every((asset) => !asset.caption?.trim())
      ? [index + 1]
      : [],
  );
  if (uncaptioned.length > 0) {
    add({
      severity: 'low',
      type: 'missing-captions',
      message:
        `${formatPages(uncaptioned)} have no caption; after looking at them, add short factual captions ` +
        '(place, time, people, what is visible)',
      pages: uncaptioned,
    });
  }

  // placed photos that an improved copy would clearly help
  const improvable = new Map<string, { gain: number; pages: Set<number> }>();
  for (const [index, assets] of placements.entries()) {
    for (const asset of assets) {
      const photo = photos.get(asset.assetId);
      if (!photo || photo.kind === 'artwork' || photo.kind === 'improved' || (photo.gain ?? 0) < REVIEW_MIN_GAIN) {
        continue;
      }
      const entry = improvable.get(photo.id) ?? { gain: photo.gain!, pages: new Set<number>() };
      entry.pages.add(index + 1);
      improvable.set(photo.id, entry);
    }
  }
  if (improvable.size > 0) {
    const entries = [...improvable].toSorted(([, a], [, b]) => b.gain - a.gain);
    const strong = entries[0][1].gain >= REVIEW_STRONG_GAIN || entries.length >= REVIEW_MANY_IMPROVABLE;
    const pageNumbers = [...new Set(entries.flatMap(([, entry]) => [...entry.pages]))].toSorted((a, b) => a - b);
    add({
      severity: strong ? 'medium' : 'low',
      type: 'could-look-better',
      message:
        `${entries.length} placed photo${entries.length === 1 ? '' : 's'} could look better (straightened or ` +
        `auto-enhanced, up to +${round(entries[0][1].gain)} in score); call apply_improvements to place improved ` +
        'copies, stacked with the originals',
      pages: pageNumbers,
      assetIds: entries.map(([id]) => id),
    });
  }

  const weakestPlaced = placements
    .flatMap((assets, index) =>
      assets.flatMap((asset) => {
        const photo = photos.get(asset.assetId);
        return photo && photo.kind !== 'artwork'
          ? [{ assetId: asset.assetId, score: round(photo.score), page: index + 1, slot: asset.slot + 1 }]
          : [];
      }),
    )
    .toSorted((a, b) => a.score - b.score || a.page - b.page || a.slot - b.slot)
    .slice(0, WEAKEST_LIMIT);

  const sorted = issues.toSorted(
    (a, b) =>
      order(a.severity) - order(b.severity) ||
      (a.pages[0] ?? Infinity) - (b.pages[0] ?? Infinity) ||
      (a.slot ?? 0) - (b.slot ?? 0) ||
      a.type.localeCompare(b.type),
  );

  return {
    pageCount: pages.length,
    counts: {
      high: sorted.filter((issue) => issue.severity === 'high').length,
      medium: sorted.filter((issue) => issue.severity === 'medium').length,
      low: sorted.filter((issue) => issue.severity === 'low').length,
    },
    issues: sorted,
    unusedPhotos: suggestions.slice(0, input.unusedLimit ?? 12),
    weakestPlaced,
    people,
  };
};
