import {
  ClassifyRules,
  CollectionPrompts,
  OcrSummary,
  TextScores,
  getOcrReceiptScore,
  getOcrSignScore,
} from 'src/utils/collections/classify.js';

/**
 * CLIP text prompts per kind: book covers, spines, title pages and open books are the subjects; a reading list is
 * the source; the sign or the building of a library or a bookshop is a sign. The "other" prompts give CLIP something
 * else to prefer: people reading, a room, a street, food.
 */
export const READING_PROMPTS: CollectionPrompts = {
  subject: [
    'a photo of a book cover',
    'a photo of the title page of an old book',
    'a photo of an old printed title page',
    'a close-up photo of the cover of a hardcover book',
    'a photo of an open book',
    'a photo of book spines on a shelf',
    'a photo of a stack of books',
    'a photo of a paperback novel',
    'a photo of an antique book in a display case',
  ],
  source: ['a photo of a reading list', 'a photo of a handwritten list of book titles'],
  sign: [
    'a photo of the sign of a library',
    'a photo of a library building',
    'a photo of the entrance of a bookshop',
    'a photo of the storefront of a bookstore',
  ],
  receipt: ['a photo of a receipt', 'a photo of a bookshop receipt'],
  other: [
    'a photo of people',
    'a selfie',
    'a photo of a landscape',
    'a photo of a city street',
    'a photo of a room',
    'a photo of an animal',
    'a screenshot',
    'a photo of a car',
    'a photo of a plate of food',
    'a photo of a painting in a museum',
  ],
};

export const READING_RECEIPT_WORDS = /\b(?:total|subtotal|vat|tax|mwst|cash|card|visa|summe|paid|change|isbn)\b/gi;

/** words that name a kind of place where books are lent, sold or kept, without the global flag */
export const LIBRARY_WORDS =
  /(?<!\p{L})(?:library|bibliothek|biblioth[eè]que|biblioteca|b[uü]cherei|stadtb[uü]cherei|bookshop|bookstore|book shop|books|buchhandlung|librairie|libreria|librer[ií]a|antiquariat|antiquarian|reading room|lesesaal|archives?|cent(?:er|re))(?!\p{L})/iu;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/**
 * The text on a photo: a title page is full of text but never a source by it (the parser reads one book); a list of
 * books is a source; a library's name in large letters is a sign, less than CLIP sees one (a title page names its
 * publisher, "Buchhandlung", in large type); a receipt has totals.
 */
export const scoreReadingText = (summary: OcrSummary): TextScores => {
  const { lines, items } = summary;
  return {
    source: items >= 3 && lines >= 4 ? clamp(0.4 + 0.1 * (items - 3)) : 0,
    receipt: getOcrReceiptScore(summary),
    sign: 0.5 * getOcrSignScore(summary),
  };
};

/** a kind needs at least this score; the text of a title page never makes it less of a book */
export const READING_CLASSIFY_RULES: ClassifyRules = {
  thresholds: { subject: 0.35, source: 0.5, sign: 0.4, receipt: 0.6 },
  scoreText: scoreReadingText,
  subjectTextFactor: () => 1,
};
