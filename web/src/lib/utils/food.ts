import {
  FoodMealType,
  FoodRestaurantSource,
  type FoodDishesDto,
  type FoodDishesResponseDto,
  type FoodDishMatchDto,
  type FoodMatchResponseDto,
  type FoodMealResponseDto,
  type FoodMenuItemDto,
} from '@immich/sdk';
import { DateTime } from 'luxon';
import type { MessageFormatter, Translations } from 'svelte-i18n';

/** The limits of one match request, see `FOOD_LIMITS` on the server */
export const FOOD_MATCH_LIMITS = { dishes: 100, menus: 10 } as const;

/** Food tags are `Food/<Restaurant>/<Dish>` and `Food/<Restaurant>/Menu` */
export const FOOD_TAG_ROOT = 'Food';

export const FOOD_MEAL_TYPE_LABEL_KEYS: Record<FoodMealType, Translations> = {
  [FoodMealType.Breakfast]: 'food_meal_breakfast',
  [FoodMealType.Lunch]: 'food_meal_lunch',
  [FoodMealType.Dinner]: 'food_meal_dinner',
};

export const FOOD_RESTAURANT_SOURCE_LABEL_KEYS: Record<FoodRestaurantSource, Translations> = {
  [FoodRestaurantSource.Tag]: 'food_restaurant_source_tag',
  [FoodRestaurantSource.Sign]: 'food_restaurant_source_sign',
  [FoodRestaurantSource.Menu]: 'food_restaurant_source_menu',
  [FoodRestaurantSource.Receipt]: 'food_restaurant_source_receipt',
  [FoodRestaurantSource.Fallback]: 'food_restaurant_source_fallback',
};

/** A dish of a meal as it is edited: its photos (of the same dish) and the name they get */
export type FoodDishRow = {
  /** stable key: the first photo */
  key: string;
  assetIds: string[];
  /** the name the photos get; empty skips them */
  name: string;
  /** named freely instead of with a menu item */
  offMenu: boolean;
  /** the suggested match is weak: the user should check it */
  unsure: boolean;
  /** the photos already have this dish name in their food tags */
  savedName?: string;
  /** the menu item the server matched */
  matchedName?: string;
  /** menu items, best first */
  suggestions: string[];
};

/** The dish is probably not on the menu (bread, coffee, an amuse-bouche): no menu item beats "not on the menu" */
export const isOffMenuDish = (dish: FoodDishMatchDto) =>
  dish.index === undefined && dish.offMenu !== undefined && dish.offMenu > (dish.suggestions[0]?.score ?? 0);

/** Every photo of a meal */
export const getMealAssetIds = (meal: FoodMealResponseDto) => [
  ...new Set([...meal.menuIds, ...meal.dishIds, ...meal.signIds, ...meal.receiptIds]),
];

