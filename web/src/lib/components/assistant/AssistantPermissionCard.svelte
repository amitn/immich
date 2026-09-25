<script lang="ts">
  import AssistantAssetStrip from '$lib/components/assistant/AssistantAssetStrip.svelte';
  import AssistantLinks from '$lib/components/assistant/AssistantLinks.svelte';
  import type {
    AgentMessageContentDto,
    AgentPermissionOptionDto,
    AgentPermissionResponseDto,
    AgentPermissionStatus,
  } from '$lib/types/assistant';
  import { Badge, Button, Icon, type Color } from '@immich/ui';
  import { mdiCancel, mdiCheck, mdiClockAlertOutline, mdiShieldAlertOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    content: AgentMessageContentDto;
    disabled?: boolean;
    onRespond: (response: AgentPermissionResponseDto & { approved: boolean }) => Promise<void>;
  };

  const { content, disabled = false, onRespond }: Props = $props();

  let busy = $state(false);

  const status = $derived((content.status ?? 'pending') as AgentPermissionStatus);
  const toolName = $derived(content.toolName?.replace(/^mcp__immich__/, ''));
  const title = $derived(content.title || toolName);

  const isAllow = (option: AgentPermissionOptionDto) => option.kind.startsWith('allow');

  const optionColor = (option: AgentPermissionOptionDto): Color => {
    if (option.kind === 'allow_once') {
      return 'primary';
    }
    return isAllow(option) ? 'secondary' : 'danger';
  };

  const respond = async (response: AgentPermissionResponseDto & { approved: boolean }) => {
    if (busy) {
      return;
    }
    busy = true;
    try {
      await onRespond(response);
    } finally {
      busy = false;
    }
  };

  const resolved = $derived(
    (
      {
        approved: { color: 'success', icon: mdiCheck, label: $t('assistant_permission_approved') },
        denied: { color: 'danger', icon: mdiCancel, label: $t('assistant_permission_denied') },
        expired: { color: 'secondary', icon: mdiClockAlertOutline, label: $t('expired') },
      } as Record<string, { color: Color; icon: string; label: string }>
    )[status],
  );
</script>

<div
  class="flex flex-col gap-3 rounded-xl border-2 px-4 py-3 text-sm {status === 'pending'
    ? 'border-warning/60 bg-warning/5'
    : 'border-gray-200 dark:border-gray-700'}"
  role="group"
  aria-label={$t('assistant_permission_request')}
>
  <div class="flex items-center gap-2">
    <Icon icon={mdiShieldAlertOutline} size="20" class="shrink-0 text-warning" aria-hidden />
    <span class="font-semibold">{$t('assistant_permission_request')}</span>
    {#if title}
      <span class="min-w-0 truncate text-gray-600 dark:text-gray-400">· {title}</span>
    {/if}
  </div>

  {#if content.summary || content.text}
    <p class="whitespace-pre-wrap">{content.summary || content.text}</p>
  {/if}

  {#if content.assetIds?.length}
    <AssistantAssetStrip assetIds={content.assetIds} size="small" />
  {/if}

  <AssistantLinks albumIds={content.albumIds} bookIds={content.bookIds} />

  {#if status === 'pending'}
    <div class="flex flex-wrap gap-2">
      {#if content.options?.length}
        {#each content.options as option (option.optionId)}
          <Button
            size="small"
            shape="round"
            color={optionColor(option)}
            variant={option.kind === 'allow_once' ? 'filled' : 'outline'}
            disabled={disabled || busy}
            onclick={() => respond({ optionId: option.optionId, approved: isAllow(option) })}
          >
            {option.name}
          </Button>
        {/each}
      {:else}
        <Button
          size="small"
          shape="round"
          leadingIcon={mdiCheck}
          disabled={disabled || busy}
          onclick={() => respond({ approved: true })}
        >
          {$t('assistant_approve')}
        </Button>
        <Button
          size="small"
          shape="round"
          color="danger"
          variant="outline"
          leadingIcon={mdiCancel}
          disabled={disabled || busy}
          onclick={() => respond({ approved: false })}
        >
          {$t('assistant_deny')}
        </Button>
      {/if}
    </div>
  {:else if resolved}
    <div>
      <Badge color={resolved.color} size="small" shape="round" leadingIcon={resolved.icon}>{resolved.label}</Badge>
    </div>
  {/if}
</div>
