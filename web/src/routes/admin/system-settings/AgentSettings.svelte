<script lang="ts">
  import SettingSelect from './SettingSelect.svelte';
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { formatArgs, parseArgs, parseNameList, validateAgentConfig } from '$lib/utils/agent-config';
  import type { AdminConfigAgentProfileDto } from '@immich/sdk';
  import { Alert, Button, Field, HelperText, IconButton, Input, PasswordInput, Text, toastManager } from '@immich/ui';
  import { mdiPlus, mdiShieldAlertOutline, mdiTrashCanOutline } from '@mdi/js';
  import { isEqual } from 'lodash-es';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());

  const agent = $derived(configToEdit.agent);
  const profileNames = $derived(agent.profiles.map(({ name }) => name.trim()).filter(Boolean));
  const chatProfileOptions = $derived(profileNames.map((name) => ({ value: name, text: name })));
  const artProfileOptions = $derived([{ value: '', text: $t('disabled') }, ...chatProfileOptions]);

  const renameProfile = (profile: AdminConfigAgentProfileDto, name: string) => {
    const previous = profile.name;
    profile.name = name;
    if (previous && agent.chatProfile === previous) {
      agent.chatProfile = name;
    }
    if (previous && agent.artProfile === previous) {
      agent.artProfile = name;
    }
  };

  const addProfile = () => {
    agent.profiles.push({ name: '', command: '', args: [], env: [], passEnv: [] });
  };

  const removeProfile = (index: number) => {
    agent.profiles.splice(index, 1);
  };

  const onBeforeSave = () => {
    const issues = validateAgentConfig(agent);
    if (issues.length === 0) {
      return Promise.resolve(true);
    }
    const [{ key, ...values }] = issues;
    toastManager.warning($t(key, { values }));
    return Promise.resolve(false);
  };
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" class="mx-4 mt-4" onsubmit={(event) => event.preventDefault()}>
      <div class="flex flex-col gap-4">
        <Alert color="warning" icon={mdiShieldAlertOutline} title={$t('admin.agent_security_title')}>
          <p class="text-sm">{$t('admin.agent_security_description')}</p>
        </Alert>

        <SettingSwitch
          title={$t('admin.agent_enabled')}
          subtitle={$t('admin.agent_enabled_description')}
          {disabled}
          bind:checked={configToEdit.agent.enabled}
          isEdited={configToEdit.agent.enabled !== config.agent.enabled}
        />

        <hr />

        <SettingSelect
          name="agent-chat-profile"
          label={$t('admin.agent_chat_profile')}
          desc={$t('admin.agent_chat_profile_description')}
          options={chatProfileOptions}
          disabled={disabled || !configToEdit.agent.enabled}
          bind:value={configToEdit.agent.chatProfile}
          isEdited={configToEdit.agent.chatProfile !== config.agent.chatProfile}
        />

        <SettingSelect
          name="agent-art-profile"
          label={$t('admin.agent_art_profile')}
          desc={$t('admin.agent_art_profile_description')}
          options={artProfileOptions}
          disabled={disabled || !configToEdit.agent.enabled}
          bind:value={configToEdit.agent.artProfile}
          isEdited={configToEdit.agent.artProfile !== config.agent.artProfile}
        />

        <SettingInputField
          inputType={SettingInputFieldType.NUMBER}
          label={$t('admin.agent_max_concurrent_sessions')}
          description={$t('admin.agent_max_concurrent_sessions_description')}
          min={1}
          required
          disabled={disabled || !configToEdit.agent.enabled}
          bind:value={configToEdit.agent.maxConcurrentSessions}
          isEdited={configToEdit.agent.maxConcurrentSessions !== config.agent.maxConcurrentSessions}
        />

        <SettingInputField
          inputType={SettingInputFieldType.NUMBER}
          label={$t('admin.agent_idle_timeout')}
          description={$t('admin.agent_idle_timeout_description')}
          min={1}
          required
          disabled={disabled || !configToEdit.agent.enabled}
          bind:value={configToEdit.agent.idleTimeoutMinutes}
          isEdited={configToEdit.agent.idleTimeoutMinutes !== config.agent.idleTimeoutMinutes}
        />

        <!-- inputs and selects carry their own bottom margin, so give the switch the same spacing -->
        <div class="mb-4">
          <SettingSwitch
            title={$t('admin.agent_auto_approve_writes')}
            subtitle={$t('admin.agent_auto_approve_writes_description')}
            disabled={disabled || !configToEdit.agent.enabled}
            bind:checked={configToEdit.agent.autoApproveWrites}
            isEdited={configToEdit.agent.autoApproveWrites !== config.agent.autoApproveWrites}
          />
        </div>

        <SettingInputField
          inputType={SettingInputFieldType.TEXT}
          label={$t('admin.agent_mcp_url')}
          description={$t('admin.agent_mcp_url_description')}
          disabled={disabled || !configToEdit.agent.enabled}
          bind:value={configToEdit.agent.mcpUrl}
          isEdited={configToEdit.agent.mcpUrl !== config.agent.mcpUrl}
        />
      </div>

      <SettingAccordion
        key="agent-profiles"
        title={$t('admin.agent_profiles')}
        subtitle={$t('admin.agent_profiles_description')}
        isOpen
      >
        <div class="ms-4 mt-4 flex flex-col gap-4">
          {#if !isEqual(configToEdit.agent.profiles, config.agent.profiles)}
            <Text size="tiny" class="text-orange-700 dark:text-orange-300">{$t('unsaved_change')}</Text>
          {/if}

          {#each configToEdit.agent.profiles as profile, index (index)}
            <div
              role="group"
              class="flex flex-col gap-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-700"
              aria-label={$t('admin.agent_profile_named', { values: { name: profile.name || index + 1 } })}
            >
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-medium">
                  {profile.name || $t('admin.agent_profile_number', { values: { index: index + 1 } })}
                  {#if profile.name && profile.name === configToEdit.agent.chatProfile}
                    <span class="ms-2 text-xs font-normal text-primary">{$t('admin.agent_chat_profile')}</span>
                  {/if}
                  {#if profile.name && profile.name === configToEdit.agent.artProfile}
                    <span class="ms-2 text-xs font-normal text-primary">{$t('admin.agent_art_profile')}</span>
                  {/if}
                </p>
                <IconButton
                  icon={mdiTrashCanOutline}
                  color="danger"
                  variant="ghost"
                  shape="round"
                  size="small"
                  {disabled}
                  aria-label={$t('admin.agent_remove_profile', { values: { name: profile.name || index + 1 } })}
                  onclick={() => removeProfile(index)}
                />
              </div>

              <div class="grid gap-3 md:grid-cols-2">
                <Field label={$t('name')} required {disabled}>
                  <Input
                    value={profile.name}
                    placeholder="claude"
                    oninput={(event) => renameProfile(profile, event.currentTarget.value)}
                  />
                </Field>
                <!-- help text goes below the inputs so the Name and Command inputs line up -->
                <Field label={$t('admin.agent_command')} required {disabled}>
                  <Input
                    bind:value={profile.command}
                    placeholder="claude-agent-acp"
                    class="font-mono"
                    aria-describedby="agent-command-description-{index}"
                  />
                  <HelperText>
                    <span id="agent-command-description-{index}">{$t('admin.agent_command_description')}</span>
                  </HelperText>
                </Field>
              </div>

              <Field label={$t('admin.agent_args')} {disabled}>
                <Input
                  value={formatArgs(profile.args)}
                  placeholder="--model sonnet"
                  class="font-mono"
                  aria-describedby="agent-args-description-{index}"
                  onchange={(event) => (profile.args = parseArgs(event.currentTarget.value))}
                />
                <HelperText>
                  <span id="agent-args-description-{index}">{$t('admin.agent_args_description')}</span>
                </HelperText>
              </Field>

              <Field label={$t('admin.agent_pass_env')} {disabled}>
                <Input
                  value={profile.passEnv.join(' ')}
                  placeholder="ANTHROPIC_API_KEY"
                  class="font-mono"
                  aria-describedby="agent-pass-env-description-{index}"
                  onchange={(event) => (profile.passEnv = parseNameList(event.currentTarget.value))}
                />
                <HelperText>
                  <span id="agent-pass-env-description-{index}">{$t('admin.agent_pass_env_description')}</span>
                </HelperText>
              </Field>

              <div class="flex flex-col gap-2">
                <Text size="small" fontWeight="medium">{$t('admin.agent_env')}</Text>
                <Text size="tiny" color="muted">{$t('admin.agent_env_description')}</Text>
                {#each profile.env as variable, envIndex (envIndex)}
                  <div class="flex items-center gap-2">
                    <div class="flex-1">
                      <Input
                        bind:value={variable.name}
                        placeholder="NAME"
                        class="font-mono"
                        aria-label={$t('admin.agent_env_name', { values: { index: envIndex + 1 } })}
                        {disabled}
                      />
                    </div>
                    <div class="flex-1">
                      <PasswordInput
                        bind:value={variable.value}
                        placeholder={$t('value')}
                        autocomplete="off"
                        aria-label={$t('admin.agent_env_value', { values: { index: envIndex + 1 } })}
                        {disabled}
                      />
                    </div>
                    <IconButton
                      icon={mdiTrashCanOutline}
                      color="danger"
                      variant="ghost"
                      shape="round"
                      size="small"
                      {disabled}
                      aria-label={$t('admin.agent_remove_env', { values: { name: variable.name || envIndex + 1 } })}
                      onclick={() => profile.env.splice(envIndex, 1)}
                    />
                  </div>
                {/each}
                <div>
                  <Button
                    size="tiny"
                    shape="round"
                    variant="ghost"
                    leadingIcon={mdiPlus}
                    {disabled}
                    onclick={() => void profile.env.push({ name: '', value: '' })}
                  >
                    {$t('admin.agent_add_env')}
                  </Button>
                </div>
              </div>
            </div>
          {/each}

          <div class="flex justify-end">
            <Button size="small" shape="round" leadingIcon={mdiPlus} {disabled} onclick={addProfile}>
              {$t('admin.agent_add_profile')}
            </Button>
          </div>
        </div>
      </SettingAccordion>
    </form>
  </div>

  <SettingButtonsRow bind:configToEdit keys={['agent']} {disabled} {onBeforeSave} />
</div>