/** The saved dish name of the photos: the one most of them have */
const getSavedDishName = (assetIds: string[], meal: FoodMealResponseDto) => {
  const counts = new Map<string, number>();
  for (const saved of meal.saved) {
    if (saved.dish && assetIds.includes(saved.assetId)) {
      counts.set(saved.dish, (counts.get(saved.dish) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  for (const [name, count] of counts) {
    if (best === undefined || count > counts.get(best)!) {
      best = name;
    }
  }
  return best;
};

/**
 * The dishes of a meal to edit: the groups the match found, then the dish photos it could not match (no smart search
 * yet, or over the limit of one request) one by one. A name already saved in the food tags wins over the match.
 */
export const getFoodDishRows = (meal: FoodMealResponseDto, match?: FoodMatchResponseDto): FoodDishRow[] => {
  const hasMenu = (match?.items.length ?? 0) > 0;
  const menuNames = new Set(match?.items.map(({ name }) => name));
  const grouped = new Set(match?.dishes.flatMap(({ assetIds }) => assetIds));
  const menuIds = new Set(meal.menuIds);

  const rows: FoodDishRow[] = (match?.dishes ?? []).map((dish) => {
    const savedName = getSavedDishName(dish.assetIds, meal);
    const offMenu = isOffMenuDish(dish);
    const name = savedName ?? (offMenu ? '' : (dish.name ?? ''));
    return {
      key: dish.assetIds[0],
      assetIds: dish.assetIds,
      name,
      offMenu: hasMenu && (savedName ? !menuNames.has(savedName) : offMenu),
      unsure: !savedName && dish.name !== undefined && dish.unsure,
      savedName,
      matchedName: dish.name,
      suggestions: dish.suggestions.map((suggestion) => suggestion.name),
    };
  });

  for (const id of meal.dishIds) {
    if (grouped.has(id) || menuIds.has(id)) {
      continue;
    }
    const savedName = getSavedDishName([id], meal);
    rows.push({
      key: id,
      assetIds: [id],
      name: savedName ?? '',
      offMenu: hasMenu && !!savedName && !menuNames.has(savedName),
      unsure: false,
      savedName,
      suggestions: [],
    });
  }

  return rows;
};

/** The menu items for a dish, its suggestions first */
export const getDishOptions = (items: FoodMenuItemDto[], row: Pick<FoodDishRow, 'suggestions'>) => {
  const rank = (item: FoodMenuItemDto) => {
    const index = row.suggestions.indexOf(item.name);
    return index === -1 ? row.suggestions.length : index;
  };
  return [...items]
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index)
    .map((item) => ({ id: String(item.index), label: item.name, value: item.name }));
};

/** The request that names the photos of a meal; dishes without a name are left out */
export const getFoodDishesDto = (restaurant: string, menuIds: string[], rows: FoodDishRow[]) => {
  const named = rows.filter((row) => row.name.trim());
  const dto: FoodDishesDto = {
    restaurant: restaurant.trim(),
    photos: [
      ...menuIds.map((id) => ({ id, menu: true })),
      ...named.flatMap((row) => row.assetIds.map((id) => ({ id, dish: row.name.trim() }))),
    ],
  };
  return { dto, skipped: rows.length - named.length };
};

export type FoodSaveSummary = { restaurant: string; dishes: number; menus: number; failed: number };

/** How many dish and menu photos were named, and how many failed */
export const summarizeFoodDishes = (response: FoodDishesResponseDto, menuIds: string[]): FoodSaveSummary => {
  const menus = new Set(menuIds);
  const succeeded = response.results.filter(({ success }) => success);
  return {
    restaurant: response.restaurant,
    menus: succeeded.filter(({ id }) => menus.has(id)).length,
    dishes: succeeded.filter(({ id }) => !menus.has(id)).length,
    failed: response.results.length - succeeded.length,
  };
};

/** The meal with the food tags a save wrote, so it shows as named */
export const applyFoodDishes = (
  meal: FoodMealResponseDto,
  response: FoodDishesResponseDto,
  menuIds: string[],
): FoodMealResponseDto => {
  const menus = new Set(menuIds);
  const written = new Map(
    response.results
      .filter(({ success, tag }) => success && tag)
      .map(({ id, tag }) => [id, tag!.split('/').slice(2).join('/')]),
  );
  return {
    ...meal,
    restaurant: { ...meal.restaurant, name: response.restaurant, source: FoodRestaurantSource.Tag, confidence: 1 },
    saved: [
      ...meal.saved.filter(({ assetId }) => !written.has(assetId)),
      ...[...written].map(([assetId, leaf]) =>
        menus.has(assetId)
          ? { assetId, restaurant: response.restaurant, menu: true }
          : { assetId, restaurant: response.restaurant, dish: leaf, menu: false },
      ),
    ],
  };
};

/** The local time of a meal, e.g. "Sat, Jun 14, 2025, 1:05 PM"; the server sends it without a zone */
export const formatMealTime = (meal: Pick<FoodMealResponseDto, 'start'>, locale?: string) =>
  DateTime.fromISO(meal.start, { zone: 'UTC', locale }).toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);

/** The local day of a meal, e.g. "Saturday, June 14, 2025" */
export const formatMealDay = (meal: Pick<FoodMealResponseDto, 'start'>, locale?: string) =>
  DateTime.fromISO(meal.start, { zone: 'UTC', locale }).toLocaleString(DateTime.DATE_HUGE);

export const formatMealPlace = (meal: Pick<FoodMealResponseDto, 'city' | 'country'>) =>
  [meal.city, meal.country].filter(Boolean).join(', ');

/** The request for the assistant to name the dishes of a meal, with its photos attached */
export const getFoodAssistantPrompt = (
  $t: MessageFormatter,
  meal: FoodMealResponseDto,
  restaurant: string,
  locale?: string,
) => {
  const values = { type: meal.type, date: formatMealDay(meal, locale), restaurant: restaurant.trim() };
  return meal.restaurant.source === FoodRestaurantSource.Fallback && restaurant.trim() === meal.restaurant.name
    ? $t('food_assistant_prompt_unknown_restaurant', { values })
    : $t('food_assistant_prompt', { values });
};

/**
 * The tag of a dish or a menu, `Food/<Restaurant>/<Dish>` or `Food/<Restaurant>/Menu`: there are too many of them to
 * show one by one next to the other tags, so their restaurant stands for them
 */
export const isFoodPhotoTag = (value: string) => {
  const parts = value.split('/');
  return parts.length === 3 && parts[0] === FOOD_TAG_ROOT;
};
