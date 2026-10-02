<script lang="ts">
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());

  const notifications = $derived(configToEdit.collections.notifications);
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" class="mx-4 mt-4" onsubmit={(event) => event.preventDefault()}>
      <div class="flex flex-col gap-4">
        <SettingSwitch
          title={$t('admin.journal_notifications_enabled')}
          subtitle={$t('admin.journal_notifications_enabled_description')}
          {disabled}
          bind:checked={notifications.enabled}
          isEdited={notifications.enabled !== config.collections.notifications.enabled}
        />
        {#if notifications.enabled}
          <div class="ms-4 flex flex-col gap-4">
            <SettingInputField
              inputType={SettingInputFieldType.NUMBER}
              label={$t('admin.journal_notifications_max_per_run')}
              description={$t('admin.journal_notifications_max_per_run_description')}
              min={1}
              max={20}
              {disabled}
              bind:value={notifications.maxPerRun}
              isEdited={notifications.maxPerRun !== config.collections.notifications.maxPerRun}
            />
            <SettingInputField
              inputType={SettingInputFieldType.NUMBER}
              label={$t('admin.journal_notifications_window_days')}
              description={$t('admin.journal_notifications_window_days_description')}
              min={1}
              max={90}
              {disabled}
              bind:value={notifications.windowDays}
              isEdited={notifications.windowDays !== config.collections.notifications.windowDays}
            />
          </div>
        {/if}
      </div>
    </form>
  </div>

  <SettingButtonsRow bind:configToEdit keys={['collections']} {disabled} />
</div>
