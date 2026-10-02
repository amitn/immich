import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { bookDetailFactory, bookFactory } from '@test-data/factories/book-factory';
import { load } from './+page';

vi.mock('$lib/utils/auth', () => ({ authenticate: vi.fn() }));
vi.mock('$lib/utils/i18n', () => ({ getFormatter: () => Promise.resolve((key: string) => key) }));

const loadBook = (bookId: string) =>
  load({ url: new URL(`http://localhost/books/${bookId}`), params: { bookId } } as Parameters<typeof load>[0]);

describe('book page load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getBooks.mockResolvedValue([]);
  });

  it('should load the book and the list of books', async () => {
    const book = bookDetailFactory.build({ title: 'Italy' });
    const books = [bookFactory.build({ id: book.id }), bookFactory.build()];
    sdkMock.getBook.mockResolvedValue(book);
    sdkMock.getBooks.mockResolvedValue(books);

    await expect(loadBook(book.id)).resolves.toMatchObject({ book, books, meta: { title: 'Italy' } });
    expect(sdkMock.getBook).toHaveBeenCalledWith({ id: book.id });
    expect(sdkMock.getBooks).toHaveBeenCalled();
  });

  it('should still load the book when the list of books fails', async () => {
    const book = bookDetailFactory.build();
    sdkMock.getBook.mockResolvedValue(book);
    sdkMock.getBooks.mockRejectedValue(new Error('offline'));

    await expect(loadBook(book.id)).resolves.toMatchObject({ book, books: [] });
  });

  it('should go back to the book list when the book does not exist', async () => {
    const error = { status: 404 };
    sdkMock.getBook.mockRejectedValue(error);
    sdkMock.isHttpError.mockImplementation((value) => value === error);

    await expect(loadBook('missing')).rejects.toMatchObject({ status: 307, location: '/books' });
  });

  it('should rethrow other errors', async () => {
    const error = { status: 500 };
    sdkMock.getBook.mockRejectedValue(error);
    sdkMock.isHttpError.mockImplementation((value) => value === error);

    await expect(loadBook('book-1')).rejects.toBe(error);
  });
});
