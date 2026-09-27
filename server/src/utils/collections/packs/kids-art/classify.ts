import { ClassifyRules, CollectionPrompts, OcrSummary, TextScores } from 'src/utils/collections/classify.js';

/**
 * CLIP text prompts per kind: children's drawings, paintings, crafts and illustrated letters are the subjects; a note
 * a parent wrote about an artwork (the name, the age, the date) is the source. A photo of a child, a person or a
 * family is "other": the pack is for the artworks only, never for photos of the children.
 */
export const KIDS_ART_PROMPTS: CollectionPrompts = {
  subject: [
    "a photo of a child's drawing",
    "a photo of a child's painting",
    'a photo of a crayon drawing on paper',
    'a photo of a drawing by a young child',
    "a scan of a child's drawing",
    'a photo of a handwritten letter decorated with drawings by a child',
    "a photo of a child's craft project",
    'a photo of a drawing taped to a wall',
    'a photo of a hand-painted plate',
    'a photo of a toy made of building blocks',
  ],
  source: ['a photo of a handwritten note on a card', 'a photo of a label with a name and a date'],
  sign: [],
  receipt: [],
  other: [
    'a photo of a child',
    'a photo of a baby',
    'a photo of a person',
    'a photo of people',
    'a photo of a family',
    'a selfie',
    'a photo of a landscape',
    'a photo of a city street',
    'a photo of a room',
    'a photo of a pet',
    'a screenshot',
    'a photo of a plate of food',
    'a photo of a printed document',
    'a photo of a painting in a museum',
  ],
};

/** what is written on an artwork never makes it a source: a note is, by what CLIP sees */
export const scoreKidsArtText = (): TextScores => ({ source: 0, receipt: 0, sign: 0 });

/** a letter covered in handwriting is still an artwork */
export const KIDS_ART_CLASSIFY_RULES: ClassifyRules & { scoreText: (summary: OcrSummary) => TextScores } = {
  thresholds: { subject: 0.3, source: 0.6, sign: 1.1, receipt: 1.1 },
  scoreText: scoreKidsArtText,
  subjectTextFactor: () => 1,
};
