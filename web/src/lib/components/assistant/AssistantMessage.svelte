<script lang="ts">
  import AssistantAssetStrip from '$lib/components/assistant/AssistantAssetStrip.svelte';
  import AssistantLinks from '$lib/components/assistant/AssistantLinks.svelte';
  import AssistantMarkdown from '$lib/components/assistant/AssistantMarkdown.svelte';
  import AssistantPermissionCard from '$lib/components/assistant/AssistantPermissionCard.svelte';
  import AssistantPlan from '$lib/components/assistant/AssistantPlan.svelte';
  import AssistantToolCallCard from '$lib/components/assistant/AssistantToolCallCard.svelte';
  import type { ChatMessage } from '$lib/managers/agent-conversation.svelte';
  import { AgentMessageKind, AgentMessageRole, type AgentPermissionResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiThoughtBubbleOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    message: ChatMessage;
    onPermission: (message: ChatMessage, response: AgentPermissionResponseDto & { approved: boolean }) => Promise<void>;
  };

  const { message, onPermission }: Props = $props();

  const content = $derived(message.content);
</script>

{#if message.role === AgentMessageRole.User}
  <div class="flex flex-col items-end gap-1.5" class:opacity-60={message.pending}>
    {#if content.assetIds?.length}
      <AssistantAssetStrip assetIds={content.assetIds} size="small" limit={8} />
    {/if}
    {#if content.text}
      <div
        class="max-w-[85%] rounded-2xl rounded-ee-sm bg-primary px-4 py-2 text-sm/6 wrap-break-word whitespace-pre-wrap text-light"
      >
        {content.text}
      </div>
    {/if}
    {#if message.pending}
      <span class="sr-only">{$t('assistant_sending')}</span>
    {/if}
  </div>
{:else if message.kind === AgentMessageKind.Text}
  <div class="flex flex-col gap-2">
    <AssistantMarkdown text={content.text} />
    {#if content.assetIds?.length}
      <AssistantAssetStrip assetIds={content.assetIds} />
    {/if}
    <AssistantLinks albumIds={content.albumIds} bookIds={content.bookIds} />
  </div>
{:else if message.kind === AgentMessageKind.Thought}
  <details class="group rounded-lg text-gray-600 dark:text-gray-400">
    <summary class="flex cursor-pointer items-center gap-1.5 text-xs select-none">
      <Icon icon={mdiThoughtBubbleOutline} size="16" aria-hidden />
      {$t('assistant_thinking')}
    </summary>
    <div class="mt-1 border-s-2 border-gray-300 ps-3 dark:border-gray-600">
      <AssistantMarkdown text={content.text} class="text-xs/5" />
    </div>
  </details>
{:else if message.kind === AgentMessageKind.ToolCall}
  <AssistantToolCallCard {content} />
{:else if message.kind === AgentMessageKind.Permission}
  <AssistantPermissionCard {content} onRespond={(response) => onPermission(message, response)} />
{:else if message.kind === AgentMessageKind.Plan}
  {#if content.entries?.length}
    <AssistantPlan entries={content.entries} />
  {/if}
{:else if message.kind === AgentMessageKind.Error}
  <div
    class="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger"
    role="alert"
  >
    <Icon icon={mdiAlertCircleOutline} size="18" class="mt-0.5 shrink-0" aria-hidden />
    <p class="wrap-break-word whitespace-pre-wrap">{content.text || $t('errors.something_went_wrong')}</p>
  </div>
{/if}
