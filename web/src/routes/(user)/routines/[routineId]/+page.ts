import { getRoutine, getRoutineConfig, getRoutineRuns } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url);
  const $t = await getFormatter();

  const [routine, runs, config] = await Promise.all([
    getRoutine({ id: params.routineId }),
    getRoutineRuns({ id: params.routineId }),
    getRoutineConfig(),
  ]);

  return {
    routine,
    runs,
    config,
    meta: {
      title: routine.name || $t('routines'),
    },
  };
}) satisfies PageLoad;
