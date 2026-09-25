import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { getBooks } from '$lib/services/book-api';
import type { BookResponseDto } from '$lib/types/assistant';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const $t = await getFormatter();

  const enabled = featureFlagsManager.value.assistant;

  let books: BookResponseDto[] = [];
  let loadError: unknown;
  try {
    books = await getBooks();
  } catch (error) {
    loadError = error;
  }

  return {
    enabled,
    books,
    loadError,
    meta: {
      title: $t('photo_books'),
    },
  };
}) satisfies PageLoad;
