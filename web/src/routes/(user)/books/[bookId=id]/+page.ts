import { redirect } from '@sveltejs/kit';
import { Route } from '$lib/route';
import { ApiAdapterError } from '$lib/services/api-adapter';
import { getBook } from '$lib/services/book-api';
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
    // TODO: use isHttpError from @immich/sdk once the book endpoints are in the SDK
    if (error instanceof ApiAdapterError && (error.status === 400 || error.status === 404)) {
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
