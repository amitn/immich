import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const $t = await getFormatter();

  return {
    /** the changes of one chat turn, e.g. from the "The assistant made 12 changes" notification */
    groupId: url.searchParams.get('group') ?? undefined,
    sessionId: url.searchParams.get('session') ?? undefined,
    meta: {
      title: $t('activity_log'),
    },
  };
}) satisfies PageLoad;
