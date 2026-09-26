import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { FOOD_LIMITS, FoodMatchResponseDto, FoodMealsResponseDto } from 'src/dtos/food.dto.js';
import { BaseService } from 'src/services/base.service.js';
import { FoodService } from 'src/services/food.service.js';
import {
  AgentTool,
  AgentToolContext,
  AgentToolResult,
  defineTool,
  toolError,
  toolJson,
} from 'src/utils/agent/tools.js';
import { MAX_LOOKUP_RADIUS } from 'src/utils/food/overpass.js';

const uuid = z.uuidv4();
const date = z.string().describe('ISO date or date-time, e.g. 2024-06-01 or 2024-06-01T18:00:00');

/** turns client errors (access, validation) into tool errors the agent can read and recover from */
const handle =
  <I>(handler: (ctx: AgentToolContext, input: I) => Promise<AgentToolResult>) =>
  async (ctx: AgentToolContext, input: I) => {
    try {
      return await handler(ctx, input);
    } catch (error) {
      if (error instanceof HttpException) {
        return toolError(error.message);
      }
      throw error;
    }
  };

const withImages = (details: unknown, images: Buffer[]): AgentToolResult => ({
  content: [
    ...toolJson(details).content,
    ...images.map((image) => ({ type: 'image' as const, data: image.toString('base64'), mimeType: 'image/jpeg' })),
  ],
});

const nonEmpty = <T>(values: T[] | undefined) => (values && values.length > 0 ? values : undefined);

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** a meal as the agent reads it: no empty lists, no internals */
const compactMeals = ({ count, truncated, foodPhotos, meals, warnings }: FoodMealsResponseDto) => ({
  count,
  ...(truncated && { truncated }),
  foodPhotos,
  meals: meals.map((meal) => ({
    index: meal.index,
    start: meal.start,
    end: meal.end,
    type: meal.type,
    ...(meal.city && { city: meal.city }),
    ...(meal.country && { country: meal.country }),
    ...(meal.latitude !== undefined && { gps: [meal.latitude, meal.longitude] }),
    restaurant: { name: meal.restaurant.name, source: meal.restaurant.source, confidence: meal.restaurant.confidence },
    ...(meal.candidates.length > 0 && {
      otherNames: meal.candidates.map(({ name, source, confidence }) => ({ name, source, confidence })),
    }),
    dishIds: meal.dishIds,
    ...(nonEmpty(meal.menuIds) && { menuIds: meal.menuIds }),
    ...(nonEmpty(meal.signIds) && { signIds: meal.signIds }),
    ...(nonEmpty(meal.receiptIds) && { receiptIds: meal.receiptIds }),
    ...(meal.saved.length > 0 && {
      saved: meal.saved.map(({ assetId, restaurant, dish, menu }) => ({
        assetId,
        tag: menu ? `${restaurant}/Menu` : `${restaurant}/${dish}`,
      })),
    }),
  })),
  ...(warnings.length > 0 && { warnings }),
});

const compactMatch = ({ items, dishes, ordered, noEmbedding, warnings }: FoodMatchResponseDto) => ({
  items: items.map(({ index, name, description, price, section }) => ({
    i: index,
    name,
    ...(description && { description }),
    ...(price && { price }),
    ...(section && { section }),
  })),
  dishes: dishes.map((dish) => ({
    assetIds: dish.assetIds,
    ...(dish.name === undefined ? { match: null } : { match: dish.name, i: dish.index }),
    score: dish.score,
    ...(dish.unsure && { unsure: true }),
    ...(dish.shared && { shared: true }),
    ...(dish.offMenu !== undefined && dish.offMenu >= 0.2 && { offMenu: dish.offMenu }),
    suggestions: dish.suggestions.map(({ index, name, score }) => ({ i: index, name, score })),
  })),
  ...(ordered && { ordered }),
  ...(noEmbedding.length > 0 && { noEmbedding }),
  ...(warnings.length > 0 && { warnings }),
});

