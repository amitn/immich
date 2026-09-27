<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { getAllAlbums, scanOrientation, type AlbumResponseDto } from '@immich/sdk';
  import { DatePicker, Field, FormModal, Select, Text, toastManager } from '@immich/ui';
  import { mdiRotateRight } from '@mdi/js';
  import type { DateTime } from 'luxon';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    onClose: (started?: boolean) => void;
  };

  const { onClose }: Props = $props();

  type Scope = 'all' | 'album' | 'dates';

  let scope = $state<Scope>('all');
  let albums = $state<AlbumResponseDto[]>([]);
  let albumId = $state<string>();
  let takenAfter = $state<DateTime>();
  let takenBefore = $state<DateTime>();

  const scopes = $derived<{ value: Scope; label: string }[]>([
    { value: 'all', label: $t('orientation_scope_all') },
    { value: 'album', label: $t('orientation_scope_album') },
    { value: 'dates', label: $t('orientation_scope_dates') },
  ]);

  const albumOptions = $derived(albums.map((album) => ({ value: album.id, label: album.albumName })));
  const invalid = $derived(
    (scope === 'album' && !albumId) ||
      (scope === 'dates' &&
        ((!takenAfter && !takenBefore) || (!!takenAfter && !!takenBefore && takenAfter > takenBefore))),
  );

  onMount(async () => {
    try {
      albums = await getAllAlbums({});
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_albums'), { notify: false });
    }
  });

  const onSubmit = async () => {
    try {
      await scanOrientation({
        orientationScanDto: {
          ...(scope === 'album' && { albumId }),
          ...(scope === 'dates' && {
            takenAfter: takenAfter?.startOf('day').toISO() ?? undefined,
            takenBefore: takenBefore?.plus({ days: 1 }).startOf('day').toISO() ?? undefined,
          }),
        },
      });
      toastManager.success($t('orientation_check_started'));
      onClose(true);
    } catch (error) {
      handleError(error, $t('errors.unable_to_check_orientation'));
    }
  };
</script>

<FormModal
  title={$t('orientation_check_photos')}
  icon={mdiRotateRight}
  size="small"
  submitText={$t('orientation_check')}
  disabled={invalid}
  onClose={() => onClose()}
  {onSubmit}
>
  <div class="flex flex-col gap-4">
    <Text size="small" color="muted">{$t('orientation_check_description')}</Text>

    <fieldset>
      <legend class="mb-2 text-sm font-medium">{$t('orientation_scope')}</legend>
      <div class="flex flex-wrap gap-2">
        {#each scopes as item (item.value)}
          {@const checked = scope === item.value}
          <label
            class="cursor-pointer rounded-full border-2 px-3 py-1 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
          >
            <input type="radio" name="orientation-scope" class="sr-only" value={item.value} bind:group={scope} />
            {item.label}
          </label>
        {/each}
      </div>
    </fieldset>

    {#if scope === 'album'}
      <Field label={$t('album')}>
        <Select bind:value={albumId} options={albumOptions} placeholder={$t('orientation_choose_album')} />
      </Field>
    {:else if scope === 'dates'}
      <div class="grid grid-cols-2 gap-3">
        <Field label={$t('start_date')}>
          <DatePicker bind:value={takenAfter} />
        </Field>
        <Field label={$t('end_date')}>
          <DatePicker bind:value={takenBefore} />
        </Field>
      </div>
    {/if}
  </div>
</FormModal>
