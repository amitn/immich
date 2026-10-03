<script lang="ts">
  import { goto } from '$app/navigation';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import RoutineSummary from '$lib/components/routines/RoutineSummary.svelte';
  import { Route } from '$lib/route';
  import { openRoutineEditor, runRoutineNow } from '$lib/services/routine.service';
  import { handleError } from '$lib/utils/handle-error';
  import { isRunActive, runStatusColors, runStatusKeys } from '$lib/utils/routines';
  import {
    deleteRoutine,
    getRoutine,
    getRoutineRuns,
    RoutineApprovalMode,
    RoutineTriggerType,
    updateRoutine,
    type RoutineResponseDto,
    type RoutineRunResponseDto,
  } from '@immich/sdk';
  import {
    Alert,
    Badge,
    Button,
    Card,
    CardBody,
    Container,
    Heading,
    modalManager,
    Switch,
    Text,
    toastManager,
  } from '@immich/ui';
  import { mdiArrowLeft, mdiFlaskOutline, mdiPencilOutline, mdiPlay, mdiRestart, mdiTrashCanOutline } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  // svelte-ignore state_referenced_locally
  let routine = $state<RoutineResponseDto>(data.routine);
  // svelte-ignore state_referenced_locally
  let runs = $state<RoutineRunResponseDto[]>(data.runs);

  const triggerKeys = {
    [RoutineTriggerType.Manual]: 'routine_run_trigger_manual',
    [RoutineTriggerType.Schedule]: 'routine_run_trigger_schedule',
    [RoutineTriggerType.Event]: 'routine_run_trigger_event',
  } as const;

  const formatDate = (value: string) => DateTime.fromISO(value).toLocaleString(DateTime.DATETIME_MED);

  const refresh = async () => {
    try {
      [routine, runs] = await Promise.all([getRoutine({ id: routine.id }), getRoutineRuns({ id: routine.id })]);
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_routines'));
    }
  };

  // the history follows the runs that are queued or running
  const poll = setInterval(() => {
    if (runs.some(({ status }) => isRunActive(status))) {
      void refresh();
    }
  }, 5000);
  onDestroy(() => clearInterval(poll));

  const edit = async () => {
    const saved = await openRoutineEditor({ routine });
    if (saved) {
      routine = saved;
    }
  };

  const run = async (dryRun: boolean) => {
    if (await runRoutineNow(routine, { dryRun })) {
      await refresh();
    }
  };

  const update = async (dto: { enabled?: boolean; paused?: false }) => {
    try {
      routine = await updateRoutine({ id: routine.id, routineUpdateDto: dto });
    } catch (error) {
      handleError(error, $t('errors.unable_to_save_routine'));
    }
  };

  const remove = async () => {
    const confirmed = await modalManager.showDialog({
      title: $t('routine_delete'),
      prompt: $t('routine_delete_prompt', { values: { name: routine.name } }),
      confirmText: $t('delete'),
      confirmColor: 'danger',
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteRoutine({ id: routine.id });
      toastManager.primary($t('routine_deleted'));
      await goto(Route.routines());
    } catch (error) {
      handleError(error, $t('errors.unable_to_delete_routine'));
    }
  };
</script>

<UserPageLayout title={routine.name}>
  {#snippet buttons()}
    <div class="flex items-center gap-1">
      <Button size="small" variant="ghost" color="secondary" leadingIcon={mdiArrowLeft} href={Route.routines()}>
        {$t('routines')}
      </Button>
      <Button size="small" variant="ghost" color="secondary" leadingIcon={mdiPencilOutline} onclick={edit}>
        {$t('routine_edit')}
      </Button>
      <Button size="small" variant="ghost" color="danger" leadingIcon={mdiTrashCanOutline} onclick={remove}>
        {$t('routine_delete')}
      </Button>
    </div>
  {/snippet}

  <section class="flex place-content-center sm:mx-4">
    <Container center size="large" class="flex flex-col gap-6 pt-4 pb-28">
      {#if !data.config.enabled}
        <Alert color="warning">{$t('routines_disabled')}</Alert>
      {/if}
      {#if routine.pausedAt}
        <Alert color="danger" title={$t('routine_paused', { values: { count: routine.consecutiveFailures } })}>
          <div class="flex flex-col items-start gap-2">
            <p class="text-sm">{$t('routine_paused_description')}</p>
            <Button size="small" leadingIcon={mdiRestart} onclick={() => update({ paused: false })}>
              {$t('routine_resume')}
            </Button>
          </div>
        </Alert>
      {/if}

      <Card>
        <CardBody class="flex flex-col gap-3">
          <RoutineSummary {routine} />
          <div class="flex flex-wrap items-center gap-2">
            <Button
              size="small"
              leadingIcon={mdiPlay}
              disabled={!data.config.enabled || !!routine.pausedAt}
              onclick={() => run(false)}
            >
              {$t('routine_run_now')}
            </Button>
            <Button
              size="small"
              variant="outline"
              color="secondary"
              leadingIcon={mdiFlaskOutline}
              disabled={!data.config.enabled || !!routine.pausedAt}
              onclick={() => run(true)}
            >
              {$t('routine_dry_run')}
            </Button>
            <label class="ms-auto flex items-center gap-2 text-sm">
              <Switch checked={routine.enabled} onCheckedChange={(enabled) => update({ enabled })} />
              {$t('routine_enabled')}
            </label>
          </div>
        </CardBody>
      </Card>

      <section class="flex flex-col gap-3" aria-labelledby="routine-history">
        <Heading size="tiny" tag="h2" id="routine-history">{$t('routine_history')}</Heading>
        {#if runs.length === 0}
          <Text size="small" color="muted">{$t('routine_no_runs')}</Text>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each runs as item (item.id)}
              <li>
                <a
                  href={Route.viewRoutineRun(item)}
                  class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-200 bg-subtle px-3 py-2.5 text-sm hover:bg-primary/5 dark:border-gray-700"
                  data-testid="routine-run"
                >
                  <Badge size="small" color={runStatusColors[item.status]}>{$t(runStatusKeys[item.status])}</Badge>
                  {#if item.approvalMode === RoutineApprovalMode.DryRun}
                    <Badge size="small" color="secondary">{$t('routine_run_dry_run_badge')}</Badge>
                  {/if}
                  <time datetime={item.createdAt}>{formatDate(item.createdAt)}</time>
                  <span class="text-xs text-gray-600 dark:text-gray-400">
                    {$t(triggerKeys[item.trigger as RoutineTriggerType] ?? 'routine_run_trigger_manual')}
                  </span>
                  <span class="text-xs text-gray-600 dark:text-gray-400">
                    {$t('routine_run_changes', { values: { count: item.changes } })}
                  </span>
                  {#if item.pendingApprovals > 0}
                    <span class="text-xs font-medium text-primary">
                      {$t('routine_run_pending', { values: { count: item.pendingApprovals } })}
                    </span>
                  {/if}
                  {#if item.error}
                    <span class="w-full truncate text-xs text-red-700 dark:text-red-300">{item.error}</span>
                  {/if}
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </Container>
  </section>
</UserPageLayout>
