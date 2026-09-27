<script lang="ts">
  import ActivityList from '$lib/components/activity-log/ActivityList.svelte';
  import { ActivityLogState } from '$lib/managers/activity-log.svelte';
  import { Route } from '$lib/route';
  import { IconButton } from '@immich/ui';
  import { mdiClose, mdiOpenInNew } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    /** the changes of the open chat (shared with its Undo buttons) */
    chat: ActivityLogState;
    hasChat: boolean;
    onClose: () => void;
  };

  const { chat, hasChat, onClose }: Props = $props();

  type Tab = 'chat' | 'all';
  let tab = $state<Tab>('chat');
  // undoing from the list of all changes updates the Undo buttons of the chat too
  const all = new ActivityLogState(() => ({}), { onChange: () => chat.load() });

  const selectTab = async (value: Tab) => {
    tab = value;
    await (value === 'all' ? all.load() : chat.load());
  };
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="assistant-activity-panel">
  <div class="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
    <h2 class="text-sm font-medium">{$t('activity_log')}</h2>
    <div class="flex items-center gap-1">
      <IconButton
        variant="ghost"
        color="secondary"
        size="small"
        icon={mdiOpenInNew}
        href={Route.activityLog()}
        aria-label={$t('activity_log_open')}
        title={$t('activity_log_open')}
      />
      <IconButton
        variant="ghost"
        color="secondary"
        size="small"
        icon={mdiClose}
        aria-label={$t('close')}
        onclick={onClose}
      />
    </div>
  </div>

  <div class="flex gap-1 px-3 pt-3" role="tablist" aria-label={$t('activity_log')}>
    {#each [{ value: 'chat', label: $t('activity_log_this_chat') }, { value: 'all', label: $t('activity_log_all') }] as option (option.value)}
      <button
        type="button"
        role="tab"
        aria-selected={tab === option.value}
        class="rounded-full px-3 py-1 text-sm {tab === option.value
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
        onclick={() => selectTab(option.value as Tab)}
      >
        {option.label}
      </button>
    {/each}
  </div>

  <div class="min-h-0 flex-1 immich-scrollbar overflow-y-auto p-3" role="tabpanel">
    {#if tab === 'chat'}
      {#if hasChat}
        <ActivityList activity={chat} emptyText={$t('activity_log_empty_chat')} />
      {:else}
        <p class="py-6 text-center text-sm text-gray-600 dark:text-gray-400">{$t('activity_log_empty_chat')}</p>
      {/if}
    {:else}
      <ActivityList activity={all} showChat />
    {/if}
  </div>
</div>
