<script lang="ts">
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  type Props = {
    assetIds: string[];
    /** how many thumbnails to show before collapsing the rest into a "+N" button */
    limit?: number;
    size?: 'small' | 'medium';
  };

  const { assetIds, limit = 12, size = 'medium' }: Props = $props();

  let expanded = $state(false);

  const visible = $derived(expanded ? assetIds : assetIds.slice(0, limit));
  const hidden = $derived(assetIds.length - visible.length);
  const sizeClass = $derived(size === 'small' ? 'size-12' : 'size-16 sm:size-20');
</script>

{#if assetIds.length > 0}
  <ul class="flex flex-wrap gap-1.5" aria-label={$t('assistant_photos_count', { values: { count: assetIds.length } })}>
    {#each visible as id, index (id)}
      <li>
        <a
          href={Route.viewAsset({ id })}
          class="block overflow-hidden rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
          title={$t('assistant_open_photo', { values: { index: index + 1 } })}
        >
          <img
            src={getAssetMediaUrl({ id, size: AssetMediaSize.Thumbnail })}
            alt={$t('assistant_open_photo', { values: { index: index + 1 } })}
            loading="lazy"
            draggable="false"
            class="{sizeClass} bg-gray-200 object-cover transition-transform hover:scale-105 dark:bg-gray-700"
          />
        </a>
      </li>
    {/each}
    {#if hidden > 0}
      <li>
        <button
          type="button"
          class="{sizeClass} flex items-center justify-center rounded-lg bg-gray-200 text-sm font-medium hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
          onclick={() => (expanded = true)}
          aria-label={$t('assistant_show_more_photos', { values: { count: hidden } })}
        >
          +{hidden}
        </button>
      </li>
    {/if}
  </ul>
{/if}
