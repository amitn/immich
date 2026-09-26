import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const double = () => z.number().meta({ format: 'double' });
const uuid = () => z.uuidv4();

export const FOOD_LIMITS = {
  /** photos considered by one meal search */
  candidates: 5000,
  /** asset ids given to a meal search */
  assetIds: 2000,
  dishes: 100,
  menus: 10,
  items: 200,
  photos: 200,
} as const;

export const foodMealTypes = ['Breakfast', 'Lunch', 'Dinner'] as const;
export const foodRestaurantSources = ['tag', 'sign', 'menu', 'receipt', 'fallback'] as const;

const FoodMealTypeSchema = z.enum(foodMealTypes).describe('Meal by local time').meta({ id: 'FoodMealType' });
const FoodRestaurantSourceSchema = z
  .enum(foodRestaurantSources)
  .describe(
    'Where the restaurant name comes from: the food tags already on the photos, text read on a sign, menu or receipt, or a name made up from the meal and the city',
  )
  .meta({ id: 'FoodRestaurantSource' });

const FoodMealsSchema = z
  .object({
    albumId: uuid().optional().describe('Find meals among the photos of this album'),
    assetIds: z.array(uuid()).max(FOOD_LIMITS.assetIds).optional().describe('Find meals among these photos'),
    takenAfter: z.string().optional().describe('Only photos taken after this date (ISO 8601)'),
    takenBefore: z.string().optional().describe('Only photos taken before this date (ISO 8601)'),
    maxGapMinutes: z.int().min(5).max(240).optional().describe('A longer gap between food photos starts a new meal'),
    maxDistanceMeters: z
      .int()
      .min(20)
      .max(5000)
      .optional()
      .describe('A photo further from the place of the meal starts a new meal'),
  })
  .meta({ id: 'FoodMealsDto' });

const FoodRestaurantCandidateSchema = z
  .object({
    name: z.string().describe('Restaurant name'),
    source: FoodRestaurantSourceSchema,
    confidence: double().describe('Confidence, 0-1'),
    assetIds: z.array(uuid()).describe('Photos the name was read on'),
  })
  .meta({ id: 'FoodRestaurantCandidateDto' });

const FoodSavedDishSchema = z
  .object({
    assetId: uuid().describe('Asset ID'),
    restaurant: z.string().describe('Restaurant of the food tag'),
    dish: z.string().optional().describe('Dish of the food tag, absent for a menu'),
    menu: z.boolean().describe('Whether the photo is tagged as the menu'),
  })
  .meta({ id: 'FoodSavedDishDto' });

const FoodMealSchema = z
  .object({
    index: z.int().describe('Position of the meal, in time order'),
    start: z.string().describe('Local date-time of the first photo'),
    end: z.string().describe('Local date-time of the last photo'),
    day: z.string().describe('Local day of the meal'),
    type: FoodMealTypeSchema,
    city: z.string().optional().describe('City'),
    country: z.string().optional().describe('Country'),
    latitude: double().optional().describe('Latitude of the meal (average of its located photos)'),
    longitude: double().optional().describe('Longitude of the meal (average of its located photos)'),
    dishIds: z.array(uuid()).describe('Photos of dishes and drinks'),
    menuIds: z.array(uuid()).describe('Photos of the menu'),
    signIds: z.array(uuid()).describe('Photos of the restaurant sign or storefront'),
    receiptIds: z.array(uuid()).describe('Photos of the receipt'),
    restaurant: FoodRestaurantCandidateSchema.describe('The best name for the restaurant'),
    candidates: z.array(FoodRestaurantCandidateSchema).describe('Other names read on the photos'),
    saved: z.array(FoodSavedDishSchema).describe('Food tags already on the photos of the meal'),
  })
  .meta({ id: 'FoodMealResponseDto' });

const FoodMealsResponseSchema = z
  .object({
    count: z.int().describe('Photos considered'),
    truncated: z
      .boolean()
      .describe(`Whether more than ${FOOD_LIMITS.candidates} photos matched and the rest were left out`),
    foodPhotos: z.int().describe('Photos found to show food, a menu, a restaurant sign or a receipt'),
    meals: z.array(FoodMealSchema).describe('Restaurant visits, in time order'),
    warnings: z.array(z.string()).describe('Why the search may be incomplete, e.g. smart search is disabled'),
  })
  .meta({ id: 'FoodMealsResponseDto' });

const FoodMenuItemInputSchema = z
  .object({
    name: z.string().min(1).max(200).describe('Name of the item, as printed'),
    description: z.string().max(500).optional().describe('Description of the item'),
  })
  .meta({ id: 'FoodMenuItemInputDto' });

