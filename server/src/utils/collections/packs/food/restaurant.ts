import {
  cleanItemText,
  isPageFurniture,
  isSectionHeading,
  parseMenu,
  splitPrice,
} from 'src/utils/collections/packs/food/menu.js';
import { PlaceNameRules, PlacePhoto, cleanPlaceName, findPlaceNames } from 'src/utils/collections/place.js';

/** words that name a kind of place where people eat or drink, in the languages of the menus */
export const RESTAURANT_WORDS =
  /(?<!\p{L})(?:ristorante|trattoria|osteria|pizzeria|taverna|enoteca|locanda|bar|caff[eè]|caf[eé]|bistro|bistrot|brasserie|restaurant|restaurante|cantina|gelateria|pasticceria|panificio|bodega|taberna|tasca|marisquer[ií]a|cervecer[ií]a|asador|auberge|cr[eê]perie|boulangerie|p[aâ]tisserie|pub|tavern|grill|diner|kitchen|eatery|steakhouse|sushi|ramen|izakaya|deli|delicat\p{L}*|delikatessen|bakery|brewery|taqueria|noodle bar|chophouse|oyster bar)(?!\p{L})/iu;

export const hasRestaurantWord = (text: string) => RESTAURANT_WORDS.test(text);

/** labels, associations and slogans that are printed on signs and menus but don't name the place */
const NOT_A_NAME =
  /relais\s*&?\s*ch[aâ]teaux|grandes tables|michelin|tripadvisor|zagat|gault\s*&?\s*millau|certificate of excellence|travell?ers'? choice|slow food|^(?:open|opened|welcome|entrance|entrata|ingresso|exit|uscita|push|pull|spingere|tirare|visa|mastercard|american express|no smoking|vietato fumare|since \d{4}|dal \d{4}|est\.? \d{4}|thank you|grazie|merci|gracias)$/i;

/** how the name of a restaurant is read on its signs, menus and receipts */
export const RESTAURANT_NAME_RULES: PlaceNameRules = {
  words: RESTAURANT_WORDS,
  blocked: NOT_A_NAME,
  cleanLine: (text) => cleanItemText(splitPrice(text).text),
  isNotName: (text) => isSectionHeading(text) || isPageFurniture(text),
  title: (ocr) => parseMenu(ocr).title,
};

/** the name of a restaurant as printed on a line, without legal suffixes and prices; undefined when it can't be one */
export const cleanRestaurantName = (text: string) => cleanPlaceName(text, RESTAURANT_NAME_RULES);

/**
 * Candidates for the name of a restaurant from the text on its signs, menus (sources) and receipts, best first (see
 * `findPlaceNames`).
 */
export const findRestaurantNames = (photos: PlacePhoto[], limit = 3) =>
  findPlaceNames(photos, RESTAURANT_NAME_RULES, limit);
