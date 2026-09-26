import {
  getBookLayouts,
  Severity,
  Type,
  type BookDetailResponseDto,
  type BookLayoutRect,
  type BookLayoutResponseDto,
  type BookReviewIssueDto,
  type BookReviewResponseDto,
} from '@immich/sdk';
import type { MessageFormatter, Translations } from 'svelte-i18n';

export const BOOK_REVIEW_SEVERITIES = [Severity.High, Severity.Medium, Severity.Low] as const;

export const BOOK_REVIEW_SEVERITY_LABEL_KEYS: Record<Severity, Translations> = {
  [Severity.High]: 'book_review_severity_high',
  [Severity.Medium]: 'book_review_severity_medium',
  [Severity.Low]: 'book_review_severity_low',
};

// TODO: use `Type.MissingDishName` and `Type.MissingMenuPage` once the SDK is regenerated
export const BOOK_REVIEW_ISSUE_LABEL_KEYS: Record<Type | 'missing-dish-name' | 'missing-menu-page', Translations> = {
  [Type.DuplicateStack]: 'book_review_issue_duplicate_stack',
  [Type.LowDpi]: 'book_review_issue_low_dpi',
  [Type.EmptySlot]: 'book_review_issue_empty_slot',
  [Type.TooMuchArtwork]: 'book_review_issue_too_much_artwork',
  [Type.ArtworkBackToBack]: 'book_review_issue_artwork_back_to_back',
  [Type.SinglesInARow]: 'book_review_issue_singles_in_a_row',
  [Type.SimilarNeighbours]: 'book_review_issue_similar_neighbours',
  [Type.MapStyleFallback]: 'book_review_issue_map_style_fallback',
  [Type.PersonUnderrepresented]: 'book_review_issue_person_underrepresented',
  [Type.TooManyPairs]: 'book_review_issue_too_many_pairs',
  [Type.RepeatedLayout]: 'book_review_issue_repeated_layout',
  [Type.MissingCaptions]: 'book_review_issue_missing_captions',
  [Type.CouldLookBetter]: 'book_review_issue_could_look_better',
  'missing-dish-name': 'book_review_issue_missing_dish_name',
  'missing-menu-page': 'book_review_issue_missing_menu_page',
};

/** At most this many issues are listed in the prompt that fixes them all */
const MAX_PROMPT_ISSUES = 12;

export type BookReviewGroup = { severity: Severity; issues: BookReviewIssueDto[] };

/** Issues by severity, most severe first, without empty groups; the order within a group is kept */
export const groupBookReviewIssues = (issues: BookReviewIssueDto[]): BookReviewGroup[] =>
  BOOK_REVIEW_SEVERITIES.map((severity) => ({
    severity,
    issues: issues.filter((issue) => issue.severity === severity),
  })).filter((group) => group.issues.length > 0);

/** The issues worth a badge: the high and medium ones */
export const getBookReviewBadgeCount = (review?: BookReviewResponseDto) =>
  review ? review.counts.high + review.counts.medium : 0;

/** e.g. "4", "4 and 5" or "3, 7 and 9" */
export const formatBookPageList = (pages: number[], locale?: string) => {
  try {
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format(pages.map(String));
  } catch {
    return pages.join(', ');
  }
};

/** Where the issue is, for a prompt: "page 4, photo 2" or "pages 4 and 5"; empty when it is not on a page */
export const formatBookReviewLocation = ($t: MessageFormatter, issue: BookReviewIssueDto, locale?: string) => {
  if (issue.pages.length === 0) {
    return '';
  }
  if (issue.pages.length === 1 && issue.slot !== undefined) {
    return $t('book_review_location_slot', { values: { page: issue.pages[0], slot: issue.slot } });
  }
  return $t('book_review_location_pages', {
    values: { count: issue.pages.length, pages: formatBookPageList(issue.pages, locale) },
  });
};

type PromptBook = Pick<BookDetailResponseDto, 'id' | 'title'>;

export const getBookReviewFixPrompt = (
  $t: MessageFormatter,
  book: PromptBook,
  issue: BookReviewIssueDto,
  locale?: string,
) => {
  const location = formatBookReviewLocation($t, issue, locale);
  const values = { title: book.title, id: book.id, message: issue.message, location };
  return location ? $t('book_review_fix_prompt', { values }) : $t('book_review_fix_prompt_no_location', { values });
};

export const getBookReviewFixAllPrompt = (
  $t: MessageFormatter,
  book: PromptBook,
  issues: BookReviewIssueDto[],
  locale?: string,
) => {
  const lines = issues.slice(0, MAX_PROMPT_ISSUES).map((issue) => {
    const location = formatBookReviewLocation($t, issue, locale);
    return `- ${issue.message}${location ? ` (${location})` : ''}`;
  });
  if (issues.length > MAX_PROMPT_ISSUES) {
    lines.push(`- ${$t('book_review_fix_all_prompt_more', { values: { count: issues.length - MAX_PROMPT_ISSUES } })}`);
  }
  return $t('book_review_fix_all_prompt', { values: { title: book.title, id: book.id, issues: lines.join('\n') } });
};

export const getBookReviewUnusedPrompt = ($t: MessageFormatter, book: PromptBook, count: number) =>
  $t('book_review_unused_prompt', { values: { title: book.title, id: book.id, count } });

let layouts: Promise<BookLayoutResponseDto[]> | undefined;

/** The layouts are part of the server version, so they are fetched once; a failed request is retried next time */
export const loadBookLayouts = () => {
  layouts ??= getBookLayouts()
    .then((result) => result ?? [])
    .catch((error: unknown) => {
      layouts = undefined;
      throw error;
    });
  return layouts;
};

/** for tests */
export const resetBookLayouts = () => {
  layouts = undefined;
};

const EPSILON = 1e-6;

export type PercentRect = { left: number; top: number; width: number; height: number };

/**
 * Where a slot is on the page, in percent of the page size: the layout rect inside the margins (or the whole page
 * when full bleed), less half a gutter on the edges that border another area, like the server draws it
 */
export const getBookSlotRect = (
  layout: Pick<BookLayoutResponseDto, 'fullBleed' | 'slots'>,
  book: Pick<BookDetailResponseDto, 'pageWidthMm' | 'pageHeightMm' | 'style'>,
  slot: number,
): PercentRect | undefined => {
  const rect: BookLayoutRect | undefined = layout.slots[slot];
  const { pageWidthMm: width, pageHeightMm: height } = book;
  if (!rect || width <= 0 || height <= 0) {
    return;
  }

  const margin = layout.fullBleed ? 0 : book.style.marginMm;
  const box = { x: margin, y: margin, width: width - 2 * margin, height: height - 2 * margin };
  const half = book.style.gutterMm / 2;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  const x1 = box.x + rect.x * box.width + (rect.x > EPSILON ? half : 0);
  const y1 = box.y + rect.y * box.height + (rect.y > EPSILON ? half : 0);
  const x2 = box.x + right * box.width - (right < 1 - EPSILON ? half : 0);
  const y2 = box.y + bottom * box.height - (bottom < 1 - EPSILON ? half : 0);

  return {
    left: (x1 / width) * 100,
    top: (y1 / height) * 100,
    width: (Math.max(0, x2 - x1) / width) * 100,
    height: (Math.max(0, y2 - y1) / height) * 100,
  };
};
