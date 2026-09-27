<script lang="ts">
  import { replaceState } from '$app/navigation';
  import ActivityList from '$lib/components/activity-log/ActivityList.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { ActivityLogState, type ActivityLogFilter } from '$lib/managers/activity-log.svelte';
  import { Route } from '$lib/route';
  import { activityActions, getActivityActionKey } from '$lib/utils/activity-log';
  import { ActivityLogAction, ActivityLogSource } from '@immich/sdk';
  import { Button, DatePicker, Field, Select } from '@immich/ui';
  import { mdiClose, mdiUndo } from '@mdi/js';
  import type { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  const ALL = 'all';
  type Status = typeof ALL | 'active' | 'undone';

  let source = $state<ActivityLogSource | typeof ALL>(ALL);
  let action = $state<ActivityLogAction | typeof ALL>(ALL);
  let status = $state<Status>(ALL);
  let from = $state<DateTime>();
  let to = $state<DateTime>();
  // svelte-ignore state_referenced_locally
  let groupId = $state(data.groupId);
  // svelte-ignore state_referenced_locally
  let sessionId = $state(data.sessionId);

  const filter = $derived<ActivityLogFilter>({
    ...(source !== ALL && { source }),
    ...(action !== ALL && { action }),
    ...(status !== ALL && { undone: status === 'undone' }),
    ...(from && { $from: from.startOf('day').toUTC().toISO()! }),
    ...(to && { to: to.endOf('day').toUTC().toISO()! }),
    ...(groupId && { groupId }),
    ...(sessionId && { sessionId }),
  });

  const activity = new ActivityLogState(() => filter);

  const sourceOptions = $derived([
    { value: ALL, label: $t('activity_log_all_sources') },
    { value: ActivityLogSource.Assistant, label: $t('activity_log_source_assistant') },
    { value: ActivityLogSource.Web, label: $t('activity_log_source_web') },
  ]);

  const actionOptions = $derived([
    { value: ALL, label: $t('activity_log_all_actions') },
    ...activityActions.map((value) => ({ value, label: $t(getActivityActionKey(value)) })),
  ]);

  const statusOptions = $derived([
    { value: ALL, label: $t('activity_log_status_all') },
    { value: 'active', label: $t('activity_log_status_active') },
    { value: 'undone', label: $t('activity_log_status_undone') },
  ]);

  const undoableInGroup = $derived(activity.items.filter((item) => item.canUndo).length);

  const clearScope = () => {
    groupId = undefined;
    sessionId = undefined;
    try {
      replaceState(Route.activityLog(), {});
    } catch {
      // router not ready yet
    }
  };

  // (re)load whenever the filters change
  $effect(() => {
    void filter;
    void activity.load();
  });
</script>

<UserPageLayout title={data.meta.title}>
  <div class="mx-auto flex max-w-3xl flex-col gap-4 px-2 pb-8">
    <p class="text-sm text-gray-600 dark:text-gray-400">{$t('activity_log_description')}</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="activity-filters">
      <Field label={$t('activity_log_filter_source')}>
        <Select bind:value={source} options={sourceOptions} />
      </Field>
      <Field label={$t('activity_log_filter_action')}>
        <Select bind:value={action} options={actionOptions} />
      </Field>
      <Field label={$t('activity_log_filter_status')}>
        <Select bind:value={status} options={statusOptions} />
      </Field>
      <Field label={$t('activity_log_filter_from')}>
        <DatePicker bind:value={from} />
      </Field>
      <Field label={$t('activity_log_filter_to')}>
        <DatePicker bind:value={to} />
      </Field>
    </div>

    {#if groupId || sessionId}
      <div
        class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm"
        data-testid="activity-scope"
      >
        <span>{groupId ? $t('activity_log_one_turn') : $t('activity_log_one_chat')}</span>
        <div class="flex items-center gap-2">
          {#if groupId && undoableInGroup > 0}
            <Button
              size="small"
              variant="outline"
              color="secondary"
              leadingIcon={mdiUndo}
              disabled={activity.isBusy(activity.items.map(({ id }) => id))}
              onclick={() => activity.undo({ groupId })}
            >
              {$t('activity_log_undo_all', { values: { count: undoableInGroup } })}
            </Button>
          {/if}
          {#if sessionId}
            <Button size="small" variant="ghost" href={Route.assistant({ sessionId })}>
              {$t('activity_log_open_chat')}
            </Button>
          {/if}
          <Button size="small" variant="ghost" color="secondary" leadingIcon={mdiClose} onclick={clearScope}>
            {$t('activity_log_show_all')}
          </Button>
        </div>
      </div>
    {/if}

    <ActivityList {activity} showChat={!sessionId} />
  </div>
</UserPageLayout>
