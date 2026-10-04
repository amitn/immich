import {
  decideRoutineApprovals,
  RoutineApprovalStatus,
  getRoutineConfig,
  runRoutine,
  type RoutineApprovalDecisionResponseDto,
  type RoutineResponseDto,
  type RoutineRunResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import RoutineEditModal from '$lib/components/routines/RoutineEditModal.svelte';
import { Route } from '$lib/route';
import { handleError } from '$lib/utils/handle-error';

/**
 * Opens the routine editor (#15): a new routine, optionally started from a chat turn, or a routine to change. Returns
 * the saved routine. A new routine is followed by a toast that offers a dry run first.
 */
export const openRoutineEditor = async (
  options: { routine?: RoutineResponseDto; initial?: { name?: string; instruction?: string } } = {},
): Promise<RoutineResponseDto | undefined> => {
  const translate = get(t);
  let config;
  try {
    config = await getRoutineConfig();
  } catch (error) {
    handleError(error, translate('errors.unable_to_load_routines'));
    return;
  }

  const saved = await modalManager.show(RoutineEditModal, { config, ...options });
  if (!saved) {
    return;
  }

  if (options.routine) {
    toastManager.success(translate('routine_saved'));
  } else {
    toastManager.success(
      {
        title: translate('routine_created'),
        description: translate('routine_created_try_dry_run'),
        button: (close) => ({
          label: translate('routine_dry_run'),
          onclick: () => {
            close();
            void runRoutineNow(saved, { dryRun: true });
          },
        }),
      },
      { timeout: 10_000 },
    );
  }
  return saved;
};

/** "Run now" or a dry run: queues a run and offers to open it */
export const runRoutineNow = async (
  routine: Pick<RoutineResponseDto, 'id'>,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<RoutineRunResponseDto | undefined> => {
  const translate = get(t);
  try {
    const run = await runRoutine({ id: routine.id, routineRunCreateDto: { dryRun } });
    toastManager.primary({
      title: translate('routine_run_queued'),
      button: (close) => ({
        label: translate('routine_run_open'),
        onclick: () => {
          close();
          void goto(Route.viewRoutineRun(run));
        },
      }),
    });
    return run;
  } catch (error) {
    handleError(error, translate('errors.unable_to_run_routine'));
  }
};

/** approves or denies changes of routine runs, and tells how it went */
export const decideRoutineChanges = async (
  request: { ids?: string[]; runId?: string },
  approve: boolean,
): Promise<RoutineApprovalDecisionResponseDto | undefined> => {
  const translate = get(t);
  try {
    const response = await decideRoutineApprovals({ routineApprovalDecisionDto: { ...request, approve } });
    if (response.failed > 0) {
      const failed = response.results.find(({ status }) => status === RoutineApprovalStatus.Failed);
      toastManager.warning({
        title: translate('routine_changes_failed', { values: { count: response.failed } }),
        description: failed?.result ?? undefined,
      });
    } else if (approve) {
      toastManager.success(translate('routine_approved_count', { values: { count: response.applied } }));
    } else {
      toastManager.primary(translate('routine_denied_count', { values: { count: response.denied } }));
    }
    return response;
  } catch (error) {
    handleError(error, translate('errors.unable_to_decide_routine_changes'));
  }
};
