import { ClassifyRules, CollectionPrompts, OcrSummary, TextScores } from 'src/utils/collections/classify.js';

/**
 * CLIP text prompts per kind: the photos of a cooking session (ingredients, a step in the bowl, the pan or the oven,
 * and the finished dish) are the subjects, the recipe (a card or a cookbook page) the source. A cooking session has no
 * signs or receipts. The "other" prompts give CLIP something else to prefer for the rest of a library.
 */
export const COOKBOOK_PROMPTS: CollectionPrompts = {
  subject: [
    'a photo of food being prepared in a home kitchen',
    'a photo of ingredients in a mixing bowl',
    'a photo of cooking in a pan on the stove',
    'a photo of a dish baking in the oven',
    'a photo of chopped vegetables on a cutting board',
    'a photo of batter in a bowl',
    'a photo of a homemade dish in a baking dish',
    'a photo of a homemade cake or cupcakes',
    'a photo of a plate of home-cooked food',
  ],
  // "a recipe" alone is a photo of food to CLIP (recipe sites): the source is the page of text
  source: [
    'a photo of a page of text in a cookbook',
    'a photo of a printed page with a list of ingredients and instructions',
    'a photo of a handwritten recipe card with text',
    'a close-up photo of printed text on paper',
  ],
  sign: [],
  receipt: [],
  other: [
    'a photo of people',
    'a selfie',
    'a photo of a landscape',
    'a photo of a city street',
    'a photo of a building',
    'a photo of a room',
    'a photo of an animal',
    'a photo of a document',
    'a screenshot',
    'a photo of a car',
    'a photo of a restaurant menu',
  ],
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/**
 * The text on a photo: a recipe is many lines with its steps (the entries the parser reads) but no prices, and never a
 * receipt or a sign; the labels of the appliances a step is photographed on (an oven door, a mixer) are a word or two
 * and don't make it a recipe.
 */
export const scoreRecipeText = ({ lines, items }: OcrSummary): TextScores => ({
  source: lines < 6 ? 0 : clamp(0.55 * clamp((lines - 5) / 15) + 0.45 * clamp((items - 1) / 4)),
  receipt: 0,
  sign: 0,
});

/** a kind needs at least this score; a photo covered in text is not a step of the cooking */
export const COOKBOOK_CLASSIFY_RULES: ClassifyRules = {
  thresholds: { subject: 0.45, source: 0.5, sign: 1, receipt: 1 },
  scoreText: scoreRecipeText,
  subjectTextFactor: (lines) => (lines > 12 ? 0.3 : lines > 6 ? 0.7 : 1),
};
