<script lang="ts">
  import BookLayoutThumbnail from '$lib/components/books/BookLayoutThumbnail.svelte';
  import { getLayoutChoices, type BookPageSize, type BookSpacing } from '$lib/utils/book-geometry';
  import type { BookLayoutResponseDto } from '@immich/sdk';
  import { Field, Switch, Text } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    layouts: BookLayoutResponseDto[];
    size: BookPageSize;
    style: BookSpacing;
    /** photos on the page; layouts with fewer slots are hidden unless the user asks for them */
    photoCount?: number;
    isMap?: boolean;
    /** the layout of the page */
    current?: string;
    onSelect: (layout: BookLayoutResponseDto) => void;
  };

  const { layouts, size, style, photoCount = 0, isMap = false, current, onSelect }: Props = $props();

  let showAll = $state(false);

  const choices = $derived(getLayoutChoices(layouts, { photoCount, isMap }));
  const shown = $derived(showAll ? [...choices.fitting, ...choices.others] : choices.fitting);

  const slotLabel = (layout: BookLayoutResponseDto) =>
    layout.slots.length === 0 && layout.mapArea
      ? $t('book_layout_map_only')
      : $t('book_layout_photo_count', { values: { count: layout.slots.length } });
</script>

<div class="flex flex-col gap-3">
  {#if choices.others.length > 0}
    <Field label={$t('book_layout_show_all', { values: { count: photoCount } })}>
      <Switch bind:checked={showAll} />
    </Field>
  {/if}

  {#if shown.length === 0}
    <Text size="small" color="muted">{$t('book_layout_none_fit')}</Text>
  {:else}
    <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={$t('book_layouts')}>
      {#each shown as layout (layout.id)}
        {@const isCurrent = layout.id === current}
        {@const removed = Math.max(0, photoCount - layout.slots.length)}
        <li>
          <button
            type="button"
            class="flex w-full flex-col items-center gap-1 rounded-lg border p-2 text-center outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary {isCurrent
              ? 'border-primary bg-primary/10'
              : 'border-gray-200 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800'}"
            aria-pressed={isCurrent}
            title={layout.description}
            onclick={() => onSelect(layout)}
          >
            <BookLayoutThumbnail {layout} {size} {style} class="h-16 w-auto" />
            <span class="text-sm font-medium">{layout.name}</span>
            <span class="text-xs text-gray-600 dark:text-gray-400">{slotLabel(layout)}</span>
            {#if removed > 0}
              <span class="text-xs text-danger">{$t('book_layout_removes_photos', { values: { count: removed } })}</span
              >
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
