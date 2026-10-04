<script lang="ts">
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  // Gallery fork (#6): the notification of the day (a memory or a waiting draft) and the weekly email digest
  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" class="mx-4 mt-4" onsubmit={(event) => event.preventDefault()}>
      <div class="flex flex-col gap-4">
        <SettingSwitch
          title={$t('admin.memory_notifications_enabled')}
          subtitle={$t('admin.memory_notifications_enabled_description')}
          {disabled}
          bind:checked={configToEdit.memoryNotifications.enabled}
          isEdited={configToEdit.memoryNotifications.enabled !== config.memoryNotifications.enabled}
        />
        <SettingSwitch
          title={$t('admin.memory_notifications_digest')}
          subtitle={$t('admin.memory_notifications_digest_description')}
          {disabled}
          bind:checked={configToEdit.memoryNotifications.digest}
          isEdited={configToEdit.memoryNotifications.digest !== config.memoryNotifications.digest}
        />
      </div>
    </form>
  </div>

  <SettingButtonsRow bind:configToEdit keys={['memoryNotifications']} {disabled} />
</div>
