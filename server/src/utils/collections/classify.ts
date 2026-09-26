import { OcrBoxInput, countPrices, groupLines, toTextBoxes } from 'src/utils/collections/ocr.js';
import { SourceParser } from 'src/utils/collections/source.js';

/**
 * What a photo is to a collection: a subject (a dish, an artwork, a bottle), its text source (a menu, a wall label, a
 * bottle label), a sign that names the place (a storefront, a museum entrance), a receipt or ticket that names it too,
 * or something else.
 */
export const collectionKinds = ['subject', 'source', 'sign', 'receipt', 'other'] as const;
export type CollectionKind = (typeof collectionKinds)[number];
export type CollectionPhotoKind = Exclude<CollectionKind, 'other'>;

/** CLIP text prompts per kind; a kind without prompts is only found by its text, if at all */
export type CollectionPrompts = Record<CollectionKind, string[]>;

export type CollectionPrompt = { kind: CollectionKind; text: string };

/** every prompt with its kind, in the order the similarities are passed to `classifyPhoto` */
export const getPromptList = (prompts: CollectionPrompts): CollectionPrompt[] =>
  collectionKinds.flatMap((kind) => prompts[kind].map((text) => ({ kind, text })));

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

/** the probability of each kind, from the similarities of a photo with `prompts` (best prompt per kind) */
export const getClipKindScores = (
  similarities: number[],
  prompts: CollectionPrompt[],
): Record<CollectionKind, number> => {
  const best = collectionKinds.map((kind) =>
    Math.max(...prompts.flatMap((prompt, index) => (prompt.kind === kind ? [similarities[index] ?? -1] : []))),
  );
  const probabilities = softmax(best);
  return Object.fromEntries(collectionKinds.map((kind, index) => [kind, probabilities[index]])) as Record<
    CollectionKind,
    number
  >;
};

export type OcrSummary = {
  /** text lines on the photo */
  lines: number;
  /** amounts that look like prices */
  prices: number;
  /** entries the pack's source parser reads from the photo */
  items: number;
  /** distinct words typical of receipts or tickets (total, VAT, cash...) */
  receiptWords: number;
  /** a word that names a kind of place (trattoria, café, museum...) is on the photo */
  placeWord: boolean;
  /** the height of the largest text, as a fraction of the photo */
  largestText: number;
};

export type TextRules = {
  /** the pack's source parser, which counts the entries of a photo */
  parse: SourceParser;
  /** words of receipts (or tickets), with the global flag */
  receiptWords?: RegExp;
  /** words that name a kind of place, without the global flag */
  placeWords?: RegExp;
};

export const summarizeText = (ocr: OcrBoxInput[], rules: TextRules): OcrSummary => {
  const boxes = toTextBoxes(ocr);
  const lines = groupLines(boxes);
  const text = lines.map((line) => line.text).join('\n');
  const receiptWords = rules.receiptWords
    ? new Set((text.match(rules.receiptWords) ?? []).map((word) => word.toLowerCase())).size
    : 0;
  return {
    lines: lines.length,
    prices: countPrices(text) + boxes.filter((box) => /^\d{1,3}$/.test(box.text) && box.left > 0.5).length,
    items: lines.length >= 3 ? rules.parse(ocr).items.length : 0,
    receiptWords,
    placeWord: rules.placeWords ? rules.placeWords.test(text) : false,
    largestText: Math.max(0, ...boxes.map((box) => box.height)),
  };
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** how much the text on a photo looks like a printed list: many lines, a column of entries, prices */
export const getOcrSourceScore = ({ lines, prices, items, receiptWords }: OcrSummary) => {
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

/** how much the text on a photo looks like a sign: a few lines in large letters with a place word */
export const getOcrSignScore = ({ lines, largestText, placeWord, prices }: OcrSummary) => {
  if (lines === 0 || lines > 8 || prices > 2) {
    return 0;
  }
  return clamp((placeWord ? 0.5 : 0) + 0.3 * clamp(largestText / 0.08) + (lines <= 4 ? 0.2 : 0));
};

export type TextScores = Record<Exclude<CollectionPhotoKind, 'subject'>, number>;

/** the default scores of the text on a photo: a priced list is a source, totals a receipt, large words a sign */
export const scoreText = (summary: OcrSummary): TextScores => ({
  source: getOcrSourceScore(summary),
  receipt: getOcrReceiptScore(summary),
  sign: getOcrSignScore(summary),
});

/** a photo covered in text is not a subject: a page, not a plate */
export const defaultSubjectTextFactor = (lines: number) => (lines > 12 ? 0.3 : lines > 6 ? 0.7 : 1);

export type ClassifyRules = {
  thresholds: Record<CollectionPhotoKind, number>;
  /** the scores of the text on a photo, default `scoreText` */
  scoreText?: (summary: OcrSummary) => TextScores;
  /** how much the text lines on a photo leave of its subject score, default `defaultSubjectTextFactor` */
  subjectTextFactor?: (lines: number) => number;
};

export type Classification = {
  kind: CollectionKind;
  /** 0..1 */
  confidence: number;
  scores: Record<CollectionKind, number>;
};

const round = (value: number) => Math.round(value * 1000) / 1000;

const NO_TEXT: OcrSummary = { lines: 0, prices: 0, items: 0, receiptWords: 0, placeWord: false, largestText: 0 };

/**
 * Classifies a photo as a subject, a source, a sign, a receipt or something else, from the CLIP similarities of the
 * photo with the pack's prompts (`getPromptList`) and the text OCR found on it. CLIP decides subjects; the text makes
 * sources, receipts and signs more (or less) likely. A photo covered in text is not a subject.
 */
export const classifyPhoto = (
  rules: ClassifyRules,
  prompts: CollectionPrompt[],
  { similarities, ocr }: { similarities?: number[] | null; ocr?: OcrSummary | null },
): Classification => {
  const clip = similarities?.length ? getClipKindScores(similarities, prompts) : undefined;
  const text = ocr ?? NO_TEXT;
  const textScores = (rules.scoreText ?? scoreText)(text);
  const subjectTextFactor = rules.subjectTextFactor ?? defaultSubjectTextFactor;

  const clipScore = (kind: CollectionKind) => clip?.[kind] ?? 0;
  const combine = (clipValue: number, ocrValue: number) =>
    clip ? clamp(Math.max(clipValue, ocrValue) + 0.25 * Math.min(clipValue, ocrValue)) : ocrValue;

  const scores: Record<CollectionKind, number> = {
    subject: clamp(clipScore('subject') * subjectTextFactor(text.lines)),
    source: combine(clipScore('source'), textScores.source),
    sign: combine(clipScore('sign'), textScores.sign),
    receipt: combine(clipScore('receipt'), textScores.receipt),
    other: clipScore('other'),
  };
  // text that reads as a receipt is not a source, whatever CLIP says
  if (textScores.receipt >= rules.thresholds.receipt && scores.receipt >= scores.source) {
    scores.source *= 0.5;
  }

  const candidates = (['source', 'receipt', 'subject', 'sign'] as const)
    .filter((kind) => scores[kind] >= rules.thresholds[kind])
    .toSorted((a, b) => scores[b] - scores[a]);
  const kind: CollectionKind = candidates.at(0) ?? 'other';
  const confidence =
    kind === 'other' ? (clip ? Math.max(scores.other, 1 - Math.max(scores.subject, scores.source)) : 1) : scores[kind];

  return {
    kind,
    confidence: round(confidence),
    scores: Object.fromEntries(collectionKinds.map((key) => [key, round(scores[key])])) as Record<
      CollectionKind,
      number
    >,
  };
};
