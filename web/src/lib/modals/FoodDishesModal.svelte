<script lang="ts">
  import FoodDishEditor from '$lib/components/food/FoodDishEditor.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { sidebarTagsManager } from '$lib/managers/sidebar-tags-manager.svelte';
  import AlbumBookExportModal from '$lib/modals/AlbumBookExportModal.svelte';
  import { openAssistant } from '$lib/services/assistant.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import {
    applyFoodDishes,
    FOOD_LIMITS,
    FOOD_MEAL_TYPE_LABEL_KEYS,
    FOOD_RESTAURANT_SOURCE_LABEL_KEYS,
    formatMealPlace,
    formatMealTime,
    getFoodAssistantPrompt,
    getFoodDishesDto,
    getFoodDishRows,
    getMealAssetIds,
    summarizeFoodDishes,
    type FoodDishRow,
    type FoodSaveSummary,
  } from '$lib/utils/food';
  import { getServerErrorMessage, handleError } from '$lib/utils/handle-error';
  import {
    AssetMediaSize,
    BookStylePreset,
    findMeals,
    FoodRestaurantSource,
    matchMeal,
    setDishNames,
    type AlbumResponseDto,
    type FoodMealResponseDto,
    type FoodMenuItemDto,
  } from '@immich/sdk';
  import {
    Alert,
    Button,
    Field,
    HStack,
    Icon,
    IconButton,
    Input,
    LoadingSpinner,
    Modal,
    ModalBody,
    ModalFooter,
    modalManager,
    Text,
    toastManager,
  } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiArrowLeft,
    mdiBookOpenPageVariantOutline,
    mdiChevronRight,
    mdiClose,
    mdiContentSave,
    mdiCreationOutline,
    mdiInformationOutline,
    mdiMapMarkerOutline,
    mdiSilverwareForkKnife,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';

  type Props = {
    /** find the meals of this album */
    album?: AlbumResponseDto;
    /** or among these photos */
    assetIds?: string[];
    onClose: () => void;
  };

  const { album, assetIds = [], onClose }: Props = $props();

  type MealDraft = {
    status: 'loading' | 'ready' | 'error';
    error?: string;
    restaurant: string;
    items: FoodMenuItemDto[];
    rows: FoodDishRow[];
    warnings: string[];
    saved?: FoodSaveSummary;
  };

  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let errorMessage = $state<string>();
  let meals = $state<FoodMealResponseDto[]>([]);
  let warnings = $state<string[]>([]);
  let current = $state<number>();
  let drafts = $state<Record<number, MealDraft>>({});
  let enlarged = $state<string>();
  let isSaving = $state(false);
  let savedAny = $state(false);
  // the lookup runs through the assistant, which asks the user first
  const openStreetMap = $derived(featureFlagsManager.value.restaurantLookup);
  /** the meals whose dishes were matched, or are being matched */
  const opened = new SvelteSet<number>();

  const meal = $derived(current === undefined ? undefined : meals.find(({ index }) => index === current));
  const draft = $derived(current === undefined ? undefined : drafts[current]);
  const fallback = $derived(meal?.restaurant.source === FoodRestaurantSource.Fallback);
  const canSave = $derived(
    !!meal &&
      !!draft &&
      draft.status === 'ready' &&
      !isSaving &&
      /[\p{L}\d]/u.test(draft.restaurant) &&
      (meal.menuIds.length > 0 || draft.rows.some((row) => row.name.trim())),
  );
  const skipped = $derived(draft ? draft.rows.filter((row) => !row.name.trim()).length : 0);
  const canMakeBook = $derived(!!album || featureFlagsManager.value.assistant);

  const mealTitle = (value: FoodMealResponseDto) =>
    `${$t(FOOD_MEAL_TYPE_LABEL_KEYS[value.type])} · ${formatMealTime(value, $locale ?? undefined)}`;

  const load = async () => {
    status = 'loading';
    errorMessage = undefined;
    try {
      const ids = assetIds.slice(0, FOOD_LIMITS.assetIds);
      const result = await findMeals({ foodMealsDto: album ? { albumId: album.id } : { assetIds: ids } });
      meals = result.meals;
      // only part of a large album or selection is searched
      const truncated = result.truncated || ids.length < assetIds.length;
      warnings = [
        ...(truncated ? [$t('food_meals_truncated', { values: { count: result.count } })] : []),
        ...result.warnings,
      ];
      status = 'ready';
      if (meals.length === 1) {
        openMeal(meals[0]);
      }
    } catch (error) {
      errorMessage = getServerErrorMessage(error) || $t('errors.unable_to_find_meals');
      handleError(error, $t('errors.unable_to_find_meals'), { notify: false });
      status = 'error';
    }
  };

  const match = async (value: FoodMealResponseDto) => {
    const index = value.index;
    drafts[index] = { ...drafts[index], status: 'loading', error: undefined };
    const dishIds = value.dishIds.slice(0, FOOD_LIMITS.dishes);
    if (dishIds.length === 0) {
      drafts[index] = { ...drafts[index], status: 'ready', items: [], rows: [], warnings: [] };
      return;
    }
    try {
      const result = await matchMeal({
        foodMatchDto: { dishIds, menuIds: value.menuIds.slice(0, FOOD_LIMITS.menus) },
      });
      drafts[index] = {
        ...drafts[index],
        status: 'ready',
        items: result.items,
        rows: getFoodDishRows(value, result),
        warnings: result.warnings,
      };
    } catch (error) {
      handleError(error, $t('errors.unable_to_match_dishes'), { notify: false });
      drafts[index] = {
        ...drafts[index],
        status: 'error',
        error: getServerErrorMessage(error) || $t('errors.unable_to_match_dishes'),
      };
    }
  };

  const openMeal = (value: FoodMealResponseDto) => {
    current = value.index;
    enlarged = undefined;
    if (!opened.has(value.index)) {
      opened.add(value.index);
      drafts[value.index] = {
        status: 'loading',
        restaurant: value.restaurant.name,
        items: [],
        rows: [],
        warnings: [],
      };
      void match(value);
    }
  };

  const updateRow = (row: FoodDishRow) => {
    if (current === undefined) {
      return;
    }
    drafts[current].rows = drafts[current].rows.map((candidate) => (candidate.key === row.key ? row : candidate));
  };

  const save = async () => {
    if (!meal || !draft || !canSave) {
      return;
    }
    const index = meal.index;
    const { dto } = getFoodDishesDto(draft.restaurant, meal.menuIds, draft.rows);
    isSaving = true;
    try {
      const response = await setDishNames({ foodDishesDto: dto });
      const summary = summarizeFoodDishes(response, meal.menuIds);
      const updated = applyFoodDishes(meal, response, meal.menuIds);
      meals = meals.map((candidate) => (candidate.index === index ? updated : candidate));
      drafts[index] = {
        ...drafts[index],
        restaurant: response.restaurant,
        saved: summary,
        rows: drafts[index].rows.map((row) =>
          row.name.trim() ? { ...row, savedName: row.name.trim(), unsure: false } : row,
        ),
      };
      savedAny = true;
      // the restaurant and its dishes are new tags
      void sidebarTagsManager.load({ force: true });
      toastManager.success($t('food_dishes_saved', { values: summary }));
      if (summary.failed > 0) {
        toastManager.warning($t('food_dishes_not_saved', { values: { count: summary.failed } }));
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_name_dishes'));
    } finally {
      isSaving = false;
    }
  };

  const askAssistant = async () => {
    if (!meal || !draft) {
      return;
    }
    const prompt = getFoodAssistantPrompt($t, meal, draft.restaurant, $locale ?? undefined);
    const ids = getMealAssetIds(meal);
    onClose();
    await openAssistant({ assetIds: ids, prompt });
  };

  const makeBook = async () => {
    onClose();
    if (album) {
      await modalManager.show(AlbumBookExportModal, { album, stylePreset: BookStylePreset.Food });
      return;
    }
    await openAssistant({ assetIds, prompt: $t('food_book_prompt') });
  };

  const back = () => {
    current = undefined;
    enlarged = undefined;
  };

  onMount(() => void load());
</script>

<Modal title={$t('food_name_dishes_title')} icon={mdiSilverwareForkKnife} {onClose} size="large">
  <ModalBody>
    {#if status === 'loading'}
      <div class="flex flex-col items-center gap-3 py-10" role="status">
        <LoadingSpinner size="large" />
        <Text size="small" color="muted">{$t('food_finding_meals')}</Text>
      </div>
    {:else if status === 'error'}
      <div class="flex flex-col items-start gap-3">
        <Alert color="danger" icon={mdiAlertCircleOutline} title={errorMessage} />
        <Button size="small" shape="round" color="secondary" onclick={load}>{$t('retry')}</Button>
      </div>
    {:else if meal && draft}
      <div class="flex flex-col gap-5">
        <div class="flex items-start gap-2">
          {#if meals.length > 1}
            <IconButton
              shape="round"
              variant="ghost"
              color="secondary"
              size="small"
              icon={mdiArrowLeft}
              aria-label={$t('food_all_meals')}
              onclick={back}
            />
          {/if}
          <div class="min-w-0">
            <p class="font-medium">{mealTitle(meal)}</p>
            {#if formatMealPlace(meal)}
              <p class="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                <Icon icon={mdiMapMarkerOutline} size="16" aria-hidden />
                {formatMealPlace(meal)}
              </p>
            {/if}
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <Field
            label={$t('food_restaurant')}
            description={$t(FOOD_RESTAURANT_SOURCE_LABEL_KEYS[meal.restaurant.source])}
            required
          >
            <Input bind:value={draft.restaurant} maxlength={100} disabled={isSaving} />
          </Field>
          {#if fallback}
            <Alert color="warning" icon={mdiInformationOutline} size="small">
              <p class="text-sm">
                {openStreetMap ? $t('food_restaurant_unknown_lookup') : $t('food_restaurant_unknown')}
              </p>
            </Alert>
          {/if}
          {#if meal.candidates.length > 0}
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span class="text-gray-600 dark:text-gray-400">{$t('food_other_names')}</span>
              {#each meal.candidates as candidate (candidate.name + candidate.source)}
                <button
                  type="button"
                  class="rounded-full border border-gray-300 px-3 py-0.5 hover:border-primary hover:text-primary dark:border-gray-600"
                  title={$t(FOOD_RESTAURANT_SOURCE_LABEL_KEYS[candidate.source])}
                  disabled={isSaving}
                  onclick={() => (draft.restaurant = candidate.name)}
                >
                  {candidate.name}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <section class="flex flex-col gap-2" aria-labelledby="food-menu-heading">
          <h3 id="food-menu-heading" class="text-sm font-medium">{$t('food_menu')}</h3>
          {#if meal.menuIds.length === 0}
            <Text size="small" color="muted">{$t('food_no_menu')}</Text>
          {:else}
            <div class="flex flex-wrap gap-2">
              {#each meal.menuIds as id (id)}
                <button
                  type="button"
                  class="relative overflow-hidden rounded-lg ring-primary focus-visible:ring-2 {enlarged === id
                    ? 'ring-2'
                    : ''}"
                  aria-label={$t('food_view_menu')}
                  aria-pressed={enlarged === id}
                  onclick={() => (enlarged = enlarged === id ? undefined : id)}
                >
                  <img
                    src={getAssetMediaUrl({ id, size: AssetMediaSize.Thumbnail })}
                    alt={$t('food_menu_photo')}
                    class="size-20 bg-gray-100 object-cover sm:size-24 dark:bg-gray-800"
                    draggable="false"
                  />
                  <span class="absolute inset-x-0 bottom-0 bg-black/60 text-center text-xs text-white">
                    {$t('food_menu')}
                  </span>
                </button>
              {/each}
            </div>
            {#if enlarged}
              <div class="relative rounded-lg bg-gray-100 dark:bg-gray-800">
                <img
                  src={getAssetMediaUrl({ id: enlarged, size: AssetMediaSize.Preview })}
                  alt={$t('food_menu_photo')}
                  class="mx-auto max-h-[70vh] w-full object-contain"
                  draggable="false"
                />
                <IconButton
                  class="absolute inset-e-2 top-2"
                  shape="round"
                  color="secondary"
                  size="small"
                  icon={mdiClose}
                  aria-label={$t('close')}
                  onclick={() => (enlarged = undefined)}
                />
              </div>
            {/if}
            {#if draft.status === 'ready'}
              <Text size="small" color="muted">
                {$t('food_menu_items_read', { values: { count: draft.items.length } })}
              </Text>
            {/if}
          {/if}
        </section>

        <section class="flex flex-col gap-2" aria-labelledby="food-dishes-heading">
          <h3 id="food-dishes-heading" class="text-sm font-medium">{$t('food_dishes')}</h3>
          {#if draft.status === 'loading'}
            <div class="flex items-center gap-3 py-4" role="status">
              <LoadingSpinner />
              <Text size="small" color="muted">{$t('food_matching_dishes')}</Text>
            </div>
          {:else if draft.status === 'error'}
            <div class="flex flex-col items-start gap-2">
              <Alert color="danger" icon={mdiAlertCircleOutline} title={draft.error} />
              <Button size="small" shape="round" color="secondary" onclick={() => match(meal)}>{$t('retry')}</Button>
            </div>
          {:else}
            {#each draft.warnings as warning (warning)}
              <Text size="small" color="muted">{warning}</Text>
            {/each}
            {#if draft.rows.length === 0}
              <Text size="small" color="muted">{$t('food_no_dishes')}</Text>
            {:else}
              <ul class="flex flex-col gap-2">
                {#each draft.rows as row (row.key)}
                  <FoodDishEditor {row} items={draft.items} disabled={isSaving} onChange={updateRow} />
                {/each}
              </ul>
              {#if skipped > 0}
                <Text size="small" color="muted">{$t('food_dishes_skipped', { values: { count: skipped } })}</Text>
              {/if}
            {/if}
          {/if}
        </section>

        {#if draft.saved}
          <Alert color="success" title={$t('food_dishes_saved', { values: draft.saved })}>
            {#if canMakeBook}
              <p class="text-sm">{$t('food_make_book_description')}</p>
            {/if}
          </Alert>
        {/if}
      </div>
    {:else if meals.length === 0}
      <div class="flex flex-col items-center gap-2 py-10 text-center">
        <Icon icon={mdiSilverwareForkKnife} size="48" class="text-gray-400" aria-hidden />
        <Text>{album ? $t('food_no_meals_album') : $t('food_no_meals_selection')}</Text>
        {#each warnings as warning (warning)}
          <Text size="small" color="muted">{warning}</Text>
        {/each}
      </div>
    {:else}
      <div class="flex flex-col gap-3">
        <Text size="small" color="muted">{$t('food_meals_found', { values: { count: meals.length } })}</Text>
        {#each warnings as warning (warning)}
          <Text size="small" color="muted">{warning}</Text>
        {/each}
        <ul class="flex flex-col gap-2">
          {#each meals as item (item.index)}
            {@const named = item.saved.length}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-xl border border-gray-200 p-3 text-start hover:border-primary dark:border-gray-700"
                onclick={() => openMeal(item)}
              >
                <img
                  src={getAssetMediaUrl({
                    id: item.dishIds[0] ?? getMealAssetIds(item)[0],
                    size: AssetMediaSize.Thumbnail,
                  })}
                  alt=""
                  class="size-16 shrink-0 rounded-lg bg-gray-100 object-cover dark:bg-gray-800"
                  draggable="false"
                />
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="truncate font-medium">{item.restaurant.name}</span>
                  <span class="text-xs text-gray-600 dark:text-gray-400">
                    {$t(FOOD_RESTAURANT_SOURCE_LABEL_KEYS[item.restaurant.source])}
                    {#if item.candidates.length > 0}
                      · {$t('food_also_read', {
                        values: { names: item.candidates.map(({ name }) => name).join(', ') },
                      })}
                    {/if}
                  </span>
                  <span class="text-sm">{mealTitle(item)}</span>
                  {#if formatMealPlace(item)}
                    <span class="text-sm text-gray-600 dark:text-gray-400">{formatMealPlace(item)}</span>
                  {/if}
                  <span class="text-xs text-gray-600 dark:text-gray-400">
                    {$t('food_meal_photos', { values: { dishes: item.dishIds.length, menus: item.menuIds.length } })}
                    {#if named > 0}
                      · <span class="text-green-700 dark:text-green-400">
                        {$t('food_meal_named', { values: { count: named } })}
                      </span>
                    {/if}
                  </span>
                </span>
                <Icon icon={mdiChevronRight} size="20" class="shrink-0 text-gray-500" aria-hidden />
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </ModalBody>

  <ModalFooter>
    <HStack fullWidth class="flex-wrap">
      {#if meal && draft}
        {#if featureFlagsManager.value.assistant}
          <Button shape="round" color="secondary" fullWidth leadingIcon={mdiCreationOutline} onclick={askAssistant}>
            {$t('food_ask_assistant')}
          </Button>
        {/if}
        {#if draft.saved && canMakeBook}
          <Button
            shape="round"
            color="secondary"
            fullWidth
            leadingIcon={mdiBookOpenPageVariantOutline}
            onclick={makeBook}
          >
            {$t('food_make_book')}
          </Button>
        {/if}
        <Button
          shape="round"
          fullWidth
          leadingIcon={mdiContentSave}
          loading={isSaving}
          disabled={!canSave}
          onclick={save}
        >
          {$t('save')}
        </Button>
      {:else}
        <Button shape="round" color="secondary" fullWidth onclick={onClose}>{$t('close')}</Button>
        {#if savedAny && canMakeBook}
          <Button shape="round" fullWidth leadingIcon={mdiBookOpenPageVariantOutline} onclick={makeBook}>
            {$t('food_make_book')}
          </Button>
        {/if}
      {/if}
    </HStack>
  </ModalFooter>
</Modal>
