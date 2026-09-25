<script lang="ts">
  import { Route } from '$lib/route';
  import { getBook, getBookPageRenderUrl } from '$lib/services/book-api';
  import type { BookResponseDto } from '$lib/types/assistant';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Badge, Icon } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    book: BookResponseDto;
  };

  const { book }: Props = $props();

  let loadedPages = $state<{ id: string }[]>();
  let coverFailed = $state(false);

  const pages = $derived(book.pages ?? loadedPages);
  const firstPageId = $derived(pages?.[0]?.id);
  const ratio = $derived(book.pageWidthMm > 0 && book.pageHeightMm > 0 ? book.pageWidthMm / book.pageHeightMm : 1);

  const coverUrl = $derived.by(() => {
    if (firstPageId && !coverFailed) {
      return getBookPageRenderUrl({ id: book.id, pageId: firstPageId, size: 600, cacheKey: book.updatedAt });
    }
    if (book.coverAssetId) {
      return getAssetMediaUrl({ id: book.coverAssetId, size: AssetMediaSize.Thumbnail });
    }
  });

  onMount(() => {
    if (book.pages) {
      return;
    }
    // the list endpoint may not include pages; fetch them for the cover render
    getBook({ id: book.id })
      .then((detail) => (loadedPages = detail.pages))
      .catch(() => (loadedPages = []));
  });
</script>

<a
  href={Route.viewBook(book)}
  class="group flex flex-col gap-2 rounded-xl p-2 outline-offset-2 transition-colors hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-primary dark:hover:bg-gray-800"
>
  <div
    class="relative flex w-full items-center justify-center overflow-hidden rounded-lg bg-gray-100 shadow-sm dark:bg-gray-800"
    style:aspect-ratio={ratio}
  >
    {#if coverUrl}
      <img
        src={coverUrl}
        alt={$t('book_cover_of', { values: { title: book.title } })}
        loading="lazy"
        draggable="false"
        class="size-full object-cover transition-transform group-hover:scale-[1.02]"
        onerror={() => (coverFailed = true)}
      />
    {:else}
      <Icon icon={mdiBookOpenPageVariantOutline} size="48" class="text-gray-400" aria-hidden />
    {/if}
  </div>
  <div class="flex min-w-0 flex-col gap-0.5 px-1">
    <p class="truncate font-medium" title={book.title}>{book.title}</p>
    {#if book.subtitle}
      <p class="truncate text-sm text-gray-600 dark:text-gray-400">{book.subtitle}</p>
    {/if}
    <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      {#if pages}
        <span>{$t('book_page_count', { values: { count: pages.length } })}</span>
      {/if}
      {#if book.exportStatus === 'completed'}
        <Badge size="tiny" color="success" shape="round">{$t('book_pdf_ready')}</Badge>
      {:else if book.exportStatus === 'pending' || book.exportStatus === 'running'}
        <Badge size="tiny" color="info" shape="round">{$t('book_exporting')}</Badge>
      {/if}
    </div>
  </div>
</a>
