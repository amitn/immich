<script lang="ts">
  import AssistantAssetStrip from '$lib/components/assistant/AssistantAssetStrip.svelte';
  import AssistantLinks from '$lib/components/assistant/AssistantLinks.svelte';
  import type { AgentMessageContentDto, AgentToolCallStatus } from '$lib/types/assistant';
  import { Icon, LoadingSpinner } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiClockOutline, mdiWrenchOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    content: AgentMessageContentDto;
  };

  const { content }: Props = $props();

  const status = $derived((content.status ?? 'pending') as AgentToolCallStatus);
  const toolName = $derived(content.toolName?.replace(/^mcp__immich__/, ''));
  const title = $derived(content.title || toolName || $t('assistant_tool_call'));

  const statusLabel = $derived(
    {
      pending: $t('assistant_tool_status_pending'),
      in_progress: $t('assistant_tool_status_in_progress'),
      completed: $t('assistant_tool_status_completed'),
      failed: $t('assistant_tool_status_failed'),
    }[status] ?? status,
  );

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
  class="flex flex-col gap-2 rounded-xl border px-3 py-2 text-sm {status === 'failed'
    ? 'border-danger/40'
    : 'border-gray-200 dark:border-gray-700'} bg-subtle"
>
  <div class="flex min-w-0 items-center gap-2">
    <span class="flex size-5 shrink-0 items-center justify-center" title={statusLabel}>
      {#if status === 'in_progress'}
        <LoadingSpinner size="small" />
      {:else if status === 'completed'}
        <Icon icon={mdiCheckCircleOutline} size="18" class="text-success" aria-hidden />
      {:else if status === 'failed'}
        <Icon icon={mdiAlertCircleOutline} size="18" class="text-danger" aria-hidden />
      {:else}
        <Icon icon={mdiClockOutline} size="18" class="text-gray-500 dark:text-gray-400" aria-hidden />
      {/if}
      <span class="sr-only">{statusLabel}</span>
    </span>
    <Icon icon={mdiWrenchOutline} size="14" class="shrink-0 text-gray-500 dark:text-gray-400" aria-hidden />
    <span class="min-w-0 truncate font-medium" {title}>{title}</span>
    {#if toolName && toolName !== title}
      <code class="ms-auto hidden shrink-0 text-xs text-gray-500 sm:inline dark:text-gray-400">{toolName}</code>
    {/if}
  </div>

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
