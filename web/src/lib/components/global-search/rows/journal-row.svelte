<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiCreationOutline, mdiTagOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { getCollectionPack } from '$lib/journals/registry';
  import { formatJournalVisit, type JournalItem } from '$lib/managers/global-search-journals';

  interface Props {
    item: JournalItem;
  }
  let { item }: Props = $props();

  const icon = $derived(
    item.kind === 'ask' ? mdiCreationOutline : (getCollectionPack(item.visit.pack)?.icon ?? mdiTagOutline),
  );
</script>

<div
  class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-80 ease-out group-data-selected:bg-primary/10"
  data-testid="journal-row"
>
  <div class="flex size-8 items-center justify-center rounded-md bg-subtle/40">
    <Icon {icon} size="1.125em" class={item.kind === 'ask' ? 'text-primary' : 'text-gray-500 dark:text-gray-400'} />
  </div>
  <div class="min-w-0 flex-1">
    {#if item.kind === 'ask'}
      <div class="truncate text-sm font-medium">{$t('ask_assistant')}</div>
      <div class="truncate text-xs text-gray-500 dark:text-gray-400">
        {$t('cmdk_journals_ask_description', { values: { question: item.question } })}
      </div>
    {:else}
      <div class="truncate text-sm font-medium">{item.visit.place}</div>
      <div class="truncate text-xs text-gray-500 dark:text-gray-400">
        {[formatJournalVisit(item.visit), item.visit.entries.map(({ name }) => name).join(', ')]
          .filter(Boolean)
          .join(' — ')}
      </div>
    {/if}
  </div>
</div>
