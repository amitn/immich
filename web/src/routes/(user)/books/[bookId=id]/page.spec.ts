import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { bookDetailFactory } from '@test-data/factories/book-factory';
import { load } from './+page';

vi.mock('$lib/utils/auth', () => ({ authenticate: vi.fn() }));
vi.mock('$lib/utils/i18n', () => ({ getFormatter: () => Promise.resolve((key: string) => key) }));

const loadBook = (bookId: string) =>
  load({ url: new URL(`http://localhost/books/${bookId}`), params: { bookId } } as Parameters<typeof load>[0]);

describe('book page load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should load the book', async () => {
    const book = bookDetailFactory.build({ title: 'Italy' });
    sdkMock.getBook.mockResolvedValue(book);

    await expect(loadBook(book.id)).resolves.toMatchObject({ book, meta: { title: 'Italy' } });
    expect(sdkMock.getBook).toHaveBeenCalledWith({ id: book.id });
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
