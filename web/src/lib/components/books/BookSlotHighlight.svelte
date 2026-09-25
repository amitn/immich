<script lang="ts">
  import { getBookSlotRect, loadBookLayouts } from '$lib/utils/book-review';
  import { handleError } from '$lib/utils/handle-error';
  import type { BookDetailResponseDto, BookLayoutResponseDto, BookPageResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  type Props = {
    book: Pick<BookDetailResponseDto, 'pageWidthMm' | 'pageHeightMm' | 'style'>;
    page: BookPageResponseDto;
    /** Zero-based slot to highlight; nothing is shown without one */
    slot?: number;
  };

  const { book, page, slot }: Props = $props();

  let layouts = $state<BookLayoutResponseDto[]>([]);

  const rect = $derived.by(() => {
    if (slot === undefined) {
      return;
    }
    const layout = layouts.find(({ id }) => id === page.layout);
    return layout ? getBookSlotRect(layout, book, slot) : undefined;
  });

  $effect(() => {
    if (slot === undefined || layouts.length > 0) {
      return;
    }
    loadBookLayouts()
      .then((result) => (layouts = result))
      .catch((error: unknown) => handleError(error, $t('errors.unable_to_load_book_layouts'), { notify: false }));
  });
</script>

{#if rect && slot !== undefined}
  <div
    class="pointer-events-none absolute rounded-sm ring-4 ring-primary ring-offset-2 ring-offset-white/70 motion-safe:animate-pulse dark:ring-offset-black/70"
    style:left="{rect.left}%"
    style:top="{rect.top}%"
    style:width="{rect.width}%"
    style:height="{rect.height}%"
    data-testid="book-slot-highlight"
  >
    <span class="sr-only">{$t('book_review_slot_highlighted', { values: { slot: slot + 1 } })}</span>
  </div>
{/if}
