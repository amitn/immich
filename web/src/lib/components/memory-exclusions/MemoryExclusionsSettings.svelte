<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import AlbumPickerModal from '$lib/modals/AlbumPickerModal.svelte';
  import PeoplePickerModal from '$lib/modals/PeoplePickerModal.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { handleError } from '$lib/utils/handle-error';
  import { getExclusionName } from '$lib/utils/memory-exclusions';
  import {
    createMemoryExclusion,
    deleteMemoryExclusion,
    getMemoryExclusions,
    MemoryExclusionType,
    updateMyPreferences,
    type MemoryExclusionResponseDto,
  } from '@immich/sdk';
  import { Button, DatePicker, Field, IconButton, modalManager, Switch, Text } from '@immich/ui';
  import { mdiAccountMultiplePlusOutline, mdiCalendarPlus, mdiClose, mdiImageAlbum } from '@mdi/js';
  import type { DateTime } from 'luxon';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  /**
   * Gallery fork (#12): what the user keeps out of their memories (people and pets, days, albums, and screenshots,
   * receipts and documents) and whether they get a year in review. Every change is saved right away.
   */

  let exclusions = $state<MemoryExclusionResponseDto[]>([]);
  let documents = $state(authManager.preferences.memoryExclusions?.documents ?? false);
  let recaps = $state(authManager.preferences.memories?.types?.year_recap ?? true);
  let loaded = $state(false);
  let busy = $state(false);
  let startDate = $state<DateTime | undefined>();
  let endDate = $state<DateTime | undefined>();

  const recapsAvailable = $derived((serverConfigManager.value.availableMemoryTypes ?? []).includes('year_recap'));
  const people = $derived(exclusions.filter(({ type }) => type === MemoryExclusionType.Person));
  const albums = $derived(exclusions.filter(({ type }) => type === MemoryExclusionType.Album));
  const days = $derived(exclusions.filter(({ type }) => type === MemoryExclusionType.DateRange));
  const datesInvalid = $derived(!!startDate && !!endDate && startDate > endDate);

  onMount(async () => {
    try {
      const response = await getMemoryExclusions();
      exclusions = response.exclusions;
      documents = response.documents;
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_memory_exclusions'));
    } finally {
      loaded = true;
    }
  });

  const change = async (action: () => Promise<unknown>) => {
    busy = true;
    try {
      await action();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_memory_exclusions'));
    } finally {
      busy = false;
    }
  };

  const add = (dtos: Parameters<typeof createMemoryExclusion>[0]['memoryExclusionCreateDto'][]) =>
    change(async () => {
      for (const memoryExclusionCreateDto of dtos) {
        const created = await createMemoryExclusion({ memoryExclusionCreateDto });
        exclusions = [...exclusions.filter(({ id }) => id !== created.id), created];
      }
    });

  const addPeople = async () => {
    const picked = await modalManager.show(PeoplePickerModal, {
      multiple: true,
      excludedIds: people.flatMap(({ person }) => (person ? [person.id] : [])),
    });
    if (picked && picked.length > 0) {
      await add(picked.map(({ id }) => ({ type: MemoryExclusionType.Person, personId: id })));
    }
  };

  const addAlbum = async () => {
    const picked = await modalManager.show(AlbumPickerModal, {});
    if (picked && picked.length > 0) {
      await add(picked.map(({ id }) => ({ type: MemoryExclusionType.Album, albumId: id })));
    }
  };

  const addDays = async () => {
    if (!startDate || datesInvalid) {
      return;
    }
    const from = startDate.toISODate()!;
    const to = (endDate ?? startDate).toISODate()!;
    await add([{ type: MemoryExclusionType.DateRange, startDate: from, endDate: to }]);
    startDate = endDate = undefined;
  };

  const remove = (exclusion: MemoryExclusionResponseDto) =>
    change(async () => {
      await deleteMemoryExclusion({ id: exclusion.id });
      exclusions = exclusions.filter(({ id }) => id !== exclusion.id);
    });

  const setDocuments = (value: boolean) =>
    change(async () => {
      const preferences = await updateMyPreferences({
        userPreferencesUpdateDto: { memoryExclusions: { documents: value } },
      });
      authManager.setPreferences(preferences);
    });

  const setRecaps = (value: boolean) =>
    change(async () => {
      const preferences = await updateMyPreferences({
        userPreferencesUpdateDto: { memories: { types: { year_recap: value } } },
      });
      authManager.setPreferences(preferences);
    });
