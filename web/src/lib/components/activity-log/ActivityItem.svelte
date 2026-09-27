<script lang="ts">
  import AssistantAssetStrip from '$lib/components/assistant/AssistantAssetStrip.svelte';
  import { Route } from '$lib/route';
  import { getActivityIcon, getActivityTargetRoute, isAssistantChange } from '$lib/utils/activity-log';
  import { ActivityUndoStatus, type ActivityLogResponseDto, type ActivityUndoResultDto } from '@immich/sdk';
  import { Button, Icon } from '@immich/ui';
  import { mdiAlertOutline, mdiArrowRight, mdiRedo, mdiUndo } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    item: ActivityLogResponseDto;
    /** the last undo of the change, e.g. why it was refused */
    result?: ActivityUndoResultDto;
    busy?: boolean;
    /** show the chat of an assistant change (in the lists that are not about one chat) */
    showChat?: boolean;
    onUndo: (item: ActivityLogResponseDto) => unknown;
    onRedo: (item: ActivityLogResponseDto) => unknown;
  };

  const { item, result, busy = false, showChat = false, onUndo, onRedo }: Props = $props();

  const when = $derived(DateTime.fromISO(item.createdAt).toLocaleString(DateTime.DATETIME_MED));
  const undoneWhen = $derived(
    item.undoneAt ? DateTime.fromISO(item.undoneAt).toLocaleString(DateTime.DATETIME_MED) : undefined,
  );
  const source = $derived(
    isAssistantChange(item)
      ? item.toolName
        ? $t('activity_log_by_assistant_tool', { values: { tool: item.toolName } })
        : $t('activity_log_source_assistant')
      : $t('activity_log_source_web'),
  );
  const target = $derived(getActivityTargetRoute(item));
  const refused = $derived(
    result && (result.status === ActivityUndoStatus.Refused || result.status === ActivityUndoStatus.Failed),
  );
  const note = $derived(result?.status === ActivityUndoStatus.AlreadyUndone ? undefined : result?.message);
</script>

<li
  class="flex gap-3 rounded-xl border border-gray-200 px-3 py-2.5 text-sm dark:border-gray-700 {item.undoneAt
    ? 'bg-subtle/50'
    : 'bg-subtle'}"
  data-testid="activity-item"
>
  <Icon
    icon={getActivityIcon(item.action)}
    size="20"
    class="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400"
    aria-hidden
  />
  <div class="flex min-w-0 flex-1 flex-col gap-1.5">
    <p class="font-medium wrap-break-word" class:line-through={!!item.undoneAt} class:opacity-70={!!item.undoneAt}>
      {item.summary}
    </p>
    <p class="text-xs text-gray-600 dark:text-gray-400">
      <time datetime={item.createdAt}>{when}</time>
      · {source}
      {#if showChat && item.sessionId}
        · <a class="underline" href={Route.assistant({ sessionId: item.sessionId })}>{$t('activity_log_open_chat')}</a>
      {/if}
      {#if undoneWhen}
        · <span data-testid="activity-undone">{$t('activity_log_undone_at', { values: { date: undoneWhen } })}</span>
      {/if}
    </p>
    {#if note}
      <p
        class="flex items-start gap-1.5 text-xs {refused ? 'text-danger' : 'text-warning'}"
        role="status"
        data-testid="activity-message"
      >
        <Icon icon={mdiAlertOutline} size="14" class="mt-0.5 shrink-0" aria-hidden />
        <span>{note}</span>
      </p>
    {/if}
    {#each result?.warnings ?? [] as warning (warning)}
      <p class="text-xs text-gray-600 dark:text-gray-400">{warning}</p>
    {/each}
    {#if item.assetIds.length > 0 && !item.undoneAt}
      <AssistantAssetStrip assetIds={item.assetIds} size="small" limit={6} />
    {/if}
    {#if target}
      <a href={target} class="flex w-fit items-center gap-1 text-xs text-primary underline">
        {$t('activity_log_open_target')}
        <Icon icon={mdiArrowRight} size="14" aria-hidden />
      </a>
    {/if}
  </div>
  <div class="flex shrink-0 flex-col items-end gap-1">
    {#if item.canUndo}
      <Button
        size="small"
        variant="outline"
        color="secondary"
        leadingIcon={mdiUndo}
        loading={busy}
        disabled={busy}
        onclick={() => onUndo(item)}
      >
        {$t('activity_log_undo')}
      </Button>
    {:else if item.undoneAt}
      <span class="rounded-full bg-gray-200 px-2 py-0.5 text-xs dark:bg-gray-700">{$t('activity_log_undone')}</span>
      {#if item.canRedo}
        <Button
          size="small"
          variant="ghost"
          color="secondary"
          leadingIcon={mdiRedo}
          loading={busy}
          disabled={busy}
          onclick={() => onRedo(item)}
        >
          {$t('activity_log_redo')}
        </Button>
      {/if}
    {/if}
  </div>
</li>
