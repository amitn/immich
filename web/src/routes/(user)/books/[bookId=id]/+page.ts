import { getBook, getBooks, isHttpError, type BookResponseDto } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { Route } from '$lib/route';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

/** All books, for the book switcher; the viewer works without them */
const loadBooks = async (): Promise<BookResponseDto[]> => {
  try {
    return await getBooks();
  } catch {
    return [];
  }
};

export const load = (async ({ url, params }) => {
  await authenticate(url);
  const $t = await getFormatter();

  const books = loadBooks();
  let book;
  try {
    book = await getBook({ id: params.bookId });
  } catch (error) {
    if (isHttpError(error) && (error.status === 400 || error.status === 404)) {
      redirect(307, Route.books());
    }
    throw error;
  }

  return {
    book,
    books: await books,
    meta: {
      title: book.title || $t('photo_book'),
    },
  };
}) satisfies PageLoad;
