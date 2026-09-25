import { getBook, isHttpError } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { Route } from '$lib/route';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url);
  const $t = await getFormatter();

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
    meta: {
      title: book.title || $t('photo_book'),
    },
  };
}) satisfies PageLoad;
