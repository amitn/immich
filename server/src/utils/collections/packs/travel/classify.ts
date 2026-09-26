import { ClassifyRules, CollectionPrompts, OcrSummary, TextScores } from 'src/utils/collections/classify.js';

/**
 * What a photo is to a trip: a trip photo (the subject: anything taken on the trip, streets, beaches, stations, signs
 * and all) or a travel document (the source: a boarding pass, a ticket, a fare receipt). Signs and receipts are not
 * kinds of their own: a sign is a trip photo, a fare receipt a document.
 */
export const TRAVEL_PROMPTS: CollectionPrompts = {
  subject: [
    'a travel photo',
    'a photo of a landmark',
    'a photo of a street in a town',
    'a photo of a beach',
    'a photo of a harbour with boats',
    'a photo of mountains and a gorge',
    'a photo of a bus station',
    'a photo of an airport',
    'a photo of a train station',
    'a photo of a museum',
    'a photo of a temple or a shrine',
    'a photo of an aquarium',
    'a photo of a garden',
    'a photo of a ferry',
    'a photo of a sign',
  ],
  source: [
    'a photo of a boarding pass',
    'a photo of a bus ticket',
    'a photo of a train ticket',
    'a photo of a ferry ticket',
    'a photo of a small paper admission ticket',
    'a photo of a paper ticket',
    'a photo of a receipt',
    'a scan of a printed ticket',
  ],
  sign: [],
  receipt: [],
  other: ['a screenshot of a phone', 'a photo of a computer screen', 'a blank dark image'],
};

/**
 * words of travel documents, with the global flag: labels of boarding passes and tickets in English, Greek (and its
 * Latin lookalikes), Japanese and Chinese
 */
export const TRAVEL_DOCUMENT_WORDS =
  /\b(?:boarding|gate|seat|flight|flt|ticket|passenger|platform|departure|depart|arrival|arrive|fare|class|zone|pnr|vessel|route|from-to|economy|valid|refundable|reissued|receipt)\b|ei[sσzξe]ithpio\p{L}*|εισιτηριο\p{L}*|hmepomhnia|ημερομηνια|ktea|κτελ|乗車|搭乗|登機|領収|券|円区間|有効|入場|入场|門票|航班/giu;

/**
 * The text of a travel document: a leg read on it (the parser found a journey), and the words of tickets. A photo of a
 * sign or a timetable has words but no leg.
 */
export const scoreTravelText = (summary: OcrSummary): TextScores => {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const words = Math.min(summary.receiptWords, 5);
  const source = summary.items > 0 ? clamp(0.4 + 0.12 * words) : summary.lines >= 3 ? clamp(0.06 * words) : 0;
  return { source, sign: 0, receipt: 0 };
};

export const TRAVEL_CLASSIFY_RULES: ClassifyRules & { receiptWords: RegExp } = {
  // a trip photo is anything that is not a document or a screenshot; signs and receipts are never kinds of their own
  thresholds: { subject: 0.2, source: 0.6, sign: 2, receipt: 2 },
  scoreText: scoreTravelText,
  // signs, menus and information boards are trip photos too: only a page covered in text is not one
  subjectTextFactor: (lines) => (lines > 24 ? 0.5 : 1),
  receiptWords: TRAVEL_DOCUMENT_WORDS,
};
