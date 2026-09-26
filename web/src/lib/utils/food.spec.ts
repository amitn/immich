import { FoodMealType, FoodRestaurantSource } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';
import {
  applyFoodDishes,
  formatMealDay,
  formatMealPlace,
  formatMealTime,
  getDishOptions,
  getFoodAssistantPrompt,
  getFoodDishesDto,
  getFoodDishRows,
  getMealAssetIds,
  isFoodPhotoTag,
  isOffMenuDish,
  summarizeFoodDishes,
} from '$lib/utils/food';
import {
  foodBreadMatch,
  foodDishMatchFactory,
  foodMatchFactory,
  foodMealFactory,
  foodMenuItems,
} from '@test-data/factories/food-factory';

describe('isOffMenuDish', () => {
  it('should mark a dish that no menu item beats "not on the menu"', () => {
    expect(isOffMenuDish(foodBreadMatch)).toBe(true);
    expect(isOffMenuDish(foodDishMatchFactory())).toBe(false);
  });

  it('should not mark a weak match without a menu to compare with', () => {
    expect(isOffMenuDish(foodDishMatchFactory({ index: undefined, offMenu: undefined }))).toBe(false);
  });
});

describe('getMealAssetIds', () => {
  it('should list every photo of the meal once', () => {
    const meal = foodMealFactory({ receiptIds: ['receipt-1'], signIds: ['menu-1'] });
    expect(getMealAssetIds(meal)).toEqual(['menu-1', 'menu-2', 'dish-1', 'dish-2', 'dish-3', 'dish-4', 'receipt-1']);
  });
});

describe('getFoodDishRows', () => {
  it('should prefill the matches, mark the unsure ones and add the photos that could not be matched', () => {
    const rows = getFoodDishRows(foodMealFactory(), foodMatchFactory());

    expect(rows).toEqual([
      expect.objectContaining({ key: 'dish-1', assetIds: ['dish-1', 'dish-2'], name: 'Caponata', unsure: false }),
      expect.objectContaining({ key: 'dish-3', name: 'Pasta alla Norma', unsure: true, offMenu: false }),
      expect.objectContaining({ key: 'dish-4', assetIds: ['dish-4'], name: '', unsure: false, suggestions: [] }),
    ]);
    expect(rows[1].suggestions).toEqual(['Pasta alla Norma', 'Spaghetti alle vongole']);
  });

  it('should leave dishes that are not on the menu unnamed', () => {
    const rows = getFoodDishRows(foodMealFactory(), foodMatchFactory({ dishes: [foodBreadMatch], noEmbedding: [] }));

    expect(rows.find((row) => row.key === 'dish-4')).toEqual(
      expect.objectContaining({ name: '', offMenu: true, matchedName: undefined }),
    );
  });

  it('should prefer the names already saved in the food tags', () => {
    const meal = foodMealFactory({
      saved: [
        { assetId: 'dish-3', restaurant: 'Trattoria da Nino', dish: 'Pasta alla Norma', menu: false },
        { assetId: 'dish-4', restaurant: 'Trattoria da Nino', dish: 'Bread', menu: false },
        { assetId: 'menu-1', restaurant: 'Trattoria da Nino', menu: true },
      ],
    });
    const rows = getFoodDishRows(meal, foodMatchFactory());

    expect(rows[1]).toEqual(expect.objectContaining({ name: 'Pasta alla Norma', savedName: 'Pasta alla Norma' }));
    // a saved match is not unsure anymore
    expect(rows[1].unsure).toBe(false);
    // a saved name that is not on the menu is a free name
    expect(rows[2]).toEqual(expect.objectContaining({ name: 'Bread', offMenu: true }));
  });

  it('should name the dishes freely without a menu', () => {
    const rows = getFoodDishRows(foodMealFactory(), foodMatchFactory({ items: [], dishes: [foodBreadMatch] }));
    expect(rows.every((row) => !row.offMenu)).toBe(true);
  });

  it('should list every dish photo while the match is missing', () => {
    expect(getFoodDishRows(foodMealFactory()).map(({ key }) => key)).toEqual(['dish-1', 'dish-2', 'dish-3', 'dish-4']);
  });
});

describe('getDishOptions', () => {
  it('should offer the suggestions of the dish first, then the menu in its order', () => {
    const options = getDishOptions(foodMenuItems, { suggestions: ['Spaghetti alle vongole', 'Cannoli'] });
    expect(options.map(({ label }) => label)).toEqual([
      'Spaghetti alle vongole',
      'Cannoli',
      'Caponata',
      'Pasta alla Norma',
    ]);
    expect(options[0]).toEqual({ id: '2', label: 'Spaghetti alle vongole', value: 'Spaghetti alle vongole' });
  });
});

