<script lang="ts">
  import SettingSelect from './SettingSelect.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import FormatMessage from '$lib/elements/FormatMessage.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import type { BookMapStyle, SystemConfigBooksDto } from '$lib/types/assistant';
  import { BOOK_MAP_STYLES } from '$lib/utils/book-export';
  import type { AdminConfigDto } from '@immich/sdk';
  import { Alert, Link, Text } from '@immich/ui';
  import { mdiInformationOutline, mdiMapMarkerAlertOutline } from '@mdi/js';
  import { cloneDeep } from 'lodash-es';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  // TODO: remove once `books` is part of AdminConfigDto in @immich/sdk
  type BooksAdminConfig = AdminConfigDto & { books: SystemConfigBooksDto };
  const BOOKS_KEYS = ['books'] as unknown as Array<keyof AdminConfigDto>;
  const DEFAULT_BOOKS: SystemConfigBooksDto = { maps: { stadiaApiKey: '', defaultStyle: 'sketch' } };

  const readBooks = (config: AdminConfigDto): SystemConfigBooksDto | undefined =>
    (config as Partial<BooksAdminConfig>).books;

  const disabled = $derived(featureFlagsManager.value.configFile);
  const isSupported = $derived(readBooks(systemConfigManager.value) !== undefined);
  const saved = $derived(readBooks(systemConfigManager.value) ?? DEFAULT_BOOKS);

  let configToEdit = $state(systemConfigManager.cloneValue());
  // edited while the server does not return a `books` section yet
  const fallback = $state(cloneDeep(DEFAULT_BOOKS));
  const books = $derived(readBooks(configToEdit) ?? fallback);

  const styleLabels: Record<BookMapStyle, string> = $derived({
    sketch: $t('book_map_style_sketch'),
    watercolor: $t('book_map_style_watercolor'),
    toner: $t('book_map_style_toner'),
    terrain: $t('book_map_style_terrain'),
  });
  const styleOptions = $derived(BOOK_MAP_STYLES.map((value) => ({ value, text: styleLabels[value] })));

  const hasKey = $derived(books.maps.stadiaApiKey.trim().length > 0);

  const onBeforeSave = () => {
    books.maps.stadiaApiKey = books.maps.stadiaApiKey.trim();
    if (!readBooks(configToEdit)) {
      (configToEdit as BooksAdminConfig).books = $state.snapshot(fallback);
    }
    return Promise.resolve(true);
  };
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" class="mx-4 mt-4" onsubmit={(event) => event.preventDefault()}>
      <div class="flex flex-col gap-4">
        {#if !isSupported}
          <Alert color="warning" icon={mdiInformationOutline} size="small">
            <p class="text-sm">{$t('admin.book_settings_unsupported')}</p>
          </Alert>
        {/if}

        <Alert color="info" icon={mdiMapMarkerAlertOutline} title={$t('admin.book_maps_privacy_title')}>
          <p class="text-sm">{$t('admin.book_maps_privacy_description')}</p>
        </Alert>

        <SettingInputField
          inputType={SettingInputFieldType.PASSWORD}
          label={$t('admin.book_maps_stadia_api_key')}
          passwordAutocomplete="off"
          {disabled}
          bind:value={books.maps.stadiaApiKey}
          isEdited={books.maps.stadiaApiKey !== saved.maps.stadiaApiKey}
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
          isEdited={books.maps.defaultStyle !== saved.maps.defaultStyle}
        />

        {#if !hasKey && books.maps.defaultStyle !== 'sketch'}
          <Text size="small" class="text-orange-700 dark:text-orange-300">{$t('admin.book_maps_style_needs_key')}</Text>
        {/if}
      </div>
    </form>
  </div>

  <SettingButtonsRow bind:configToEdit keys={BOOKS_KEYS} {disabled} {onBeforeSave} />
</div>
