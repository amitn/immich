<script lang="ts">
  import AlbumCover from '$lib/components/album-page/AlbumCover.svelte';
  import AssetCover from '$lib/components/sharedlinks-page/covers/AssetCover.svelte';
  import NoCover from '$lib/components/sharedlinks-page/covers/NoCover.svelte';
  import { getAssetMediaUrl, getBookPageRenderUrl } from '$lib/utils';
  import { AssetMediaSize, type BookResponseDto, type SharedLinkResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    sharedLink: SharedLinkResponseDto;
    /** the book of a link to a book, whose first page (or cover photo) is the cover, as in the list of books */
    book?: BookResponseDto;
    preload?: boolean;
    class?: string;
  }

  let { sharedLink, book, preload = false, class: className = '' }: Props = $props();

  let bookCoverFailed = $state(false);

  const bookCoverUrl = $derived.by(() => {
    if (!book || bookCoverFailed) {
      return;
    }
    if (book.firstPageId) {
      return getBookPageRenderUrl({ id: book.id, pageId: book.firstPageId, size: 240, cacheKey: book.updatedAt });
    }
    if (book.coverAssetId) {
      return getAssetMediaUrl({ id: book.coverAssetId, size: AssetMediaSize.Thumbnail });
    }
  });
</script>

<div class="relative size-22 shrink-0">
  {#if sharedLink?.album}
    <AlbumCover album={sharedLink.album} class={className} {preload} />
  {:else if sharedLink.book}
    <!-- the owner's own view of the book: its first page, whole, or a book icon until it is known -->
    <div
      class="flex size-full items-center justify-center rounded-xl bg-gray-100 text-primary dark:bg-immich-dark-gray {className}"
      role="img"
      aria-label={sharedLink.book.title}
      data-testid="book-cover"
    >
      {#if bookCoverUrl}
        <img
          src={bookCoverUrl}
          alt=""
          class="max-h-[85%] max-w-[85%] object-contain shadow-sm"
          loading={preload ? 'eager' : 'lazy'}
          draggable="false"
          onerror={() => (bookCoverFailed = true)}
        />
      {:else}
        <Icon icon={mdiBookOpenPageVariantOutline} size="2.5rem" />
      {/if}
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
