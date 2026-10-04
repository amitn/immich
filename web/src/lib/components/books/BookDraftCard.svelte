<script lang="ts">
  import { Route } from '$lib/route';
  import { getAssetMediaUrl, getBookPageRenderUrl } from '$lib/utils';
  import { AssetMediaSize, type BookDraftResponseDto } from '@immich/sdk';
  import { Button, Icon } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline, mdiCheck, mdiClose } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    draft: BookDraftResponseDto;
    busy?: boolean;
    onKeep: (draft: BookDraftResponseDto) => void;
    onDiscard: (draft: BookDraftResponseDto) => void;
  };

  const { draft, busy = false, onKeep, onDiscard }: Props = $props();

  const book = $derived(draft.book);

  let coverFailed = $state(false);

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

<article
  class="flex h-full flex-col gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-2"
  aria-label={book.title}
  data-testid="book-draft-card"
>
  <a
    href={Route.viewBook(book)}
    class="group flex flex-col gap-2 rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
    title={$t('book_draft_open')}
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
    </div>
  </a>
  <p class="px-1 text-xs text-gray-600 dark:text-gray-400">{draft.reason}</p>
  <div class="mt-auto flex gap-2 px-1 pb-1">
    <Button
      size="small"
      shape="round"
      leadingIcon={mdiCheck}
      disabled={busy}
      onclick={() => onKeep(draft)}
      aria-label={$t('book_draft_keep_title', { values: { title: book.title } })}
    >
      {$t('book_draft_keep')}
    </Button>
    <Button
      size="small"
      shape="round"
      variant="ghost"
      color="secondary"
      leadingIcon={mdiClose}
      disabled={busy}
      onclick={() => onDiscard(draft)}
      aria-label={$t('book_draft_discard_title', { values: { title: book.title } })}
    >
      {$t('book_draft_discard')}
    </Button>
  </div>
</article>
