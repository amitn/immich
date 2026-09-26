import {
  BookStylePreset,
  FoodMealType,
  FoodRestaurantSource,
  findMeals,
  matchMeal,
  setDishNames,
  type FoodDishesDto,
  type FoodDishesResponseDto,
  type FoodMatchResponseDto,
  type FoodMealResponseDto,
  type FoodRestaurantCandidateDto,
} from '@immich/sdk';
import { mdiSilverwareForkKnife } from '@mdi/js';
import type { Translations } from 'svelte-i18n';
import type { HasCollectionLabels, WebCollectionPack } from '$lib/collections/pack';
import type {
  CollectionEntriesDto,
  CollectionEntriesResponse,
  CollectionMatch,
  CollectionPlaceCandidate,
  CollectionVisit,
} from '$lib/collections/types';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';

/** every label of the naming dialog is in `i18n/en.json`, under `collections.food`: this does not compile otherwise */
export const foodLabels: HasCollectionLabels<'food'> = true;

/** The limits of one request, see `FOOD_LIMITS` on the server */
export const FOOD_LIMITS = { assetIds: 2000, dishes: 100, menus: 10 } as const;

const MEAL_TYPE_LABELS: Record<FoodMealType, Translations> = {
  [FoodMealType.Breakfast]: 'collections.food.visit_type_breakfast',
  [FoodMealType.Lunch]: 'collections.food.visit_type_lunch',
  [FoodMealType.Dinner]: 'collections.food.visit_type_dinner',
};

/** the menu is the source of a meal */
const toPlace = (candidate: FoodRestaurantCandidateDto): CollectionPlaceCandidate => ({
  ...candidate,
  source: candidate.source === FoodRestaurantSource.Menu ? 'source' : candidate.source,
});

/** A meal of `/food/meals` as a visit of the food collection */
export const toCollectionVisit = (meal: FoodMealResponseDto): CollectionVisit => ({
  index: meal.index,
  start: meal.start,
  end: meal.end,
  day: meal.day,
  type: meal.type,
  ...(meal.city && { city: meal.city }),
  ...(meal.country && { country: meal.country }),
  ...(meal.latitude !== undefined && { latitude: meal.latitude, longitude: meal.longitude }),
  subjectIds: meal.dishIds,
  sourceIds: meal.menuIds,
  signIds: meal.signIds,
  receiptIds: meal.receiptIds,
  place: toPlace(meal.restaurant),
  candidates: meal.candidates.map((candidate) => toPlace(candidate)),
  saved: meal.saved.map(({ assetId, restaurant, dish, menu }) => ({
    assetId,
    place: restaurant,
    ...(dish !== undefined && { entry: dish }),
    source: menu,
  })),
});

/** A match of `/food/meals/match` as a match of the food collection */
export const toCollectionMatch = (match: FoodMatchResponseDto): CollectionMatch => ({
  entries: match.items.map(({ menuId, ...item }) => ({ ...item, ...(menuId && { sourceId: menuId }) })),
  subjects: match.dishes.map(({ offMenu, ...dish }) => ({
    ...dish,
    ...(offMenu !== undefined && { offList: offMenu }),
  })),
  ...(match.ordered !== undefined && { ordered: match.ordered }),
  noEmbedding: match.noEmbedding,
  warnings: match.warnings,
});

/** The names of a meal as `/food/dishes` takes them: menu photos with menu: true, dish photos with their dish */
export const toFoodDishesDto = ({ place, photos }: CollectionEntriesDto): FoodDishesDto => ({
  restaurant: place,
  photos: photos.map(({ id, entry, source }) => (source ? { id, menu: true } : { id, dish: entry })),
});

export const toCollectionEntriesResponse = ({
  restaurant,
  results,
}: FoodDishesResponseDto): CollectionEntriesResponse => ({
  place: restaurant,
  results,
});

/**
 * Food: the dishes of restaurant meals, matched with the items of the menu and saved as `Food/<Restaurant>/<Dish>`
 * tags. It talks to `/food/*` until the SDK has the generic `/collections/{pack}/*` endpoints.
 */
export const foodPack: WebCollectionPack = {
  id: 'food',
  order: 0,
  icon: mdiSilverwareForkKnife,
  tagRoot: 'Food',
  limits: { assetIds: FOOD_LIMITS.assetIds, subjects: FOOD_LIMITS.dishes, sources: FOOD_LIMITS.menus },
  bookStylePreset: BookStylePreset.Food,
  bookStyleLabels: { name: 'book_style_preset_food', description: 'book_style_preset_food_description' },
  visitTypeLabel: (type) => MEAL_TYPE_LABELS[type as FoodMealType],
  // dishes are recognized by smart search; without it only menus, signs and receipts would be found
  isAvailable: () => featureFlagsManager.value.smartSearch,
  // the lookup runs through the assistant, which asks the user first
  hasPlaceLookup: () => featureFlagsManager.value.restaurantLookup,
  api: {
    findVisits: async (target) => {
      const result = await findMeals({ foodMealsDto: target });
      return {
        pack: 'food',
        count: result.count,
        truncated: result.truncated,
        photos: result.foodPhotos,
        visits: result.meals.map((meal) => toCollectionVisit(meal)),
        warnings: result.warnings,
      };
    },
    matchVisit: async ({ subjectIds, sourceIds }) =>
      toCollectionMatch(await matchMeal({ foodMatchDto: { dishIds: subjectIds, menuIds: sourceIds } })),
    saveEntries: async (dto) =>
      toCollectionEntriesResponse(await setDishNames({ foodDishesDto: toFoodDishesDto(dto) })),
  },
};

export default foodPack;
