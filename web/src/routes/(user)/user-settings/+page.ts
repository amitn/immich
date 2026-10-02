import { getApiKeys, getSessions } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { getRenamedSettingsRedirect } from '$lib/journals/settings-redirect';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  // the sections renamed with the journals (#24), e.g. ?isOpen=collections
  const renamed = getRenamedSettingsRedirect(url);
  if (renamed) {
    redirect(307, renamed);
  }

  await authenticate(url);

  const keys = await getApiKeys();
  const sessions = await getSessions();
  const $t = await getFormatter();

  return {
    keys,
    sessions,
    meta: {
      title: $t('settings'),
    },
  };
}) satisfies PageLoad;
