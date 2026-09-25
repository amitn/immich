<script lang="ts">
  import { optionClickCallbackStore, selectedIdStore } from '$lib/stores/context-menu.store';
  import { getBookPageRenderUrl } from '$lib/utils';
  import { generateId } from '$lib/utils/generate-id';
  import type { BookResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline, mdiCheck } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    book: BookResponseDto;
    /** The book that is open */
    current?: boolean;
    onClick: (book: BookResponseDto) => void;
  };

  const { book, current = false, onClick }: Props = $props();

  // a menu entry is small: the thumbnail rendering of the first page is cheap
  const THUMBNAIL_SIZE = 120;

  const id = generateId();

  let coverFailed = $state(false);

  const isActive = $derived($selectedIdStore === id);
  const ratio = $derived(book.pageWidthMm > 0 && book.pageHeightMm > 0 ? book.pageWidthMm / book.pageHeightMm : 1);
  const coverUrl = $derived(
    book.firstPageId && !coverFailed
      ? getBookPageRenderUrl({ id: book.id, pageId: book.firstPageId, size: THUMBNAIL_SIZE, cacheKey: book.updatedAt })
      : undefined,
  );

  const handleClick = () => {
    // eslint-disable-next-line unicorn/no-optional-chaining-on-undeclared-variable
    $optionClickCallbackStore?.();
    onClick(book);
  };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<li
  {id}
  onclick={handleClick}
  onmouseover={() => ($selectedIdStore = id)}
  onmouseleave={() => ($selectedIdStore = undefined)}
  class="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-start text-sm font-medium text-immich-fg dark:text-immich-dark-bg {isActive
    ? 'bg-slate-300'
    : 'bg-slate-100'}"
  role="menuitemradio"
  aria-checked={current}
>
  <span
    class="flex h-10 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-slate-200 shadow-sm"
    style:aspect-ratio={ratio}
  >
    {#if coverUrl}
      <img
        src={coverUrl}
        alt=""
        loading="lazy"
        draggable="false"
        class="size-full object-cover"
        onerror={() => (coverFailed = true)}
      />
    {:else}
      <Icon icon={mdiBookOpenPageVariantOutline} size="18" class="text-gray-500" aria-hidden />
    {/if}
  </span>
  <span class="flex min-w-0 grow flex-col">
    <span class="truncate {current ? 'text-immich-primary' : ''}" title={book.title}>{book.title}</span>
    <span class="text-xs font-normal text-gray-500">
      {$t('book_page_count', { values: { count: book.pageCount } })}
    </span>
  </span>
  <span class="size-4.5 shrink-0 text-immich-primary">
    {#if current}
      <Icon icon={mdiCheck} size="18" aria-hidden />
    {/if}
  </span>
</li>
