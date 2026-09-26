import {
  ClassifyRules,
  CollectionPrompts,
  OcrSummary,
  TextScores,
  getOcrSignScore,
} from 'src/utils/collections/classify.js';

/**
 * CLIP text prompts per kind: bottles (their labels), glasses and pours are the subjects; a wine list, a tasting sheet
 * or the pairing of a menu is the source; the sign or the building of a winery, a wine bar or a wine shop is a sign.
 * The "other" prompts give CLIP something else to prefer: the vineyard, the barrels of the cellar and the food of the
 * meal are part of the day, not bottles.
 */
export const WINE_PROMPTS: CollectionPrompts = {
  subject: [
    'a photo of a bottle of wine',
    'a close-up photo of a wine label on a bottle',
    'a photo of a glass of wine next to a bottle',
    'a photo of a glass of red wine',
    'a photo of a glass of white wine',
    'a photo of wine being poured into a glass',
    'a photo of wine bottles on a table',
    'a photo of a bottle of champagne',
    'a photo of a bottle of beer and a glass',
  ],
  source: [
    'a photo of a wine list',
    'a photo of a printed wine menu with prices',
    'a photo of a tasting sheet with a list of wines',
  ],
  sign: [
    'a photo of the sign of a winery',
    'a photo of the entrance of a winery',
    'a photo of the sign of a wine bar',
    'a photo of the storefront of a wine shop',
  ],
  receipt: ['a photo of a receipt', 'a photo of a bill from a wine bar'],
  other: [
    'a photo of people',
    'a selfie',
    'a photo of a landscape',
    'a photo of a vineyard',
    'a photo of barrels in a wine cellar',
    'a photo of a city street',
    'a photo of a building',
    'a photo of a room',
    'a photo of an animal',
    'a photo of a document',
    'a screenshot',
    'a photo of a car',
    'a photo of a plate of food',
    'a photo of a dessert on a plate',
  ],
};

export const WINE_RECEIPT_WORDS =
  /\b(?:total|subtotal|vat|tax|mwst|iva|tva|cash|card|visa|mastercard|amex|rechnung|summe|tip|gratuity|paid|change)\b/gi;

/** words that name a kind of place where wine is made, poured or sold, without the global flag */
export const WINERY_WORDS =
  /(?<!\p{L})(?:weingut|weinbau|weinhaus|weinstube|winzer|winzerhof|sektkellerei|domaine|ch[aâ]teau|bodegas?|cantina|tenuta|fattoria|quinta|winery|vineyards?|cellars?|cellar door|wine bar|wine shop|enoteca|vinoteca|vinothek|weinhandlung|caviste|brewery|brewing|tasting room)(?!\p{L})/iu;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/**
 * The text on a photo: a wine list is many lines, several of them wines (the parser reads a list only when lines have
 * vintages or prices); a label is a few lines and never a source by its text; a winery's name in large letters is a
 * sign; a receipt has totals.
 */
export const scoreWineText = (summary: OcrSummary): TextScores => {
  const { lines, prices, items, receiptWords } = summary;
  const list = items >= 3 && lines >= 8;
  return {
    source: list ? clamp(0.35 * clamp((items - 2) / 6) + 0.35 * clamp(prices / 6) + 0.3 * clamp((lines - 6) / 14)) : 0,
    receipt:
      receiptWords === 0
        ? 0
        : clamp(0.35 * clamp(receiptWords / 2) + 0.35 * clamp(prices / 4) + 0.3 * clamp((receiptWords - 1) / 3)),
    // a label in large letters with "Winery" or "Château" is a bottle: the look of a sign tells more than its text
    sign: 0.5 * getOcrSignScore(summary),
  };
};

/** a kind needs at least this score; the text of a label never makes a bottle less of a bottle, a whole page does */
export const WINE_CLASSIFY_RULES: ClassifyRules = {
  // CLIP takes some label close-ups for a page of text, and a winery's sign for a building: a bottle or a sign needs
  // less than a list, whose text must read as one
  thresholds: { subject: 0.35, source: 0.5, sign: 0.4, receipt: 0.6 },
  scoreText: scoreWineText,
  subjectTextFactor: (lines) => (lines > 30 ? 0.4 : lines > 20 ? 0.7 : 1),
};