const FoodMatchSchema = z
  .object({
    dishIds: z.array(uuid()).min(1).max(FOOD_LIMITS.dishes).describe('Photos of the dishes of one meal'),
    menuIds: z.array(uuid()).max(FOOD_LIMITS.menus).optional().describe('Photos of the menu of the meal'),
    items: z
      .array(FoodMenuItemInputSchema)
      .max(FOOD_LIMITS.items)
      .optional()
      .describe('Menu items to match instead of the ones read on the menu photos'),
  })
  .meta({ id: 'FoodMatchDto' });

const FoodMenuItemSchema = z
  .object({
    index: z.int().describe('Index of the item'),
    name: z.string().describe('Name of the item, as printed'),
    description: z.string().optional().describe('Description of the item'),
    price: z.string().optional().describe('Price as printed'),
    section: z.string().optional().describe('Section of the menu, e.g. "Primi piatti"'),
    menuId: uuid().optional().describe('Menu photo the item was read on'),
  })
  .meta({ id: 'FoodMenuItemDto' });

const FoodDishSuggestionSchema = z
  .object({
    index: z.int().describe('Index of the menu item'),
    name: z.string().describe('Name of the menu item'),
    score: double().describe('Probability among the items, 0-1'),
  })
  .meta({ id: 'FoodDishSuggestionDto' });

const FoodDishMatchSchema = z
  .object({
    assetIds: z.array(uuid()).describe('Photos of the same dish'),
    index: z.int().optional().describe('Index of the matched menu item'),
    name: z.string().optional().describe('Name of the matched menu item'),
    score: double().describe('Probability of the match, 0-1'),
    unsure: z.boolean().describe('The match is weak or not the favourite of the photos: check it'),
    shared: z.boolean().optional().describe('The menu item is matched to other dishes too'),
    offMenu: double()
      .optional()
      .describe('Probability that the dish is not on the menu (bread, coffee, an amuse-bouche), 0-1'),
    suggestions: z.array(FoodDishSuggestionSchema).describe('Best menu items for the photos'),
  })
  .meta({ id: 'FoodDishMatchDto' });

const FoodMatchResponseSchema = z
  .object({
    items: z.array(FoodMenuItemSchema).describe('The menu items'),
    dishes: z.array(FoodDishMatchSchema).describe('The dishes, with their matches'),
    ordered: z
      .boolean()
      .optional()
      .describe(
        'The dishes were matched in the order of the courses of a tasting menu; the scores are then the probabilities over all such alignments',
      ),
    noEmbedding: z.array(uuid()).describe('Dish photos that could not be matched because smart search has not run'),
    warnings: z.array(z.string()).describe('Why matching may be incomplete'),
  })
  .meta({ id: 'FoodMatchResponseDto' });

const FoodDishNameSchema = z
  .object({
    id: uuid().describe('Asset ID'),
    dish: z.string().max(200).optional().describe('Name of the dish; "menu" marks a photo of the menu'),
    menu: z.boolean().optional().describe('The photo shows the menu'),
  })
  .meta({ id: 'FoodDishNameDto' });

const FoodDishesSchema = z
  .object({
    restaurant: z.string().min(1).max(100).describe('Name of the restaurant'),
    photos: z.array(FoodDishNameSchema).min(1).max(FOOD_LIMITS.photos).describe('The photos to name'),
  })
  .meta({ id: 'FoodDishesDto' });

const FoodDishResultSchema = z
  .object({
    id: uuid().describe('Asset ID'),
    success: z.boolean().describe('Whether the photo was tagged'),
    tag: z.string().optional().describe('The food tag of the photo'),
    previousTags: z.array(z.string()).optional().describe('Food tags the photo had before, now removed'),
    description: z.string().optional().describe('The description set on the photo, when it had none'),
    error: z.string().optional().describe('Why the photo was not tagged'),
  })
  .meta({ id: 'FoodDishResultDto' });

const FoodDishesResponseSchema = z
  .object({
    restaurant: z.string().describe('Name of the restaurant as it is used in the tags'),
    results: z.array(FoodDishResultSchema).describe('One result per photo'),
  })
  .meta({ id: 'FoodDishesResponseDto' });

export class FoodMealsDto extends createZodDto(FoodMealsSchema) {}
export class FoodMealsResponseDto extends createZodDto(FoodMealsResponseSchema) {}
export class FoodMatchDto extends createZodDto(FoodMatchSchema) {}
export class FoodMatchResponseDto extends createZodDto(FoodMatchResponseSchema) {}
export class FoodDishesDto extends createZodDto(FoodDishesSchema) {}
export class FoodDishesResponseDto extends createZodDto(FoodDishesResponseSchema) {}

export type FoodMealResponse = z.infer<typeof FoodMealSchema>;
export type FoodRestaurantCandidate = z.infer<typeof FoodRestaurantCandidateSchema>;
export type FoodMenuItemResponse = z.infer<typeof FoodMenuItemSchema>;
export type FoodDishMatchResponse = z.infer<typeof FoodDishMatchSchema>;
export type FoodDishResult = z.infer<typeof FoodDishResultSchema>;
