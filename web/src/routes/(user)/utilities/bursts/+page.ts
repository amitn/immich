import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const $t = await getFormatter();

  return {
    albumId: url.searchParams.get('albumId') ?? undefined,
    meta: {
      title: $t('burst_cleanup'),
    },
  };
}) satisfies PageLoad;
