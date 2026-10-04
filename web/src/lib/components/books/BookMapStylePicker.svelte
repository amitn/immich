<script lang="ts">
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { getBookMapPreviewUrl } from '$lib/utils';
  import {
    BOOK_MAP_PICKER_OPTIONS,
    getBookMapChoiceId,
    type BookMapChoice,
    type BookMapPickerOption,
  } from '$lib/utils/book-export';
  import { generateId } from '$lib/utils/generate-id';
  import { BookMapLook, BookMapStyle } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCheckCircle, mdiMapOutline, mdiPaletteOutline } from '@mdi/js';
  import type { Translations } from 'svelte-i18n';
  import { t } from 'svelte-i18n';

  type Props = {
    value: BookMapChoice;
    /** what the thumbnails show: a page, the first map of a book, or the photos of an album; none: no thumbnails */
    preview?: { bookId?: string; pageId?: string; albumId?: string; stylePreset?: string };
    /** the "Illustrated by AI" option, e.g. for a page; `active` while the map is (being) illustrated */
    illustrated?: { active: boolean; onSelect: () => void };
    disabled?: boolean;
    onChange?: (choice: BookMapChoice) => void;
  };

  let { value = $bindable(), preview, illustrated, disabled = false, onChange }: Props = $props();

  const name = `book-map-style-${generateId()}`;
  const selectedId = $derived(illustrated?.active ? 'illustrated' : getBookMapChoiceId(value));
  const hasStadiaKey = $derived(featureFlagsManager.value.bookStadiaMaps);
  const mapEnabled = $derived(featureFlagsManager.value.map);
  const canIllustrate = $derived(featureFlagsManager.value.artisticStyles);

  const lookKeys: Record<BookMapLook, Translations> = {
    [BookMapLook.Wash]: 'book_map_look_wash',
    [BookMapLook.Engraved]: 'book_map_look_engraved',
    [BookMapLook.Minimal]: 'book_map_look_minimal',
    [BookMapLook.Vintage]: 'book_map_look_vintage',
  };
  const styleKeys: Record<BookMapStyle, Translations> = {
    [BookMapStyle.Styled]: 'book_map_style_styled',
    [BookMapStyle.Sketch]: 'book_map_style_sketch',
    [BookMapStyle.Watercolor]: 'book_map_style_watercolor',
    [BookMapStyle.Toner]: 'book_map_style_toner',
    [BookMapStyle.Terrain]: 'book_map_style_terrain',
  };

  const labelOf = (option: BookMapPickerOption) =>
    option.kind === 'styled'
      ? $t(option.look ? lookKeys[option.look] : 'book_map_look_auto')
      : $t(styleKeys[option.style]);

  const isDisabled = (option: BookMapPickerOption) => option.kind === 'stadia' && !hasStadiaKey;

  const styledOptions = BOOK_MAP_PICKER_OPTIONS.filter((option) => option.kind === 'styled');
  const otherOptions = BOOK_MAP_PICKER_OPTIONS.filter((option) => option.kind !== 'styled');

  let failed = $state<Record<string, boolean>>({});

  const select = (option: BookMapPickerOption) => {
    if (disabled || isDisabled(option)) {
      return;
    }
    value = { style: option.style, ...(option.look && { look: option.look }) };
    onChange?.(value);
  };

  const description = $derived.by(() => {
    if (selectedId === 'illustrated') {
      return $t('book_map_style_illustrated_description');
    }
    if (value.style === BookMapStyle.Styled) {
      return mapEnabled ? $t('book_map_style_styled_description') : $t('book_map_style_map_disabled');
    }
    if (value.style === BookMapStyle.Sketch) {
      return $t('book_map_style_sketch_description');
    }
    return hasStadiaKey ? $t('book_map_style_stadia_description') : $t('book_map_style_needs_key');
  });
</script>

{#snippet card(id: string, label: string, thumbnail: string | undefined, optionDisabled: boolean, onSelect: () => void)}
  {@const checked = selectedId === id}
  <label
    class="flex flex-col gap-1 rounded-xl border-2 p-1.5 text-center transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
      ? 'border-primary bg-primary/5'
      : 'border-gray-200 dark:border-gray-700'} {optionDisabled || disabled
      ? 'cursor-not-allowed opacity-50'
      : 'cursor-pointer hover:border-gray-300 dark:hover:border-gray-600'}"
    data-testid="book-map-style-{id}"
  >
    <input
      type="radio"
      {name}
      class="sr-only"
      value={id}
      {checked}
      disabled={optionDisabled || disabled}
      onchange={onSelect}
    />
    <span
      class="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800"
    >
      {#if thumbnail && !failed[id]}
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          class="size-full object-cover"
          onerror={() => (failed = { ...failed, [id]: true })}
        />
      {:else}
        <Icon
          icon={id === 'illustrated' ? mdiPaletteOutline : mdiMapOutline}
          size="28"
          class="text-gray-400"
          aria-hidden
        />
      {/if}
    </span>
    <span class="flex items-center justify-center gap-1 text-xs font-medium">
      <span class="truncate">{label}</span>
      {#if checked}
        <Icon icon={mdiCheckCircle} size="14" class="shrink-0 text-primary" aria-hidden />
      {/if}
    </span>
  </label>
{/snippet}

{#snippet option(option: BookMapPickerOption)}
  {@render card(
    option.id,
    labelOf(option),
    preview && !isDisabled(option)
      ? getBookMapPreviewUrl({ ...preview, style: option.style, look: option.look })
      : undefined,
    isDisabled(option),
    () => select(option),
  )}
{/snippet}

<fieldset {disabled} aria-describedby="{name}-description" class="flex flex-col gap-2">
  <legend class="mb-1 text-sm font-medium">{$t('book_map_style')}</legend>

  <p class="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
    {$t('book_map_style_styled')}
    <span class="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{$t('book_map_style_recommended')}</span>
  </p>
  <div class="grid grid-cols-3 gap-2 sm:grid-cols-5">
    {#each styledOptions as item (item.id)}
      {@render option(item)}
    {/each}
  </div>

  <p class="mt-1 text-xs font-medium text-gray-600 dark:text-gray-400">{$t('book_map_style_other')}</p>
  <div class="grid grid-cols-3 gap-2 sm:grid-cols-5">
    {#each otherOptions as item (item.id)}
      {@render option(item)}
    {/each}
    {#if illustrated}
      {@render card('illustrated', $t('book_map_style_illustrated'), undefined, !canIllustrate, () => {
        if (canIllustrate && !disabled) {
          illustrated.onSelect();
        }
      })}
    {/if}
  </div>

  <p id="{name}-description" class="text-xs text-gray-600 dark:text-gray-400" aria-live="polite">
    {description}
    {#if !hasStadiaKey}
      <span class="block">{$t('book_map_style_stadia_unavailable')}</span>
    {/if}
    {#if illustrated && !canIllustrate}
      <span class="block">{$t('book_illustrate_maps_unavailable')}</span>
    {/if}
  </p>
</fieldset>
