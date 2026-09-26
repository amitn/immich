import { CollectionReviewInput, CollectionReviewIssue } from 'src/utils/collections/pack.js';
import { findTerms, parseWineName } from 'src/utils/collections/packs/wine/label.js';
import { normalizeWords } from 'src/utils/collections/packs/wine/lexicon.js';
import { isGarbled } from 'src/utils/collections/place.js';

/** the tasting-note layouts of wine books: a bottle with its fiche and note, and two bottles with theirs */
export const TASTING_NOTE_LAYOUT = 'tasting-note';
export const TASTING_NOTES_LAYOUT = 'tasting-notes';
export const TASTING_LAYOUTS = [TASTING_NOTE_LAYOUT, TASTING_NOTES_LAYOUT];

/** the region and the grape named in the name of a wine, e.g. Bourgogne and Pinot Noir in "Bourgogne Pinot Noir" */
export const getNamedTerms = (text: string) => {
  const terms = findTerms(normalizeWords(text).split(' ').filter(Boolean)).filter(({ exact }) => exact);
  const of = (kind: 'region' | 'grape') => [
    ...new Set(terms.filter(({ entry }) => entry.kind === kind).map(({ entry }) => entry.name)),
  ];
  return { regions: of('region'), grapes: of('grape') };
};

/**
 * The caption of a wine in a book. On a tasting-note page it is the fiche of the bottle, one "Label: value" line per
 * part of its name (producer, wine, vintage) and per region and grape its name holds, then the note the user wrote in
 * the photo's description (not the one save_entries wrote), e.g.
 *
 *   Producer: Willi Haag
 *   Wine: Brauneberger Juffer Riesling Spätlese
 *   Vintage: 2009
 *   Grape: Riesling
 *
 *   Honey and slate, a long finish.
 *
 * Elsewhere (a food book's dish pages) it is the name as tagged, "Producer · Wine · Vintage".
 */
export const getWineCaption = (entry: string, context: { layout?: string; description?: string | null } = {}) => {
  if (!context.layout || !TASTING_LAYOUTS.includes(context.layout)) {
    return entry;
  }
  const { producer, wine, vintage } = parseWineName(entry);
  const { regions, grapes } = getNamedTerms(`${wine ?? ''}`);
  const fields = [
    producer && `Producer: ${producer}`,
    wine && `Wine: ${wine}`,
    vintage && `Vintage: ${vintage}`,
    regions.length > 0 && `Region: ${regions.join(', ')}`,
    grapes.length > 0 && `Grape: ${grapes.join(', ')}`,
  ].filter(Boolean);
  const note = context.description?.trim();
  // the description save_entries wrote is the name again, not a note
  const written = note && normalizeWords(note) !== normalizeWords(entry) ? note : undefined;
  return [fields.join('\n'), written].filter(Boolean).join('\n\n');
};

/** a name the assistant could not read: no producer or vintage, and a placeholder or letters OCR made up */
export const isUnreadableWine = (entry: string) => {
  const { producer, wine, vintage } = parseWineName(entry);
  if (producer || vintage) {
    return false;
  }
  const text = (wine ?? '').trim();
  return (
    text.length === 0 ||
    /^(?:unknown|unread|unreadable|unnamed|bottle|wine|beer|drink|label|glass|\?+|n\/?a)(?:\s+(?:wine|bottle|\d+))?$/i.test(
      text,
    ) ||
    isGarbled(text)
  );
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The checks of a wine book: bottles without a readable name, and one bottle placed on several photos (the label
 * close-up and the glass: keep the best, or put them on one tasting-note page)
 */
export const reviewWineBook = ({ chapters }: CollectionReviewInput): CollectionReviewIssue[] => {
  const issues: CollectionReviewIssue[] = [];
  for (const chapter of chapters) {
    const unreadable = chapter.placed.filter(({ entry }) => isUnreadableWine(entry));
    if (unreadable.length > 0) {
      issues.push({
        severity: 'medium',
        type: 'missing-dish-name',
        message:
          `The chapter of ${chapter.place} shows ${plural(unreadable.length, 'bottle')} without a readable name ` +
          `(e.g. "${unreadable[0].entry}"): look at the labels and save their names ("Producer · Wine · Vintage")`,
        pages: chapter.pages,
        assetIds: unreadable.flatMap(({ assetIds }) => assetIds).slice(0, 6),
      });
    }
    const repeated = chapter.placed.filter(({ assetIds }) => assetIds.length > 1);
    if (repeated.length > 0) {
      issues.push({
        severity: 'low',
        type: 'missing-dish-name',
        message:
          `The chapter of ${chapter.place} shows ${plural(repeated.length, 'bottle')} on more than one photo (e.g. ` +
          `${repeated[0].entry}, ${repeated[0].assetIds.length} photos): keep the best photo of each bottle, or ` +
          'put them side by side on one tasting-notes page',
        pages: chapter.pages,
        assetIds: repeated.flatMap(({ assetIds }) => assetIds.slice(1)).slice(0, 6),
      });
    }
  }
  return issues;
};