</script>

{#snippet chips(items: MemoryExclusionResponseDto[])}
  {#if items.length === 0}
    <Text size="small" color="muted">{$t('memory_exclusions_none')}</Text>
  {:else}
    <ul class="flex flex-wrap gap-2">
      {#each items as exclusion (exclusion.id)}
        {@const name = getExclusionName(exclusion, $locale)}
        <li
          class="flex items-center gap-1 rounded-full bg-subtle py-1 ps-3 pe-1 text-sm"
          data-testid="memory-exclusion"
        >
          <span>{name}</span>
          <IconButton
            icon={mdiClose}
            size="tiny"
            shape="round"
            variant="ghost"
            color="secondary"
            disabled={busy}
            aria-label={$t('memory_exclusions_remove', { values: { name } })}
            onclick={() => remove(exclusion)}
          />
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<section class="my-4 flex flex-col gap-6 sm:ms-4 md:ms-8" aria-busy={!loaded || busy}>
  {#if recapsAvailable}
    <Field label={$t('memory_exclusions_recaps')} description={$t('memory_exclusions_recaps_description')}>
      <Switch checked={recaps} disabled={busy} onCheckedChange={(value) => ((recaps = value), setRecaps(value))} />
    </Field>
  {/if}

  <div class="flex flex-col gap-2">
    <Text fontWeight="medium">{$t('memory_exclusions_people')}</Text>
    <Text size="small" color="muted">{$t('memory_exclusions_people_description')}</Text>
    {@render chips(people)}
    <div>
      <Button
        size="small"
        shape="round"
        variant="outline"
        leadingIcon={mdiAccountMultiplePlusOutline}
        disabled={busy}
        onclick={addPeople}
      >
        {$t('memory_exclusions_add_people')}
      </Button>
    </div>
  </div>

  <div class="flex flex-col gap-2">
    <Text fontWeight="medium">{$t('memory_exclusions_dates')}</Text>
    <Text size="small" color="muted">{$t('memory_exclusions_dates_description')}</Text>
    {@render chips(days)}
    <div class="flex flex-wrap items-end gap-3">
      <Field label={$t('start_date')}>
        <DatePicker bind:value={startDate} />
      </Field>
      <Field label={$t('end_date')}>
        <DatePicker bind:value={endDate} />
      </Field>
      <Button
        size="small"
        shape="round"
        variant="outline"
        leadingIcon={mdiCalendarPlus}
        disabled={busy || !startDate || datesInvalid}
        onclick={addDays}
      >
        {$t('memory_exclusions_add_dates')}
      </Button>
    </div>
    {#if datesInvalid}
      <Text size="small" color="danger">{$t('start_date_before_end_date')}</Text>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <Text fontWeight="medium">{$t('memory_exclusions_albums')}</Text>
    <Text size="small" color="muted">{$t('memory_exclusions_albums_description')}</Text>
    {@render chips(albums)}
    <div>
      <Button
        size="small"
        shape="round"
        variant="outline"
        leadingIcon={mdiImageAlbum}
        disabled={busy}
        onclick={addAlbum}
      >
        {$t('memory_exclusions_add_album')}
      </Button>
    </div>
  </div>

  <Field label={$t('memory_exclusions_documents')} description={$t('memory_exclusions_documents_description')}>
    <Switch
      checked={documents}
      disabled={busy}
      onCheckedChange={(value) => ((documents = value), setDocuments(value))}
    />
  </Field>
</section>
