import type { BookReviewResponseDto } from '@immich/sdk';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { buildBookReview } from '@test-data/factories/book-review-factory';
import { BookReviewState } from './book-review-state.svelte';

describe('BookReviewState', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should load the review of the book', async () => {
    const review = buildBookReview();
    sdkMock.getBookReview.mockResolvedValue(review);
    const state = new BookReviewState(() => 'error');

    await state.load('book-1');

    expect(sdkMock.getBookReview).toHaveBeenCalledWith({ id: 'book-1' });
    expect(state.review).toEqual(review);
    expect(state.loading).toBe(false);
    expect(state.checkedAt).toEqual(expect.any(Number));
  });

  it('should keep loading long enough to be seen', async () => {
    sdkMock.getBookReview.mockResolvedValue(buildBookReview());
    const state = new BookReviewState(() => 'error');
    const started = Date.now();

    const loading = state.load('book-1');
    expect(state.loading).toBe(true);
    await loading;

    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    expect(state.loading).toBe(false);
  });

  it('should keep the newest review when requests overlap', async () => {
    const older = buildBookReview({ pageCount: 1 });
    const newer = buildBookReview({ pageCount: 2 });
    let resolveOlder: (review: BookReviewResponseDto) => void = () => {};
    sdkMock.getBookReview
      .mockReturnValueOnce(new Promise((resolve) => (resolveOlder = resolve)))
      .mockResolvedValueOnce(newer);
    const state = new BookReviewState(() => 'error');

    const first = state.load('book-1');
    await state.reload();
    resolveOlder(older);
    await first;

    expect(state.review?.pageCount).toBe(2);
  });

  it('should forget the review of the previous book', async () => {
    sdkMock.getBookReview.mockResolvedValueOnce(buildBookReview());
    const state = new BookReviewState(() => 'error');
    await state.load('book-1');

    sdkMock.getBookReview.mockRejectedValueOnce(new Error('offline'));
    await state.load('book-2');

    expect(state.review).toBeUndefined();
    expect(state.failed).toBe(true);
  });
});
