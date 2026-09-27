<script lang="ts">
  import AssistantAssetStrip from '$lib/components/assistant/AssistantAssetStrip.svelte';
  import AssistantLinks from '$lib/components/assistant/AssistantLinks.svelte';
  import { AgentToolCallStatus } from '$lib/managers/agent-conversation.svelte';
  import type { ActivityLogResponseDto, AgentMessageContentDto } from '@immich/sdk';
  import { Button, Icon, LoadingSpinner } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiAlertOutline,
    mdiCheckCircleOutline,
    mdiClockOutline,
    mdiRedo,
    mdiUndo,
    mdiWrenchOutline,
  } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    content: AgentMessageContentDto;
    /** the changes the call made, from the activity log */
    changes?: ActivityLogResponseDto[];
    /** why undoing the changes was refused, or not complete */
    undoMessage?: string;
    busy?: boolean;
    onUndo?: (ids: string[]) => unknown;
    onRedo?: (id: string) => unknown;
  };

  const { content, changes = [], undoMessage, busy = false, onUndo, onRedo }: Props = $props();

  const undoable = $derived(changes.filter((change) => change.canUndo));
  const undone = $derived(changes.length > 0 && changes.every((change) => change.undoneAt));
  const redoable = $derived(changes.length === 1 && changes[0].canRedo ? changes[0] : undefined);

  const status = $derived(content.status ?? AgentToolCallStatus.Pending);
  const toolName = $derived(content.toolName?.replace(/^mcp__immich__/, ''));
  const title = $derived(content.title || toolName || $t('assistant_tool_call'));

  const statusLabels: Record<string, string> = $derived({
    [AgentToolCallStatus.Pending]: $t('assistant_tool_status_pending'),
    [AgentToolCallStatus.InProgress]: $t('assistant_tool_status_in_progress'),
    [AgentToolCallStatus.Completed]: $t('assistant_tool_status_completed'),
    [AgentToolCallStatus.Failed]: $t('assistant_tool_status_failed'),
  });
  const statusLabel = $derived(statusLabels[status] ?? status);

  const input = $derived.by(() => {
    if (content.input === undefined || content.input === null) {
      return;
    }
    if (typeof content.input === 'string') {
      return content.input;
    }
    try {
      return JSON.stringify(content.input, null, 2);
    } catch {
      return String(content.input);
    }
  });
</script>

<div
  class="flex flex-col gap-2 rounded-xl border px-3 py-2 text-sm {status === AgentToolCallStatus.Failed
    ? 'border-danger/40'
    : 'border-gray-200 dark:border-gray-700'} bg-subtle"
>
  <div class="flex min-w-0 items-center gap-2">
    <span class="flex size-5 shrink-0 items-center justify-center" title={statusLabel}>
      {#if status === AgentToolCallStatus.InProgress}
        <LoadingSpinner size="small" />
      {:else if status === AgentToolCallStatus.Completed}
        <Icon icon={mdiCheckCircleOutline} size="18" class="text-success" aria-hidden />
      {:else if status === AgentToolCallStatus.Failed}
        <Icon icon={mdiAlertCircleOutline} size="18" class="text-danger" aria-hidden />
      {:else}
        <Icon icon={mdiClockOutline} size="18" class="text-gray-500 dark:text-gray-400" aria-hidden />
      {/if}
      <span class="sr-only">{statusLabel}</span>
    </span>
    <Icon icon={mdiWrenchOutline} size="14" class="shrink-0 text-gray-500 dark:text-gray-400" aria-hidden />
    <span class="min-w-0 truncate font-medium" {title}>{title}</span>
    <div class="ms-auto flex shrink-0 items-center gap-2">
      {#if toolName && toolName !== title}
        <code class="hidden shrink-0 text-xs text-gray-500 sm:inline dark:text-gray-400">{toolName}</code>
      {/if}
      {#if status === AgentToolCallStatus.Completed && onUndo && undoable.length > 0}
        <Button
          class="shrink-0"
          size="tiny"
          variant="outline"
          color="secondary"
          leadingIcon={mdiUndo}
          loading={busy}
          disabled={busy}
          title={undoable.length === 1 ? undoable[0].summary : undefined}
          onclick={() => onUndo(undoable.map(({ id }) => id))}
        >
          {undoable.length === 1
            ? $t('activity_log_undo')
            : $t('activity_log_undo_count', { values: { count: undoable.length } })}
        </Button>
      {:else if undone}
        <span
          class="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-xs dark:bg-gray-700"
          data-testid="tool-call-undone">{$t('activity_log_undone')}</span
        >
        {#if redoable && onRedo}
          <Button
            class="shrink-0"
            size="tiny"
            variant="ghost"
            color="secondary"
            leadingIcon={mdiRedo}
            disabled={busy}
            onclick={() => onRedo(redoable.id)}
          >
            {$t('activity_log_redo')}
          </Button>
        {/if}
      {/if}
    </div>
  </div>

  {#if undoMessage}
    <p class="flex items-start gap-1.5 text-xs text-warning" role="status" data-testid="tool-call-undo-message">
      <Icon icon={mdiAlertOutline} size="14" class="mt-0.5 shrink-0" aria-hidden />
      <span>{undoMessage}</span>
    </p>
  {/if}

  {#if content.assetIds?.length}
    <AssistantAssetStrip assetIds={content.assetIds} size="small" />
  {/if}

  <AssistantLinks albumIds={content.albumIds} bookIds={content.bookIds} />

  {#if input || content.output}
    <div class="flex flex-col gap-1">
      {#if input}
        <details class="group">
          <summary class="cursor-pointer text-xs text-gray-600 select-none dark:text-gray-400">
            {$t('assistant_tool_input')}
          </summary>
          <pre
            class="mt-1 max-h-60 immich-scrollbar overflow-auto rounded-lg bg-gray-100 p-2 text-xs whitespace-pre-wrap dark:bg-gray-900">{input}</pre>
        </details>
      {/if}
      {#if content.output}
        <details class="group">
          <summary class="cursor-pointer text-xs text-gray-600 select-none dark:text-gray-400">
            {$t('assistant_tool_output')}
          </summary>
          <pre
            class="mt-1 max-h-60 immich-scrollbar overflow-auto rounded-lg bg-gray-100 p-2 text-xs whitespace-pre-wrap dark:bg-gray-900">{content.output}</pre>
        </details>
      {/if}
    </div>
  {/if}
</div>
