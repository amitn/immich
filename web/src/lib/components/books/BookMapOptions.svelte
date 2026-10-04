<script lang="ts">
  import BookMapStylePicker from '$lib/components/books/BookMapStylePicker.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { toBookMapStyle, toBookMapStyleOption, type BookMapChoice } from '$lib/utils/book-export';
  import { BookMapLookOption, BookMapStyle, BookMapStyleOption, type BookMapLook } from '@immich/sdk';
  import { Field, Switch } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    includeMaps: boolean;
    mapStyle: BookMapStyleOption;
    /** the look of styled maps */
    mapLook?: BookMapLookOption;
    illustratedMaps: boolean;
    /** what the thumbnails of the styles show: the first map of a book, or the photos of an album */
    preview?: { bookId?: string; albumId?: string; stylePreset?: string };
    disabled?: boolean;
  };

  let {
    includeMaps = $bindable(),
    mapStyle = $bindable(),
    mapLook = $bindable(BookMapLookOption.Auto),
    illustratedMaps = $bindable(),
    preview,
    disabled = false,
  }: Props = $props();

  const canIllustrate = $derived(featureFlagsManager.value.artisticStyles);

  // auto is the server's default, which is styled unless the administrator chose another
  const choice = $derived<BookMapChoice>({
    style: toBookMapStyle(mapStyle) ?? BookMapStyle.Styled,
    ...(mapLook !== BookMapLookOption.Auto && { look: mapLook as unknown as BookMapLook }),
  });

  const onChange = ({ style, look }: BookMapChoice) => {
    mapStyle = toBookMapStyleOption(style);
    mapLook = (look as unknown as BookMapLookOption | undefined) ?? BookMapLookOption.Auto;
  };

  $effect(() => {
    if (!canIllustrate && illustratedMaps) {
      illustratedMaps = false;
    }
  });
</script>

<div class="flex flex-col gap-4">
  <Field label={$t('book_include_maps')} description={$t('book_include_maps_description')} {disabled}>
    <Switch bind:checked={includeMaps} />
  </Field>

  {#if includeMaps}
    <div class="flex flex-col gap-4 border-s-2 border-gray-200 ps-4 dark:border-gray-700">
      <BookMapStylePicker value={choice} {preview} {disabled} {onChange} />

      <Field
        label={$t('book_illustrate_maps')}
        description={canIllustrate ? $t('book_illustrate_maps_description') : $t('book_illustrate_maps_unavailable')}
        disabled={disabled || !canIllustrate}
      >
        <Switch bind:checked={illustratedMaps} />
      </Field>
    </div>
  {/if}
</div>
