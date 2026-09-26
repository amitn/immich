<script lang="ts">
  import SettingSelect from './SettingSelect.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import FormatMessage from '$lib/elements/FormatMessage.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { DefaultStyle } from '@immich/sdk';
  import { Alert, Link, Text } from '@immich/ui';
  import { mdiMapMarkerAlertOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());

  const books = $derived(configToEdit.books);

  const styleLabels: Record<DefaultStyle, string> = $derived({
    [DefaultStyle.Sketch]: $t('book_map_style_sketch'),
    [DefaultStyle.Watercolor]: $t('book_map_style_watercolor'),
    [DefaultStyle.Toner]: $t('book_map_style_toner'),
    [DefaultStyle.Terrain]: $t('book_map_style_terrain'),
  });
  const styleOptions = $derived(Object.values(DefaultStyle).map((value) => ({ value, text: styleLabels[value] })));

  const hasKey = $derived(books.maps.stadiaApiKey.trim().length > 0);

  const onBeforeSave = () => {
    books.maps.stadiaApiKey = books.maps.stadiaApiKey.trim();
    return Promise.resolve(true);
  };
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" class="mx-4 mt-4" onsubmit={(event) => event.preventDefault()}>
      <div class="flex flex-col gap-4">
        <Alert color="info" icon={mdiMapMarkerAlertOutline} title={$t('admin.book_maps_privacy_title')}>
          <p class="text-sm">{$t('admin.book_maps_privacy_description')}</p>
        </Alert>

        <SettingInputField
          inputType={SettingInputFieldType.PASSWORD}
          label={$t('admin.book_maps_stadia_api_key')}
          passwordAutocomplete="off"
          {disabled}
          bind:value={books.maps.stadiaApiKey}
          isEdited={books.maps.stadiaApiKey !== config.books.maps.stadiaApiKey}
        >
          {#snippet descriptionSnippet()}
            <p class="text-sm immich-form-label">
              <FormatMessage key="admin.book_maps_stadia_api_key_description">
                {#snippet children({ message })}
                  <Link href="https://stadiamaps.com/" target="_blank" rel="noopener noreferrer">{message}</Link>
                {/snippet}
              </FormatMessage>
            </p>
          {/snippet}
        </SettingInputField>

        <SettingSelect
          name="book-map-default-style"
          label={$t('admin.book_maps_default_style')}
          desc={$t('admin.book_maps_default_style_description')}
          options={styleOptions}
          {disabled}
          bind:value={books.maps.defaultStyle}
          isEdited={books.maps.defaultStyle !== config.books.maps.defaultStyle}
        />

        {#if !hasKey && books.maps.defaultStyle !== DefaultStyle.Sketch}
          <Text size="small" class="text-orange-700 dark:text-orange-300">{$t('admin.book_maps_style_needs_key')}</Text>
        {/if}
      </div>
    </form>
  </div>

  <SettingButtonsRow bind:configToEdit keys={['books']} {disabled} {onBeforeSave} />
</div>
