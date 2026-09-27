import { getBookReview, type BookReviewResponseDto } from '@immich/sdk';
import { handleError } from '$lib/utils/handle-error';

/** a review can come back in a few milliseconds; shorter than this, nobody would see it run */
const MIN_LOADING_MS = 400;

/** The review of the open book; a newer request wins over one that is still running */
export class BookReviewState {
  review = $state<BookReviewResponseDto>();
  loading = $state(false);
  failed = $state(false);
  /** when the review last finished, so a check that changed nothing still shows it ran */
  checkedAt = $state<number>();

  #bookId?: string;
  #request = 0;
  #errorMessage: () => string;

  /** errorMessage: logged when the review cannot be loaded */
  constructor(errorMessage: () => string) {
    this.#errorMessage = errorMessage;
  }

  async load(bookId: string) {
    if (bookId !== this.#bookId) {
      // don't show the review of the previous book
      this.review = undefined;
      this.checkedAt = undefined;
      this.#bookId = bookId;
    }

    const request = ++this.#request;
    this.loading = true;
    const shown = new Promise((resolve) => setTimeout(resolve, MIN_LOADING_MS));
    try {
      const [review] = await Promise.all([getBookReview({ id: bookId }), shown]);
      if (request === this.#request) {
        this.review = review;
        this.failed = false;
        this.checkedAt = Date.now();
      }
    } catch (error) {
      if (request === this.#request) {
        this.failed = true;
        handleError(error, this.#errorMessage(), { notify: false });
      }
    } finally {
      if (request === this.#request) {
        this.loading = false;
      }
    }
  }

  reload() {
    return this.#bookId ? this.load(this.#bookId) : Promise.resolve();
  }

  clear() {
    this.#request++;
    this.#bookId = undefined;
    this.review = undefined;
    this.loading = false;
    this.failed = false;
    this.checkedAt = undefined;
  }
}
