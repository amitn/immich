<script lang="ts">
  import Combobox, { type ComboBoxOption } from '$lib/components/shared-components/Combobox.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getDishOptions, type FoodDishRow } from '$lib/utils/food';
  import { AssetMediaSize, type FoodMenuItemDto } from '@immich/sdk';
  import { Checkbox, Input, Label } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    row: FoodDishRow;
    /** the items read on the menu; without them dishes are named freely */
    items: FoodMenuItemDto[];
    disabled?: boolean;
    onChange: (row: FoodDishRow) => void;
  };

  const { row, items, disabled = false, onChange }: Props = $props();

  const hasMenu = $derived(items.length > 0);
  const options = $derived(getDishOptions(items, row));
  const selectedOption = $derived<ComboBoxOption | undefined>(
    row.name ? { id: `${row.key}-${row.name}`, label: row.name, value: row.name } : undefined,
  );
  const saved = $derived(!!row.savedName && row.savedName === row.name.trim());
  const [cover, ...others] = $derived(row.assetIds);
  const checkboxId = $derived(`food-off-menu-${row.key}`);

  const menuNames = $derived(new Set(items.map(({ name }) => name)));

  const setOffMenu = (offMenu: boolean) => {
    if (offMenu) {
      onChange({ ...row, offMenu, name: menuNames.has(row.name) ? '' : row.name });
      return;
    }
    const name = menuNames.has(row.name) ? row.name : (row.matchedName ?? row.suggestions[0] ?? '');
    onChange({ ...row, offMenu, name });
  };
</script>

<li
  class="flex gap-3 rounded-xl border p-2 sm:p-3 {row.unsure
    ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30'
    : 'border-gray-200 dark:border-gray-700'}"
  data-testid="food-dish"
  data-unsure={row.unsure || undefined}
  data-off-menu={row.offMenu || undefined}
>
  <div class="relative shrink-0">
    <img
      src={getAssetMediaUrl({ id: cover, size: AssetMediaSize.Thumbnail })}
      alt={row.name || $t('food_dish_unnamed')}
      class="size-20 rounded-lg bg-gray-100 object-cover sm:size-24 dark:bg-gray-800"
      draggable="false"
    />
    {#if others.length > 0}
      <span
        class="absolute inset-e-1 bottom-1 rounded-full bg-black/70 px-1.5 text-xs text-white"
        title={$t('food_dish_photos', { values: { count: row.assetIds.length } })}
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
          {$t('food_dish_unsure')}
        </span>
      {/if}
      {#if row.offMenu}
        <span class="rounded-full bg-gray-200 px-2 py-0.5 text-gray-800 dark:bg-gray-700 dark:text-gray-100">
          {$t('food_not_on_menu')}
        </span>
      {/if}
      {#if saved}
        <span class="rounded-full bg-green-100 px-2 py-0.5 text-green-900 dark:bg-green-900 dark:text-green-100">
          {$t('food_dish_saved')}
        </span>
      {/if}
    </div>

    {#if hasMenu && !row.offMenu}
      <Combobox
        label={$t('food_dish_name')}
        {options}
        {selectedOption}
        {disabled}
        allowCreate
        placeholder={$t('food_dish_name_placeholder')}
        onSelect={(option) => onChange({ ...row, name: option?.value ?? '', unsure: false })}
      />
    {:else}
      <Label label={$t('food_dish_name')} for="food-dish-{row.key}" class="text-xs font-light text-neutral-500" />
      <Input
        id="food-dish-{row.key}"
        value={row.name}
        {disabled}
        maxlength={200}
        placeholder={$t('food_dish_free_placeholder')}
        oninput={(event) => onChange({ ...row, name: event.currentTarget.value, unsure: false })}
      />
    {/if}

    {#if hasMenu}
      <div class="flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          size="tiny"
          checked={row.offMenu}
          {disabled}
          onCheckedChange={(checked) => setOffMenu(!!checked)}
        />
        <Label label={$t('food_not_on_menu')} for={checkboxId} class="text-sm" />
      </div>
    {/if}
  </div>
</li>
