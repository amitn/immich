<script lang="ts">
  import { getCollectionLabel, type CollectionLabel, type WebCollectionPack } from '$lib/collections/pack';
  import type { CollectionEntry } from '$lib/collections/types';
  import Combobox, { type ComboBoxOption } from '$lib/components/shared-components/Combobox.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getEntryOptions, type EntryRow } from '$lib/utils/collections';
  import { AssetMediaSize } from '@immich/sdk';
  import { Checkbox, Input, Label } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    pack: WebCollectionPack;
    row: EntryRow;
    /** the entries read on the source; without them subjects are named freely */
    entries: CollectionEntry[];
    disabled?: boolean;
    onChange: (row: EntryRow) => void;
  };

  const { pack, row, entries, disabled = false, onChange }: Props = $props();

  const label = (key: CollectionLabel) => getCollectionLabel(pack, key);

  const hasSource = $derived(entries.length > 0);
  const options = $derived(getEntryOptions(entries, row));
  const selectedOption = $derived<ComboBoxOption | undefined>(
    row.name ? { id: `${row.key}-${row.name}`, label: row.name, value: row.name } : undefined,
  );
  const saved = $derived(!!row.savedName && row.savedName === row.name.trim());
  const [cover, ...others] = $derived(row.assetIds);
  const checkboxId = $derived(`${pack.id}-off-list-${row.key}`);

  const entryNames = $derived(new Set(entries.map(({ name }) => name)));

  const setOffList = (offList: boolean) => {
    if (offList) {
      onChange({ ...row, offList, name: entryNames.has(row.name) ? '' : row.name });
      return;
    }
    const name = entryNames.has(row.name) ? row.name : (row.matchedName ?? row.suggestions[0] ?? '');
    onChange({ ...row, offList, name });
  };
</script>

<li
  class="flex gap-3 rounded-xl border p-2 sm:p-3 {row.unsure
    ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30'
    : 'border-gray-200 dark:border-gray-700'}"
  data-testid="collection-entry"
  data-unsure={row.unsure || undefined}
  data-off-list={row.offList || undefined}
>
  <div class="relative shrink-0">
    <img
      src={getAssetMediaUrl({ id: cover, size: AssetMediaSize.Thumbnail })}
      alt={row.name || $t(label('subject_unnamed'))}
      class="size-20 rounded-lg bg-gray-100 object-cover sm:size-24 dark:bg-gray-800"
      draggable="false"
    />
    {#if others.length > 0}
      <span
        class="absolute inset-e-1 bottom-1 rounded-full bg-black/70 px-1.5 text-xs text-white"
        title={$t(label('subject_photos'), { values: { count: row.assetIds.length } })}
      >
        +{others.length}
      </span>
    {/if}
  </div>

  <div class="flex min-w-0 flex-1 flex-col gap-2">
    <div class="flex flex-wrap gap-1 text-xs">
      {#if row.unsure}
        <span
          class="rounded-full bg-amber-200 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-800 dark:text-amber-100"
        >
          {$t(label('subject_unsure'))}
        </span>
      {/if}
      {#if row.offList}
        <span class="rounded-full bg-gray-200 px-2 py-0.5 text-gray-800 dark:bg-gray-700 dark:text-gray-100">
          {$t(label('not_on_source'))}
        </span>
      {/if}
      {#if saved}
        <span class="rounded-full bg-green-100 px-2 py-0.5 text-green-900 dark:bg-green-900 dark:text-green-100">
          {$t(label('subject_saved'))}
        </span>
      {/if}
    </div>

    {#if hasSource && !row.offList}
      <Combobox
        label={$t(label('subject_name'))}
        {options}
        {selectedOption}
        {disabled}
        allowCreate
        placeholder={$t(label('subject_name_placeholder'))}
        onSelect={(option) => onChange({ ...row, name: option?.value ?? '', unsure: false })}
      />
    {:else}
      <Label
        label={$t(label('subject_name'))}
        for="{pack.id}-entry-{row.key}"
        class="text-xs font-light text-neutral-500"
      />
      <Input
        id="{pack.id}-entry-{row.key}"
        value={row.name}
        {disabled}
        maxlength={200}
        placeholder={$t(label('subject_free_placeholder'))}
        oninput={(event) => onChange({ ...row, name: event.currentTarget.value, unsure: false })}
      />
    {/if}

    {#if hasSource}
      <div class="flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          size="tiny"
          checked={row.offList}
          {disabled}
          onCheckedChange={(checked) => setOffList(!!checked)}
        />
        <Label label={$t(label('not_on_source'))} for={checkboxId} class="text-sm" />
      </div>
    {/if}
  </div>
</li>
