import {
  ClassifyRules,
  CollectionPrompts,
  OcrSummary,
  TextScores,
  getOcrSignScore,
} from 'src/utils/collections/classify.js';

/**
 * CLIP text prompts per kind: plants, their flowers, fruit and harvest are the subjects; seed packets and plant tags
 * the sources; the sign of a garden, a nursery or an orchard a sign. The "other" prompts give CLIP something else to
 * prefer: people, the house, a street, the tools.
 */
export const GARDEN_PROMPTS: CollectionPrompts = {
  subject: [
    'a photo of a young fruit tree in a garden',
    'a photo of a plant growing in a garden',
    'a close-up photo of blossoms on a branch',
    'a close-up photo of fruit on a tree',
    'a photo of vegetables growing in a garden bed',
    'a photo of lettuce growing in a pot',
    'a photo of seedlings in pots',
    'a photo of flowers in a garden',
    'a photo of harvested fruit and vegetables',
  ],
  source: [
    'a photo of a seed packet',
    'a photo of a plant tag at the foot of a tree',
    'a close-up photo of a metal plant label with embossed letters',
    'a photo of a plant label stuck in the soil',
  ],
  sign: ['a photo of the sign of a garden nursery', 'a photo of the entrance sign of a botanical garden'],
  receipt: ['a photo of a receipt'],
  other: [
    'a photo of people',
    'a selfie',
    'a photo of a house',
    'a photo of a city street',
    'a photo of a room',
    'a photo of an animal',
    'a screenshot',
    'a photo of a car',
    'a photo of a plate of food',
    'a photo of garden tools',
  ],
};

export const GARDEN_RECEIPT_WORDS = /\b(?:total|subtotal|tax|cash|card|visa|paid|change)\b/gi;

/** words that name a kind of place where plants grow or are sold, without the global flag */
export const GARDEN_WORDS =
  /(?<!\p{L})(?:garden|gardens|nursery|orchard|farm|allotment|greenhouse|botanical|arboretum|garden centre|garden center)(?!\p{L})/iu;

/** the text on a photo: a seed packet names a crop in large print; a tag a few words; a nursery's name a sign */
export const scoreGardenText = (summary: OcrSummary): TextScores => {
  const { lines, items, receiptWords } = summary;
  return {
    source: items >= 1 && lines >= 2 && receiptWords === 0 ? Math.min(1, 0.45 + 0.05 * lines) : 0,
    receipt: 0,
    sign: 0.6 * getOcrSignScore(summary),
  };
};

/** a kind needs at least this score; a plant with a nursery tag in the frame is still a plant */
export const GARDEN_CLASSIFY_RULES: ClassifyRules = {
  thresholds: { subject: 0.2, source: 0.5, sign: 0.5, receipt: 0.7 },
  scoreText: scoreGardenText,
  subjectTextFactor: (lines) => (lines > 8 ? 0.5 : 1),
};
