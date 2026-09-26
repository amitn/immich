import { CollectionPack } from 'src/utils/collections/pack.js';
import { FOOD_CLASSIFY_RULES, FOOD_PROMPTS, RECEIPT_WORDS } from 'src/utils/collections/packs/food/classify.js';
import { parseMenu } from 'src/utils/collections/packs/food/menu.js';
import { RESTAURANT_NAME_RULES } from 'src/utils/collections/packs/food/restaurant.js';
import { DEFAULT_VISIT_OPTIONS } from 'src/utils/collections/visits.js';

/** OpenStreetMap amenities where people eat or drink */
export const FOOD_AMENITIES = [
  'restaurant',
  'cafe',
  'bar',
  'pub',
  'fast_food',
  'ice_cream',
  'food_court',
  'biergarten',
] as const;

export type MealType = 'Breakfast' | 'Lunch' | 'Dinner';

/** breakfast before 11:00, lunch until 16:00, dinner after (local time) */
export const getMealType = (time: number): MealType => {
  const hour = new Date(time).getUTCHours();
  if (hour >= 4 && hour < 11) {
    return 'Breakfast';
  }
  if (hour >= 11 && hour < 16) {
    return 'Lunch';
  }
  return 'Dinner';
};

/** texts for dishes that are usually not on a menu; the best of them competes with the items as "not on the menu" */
export const OFF_MENU_PROMPTS = [
  'a photo of food',
  'a photo of a bread basket with butter',
  'a photo of a cup of coffee',
  'a photo of a small amuse-bouche',
  'a photo of chocolates and petits fours',
];

/** the CLIP text of a menu item */
export const itemPrompt = (item: { name: string; description?: string }) => {
  const text = item.description ? `${item.name}: ${item.description}` : item.name;
  return `a photo of ${text.length > 200 ? text.slice(0, 200) : text}`;
};

/** The description a dish photo gets when it has none yet, e.g. "Spaghetti alle vongole · Trattoria da Nino". */
export const getDishDescription = (restaurant: string, dish: string) => `${dish.trim()} · ${restaurant.trim()}`;

/**
 * Food: restaurant meals. Dishes and drinks are the subjects, the menu is the source, the restaurant is the place and
 * its menu items are the entries; photos are tagged `Food/<Restaurant>/<Dish>` and `Food/<Restaurant>/Menu`, and
 * books in the Food style (a printed menu) have a chapter per meal opened by its menu.
 */
export const foodPack: CollectionPack = {
  id: 'food',
  title: 'Food',
  description: 'restaurant meals: photos of dishes and drinks, matched with the items of the menu',
  tagRoot: 'Food',
  sourceLeaf: 'Menu',
  names: {
    subject: 'dish',
    subjects: 'dishes',
    source: 'menu',
    sources: 'menus',
    place: 'restaurant',
    entry: 'menu item',
    entries: 'menu items',
    visit: 'meal',
    visits: 'meals',
  },

  prompts: FOOD_PROMPTS,
  classify: { ...FOOD_CLASSIFY_RULES, receiptWords: RECEIPT_WORDS },

  source: { parse: parseMenu, prompt: itemPrompt },

  place: {
    ...RESTAURANT_NAME_RULES,
    fallbackName: ({ type, city, day }) => (city ? `${type} in ${city}` : `${type} on ${day}`),
    lookup: { filters: [{ key: 'amenity', values: FOOD_AMENITIES }] },
  },

  visits: { options: DEFAULT_VISIT_OPTIONS, type: getMealType },

  // calibrated on real meals, see `benchmark.spec.ts`: the order of a tasting menu applies when the photos follow it
  match: { options: { order: 'auto' }, offListPrompts: OFF_MENU_PROMPTS },

  describe: (dish, restaurant) => getDishDescription(restaurant, dish),

  book: {
    preset: {
      id: 'food',
      name: 'Food',
      description:
        'A printed menu: warm off-white paper, deep ink and terracotta, small-caps serif headings, thin rules and ' +
        'ornaments, and the name of every dish below its photo',
      summary:
        'a printed menu: warm paper, small-caps serif headings, thin rules and ornaments, dish names below the ' +
        'photos; lays out one chapter per restaurant visit',
      style: {
        marginMm: 18,
        gutterMm: 6,
        background: '#f6f0e4',
        textColor: '#2a2420',
        fontFamily: 'FreeSerif, serif',
        titleSizePt: 30,
        captionSizePt: 10.5,
        theme: 'food',
        accentColor: '#8c3b2a',
      },
    },
    theme: {
      id: 'food',
      summary:
        'a printed menu: small-caps headings, thin rules and ornaments, and the names of the dishes set below the photos',
      look: 'printed',
    },
    caption: (dish) => dish,
    review: { unnamedEntries: true, missingSourcePage: true },
  },

  agent: {
    instructions:
      'Food (pack "food": subjects are dishes and drinks, the source is the menu, places are restaurants, visits ' +
      'are meals): find_visits finds the restaurant visits (dishes, menus, signs, receipts) in an album, a date range ' +
      'or photos. For each meal: read_source its menu photos (look at the image too: OCR misses thin or small print, ' +
      'so read the items yourself when it does), then match_subjects with the subjectIds and sourceIds (or the ' +
      'entries you read), and check every suggestion with view_photos; unsure and offList dishes need your eyes, and ' +
      'dishes that are not on the menu (bread, coffee, an amuse-bouche) get a short name from what you see. The ' +
      'restaurant name comes from the tags, a sign, the menu or a receipt; when its source is fallback, ask the user ' +
      'for the name (if they agree, lookup_place can search OpenStreetMap near the photos, but it sends the location ' +
      'to a public service and the admin may have disabled it). Then save with save_entries (names as printed on the ' +
      'menu, menu photos with source: true; only photos of food and drinks plus the menu: leave out signs, ' +
      'storefronts, receipts and table or people shots), and offer an album of the meal or a food photo book ' +
      '(stylePreset "food").',
  },

  messages: {
    smartSearchDisabled:
      'Smart search is disabled: dishes cannot be recognized, only menus, signs and receipts by their text',
    ocrDisabled: 'OCR is disabled: menus, signs and receipts are recognized by their look only',
  },
};
