import { getOrientationSuggestions, OrientationStatus } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const [suggestions, fixed] = await Promise.all([
    getOrientationSuggestions({ status: OrientationStatus.Suggested }),
    getOrientationSuggestions({ status: OrientationStatus.Fixed }),
  ]);
  const $t = await getFormatter();

  return {
    suggestions,
    fixed,
    meta: {
      title: $t('orientation'),
    },
  };
}) satisfies PageLoad;
