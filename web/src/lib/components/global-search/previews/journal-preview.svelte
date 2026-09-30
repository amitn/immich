<script lang="ts">
  import { AssetMediaSize } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import { formatJournalVisit, type JournalItem } from '$lib/managers/global-search-journals';
  import { getAssetMediaUrl } from '$lib/utils';

  interface Props {
    item: JournalItem;
  }
  let { item }: Props = $props();
</script>

<div data-cmdk-preview-journal class="p-5">
  {#if item.kind === 'ask'}
    <div class="text-base font-semibold">{$t('ask_assistant')}</div>
    <div class="mt-2 text-sm text-gray-600 dark:text-gray-300">
      {$t('cmdk_journals_ask_preview', { values: { question: item.question } })}
    </div>
  {:else}
    <div class="text-base font-semibold">{item.visit.place}</div>
    <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatJournalVisit(item.visit)}</div>
    {#if item.visit.entries.length > 0}
      <ul class="mt-3 flex flex-col gap-0.5 text-sm">
        {#each item.visit.entries as entry, index (index)}
          <li class="truncate">{entry.name}</li>
        {/each}
      </ul>
    {/if}
    {#if item.visit.photoIds.length > 0}
      <div class="mt-3 grid grid-cols-3 gap-2">
        {#each item.visit.photoIds as photoId (photoId)}
          <img
            src={getAssetMediaUrl({ id: photoId, size: AssetMediaSize.Thumbnail })}
            alt=""
            class="size-[72px] rounded-md object-cover"
          />
        {/each}
      </div>
    {/if}
  {/if}
</div>
