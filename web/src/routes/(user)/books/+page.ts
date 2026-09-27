import { getBookDrafts, getBooks, type BookDraftResponseDto, type BookResponseDto } from '@immich/sdk';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url, parent }) => {
  // feature flags are initialized by the root layout
  await parent();
  await authenticate(url);
  const $t = await getFormatter();

  const enabled = featureFlagsManager.value.assistant;

  let books: BookResponseDto[] = [];
  let loadError: unknown;
  // the suggestions are optional: the books show without them
  const drafts = getBookDrafts().catch((): BookDraftResponseDto[] => []);
  try {
    books = await getBooks();
  } catch (error) {
    loadError = error;
  }

  return {
    enabled,
    books,
    drafts: await drafts,
    loadError,
    meta: {
      title: $t('photo_books'),
    },
  };
}) satisfies PageLoad;
