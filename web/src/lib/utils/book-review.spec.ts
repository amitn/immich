import { Severity, Type } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';
import {
  formatBookPageList,
  formatBookReviewLocation,
  getBookReviewBadgeCount,
  getBookReviewFixAllPrompt,
  getBookReviewFixPrompt,
  getBookSlotRect,
  groupBookReviewIssues,
} from '$lib/utils/book-review';
import { bookReviewIssueFactory, buildBookReview } from '@test-data/factories/book-review-factory';

/** Shows the key and the values, to check what goes into a message */
const $t = ((key: string, options?: { values?: Record<string, unknown> }) =>
  options?.values ? `${key} ${JSON.stringify(options.values)}` : key) as unknown as MessageFormatter;

const book = { id: 'book-1', title: 'Italy' };

describe('groupBookReviewIssues', () => {
  it('should group the issues by severity, most severe first', () => {
    const low = bookReviewIssueFactory.build({ severity: Severity.Low, message: 'low' });
    const high1 = bookReviewIssueFactory.build({ severity: Severity.High, message: 'high 1' });
    const high2 = bookReviewIssueFactory.build({ severity: Severity.High, message: 'high 2' });

    expect(groupBookReviewIssues([low, high1, high2])).toEqual([
      { severity: Severity.High, issues: [high1, high2] },
      { severity: Severity.Low, issues: [low] },
    ]);
  });

  it('should return no groups without issues', () => {
    expect(groupBookReviewIssues([])).toEqual([]);
  });
});

describe('getBookReviewBadgeCount', () => {
  it('should count the high and medium issues', () => {
    const review = buildBookReview({ counts: { high: 2, medium: 3, low: 7 } });

    expect(getBookReviewBadgeCount(review)).toBe(5);
    expect(getBookReviewBadgeCount()).toBe(0);
  });
});

describe('formatBookPageList', () => {
  it('should list the pages', () => {
    expect(formatBookPageList([4], 'en')).toBe('4');
    expect(formatBookPageList([4, 5], 'en')).toBe('4 and 5');
    expect(formatBookPageList([3, 7, 9], 'en')).toBe('3, 7, and 9');
  });
});

describe('formatBookReviewLocation', () => {
  it('should name the page and the photo', () => {
    const issue = bookReviewIssueFactory.build({ pages: [4], slot: 2 });

    expect(formatBookReviewLocation($t, issue, 'en')).toBe('book_review_location_slot {"page":4,"slot":2}');
  });

  it('should name the pages', () => {
    const issue = bookReviewIssueFactory.build({ pages: [4, 5], slot: undefined });

    expect(formatBookReviewLocation($t, issue, 'en')).toBe('book_review_location_pages {"count":2,"pages":"4 and 5"}');
  });

  it('should be empty for an issue that is not on a page', () => {
    const issue = bookReviewIssueFactory.build({ pages: [], type: Type.PersonUnderrepresented });

    expect(formatBookReviewLocation($t, issue, 'en')).toBe('');
  });
});

describe('getBookReviewFixPrompt', () => {
  it('should reference the book, the issue and its pages', () => {
    const issue = bookReviewIssueFactory.build({ message: 'Pages 4 and 5 use the same layout', pages: [4, 5] });

    const prompt = getBookReviewFixPrompt($t, book, issue, 'en');

    expect(prompt).toMatch(/^book_review_fix_prompt /);
    expect(JSON.parse(prompt.slice('book_review_fix_prompt '.length))).toEqual({
      title: 'Italy',
      id: 'book-1',
      message: 'Pages 4 and 5 use the same layout',
      location: 'book_review_location_pages {"count":2,"pages":"4 and 5"}',
    });
  });

  it('should leave out the location of an issue that is not on a page', () => {
    const issue = bookReviewIssueFactory.build({ message: 'Anna is in 1 photo', pages: [] });

    expect(getBookReviewFixPrompt($t, book, issue, 'en')).toMatch(/^book_review_fix_prompt_no_location /);
  });
});

describe('getBookReviewFixAllPrompt', () => {
  it('should list every issue', () => {
    const issues = [
      bookReviewIssueFactory.build({ message: 'first', pages: [2], slot: 1 }),
      bookReviewIssueFactory.build({ message: 'second', pages: [] }),
    ];

    const prompt = getBookReviewFixAllPrompt($t, book, issues, 'en');
    const values = JSON.parse(prompt.slice('book_review_fix_all_prompt '.length));

    expect(values).toMatchObject({ title: 'Italy', id: 'book-1' });
    expect(values.issues).toBe('- first (book_review_location_slot {"page":2,"slot":1})\n- second');
  });

  it('should keep the prompt short when there are many issues', () => {
    const issues = bookReviewIssueFactory.buildList(15, { pages: [] });

    const prompt = getBookReviewFixAllPrompt($t, book, issues, 'en');
    const lines = JSON.parse(prompt.slice('book_review_fix_all_prompt '.length)).issues.split('\n');

    expect(lines).toHaveLength(13);
    expect(lines.at(-1)).toBe('- book_review_fix_all_prompt_more {"count":3}');
  });
});

describe('getBookSlotRect', () => {
  const style = { marginMm: 10, gutterMm: 4, background: '#fff', textColor: '#000', fontFamily: 'serif' };
  const page = { pageWidthMm: 200, pageHeightMm: 100, style };

  it('should place a slot inside the margins, with half a gutter towards its neighbours', () => {
    const layout = {
      fullBleed: false,
      slots: [
        { x: 0, y: 0, width: 0.5, height: 1 },
        { x: 0.5, y: 0, width: 0.5, height: 1 },
      ],
    };

    // the box is 180 × 80 mm from (10, 10); the left slot ends 2 mm before the middle
    expect(getBookSlotRect(layout, page, 0)).toEqual({ left: 5, top: 10, width: 44, height: 80 });
    expect(getBookSlotRect(layout, page, 1)).toEqual({ left: 51, top: 10, width: 44, height: 80 });
  });

  it('should ignore the margins of a full-bleed layout', () => {
    const layout = { fullBleed: true, slots: [{ x: 0, y: 0, width: 1, height: 1 }] };

    expect(getBookSlotRect(layout, page, 0)).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('should not place a slot the layout does not have', () => {
    expect(getBookSlotRect({ fullBleed: false, slots: [] }, page, 0)).toBeUndefined();
  });
});
