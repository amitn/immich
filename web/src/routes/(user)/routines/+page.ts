import {
  getRoutineConfig,
  getRoutineInbox,
  getRoutines,
  type RoutineApprovalResponseDto,
  type RoutineConfigResponseDto,
  type RoutineResponseDto,
} from '@immich/sdk';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url, parent }) => {
  // feature flags are initialized by the root layout
  await parent();
  await authenticate(url);
  const $t = await getFormatter();

  const assistant = featureFlagsManager.value.assistant;
  let config: RoutineConfigResponseDto | undefined;
  let routines: RoutineResponseDto[] = [];
  let inbox: RoutineApprovalResponseDto[] = [];
  let loadError: unknown;
  if (assistant) {
    try {
      [config, routines, inbox] = await Promise.all([getRoutineConfig(), getRoutines(), getRoutineInbox()]);
    } catch (error) {
      loadError = error;
    }
  }

  return {
    config,
    routines,
    inbox,
    loadError,
    showInbox: url.searchParams.get('tab') === 'inbox',
    meta: {
      title: $t('routines'),
    },
  };
}) satisfies PageLoad;
