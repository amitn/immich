<script lang="ts">
  import BookStyleSwatch from '$lib/components/books/BookStyleSwatch.svelte';
  import {
    BOOK_STYLE_PRESET_LABEL_KEYS,
    BOOK_STYLE_PRESETS,
    DEFAULT_BOOK_STYLE_PRESET,
    isBookStylePreset,
    loadBookStylePresets,
    loadBookUserStyles,
    type BookStyleChoice,
  } from '$lib/utils/book-style';
  import { handleError } from '$lib/utils/handle-error';
  import { generateId } from '$lib/utils/generate-id';
  import type { BookStyle, BookStylePresetResponseDto, BookUserStyleResponseDto } from '@immich/sdk';
  import { Button, Icon } from '@immich/ui';
  import { mdiCheckCircle, mdiCreationOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    /** a preset, or the id of one of the user's own styles */
    value?: BookStyleChoice;
    /** Page width in millimeters, to draw the margins to scale */
    pageWidthMm?: number;
    disabled?: boolean;
    /** Called with the user's own styles once they are loaded, e.g. to create a book with the style of one */
    onUserStyles?: (styles: BookUserStyleResponseDto[]) => void;
    /** Shows "Create with assistant…", e.g. when the assistant is enabled */
    onCreateWithAssistant?: () => void;
  };

  let {
    value = $bindable(DEFAULT_BOOK_STYLE_PRESET),
    pageWidthMm,
    disabled = false,
    onUserStyles,
    onCreateWithAssistant,
  }: Props = $props();

  const name = `book-style-preset-${generateId()}`;
  const descriptionId = `${name}-description`;

  let presets = $state<BookStylePresetResponseDto[]>([]);
  let userStyles = $state<BookUserStyleResponseDto[]>([]);

  const styleOf = (id: string) => presets.find((preset) => preset.id === id)?.style;

  const description = $derived(
    isBookStylePreset(value)
      ? $t(BOOK_STYLE_PRESET_LABEL_KEYS[value].description)
      : (userStyles.find((style) => style.id === value)?.description ?? ''),
  );

  onMount(async () => {
    try {
      presets = await loadBookStylePresets();
    } catch (error) {
      // the choice still works without the swatches
      handleError(error, $t('errors.unable_to_load_book_style_presets'), { notify: false });
    }
    try {
      userStyles = await loadBookUserStyles();
      onUserStyles?.(userStyles);
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_book_styles'), { notify: false });
    }
  });
</script>

{#snippet option(id: string, label: string, style: BookStyle | undefined)}
  {@const checked = value === id}
  <label
    class="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 p-3 text-center transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
      ? 'border-primary bg-primary/5'
      : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
  >
    <input type="radio" {name} class="sr-only" value={id} bind:group={value} />
    <BookStyleSwatch {style} {pageWidthMm} />
    <span class="flex max-w-full flex-col items-center">
      <span class="flex max-w-full items-center gap-1 text-xs font-medium">
        <span class="truncate">{label}</span>
        {#if checked}
          <Icon icon={mdiCheckCircle} size="14" class="shrink-0 text-primary" aria-hidden />
        {/if}
      </span>
      {#if style}
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {$t('book_style_margins', { values: { margin: style.marginMm } })}
        </span>
      {/if}
    </span>
  </label>
{/snippet}

<fieldset {disabled} aria-describedby={descriptionId}>
  <legend class="mb-2 text-sm font-medium">{$t('book_style')}</legend>
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {#each BOOK_STYLE_PRESETS as id (id)}
      {@render option(id, $t(BOOK_STYLE_PRESET_LABEL_KEYS[id].name), styleOf(id))}
    {/each}
  </div>
  {#if userStyles.length > 0}
    <p class="mt-3 mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">{$t('book_style_yours')}</p>
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {#each userStyles as style (style.id)}
        {@render option(style.id, style.name, style.style)}
      {/each}
    </div>
  {/if}
  <p id={descriptionId} class="mt-2 text-xs text-gray-600 dark:text-gray-400" aria-live="polite">
    {description}
  </p>
  {#if onCreateWithAssistant}
    <Button
      class="mt-2"
      size="small"
      variant="ghost"
      shape="round"
      leadingIcon={mdiCreationOutline}
      onclick={onCreateWithAssistant}
    >
      {$t('style_creator_create_with_assistant')}
    </Button>
  {/if}
</fieldset>
