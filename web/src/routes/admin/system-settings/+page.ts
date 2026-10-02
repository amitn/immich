import { getConfig, getConfigDefaults } from '@immich/sdk';
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

  await authenticate(url, { admin: true });
  const config = await getConfig();
  const defaultConfig = await getConfigDefaults();
  const $t = await getFormatter();

  return {
    config,
    defaultConfig,
    meta: {
      title: $t('admin.system_settings'),
    },
  };
}) satisfies PageLoad;
