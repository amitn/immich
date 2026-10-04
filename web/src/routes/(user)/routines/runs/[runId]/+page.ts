import { getRoutineRun } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url);
  const $t = await getFormatter();
  const run = await getRoutineRun({ id: params.runId });

  return {
    run,
    meta: {
      title: run.routineName || $t('routine_run'),
    },
  };
}) satisfies PageLoad;
