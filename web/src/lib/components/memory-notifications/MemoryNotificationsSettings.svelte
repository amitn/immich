<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { handleError } from '$lib/utils/handle-error';
  import { updateMyPreferences } from '@immich/sdk';
  import { Button, Field, Select, Switch, Text, toastManager } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  /**
   * Gallery fork (#6): which notifications the user gets — a memory of the day, a suggested book waiting for them,
   * new journal visits, ready creations — the time of day of the notification of the day, and a weekly email digest.
   * The time of day is in the time zone of the browser that saves it.
   */

  const preferences = authManager.preferences.memoryNotifications;
  let memories = $state(preferences?.memories ?? true);
  let drafts = $state(preferences?.drafts ?? true);
  let creations = $state(preferences?.creations ?? true);
  let journals = $state(authManager.preferences.collectionNotifications?.enabled ?? true);
  let hour = $state(String(preferences?.hour ?? 9));
  let digest = $state(preferences?.digest ?? false);
  let digestDay = $state(String(preferences?.digestDay ?? 7));

  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const emailAvailable = $derived(featureFlagsManager.valueOrUndefined?.email ?? false);
  const language = $derived($locale === 'default' ? undefined : $locale);

  // the hours and the days of the week in the viewer's language, e.g. "9 AM" / "09:00" and "Sunday"
  const hours = $derived(
    Array.from({ length: 24 }, (_, value) => ({
      value: String(value),
      label: new Intl.DateTimeFormat(language, { hour: 'numeric', timeZone: 'UTC' }).format(
        Date.UTC(2026, 0, 1, value),
      ),
    })),
  );
  // 5 January 2026 was a Monday: ISO day 1
  const days = $derived(
    Array.from({ length: 7 }, (_, index) => ({
      value: String(index + 1),
      label: new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' }).format(
        Date.UTC(2026, 0, 5 + index),
      ),
    })),
  );

  const handleSave = async () => {
    try {
      const response = await updateMyPreferences({
        userPreferencesUpdateDto: {
          memoryNotifications: {
            memories,
            drafts,
            creations,
            hour: Number(hour),
            timeZone,
            digest: digest && emailAvailable,
            digestDay: Number(digestDay),
          },
          collectionNotifications: { enabled: journals },
        },
      });
      authManager.setPreferences(response);
      toastManager.primary($t('saved_settings'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_settings'));
    }
  };
</script>

<section class="my-4">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" onsubmit={(event) => event.preventDefault()}>
      <div class="flex flex-col gap-6 sm:ms-8">
        <Field
          label={$t('memory_notifications_memories')}
          description={$t('memory_notifications_memories_description')}
        >
          <Switch bind:checked={memories} />
        </Field>

        <Field label={$t('memory_notifications_drafts')} description={$t('memory_notifications_drafts_description')}>
          <Switch bind:checked={drafts} />
        </Field>

        <Field
          label={$t('journal_notifications_setting')}
          description={$t('journal_notifications_setting_description')}
        >
          <Switch bind:checked={journals} />
        </Field>

        <Field
          label={$t('memory_notifications_creations')}
          description={$t('memory_notifications_creations_description')}
        >
          <Switch bind:checked={creations} />
        </Field>

        <Field
          label={$t('memory_notifications_hour')}
          description={$t('memory_notifications_hour_description', { values: { timeZone } })}
        >
          <Select options={hours} bind:value={hour} />
        </Field>

        <Field
          label={$t('memory_notifications_digest')}
          description={emailAvailable
            ? $t('memory_notifications_digest_description')
            : $t('memory_notifications_digest_unavailable')}
          disabled={!emailAvailable}
        >
          <Switch bind:checked={digest} />
        </Field>

        {#if digest && emailAvailable}
          <Field label={$t('memory_notifications_digest_day')}>
            <Select options={days} bind:value={digestDay} />
          </Field>
        {/if}

        <Text size="small" color="muted">{$t('memory_notifications_limit')}</Text>
      </div>

      <div class="mt-4 flex justify-end">
        <Button shape="round" type="submit" size="small" onclick={() => handleSave()}>{$t('save')}</Button>
      </div>
    </form>
  </div>
</section>
