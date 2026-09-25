<script lang="ts">
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import type { BookMapStyleOption } from '$lib/types/assistant';
  import { BOOK_MAP_STYLE_OPTIONS, isTileMapStyle } from '$lib/utils/book-export';
  import { Field, Select, Switch } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    includeMaps: boolean;
    mapStyle: BookMapStyleOption;
    illustratedMaps: boolean;
    disabled?: boolean;
  };

  let {
    includeMaps = $bindable(),
    mapStyle = $bindable(),
    illustratedMaps = $bindable(),
    disabled = false,
  }: Props = $props();

  const canIllustrate = $derived(featureFlagsManager.value.artisticStyles);

  const labels: Record<BookMapStyleOption, string> = $derived({
    auto: $t('book_map_style_auto'),
    sketch: $t('book_map_style_sketch'),
    watercolor: $t('book_map_style_watercolor'),
    toner: $t('book_map_style_toner'),
    terrain: $t('book_map_style_terrain'),
  });

  const options = $derived(BOOK_MAP_STYLE_OPTIONS.map((value) => ({ value, label: labels[value] })));

  const styleDescription = $derived.by(() => {
    if (mapStyle === 'auto') {
      return $t('book_map_style_auto_description');
    }
    if (isTileMapStyle(mapStyle)) {
      return $t('book_map_style_needs_key');
    }
    return $t('book_map_style_sketch_description');
  });

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
      <Field label={$t('book_map_style')} description={styleDescription} {disabled}>
        <Select bind:value={mapStyle} {options} />
      </Field>

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
