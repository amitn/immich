<script lang="ts">
  import { locale } from '$lib/stores/preferences.store';
  import type { AgentSessionResponseDto } from '$lib/types/assistant';
  import { Button, Icon, IconButton, LoadingSpinner } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiPlus, mdiTrashCanOutline } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    sessions: AgentSessionResponseDto[];
    activeId?: string;
    onSelect: (session: AgentSessionResponseDto) => void;
    onNew: () => void;
    onDelete: (session: AgentSessionResponseDto) => void;
  };

  const { sessions, activeId, onSelect, onNew, onDelete }: Props = $props();

  const relative = (date: string) => DateTime.fromISO(date).toRelative({ locale: $locale }) ?? '';
</script>

<nav class="flex h-full min-h-0 flex-col" aria-label={$t('assistant_chats')}>
  <div class="p-3">
    <Button fullWidth size="small" shape="round" leadingIcon={mdiPlus} onclick={onNew}>
      {$t('assistant_new_chat')}
    </Button>
  </div>

  {#if sessions.length === 0}
    <p class="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{$t('assistant_no_chats')}</p>
  {:else}
    <ul class="flex min-h-0 flex-1 immich-scrollbar flex-col gap-0.5 overflow-y-auto px-2 pb-3">
      {#each sessions as session (session.id)}
        {@const active = session.id === activeId}
        {@const title = session.title || $t('assistant_untitled_chat')}
        <li
          class="group flex items-center gap-1 rounded-xl pe-1 {active
            ? 'bg-primary/10 text-primary'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 flex-col items-start px-3 py-2 text-start"
            aria-current={active ? 'true' : undefined}
            onclick={() => onSelect(session)}
          >
            <span class="w-full truncate text-sm font-medium">{title}</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">{relative(session.updatedAt)}</span>
          </button>
          {#if session.status === 'running'}
            <span class="shrink-0" title={$t('assistant_status_running')}>
              <LoadingSpinner size="small" />
              <span class="sr-only">{$t('assistant_status_running')}</span>
            </span>
          {:else if session.status === 'error'}
            <span class="shrink-0" title={$t('assistant_status_error')}>
              <Icon icon={mdiAlertCircleOutline} size="16" class="text-danger" aria-hidden />
              <span class="sr-only">{$t('assistant_status_error')}</span>
            </span>
          {/if}
          <IconButton
            icon={mdiTrashCanOutline}
            size="small"
            variant="ghost"
            color="secondary"
            shape="round"
            class="shrink-0 opacity-100 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            aria-label={$t('assistant_delete_chat_named', { values: { title } })}
            onclick={() => onDelete(session)}
          />
        </li>
      {/each}
    </ul>
  {/if}
</nav>
