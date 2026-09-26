import { parseMenu } from 'src/utils/food/menu.js';
import { OcrBoxInput, countPrices, groupLines, toTextBoxes } from 'src/utils/food/ocr.js';

export const foodKinds = ['dish', 'menu', 'sign', 'receipt', 'other'] as const;
export type FoodKind = (typeof foodKinds)[number];

/**
 * CLIP text prompts per kind; a photo is compared with each of them. The "other" prompts give CLIP something else to
 * prefer for the people, places and things that fill the rest of a library.
 */
export const FOOD_PROMPTS: Record<FoodKind, string[]> = {
  dish: [
    'a photo of a plate of food',
    'a close-up photo of a dish served in a restaurant',
    'a photo of a meal on a restaurant table',
    'a photo of a dessert on a plate',
    'a photo of pasta',
    'a photo of pizza',
    'a photo of a drink or a cocktail on a table',
    'a photo of a cup of coffee and a pastry',
  ],
  menu: [
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
export const FOOD_PROMPT_LIST = foodKinds.flatMap((kind) => FOOD_PROMPTS[kind].map((text) => ({ kind, text })));

/** CLIP's logit scale: cosine similarities are multiplied by this before the softmax */
export const CLIP_TEMPERATURE = 100;

export const softmax = (values: number[], temperature = CLIP_TEMPERATURE) => {
  if (values.length === 0) {
    return [];
  }
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp((value - max) * temperature));
  const sum = exps.reduce((total, value) => total + value, 0);
  return exps.map((value) => value / sum);
};

/** the probability of each kind, from the similarities of a photo with `FOOD_PROMPT_LIST` (best prompt per kind) */
export const getClipKindScores = (similarities: number[]): Record<FoodKind, number> => {
  const best = foodKinds.map((kind) =>
    Math.max(...FOOD_PROMPT_LIST.flatMap((prompt, index) => (prompt.kind === kind ? [similarities[index] ?? -1] : []))),
  );
  const probabilities = softmax(best);
  return Object.fromEntries(foodKinds.map((kind, index) => [kind, probabilities[index]])) as Record<FoodKind, number>;
};

const RECEIPT_WORDS =
  /\b(?:total[e]?|subtotal|sub-total|iva|tva|vat|tax|mwst|cash|contanti|resto|change|carta|card|visa|mastercard|amex|scontrino|ricevuta|fattura|documento commerciale|ticket|rechnung|summe|importe|propina|tip|gratuity|tavolo|table|coperti|covers|cameriere|server|pagato|paid|bancomat|efectivo|cambio)\b/gi;

const RESTAURANT_WORDS =
  /(?<!\p{L})(?:ristorante|trattoria|osteria|pizzeria|taverna|enoteca|locanda|bar|caff[eè]|caf[eé]|bistro|bistrot|brasserie|restaurant|restaurante|cantina|gelateria|pasticceria|panificio|bodega|taberna|tasca|marisquer[ií]a|cervecer[ií]a|asador|auberge|cr[eê]perie|boulangerie|p[aâ]tisserie|pub|tavern|grill|diner|kitchen|eatery|steakhouse|sushi|ramen|izakaya|deli|delicat\p{L}*|delikatessen|bakery|brewery|taqueria|noodle bar|chophouse|oyster bar)(?!\p{L})/iu;

export const hasRestaurantWord = (text: string) => RESTAURANT_WORDS.test(text);

export type OcrSummary = {
  /** text lines on the photo */
  lines: number;
  /** amounts that look like prices */
  prices: number;
  /** items `parseMenu` reads from the photo */
  items: number;
  /** distinct words typical of receipts (total, VAT, cash...) */
  receiptWords: number;
  /** a restaurant word (trattoria, café...) is on the photo */
  restaurantWord: boolean;
  /** the height of the largest text, as a fraction of the photo */
  largestText: number;
};

export const summarizeOcr = (ocr: OcrBoxInput[]): OcrSummary => {
  const boxes = toTextBoxes(ocr);
  const lines = groupLines(boxes);
  const text = lines.map((line) => line.text).join('\n');
  const receiptWords = new Set((text.match(RECEIPT_WORDS) ?? []).map((word) => word.toLowerCase())).size;
  return {
    lines: lines.length,
    prices: countPrices(text) + boxes.filter((box) => /^\d{1,3}$/.test(box.text) && box.left > 0.5).length,
    items: lines.length >= 3 ? parseMenu(ocr).items.length : 0,
    receiptWords,
    restaurantWord: hasRestaurantWord(text),
    largestText: Math.max(0, ...boxes.map((box) => box.height)),
  };
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** how much the text on a photo looks like a menu: many lines, a column of items, prices */
export const getOcrMenuScore = ({ lines, prices, items, receiptWords }: OcrSummary) => {
  if (lines < 4) {
    return 0;
  }
  const score =
    0.3 * clamp((items - 2) / 6) +
    0.4 * clamp(prices / 8) +
    0.3 * clamp((lines - 4) / 16) -
    0.15 * clamp(receiptWords / 3);
  return clamp(score);
};

/** how much the text on a photo looks like a receipt: typical words and several amounts */
export const getOcrReceiptScore = ({ prices, receiptWords }: OcrSummary) =>
  receiptWords === 0
    ? 0
    : clamp(0.35 * clamp(receiptWords / 2) + 0.35 * clamp(prices / 4) + 0.3 * clamp((receiptWords - 1) / 3));

/** how much the text on a photo looks like a sign: a few lines in large letters with a restaurant word */
export const getOcrSignScore = ({ lines, largestText, restaurantWord, prices }: OcrSummary) => {
  if (lines === 0 || lines > 8 || prices > 2) {
    return 0;
  }
  return clamp((restaurantWord ? 0.5 : 0) + 0.3 * clamp(largestText / 0.08) + (lines <= 4 ? 0.2 : 0));
};

export type FoodClassification = {
  kind: FoodKind;
  /** 0..1 */
  confidence: number;
  scores: Record<FoodKind, number>;
};

/** a kind needs at least this score */
export const FOOD_THRESHOLDS = {
  dish: 0.5,
  menu: 0.5,
  sign: 0.55,
  receipt: 0.55,
};

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Classifies a photo as a dish, a menu, a restaurant sign or storefront, a receipt, or something else, from the CLIP
 * similarities of the photo with `FOOD_PROMPT_LIST` and the text OCR found on it. CLIP decides dishes; the text makes
 * menus, receipts and signs more (or less) likely: a menu has many lines in a column with prices, a receipt has
 * totals and taxes, a sign a few large words such as "Trattoria". A photo covered in text is not a dish.
 */
export const classifyFood = ({
  similarities,
  ocr,
}: {
  similarities?: number[] | null;
  ocr?: OcrSummary | null;
}): FoodClassification => {
  const clip = similarities?.length ? getClipKindScores(similarities) : undefined;
  const text = ocr ?? { lines: 0, prices: 0, items: 0, receiptWords: 0, restaurantWord: false, largestText: 0 };

  const ocrMenu = getOcrMenuScore(text);
  const ocrReceipt = getOcrReceiptScore(text);
  const ocrSign = getOcrSignScore(text);

  const clipScore = (kind: FoodKind) => clip?.[kind] ?? 0;
  const combine = (clipValue: number, ocrValue: number) =>
    clip ? clamp(Math.max(clipValue, ocrValue) + 0.25 * Math.min(clipValue, ocrValue)) : ocrValue;

  const scores: Record<FoodKind, number> = {
    // lots of text is a menu, a receipt or a page, not a plate
    dish: clamp(clipScore('dish') * (text.lines > 12 ? 0.3 : text.lines > 6 ? 0.7 : 1)),
    menu: combine(clipScore('menu'), ocrMenu),
    sign: combine(clipScore('sign'), ocrSign),
    receipt: combine(clipScore('receipt'), ocrReceipt),
    other: clipScore('other'),
  };
  // text that reads as a receipt is not a menu, whatever CLIP says
  if (ocrReceipt >= FOOD_THRESHOLDS.receipt && scores.receipt >= scores.menu) {
    scores.menu *= 0.5;
  }

  const candidates = (['menu', 'receipt', 'dish', 'sign'] as const)
    .filter((kind) => scores[kind] >= FOOD_THRESHOLDS[kind])
    .toSorted((a, b) => scores[b] - scores[a]);
  const kind: FoodKind = candidates.at(0) ?? 'other';
  const confidence =
    kind === 'other' ? (clip ? Math.max(scores.other, 1 - Math.max(scores.dish, scores.menu)) : 1) : scores[kind];

  return {
    kind,
    confidence: round(confidence),
    scores: Object.fromEntries(foodKinds.map((key) => [key, round(scores[key])])) as Record<FoodKind, number>,
  };
};