/** Food photos: meals, menus, dish names and restaurants */
@Injectable()
export class FoodAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const foodService = BaseService.create(FoodService, this);

    return [
      defineTool({
        name: 'find_meals',
        title: 'Find meals',
        description:
          'Find the restaurant meals among photos: dishes and drinks (by CLIP), menus, restaurant signs or storefronts ' +
          'and receipts (by CLIP and the text read on them), grouped into visits by time (gaps up to 45 minutes, up ' +
          'to 5 hours; a menu or sign photographed apart joins the closest meal) and place when the photos are ' +
          `located. Give an album, asset ids (up to ${FOOD_LIMITS.assetIds}, e.g. from search_photos) or a date ` +
          'range. Returns {meals: [{index, start, end, type (Breakfast/Lunch/Dinner from the camera clock, which ' +
          'can be on the wrong time zone), city, gps, restaurant: {name, source, confidence}, otherNames, dishIds, ' +
          'menuIds, signIds, receiptIds, saved (food tags already set)}]}. restaurant.source is tag (already named), ' +
          'sign, menu or receipt (read on the photos: check it) or fallback (a made-up "Dinner in <City>": ask the ' +
          'user). Next: read_menu for a menu, match_dishes for the dishes, view_photos to check.',
        input: z.object({
          albumId: uuid.optional(),
          assetIds: z.array(uuid).max(FOOD_LIMITS.assetIds).optional(),
          takenAfter: date.optional(),
          takenBefore: date.optional(),
          maxGapMinutes: z.int().min(5).max(240).optional().describe('Gap that starts a new meal, default 45'),
          maxDistanceMeters: z
            .int()
            .min(20)
            .max(5000)
            .optional()
            .describe('Distance that starts a new meal, default 150'),
        }),
        mutating: false,
        handler: handle(async ({ auth }, input) => toolJson(compactMeals(await foodService.findMeals(auth, input)))),
      }),

      defineTool({
        name: 'read_menu',
        title: 'Read a menu',
        description:
          'Read the items of a menu photo: the original is read again with OCR in overlapping tiles at full ' +
          'resolution, then split into columns and lines; prices, section headings, allergen codes, addresses, ' +
          'phone numbers and cover charges are set aside, and names over several lines are joined. Names stay in ' +
          'the language of the menu. Returns {id, title (often the restaurant), restaurant (name candidates), ' +
          'sections, items: [{i, name, description, price, section}], ocr} and the menu image, plus zoomed parts ' +
          'of it when zoom=true or when few items were read. OCR misses thin, handwritten or tilted print: always ' +
          'look at the image, and pass the items you read yourself to match_dishes when they differ.',
        input: z.object({
          id: uuid.describe('Asset ID of the menu photo'),
          zoom: z
            .boolean()
            .optional()
            .describe('Also return zoomed parts of the menu, default: when few items are read'),
        }),
        mutating: false,
        handler: handle(async ({ auth }, { id, zoom }) => {
          const reading = await foodService.readMenu(auth, id);
          const images = await foodService.getMenuImages(auth, id, { zoom: zoom ?? reading.items.length < 3 });
          return withImages(
            {
              id,
              ...(reading.title && { title: reading.title }),
              ...(reading.restaurant.length > 0 && {
                restaurant: reading.restaurant.map(({ name, confidence }) => ({ name, confidence })),
              }),
              ...(reading.sections.length > 0 && { sections: reading.sections }),
              items: reading.items.map(({ name, description, price, section }, i) => ({
                i,
                name,
                ...(description && { description }),
                ...(price && { price }),
                ...(section && { section }),
              })),
              ocr: reading.ocr,
              ...(reading.warnings.length > 0 && { warnings: reading.warnings }),
            },
            images,
          );
        }),
      }),

      defineTool({
        name: 'match_dishes',
        title: 'Match dishes with the menu',
        description:
          'Suggest which menu item each dish photo of one meal shows: CLIP compares the photos with the item names ' +
          '(and descriptions), near-identical photos of the same dish are grouped, and each dish gets a different ' +
          'item unless two dishes clearly share one (a course of assorted desserts, two plates of the same thing). ' +
          'At a tasting menu (few prices) whose courses the photos follow, the dishes are matched in the order of ' +
          'the courses, skipping courses no photo shows and dishes off the menu (ordered: true). Items come from ' +
          'the menuIds (read like read_menu), or pass items yourself (what you read on the menu, in menu order). ' +
          'Returns {items: [{i, name, price, section}], dishes: [{assetIds, match (item name or null), i, score ' +
          '(0-1), unsure, shared, offMenu (probability it is not on the menu: bread, coffee, an amuse-bouche), ' +
          'suggestions: [{i, name, score}]}], ordered} and a contact sheet of the dishes captioned with their ' +
          'suggestions. Suggestions only: check every match with view_photos, especially unsure ones, and name ' +
          'off-menu dishes from what you see. Without a menu, name the dishes yourself.',
        input: z.object({
          dishIds: z.array(uuid).min(1).max(FOOD_LIMITS.dishes),
          menuIds: z.array(uuid).max(FOOD_LIMITS.menus).optional(),
          items: z
            .array(z.object({ name: z.string().min(1).max(200), description: z.string().max(500).optional() }))
            .max(FOOD_LIMITS.items)
            .optional()
            .describe('Menu items to match instead of the ones read on the menu photos'),
          contactSheet: z.boolean().optional().describe('Return the captioned contact sheet, default true'),
        }),
        mutating: false,
        handler: handle(async ({ auth }, { contactSheet = true, ...input }) => {
          const result = await foodService.matchMeal(auth, input);
          const details = compactMatch(result);
          if (!contactSheet || result.dishes.length === 0) {
            return toolJson(details);
          }

          const rows = await this.assetJobRepository.getForAgent(
            result.dishes.map(({ assetIds }) => assetIds[0]),
            auth.user.id,
          );
          const previews = new Map(rows.map((row) => [row.id, row.previewPath]));
          const tiles = result.dishes.slice(0, 36).map((dish, index) => ({
            input: previews.get(dish.assetIds[0]) ?? null,
            label: String(index + 1),
            caption:
              dish.suggestions.length === 0
                ? 'no menu item'
                : dish.suggestions
                    .slice(0, 3)
                    .map(({ name, score }) => `${name} ${percent(score)}`)
                    .join('\n'),
          }));
          const image = await this.mediaRepository.createContactSheet(tiles, { tileSize: 320 });
          const sheet = Object.fromEntries(
            result.dishes.slice(0, 36).map((dish, index) => [index + 1, dish.assetIds[0]]),
          );
          return withImages({ ...details, sheet }, [image]);
        }),
      }),

      defineTool({
        name: 'lookup_restaurant',
        title: 'Look up restaurants on OpenStreetMap',
        description:
          'Look up named restaurants, cafés and bars within `radius` meters (default 75) of a meal on ' +
          'OpenStreetMap, from the GPS of its photos (assetIds) or given coordinates. This sends the location to a ' +
          'public service (the Overpass API), so ask the user before you call it, and only when find_meals could ' +
          'not read the name. The admin has to enable it (Food > OpenStreetMap); when it is disabled the result ' +
          'says so: then ask the user for the name. Returns {places: [{name, amenity, cuisine, distance (m)}]}, ' +
          'closest first; confirm the place with the user.',
        input: z.object({
          assetIds: z.array(uuid).min(1).max(100).optional().describe('Photos of the meal, for their location'),
          latitude: z.number().min(-90).max(90).optional(),
          longitude: z.number().min(-180).max(180).optional(),
          radius: z.int().min(10).max(MAX_LOOKUP_RADIUS).optional().describe('Meters, default 75'),
        }),
        mutating: true,
        handler: handle(async ({ auth }, input) => {
          const result = await foodService.lookupRestaurants(auth, input);
          if (!result.enabled) {
            return toolJson({ enabled: false, message: result.message });
          }
          const { latitude, longitude, radius, places } = result;
          return toolJson({
            location: [latitude, longitude],
            radius,
            places: places.map(({ name, amenity, cuisine, distance }) => ({
              name,
              amenity,
              ...(cuisine && { cuisine }),
              distance,
            })),
            ...(places.length === 0 && { message: 'No named place nearby: ask the user for the name' }),
          });
        }),
      }),

      defineTool({
        name: 'set_dish_names',
        title: 'Name dishes',
        description:
          'Save the names of a meal: every photo gets the tag Food/<restaurant>/<dish> (or Food/<restaurant>/Menu ' +
          'for a menu photo, with menu: true or dish "menu"), replacing the food tag it had, and a dish photo with ' +
          'no description gets "<dish> · <restaurant>". Running it again replaces the names, so it is safe to ' +
          'correct them. Use the names as printed on the menu (in its language), or a short clear name for dishes ' +
          'that are not on it. Photo books and albums can then be built from the Food tags (a book with ' +
          'stylePreset "food"). Returns {restaurant, photos: [{id, tag, description, previousTags}], failed}.',
        input: z.object({
          restaurant: z.string().min(1).max(100).describe('Name of the restaurant'),
          photos: z
            .array(
              z.object({
                id: uuid,
                dish: z.string().max(200).optional().describe('Name of the dish; "menu" for a photo of the menu'),
                menu: z.boolean().optional().describe('The photo shows the menu'),
              }),
            )
            .min(1)
            .max(FOOD_LIMITS.photos),
        }),
        mutating: true,
        handler: handle(async ({ auth }, input) => {
          const { restaurant, results } = await foodService.setDishNames(auth, input);
          const failed = results.filter(({ success }) => !success).map(({ id, error }) => ({ id, error }));
          return toolJson({
            restaurant,
            photos: results
              .filter(({ success }) => success)
              .map(({ id, tag, description, previousTags }) => ({
                id,
                tag,
                ...(description && { description }),
                ...(previousTags && { previousTags }),
              })),
            ...(failed.length > 0 && { failed }),
          });
        }),
      }),
    ];
  }
}
