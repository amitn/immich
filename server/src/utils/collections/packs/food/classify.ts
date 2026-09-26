import {
  ClassifyRules,
  CollectionPrompts,
  OcrSummary,
  classifyPhoto,
  getPromptList,
  summarizeText,
} from 'src/utils/collections/classify.js';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { parseMenu } from 'src/utils/collections/packs/food/menu.js';
import { RESTAURANT_WORDS } from 'src/utils/collections/packs/food/restaurant.js';

/**
 * CLIP text prompts per kind: dishes and drinks are the subjects, menus the source, restaurant signs and storefronts
 * the signs; a photo is compared with each of them. The "other" prompts give CLIP something else to prefer for the
 * people, places and things that fill the rest of a library.
 */
export const FOOD_PROMPTS: CollectionPrompts = {
  subject: [
    'a photo of a plate of food',
    'a close-up photo of a dish served in a restaurant',
    'a photo of a meal on a restaurant table',
    'a photo of a dessert on a plate',
    'a photo of pasta',
    'a photo of pizza',
    'a photo of a drink or a cocktail on a table',
    'a photo of a cup of coffee and a pastry',
  ],
  source: [
    'a photo of a restaurant menu',
    'a photo of a printed menu with a list of dishes and prices',
    'a photo of a menu board on a wall',
    'a photo of a handwritten chalkboard menu',
  ],
  sign: [
    'a photo of a restaurant storefront',
    'a photo of the sign of a restaurant',
    'a photo of the entrance of a cafe',
    'a photo of the facade of a trattoria',
  ],
  receipt: ['a photo of a restaurant receipt', 'a photo of a bill from a restaurant'],
  other: [
    'a photo of people',
    'a selfie',
    'a photo of a landscape',
    'a photo of a city street',
    'a photo of a building',
    'a photo of the beach',
    'a photo of a room',
    'a photo of an animal',
    'a photo of a document',
    'a screenshot',
    'a photo of a car',
  ],
};

/** every prompt with its kind, in the order the similarities are passed to `classifyFood` */
export const FOOD_PROMPT_LIST = getPromptList(FOOD_PROMPTS);

export const RECEIPT_WORDS =
  /\b(?:total[e]?|subtotal|sub-total|iva|tva|vat|tax|mwst|cash|contanti|resto|change|carta|card|visa|mastercard|amex|scontrino|ricevuta|fattura|documento commerciale|ticket|rechnung|summe|importe|propina|tip|gratuity|tavolo|table|coperti|covers|cameriere|server|pagato|paid|bancomat|efectivo|cambio)\b/gi;

/** a kind needs at least this score */
export const FOOD_CLASSIFY_RULES: ClassifyRules = {
  thresholds: { subject: 0.5, source: 0.5, sign: 0.55, receipt: 0.55 },
};

/** the text on a photo: its lines, prices, menu items, receipt words and restaurant words */
export const summarizeFoodText = (ocr: OcrBoxInput[]): OcrSummary =>
  summarizeText(ocr, { parse: parseMenu, receiptWords: RECEIPT_WORDS, placeWords: RESTAURANT_WORDS });

/**
 * Classifies a photo as a dish (subject), a menu (source), a restaurant sign or storefront, a receipt, or something
 * else: a menu has many lines in a column with prices, a receipt has totals and taxes, a sign a few large words such
 * as "Trattoria". A photo covered in text is not a dish.
 */
export const classifyFood = (input: { similarities?: number[] | null; ocr?: OcrSummary | null }) =>
  classifyPhoto(FOOD_CLASSIFY_RULES, FOOD_PROMPT_LIST, input);
