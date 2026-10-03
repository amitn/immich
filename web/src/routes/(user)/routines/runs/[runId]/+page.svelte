<script lang="ts">
  import AssistantAssetStrip from '$lib/components/assistant/AssistantAssetStrip.svelte';
  import AssistantMarkdown from '$lib/components/assistant/AssistantMarkdown.svelte';
  import AssistantMessage from '$lib/components/assistant/AssistantMessage.svelte';
  import AssistantTurnUndo from '$lib/components/assistant/AssistantTurnUndo.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import RoutineChangeList from '$lib/components/routines/RoutineChangeList.svelte';
  import { ActivityLogState } from '$lib/managers/activity-log.svelte';
  import { Route } from '$lib/route';
  import { decideRoutineChanges } from '$lib/services/routine.service';
  import { handleError } from '$lib/utils/handle-error';
  import { isRunActive, routineEventKeys, runStatusColors, runStatusKeys } from '$lib/utils/routines';
  import {
    cancelRoutineRun,
    getRoutineRun,
    RoutineApprovalMode,
    RoutineEvent,
    type RoutineRunDetailResponseDto,
  } from '@immich/sdk';
  import { Alert, Badge, Button, Container, Heading, LoadingSpinner, Text } from '@immich/ui';
  import { mdiArrowLeft, mdiStopCircleOutline } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  // svelte-ignore state_referenced_locally
  let run = $state<RoutineRunDetailResponseDto>(data.run);
  const deciding = new SvelteSet<string>();
  /** the changes of the run (and the approved ones), which are undone together */
  const activity = new ActivityLogState(() => ({ groupId: run.id }));
  const changes = $derived(activity.group(run.id));
  const assetIds = $derived(new Set(run.messages.flatMap(({ content }) => content.assetIds ?? [])));
  const active = $derived(isRunActive(run.status));

  const formatDate = (value: string) => DateTime.fromISO(value).toLocaleString(DateTime.DATETIME_MED);

  const refresh = async () => {
    try {
      run = await getRoutineRun({ id: run.id });
      await activity.load();
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_routine_run'));
    }
  };

  // a run that is queued or running is followed until it ends
  const poll = setInterval(() => {
    if (active) {
      void refresh();
    }
  }, 3000);
  onDestroy(() => clearInterval(poll));

  onMount(() => {
    void activity.load();
  });

  const stop = async () => {
    try {
      await cancelRoutineRun({ id: run.id });
      await refresh();
    } catch (error) {
      handleError(error, $t('errors.unable_to_stop_routine_run'));
    }
  };

  const decide = async (ids: string[], approve: boolean) => {
    for (const id of ids) {
      deciding.add(id);
    }
    try {
      if (await decideRoutineChanges({ ids }, approve)) {
        await refresh();
      }
    } finally {
      for (const id of ids) {
        deciding.delete(id);
      }
    }
  };

  const noPermission = () => Promise.resolve();
</script>

<UserPageLayout title={run.routineName}>
  {#snippet buttons()}
    <div class="flex items-center gap-1">
      <Button
        size="small"
        variant="ghost"
        color="secondary"
        leadingIcon={mdiArrowLeft}
        href={Route.viewRoutine({ id: run.routineId })}
      >
        {$t('routine_history')}
      </Button>
      {#if active}
        <Button size="small" variant="ghost" color="danger" leadingIcon={mdiStopCircleOutline} onclick={stop}>
          {$t('routine_run_stop')}
        </Button>
      {/if}
    </div>
  {/snippet}

  <section class="flex place-content-center sm:mx-4">
    <Container center size="large" class="flex flex-col gap-6 pt-4 pb-28">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <Badge color={runStatusColors[run.status]}>{$t(runStatusKeys[run.status])}</Badge>
        {#if run.approvalMode === RoutineApprovalMode.DryRun}
          <Badge color="secondary">{$t('routine_run_dry_run_badge')}</Badge>
        {/if}
        <time datetime={run.createdAt}>{formatDate(run.createdAt)}</time>
        <span class="text-gray-600 dark:text-gray-400">
          · {$t('routine_run_changes', { values: { count: run.changes } })}
          {#if run.pendingApprovals > 0}
            · {$t('routine_run_pending', { values: { count: run.pendingApprovals } })}
          {/if}
        </span>
        {#if active}
          <LoadingSpinner size="small" />
        {/if}
      </div>

      {#if run.error}
        <Alert color="danger">{run.error}</Alert>
      {/if}

      {#if run.summary}
        <section class="flex flex-col gap-2" aria-labelledby="routine-run-summary">
          <Heading size="tiny" tag="h2" id="routine-run-summary">{$t('routine_run_summary')}</Heading>
          <div class="rounded-xl bg-subtle px-4 py-3 text-sm">
            <AssistantMarkdown text={run.summary} />
          </div>
        </section>
      {/if}

      {#if run.assetIds.length > 0 || run.events.length > 0}
        <section class="flex flex-col gap-2">
          <Heading size="tiny" tag="h2">{$t('routine_run_started_with')}</Heading>
          <ul class="text-sm text-gray-700 dark:text-gray-300">
            {#each run.events as event, index (index)}
              <li>
                {$t(routineEventKeys[event.kind as RoutineEvent] ?? 'routine_trigger_event')}
                {#if typeof event.data?.title === 'string'}
                  · {event.data.title}
                {/if}
              </li>
            {/each}
          </ul>
          <AssistantAssetStrip assetIds={run.assetIds} size="small" limit={16} />
          {#if run.moreAssets > 0}
            <Text size="tiny" color="muted">{$t('routine_run_more_photos', { values: { count: run.moreAssets } })}</Text
            >
          {/if}
        </section>
      {/if}

      {#if run.approvals.length > 0}
        <section class="flex flex-col gap-2" aria-labelledby="routine-run-changes">
          <Heading size="tiny" tag="h2" id="routine-run-changes">{$t('routine_changes')}</Heading>
          <RoutineChangeList changes={run.approvals} busy={deciding} onDecide={decide} />
        </section>
      {/if}

      {#if changes.length > 0}
        <AssistantTurnUndo
          {changes}
          busy={activity.isBusy(changes.map(({ id }) => id))}
          onUndo={() => activity.undo({ groupId: run.id })}
        />
      {/if}

      <section class="flex flex-col gap-4" aria-labelledby="routine-run-transcript">
        <Heading size="tiny" tag="h2" id="routine-run-transcript">{$t('routine_run_transcript')}</Heading>
        <div class="flex flex-col gap-4" role="log">
          {#each run.messages as message (message.id)}
            <AssistantMessage {message} {assetIds} onPermission={noPermission} {activity} />
          {/each}
        </div>
      </section>
    </Container>
  </section>
</UserPageLayout>
