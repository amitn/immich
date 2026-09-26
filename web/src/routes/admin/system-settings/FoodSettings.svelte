<script lang="ts">
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { Alert, toastManager } from '@immich/ui';
  import { mdiMapMarkerAlertOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());

  const openStreetMap = $derived(configToEdit.food.openStreetMap);

  const isHttpUrl = (value: string) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  };

  const onBeforeSave = () => {
    openStreetMap.overpassUrl = openStreetMap.overpassUrl.trim();
    if (isHttpUrl(openStreetMap.overpassUrl)) {
      return Promise.resolve(true);
    }
    toastManager.warning($t('admin.food_overpass_url_invalid'));
    return Promise.resolve(false);
  };
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" class="mx-4 mt-4" onsubmit={(event) => event.preventDefault()}>
      <div class="flex flex-col gap-4">
        <Alert color="info" icon={mdiMapMarkerAlertOutline} title={$t('admin.food_open_street_map_privacy_title')}>
          <p class="text-sm">{$t('admin.food_open_street_map_privacy_description')}</p>
        </Alert>

        <SettingSwitch
          title={$t('admin.food_open_street_map_enabled')}
          subtitle={$t('admin.food_open_street_map_enabled_description')}
          {disabled}
          bind:checked={openStreetMap.enabled}
          isEdited={openStreetMap.enabled !== config.food.openStreetMap.enabled}
        />

        <SettingInputField
          inputType={SettingInputFieldType.TEXT}
          label={$t('admin.food_overpass_url')}
          description={$t('admin.food_overpass_url_description')}
          required
          disabled={disabled || !openStreetMap.enabled}
          bind:value={openStreetMap.overpassUrl}
          isEdited={openStreetMap.overpassUrl !== config.food.openStreetMap.overpassUrl}
        />
      </div>
    </form>
  </div>

  <SettingButtonsRow bind:configToEdit keys={['food']} {disabled} {onBeforeSave} />
</div>
