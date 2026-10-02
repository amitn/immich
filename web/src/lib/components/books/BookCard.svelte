<script lang="ts">
  import { Route } from '$lib/route';
  import { getAssetMediaUrl, getBookPageRenderUrl } from '$lib/utils';
  import { getCompletedExports, isBookExporting, isBookExportOutdated } from '$lib/utils/book-export';
  import { AssetMediaSize, BookExportFormat, type BookResponseDto } from '@immich/sdk';
  import { Badge, Icon } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    book: BookResponseDto;
  };

  const { book }: Props = $props();

  let coverFailed = $state(false);

  const completedExports = $derived(getCompletedExports(book));
  const ratio = $derived(book.pageWidthMm > 0 && book.pageHeightMm > 0 ? book.pageWidthMm / book.pageHeightMm : 1);

  const coverUrl = $derived.by(() => {
    if (book.firstPageId && !coverFailed) {
      return getBookPageRenderUrl({ id: book.id, pageId: book.firstPageId, size: 600, cacheKey: book.updatedAt });
    }
    if (book.coverAssetId) {
      return getAssetMediaUrl({ id: book.coverAssetId, size: AssetMediaSize.Thumbnail });
    }
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
    <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <span>{$t('book_page_count', { values: { count: book.pageCount } })}</span>
      {#each completedExports as format (format)}
        {@const label = format === BookExportFormat.Pdf ? $t('book_format_pdf') : $t('book_format_html_short')}
        {#if isBookExportOutdated(book, format)}
          <span title={$t('book_export_outdated_hint')}>
            <Badge size="tiny" color="secondary" shape="round">
              {$t('book_format_outdated', { values: { format: label } })}
            </Badge>
          </span>
        {:else}
          <span title={format === BookExportFormat.Pdf ? $t('book_pdf_ready') : $t('book_html_ready')}>
            <Badge size="tiny" color="success" shape="round">
              {label}
              <span class="sr-only">{$t('book_export_status_completed')}</span>
            </Badge>
          </span>
        {/if}
      {/each}
      {#if isBookExporting(book)}
        <Badge size="tiny" color="info" shape="round">{$t('book_exporting_short')}</Badge>
      {/if}
    </div>
  </div>
</a>