describe('getFoodDishesDto', () => {
  it('should mark the menu photos and name every photo of a dish, leaving unnamed dishes out', () => {
    const rows = getFoodDishRows(foodMealFactory(), foodMatchFactory());
    rows[1].name = ' Spaghetti alle vongole ';

    const { dto, skipped } = getFoodDishesDto(' Trattoria da Nino ', ['menu-1', 'menu-2'], rows);

    expect(dto).toEqual({
      restaurant: 'Trattoria da Nino',
      photos: [
        { id: 'menu-1', menu: true },
        { id: 'menu-2', menu: true },
        { id: 'dish-1', dish: 'Caponata' },
        { id: 'dish-2', dish: 'Caponata' },
        { id: 'dish-3', dish: 'Spaghetti alle vongole' },
      ],
    });
    expect(skipped).toBe(1);
  });
});

describe('summarizeFoodDishes and applyFoodDishes', () => {
  const response = {
    restaurant: 'Trattoria da Nino',
    results: [
      { id: 'menu-1', success: true, tag: 'Food/Trattoria da Nino/Menu' },
      {
        id: 'dish-1',
        success: true,
        tag: 'Food/Trattoria da Nino/Caponata',
        description: 'Caponata · Trattoria da Nino',
      },
      { id: 'dish-3', success: false, error: 'no_permission' },
    ],
  };

  it('should count the named dishes and menus, and the failures', () => {
    expect(summarizeFoodDishes(response, ['menu-1'])).toEqual({
      restaurant: 'Trattoria da Nino',
      dishes: 1,
      menus: 1,
      failed: 1,
    });
  });

  it('should show the meal as named', () => {
    const meal = foodMealFactory({
      restaurant: { name: 'Lunch in Taormina', source: FoodRestaurantSource.Fallback, confidence: 0, assetIds: [] },
      saved: [{ assetId: 'dish-1', restaurant: 'Old', dish: 'Old dish', menu: false }],
    });

    const updated = applyFoodDishes(meal, response, ['menu-1']);

    expect(updated.restaurant).toEqual(
      expect.objectContaining({ name: 'Trattoria da Nino', source: FoodRestaurantSource.Tag }),
    );
    expect(updated.saved).toEqual([
      { assetId: 'menu-1', restaurant: 'Trattoria da Nino', menu: true },
      { assetId: 'dish-1', restaurant: 'Trattoria da Nino', dish: 'Caponata', menu: false },
    ]);
  });
});

describe('formatting', () => {
  it('should show the local time of the meal as it was taken', () => {
    const meal = foodMealFactory();
    expect(formatMealTime(meal, 'en').replaceAll('\u{202F}', ' ')).toBe('Sat, Jun 14, 2025, 1:05 PM');
    expect(formatMealDay(meal, 'en')).toBe('Saturday, June 14, 2025');
    expect(formatMealPlace(meal)).toBe('Taormina, Italy');
    expect(formatMealPlace(foodMealFactory({ city: undefined, country: undefined }))).toBe('');
  });
});

describe('getFoodAssistantPrompt', () => {
  const $t = vi.fn((key: string, options?: { values?: Record<string, unknown> }) =>
    JSON.stringify({ key, ...options?.values }),
  ) as unknown as MessageFormatter;

  it('should ask to name the dishes of the meal at the restaurant', () => {
    const prompt = JSON.parse(getFoodAssistantPrompt($t, foodMealFactory(), ' Da Nino ', 'en'));
    expect(prompt).toEqual({
      key: 'food_assistant_prompt',
      type: FoodMealType.Lunch,
      date: 'Saturday, June 14, 2025',
      restaurant: 'Da Nino',
    });
  });

  it('should ask to find the restaurant when its name could not be read', () => {
    const meal = foodMealFactory({
      restaurant: { name: 'Lunch in Taormina', source: FoodRestaurantSource.Fallback, confidence: 0, assetIds: [] },
    });
    expect(JSON.parse(getFoodAssistantPrompt($t, meal, 'Lunch in Taormina', 'en')).key).toBe(
      'food_assistant_prompt_unknown_restaurant',
    );
    // once the user typed the name in, the assistant gets it
    expect(JSON.parse(getFoodAssistantPrompt($t, meal, 'Da Nino', 'en')).key).toBe('food_assistant_prompt');
  });
});

describe('isFoodPhotoTag', () => {
  it('should tell the tags of dishes and menus from their restaurant', () => {
    expect(isFoodPhotoTag('Food/Trattoria da Nino/Caponata')).toBe(true);
    expect(isFoodPhotoTag('Food/Trattoria da Nino/Menu')).toBe(true);
    expect(isFoodPhotoTag('Food/Trattoria da Nino')).toBe(false);
    expect(isFoodPhotoTag('Food')).toBe(false);
    expect(isFoodPhotoTag('Travel/Italy/Taormina')).toBe(false);
  });
});
