<script lang="ts">
  import ActivityItem from '$lib/components/activity-log/ActivityItem.svelte';
  import type { ActivityLogState } from '$lib/managers/activity-log.svelte';
  import { groupActivity } from '$lib/utils/activity-log';
  import { Button, LoadingSpinner } from '@immich/ui';
  import { mdiUndo } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    activity: ActivityLogState;
    /** show the chat of assistant changes */
    showChat?: boolean;
    emptyText?: string;
  };

  const { activity, showChat = false, emptyText }: Props = $props();

  const groups = $derived(groupActivity(activity.items));
</script>

{#if activity.items.length === 0}
  {#if activity.loading}
    <div class="flex justify-center py-6"><LoadingSpinner /></div>
  {:else}
    <p class="py-6 text-center text-sm text-gray-600 dark:text-gray-400" data-testid="activity-empty">
      {emptyText ?? $t('activity_log_empty')}
    </p>
  {/if}
{:else}
  <div class="flex flex-col gap-4">
    {#each groups as group, index (`${group.groupId}:${index}`)}
      {@const undoable = group.items.filter((item) => item.canUndo)}
      <section class="flex flex-col gap-2" data-testid="activity-group">
        {#if group.items.length > 1}
          <div class="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-400">
            <span>{$t('activity_log_group_changes', { values: { count: group.items.length } })}</span>
            {#if undoable.length > 1}
              <Button
                size="tiny"
                variant="ghost"
                color="secondary"
                leadingIcon={mdiUndo}
                disabled={activity.isBusy(undoable.map(({ id }) => id))}
                onclick={() => activity.undo({ groupId: group.groupId })}
              >
                {$t('activity_log_undo_all', { values: { count: undoable.length } })}
              </Button>
            {/if}
          </div>
        {/if}
        <ul class="flex flex-col gap-2">
          {#each group.items as item (item.id)}
            <ActivityItem
              {item}
              {showChat}
              result={activity.results[item.id]}
              busy={activity.isBusy([item.id])}
              onUndo={(change) => activity.undo({ ids: [change.id] })}
              onRedo={(change) => activity.redo(change.id)}
            />
          {/each}
        </ul>
      </section>
    {/each}
    {#if activity.hasMore}
      <div class="flex justify-center">
        <Button size="small" variant="ghost" loading={activity.loading} onclick={() => activity.loadMore()}>
          {$t('load_more')}
        </Button>
      </div>
    {/if}
  </div>
{/if}
