import {
  FoodMealType,
  FoodRestaurantSource,
  type FoodDishMatchDto,
  type FoodMatchResponseDto,
  type FoodMealResponseDto,
  type FoodMenuItemDto,
} from '@immich/sdk';

/** A lunch in Taormina with two menu photos, four dish photos and a sign */
export const foodMealFactory = (meal: Partial<FoodMealResponseDto> = {}): FoodMealResponseDto => ({
  index: 0,
  start: '2025-06-14T13:05:00',
  end: '2025-06-14T14:30:00',
  day: '2025-06-14',
  type: FoodMealType.Lunch,
  city: 'Taormina',
  country: 'Italy',
  latitude: 37.85,
  longitude: 15.29,
  dishIds: ['dish-1', 'dish-2', 'dish-3', 'dish-4'],
  menuIds: ['menu-1', 'menu-2'],
  signIds: ['sign-1'],
  receiptIds: [],
  restaurant: { name: 'Trattoria da Nino', source: FoodRestaurantSource.Sign, confidence: 0.9, assetIds: ['sign-1'] },
  candidates: [{ name: 'Da Nino', source: FoodRestaurantSource.Menu, confidence: 0.6, assetIds: ['menu-1'] }],
  saved: [],
  ...meal,
});

export const foodMenuItems: FoodMenuItemDto[] = [
  { index: 0, name: 'Caponata', price: '9', section: 'Antipasti', menuId: 'menu-1' },
  { index: 1, name: 'Pasta alla Norma', price: '12', section: 'Primi', menuId: 'menu-1' },
  { index: 2, name: 'Spaghetti alle vongole', price: '15', section: 'Primi', menuId: 'menu-2' },
  { index: 3, name: 'Cannoli', price: '6', section: 'Dolci', menuId: 'menu-2' },
];

const suggestion = (index: number, score: number) => ({ index, name: foodMenuItems[index].name, score });

export const foodDishMatchFactory = (dish: Partial<FoodDishMatchDto> = {}): FoodDishMatchDto => ({
  assetIds: ['dish-1'],
  index: 0,
  name: 'Caponata',
  score: 0.8,
  unsure: false,
  offMenu: 0.05,
  suggestions: [suggestion(0, 0.8), suggestion(1, 0.1)],
  ...dish,
});

/**
 * The match of the lunch: a sure caponata (two photos), an unsure pasta alla norma, and bread that is not on the
 * menu; dish-4 has no smart search embedding yet
 */
export const foodMatchFactory = (match: Partial<FoodMatchResponseDto> = {}): FoodMatchResponseDto => ({
  items: foodMenuItems,
  dishes: [
    foodDishMatchFactory({ assetIds: ['dish-1', 'dish-2'] }),
    foodDishMatchFactory({
      assetIds: ['dish-3'],
      index: 1,
      name: 'Pasta alla Norma',
      score: 0.4,
      unsure: true,
      suggestions: [suggestion(1, 0.4), suggestion(2, 0.35)],
    }),
  ],
  noEmbedding: ['dish-4'],
  warnings: [],
  ...match,
});

export const foodBreadMatch = foodDishMatchFactory({
  assetIds: ['dish-4'],
  index: undefined,
  name: undefined,
  score: 0,
  unsure: true,
  offMenu: 0.7,
  suggestions: [suggestion(3, 0.2)],
});
