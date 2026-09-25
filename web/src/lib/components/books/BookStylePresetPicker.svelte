<script lang="ts">
  import BookStyleSwatch from '$lib/components/books/BookStyleSwatch.svelte';
  import {
    BOOK_STYLE_PRESET_LABEL_KEYS,
    BOOK_STYLE_PRESETS,
    DEFAULT_BOOK_STYLE_PRESET,
    loadBookStylePresets,
  } from '$lib/utils/book-style';
  import { handleError } from '$lib/utils/handle-error';
  import { generateId } from '$lib/utils/generate-id';
  import { BookStylePreset, type BookStylePresetResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCheckCircle } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    value?: BookStylePreset;
    /** Page width in millimeters, to draw the margins to scale */
    pageWidthMm?: number;
    disabled?: boolean;
  };

  let { value = $bindable(DEFAULT_BOOK_STYLE_PRESET), pageWidthMm, disabled = false }: Props = $props();

  const name = `book-style-preset-${generateId()}`;
  const descriptionId = `${name}-description`;

  let presets = $state<BookStylePresetResponseDto[]>([]);

  const styleOf = (id: BookStylePreset) => presets.find((preset) => preset.id === id)?.style;

  onMount(async () => {
    try {
      presets = await loadBookStylePresets();
    } catch (error) {
      // the choice still works without the swatches
      handleError(error, $t('errors.unable_to_load_book_style_presets'), { notify: false });
    }
  });
</script>

<fieldset {disabled} aria-describedby={descriptionId}>
  <legend class="mb-2 text-sm font-medium">{$t('book_style')}</legend>
  <div class="grid grid-cols-3 gap-2">
    {#each BOOK_STYLE_PRESETS as id (id)}
      {@const checked = value === id}
      {@const style = styleOf(id)}
      <label
        class="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 p-3 text-center transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
          ? 'border-primary bg-primary/5'
          : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
      >
        <input type="radio" {name} class="sr-only" value={id} bind:group={value} />
        <BookStyleSwatch {style} {pageWidthMm} />
        <span class="flex flex-col items-center">
          <span class="flex items-center gap-1 text-xs font-medium">
            {$t(BOOK_STYLE_PRESET_LABEL_KEYS[id].name)}
            {#if checked}
              <Icon icon={mdiCheckCircle} size="14" class="text-primary" aria-hidden />
            {/if}
          </span>
          {#if style}
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {$t('book_style_margins', { values: { margin: style.marginMm } })}
            </span>
          {/if}
        </span>
      </label>
    {/each}
  </div>
  <p id={descriptionId} class="mt-2 text-xs text-gray-600 dark:text-gray-400" aria-live="polite">
    {$t(BOOK_STYLE_PRESET_LABEL_KEYS[value].description)}
  </p>
</fieldset>
