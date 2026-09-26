<script lang="ts">
  import AlbumCover from '$lib/components/album-page/AlbumCover.svelte';
  import AssetCover from '$lib/components/sharedlinks-page/covers/AssetCover.svelte';
  import NoCover from '$lib/components/sharedlinks-page/covers/NoCover.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import type { SharedLinkResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    sharedLink: SharedLinkResponseDto;
    preload?: boolean;
    class?: string;
  }

  let { sharedLink, preload = false, class: className = '' }: Props = $props();
</script>

<div class="relative size-22 shrink-0">
  {#if sharedLink?.album}
    <AlbumCover album={sharedLink.album} class={className} {preload} />
  {:else if sharedLink.book}
    <!-- the photos of a book are not shared one by one, so it has no photo cover -->
    <div
      class="flex size-full items-center justify-center rounded-xl bg-gray-100 text-primary dark:bg-immich-dark-gray {className}"
      role="img"
      aria-label={sharedLink.book.title}
      data-testid="book-cover"
    >
      <Icon icon={mdiBookOpenPageVariantOutline} size="2.5rem" />
    </div>
  {:else if sharedLink.assets[0]}
    <AssetCover
      alt={$t('individual_share')}
      class={className}
      {preload}
      src={getAssetMediaUrl({ id: sharedLink.assets[0].id })}
    />
  {:else}
    <NoCover alt={$t('unnamed_share')} class={className} {preload} />
  {/if}
</div>
