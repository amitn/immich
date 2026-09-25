import { getBookReview, type BookReviewResponseDto } from '@immich/sdk';
import { handleError } from '$lib/utils/handle-error';

/** The review of the open book; a newer request wins over one that is still running */
export class BookReviewState {
  review = $state<BookReviewResponseDto>();
  loading = $state(false);
  failed = $state(false);

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
      this.#bookId = bookId;
    }

    const request = ++this.#request;
    this.loading = true;
    try {
      const review = await getBookReview({ id: bookId });
      if (request === this.#request) {
        this.review = review;
        this.failed = false;
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
  }
}
