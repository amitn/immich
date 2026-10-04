import { CollectionReviewInput, CollectionReviewIssue } from 'src/utils/collections/pack.js';
import { parseTaxon } from 'src/utils/collections/packs/nature/label.js';

/** the theme of nature books: the gallery look (photos whole, catalogue captions) on the cream paper of a field guide */
export const FIELD_GUIDE_THEME = 'field-guide';

/**
 * The caption of a plate of a field guide, as the gallery look sets it (the first line in italics, then the others):
 * the scientific name, then the common name and the family, "Castanospermum australe\nMoreton Bay Chestnut ·
 * Fabaceae"; the common name alone when no scientific name was read
 */
export const captionSpecies = (entry: string) => {
  const { common, scientific, family } = parseTaxon(entry);
  // a cultivar of a genus, "Rose 'Proper Job' (Rosa)": "Rosa 'Proper Job'", then "Rose"
  const cultivar = common && scientific && !scientific.includes(' ') ? /^(.*?)\s*(['‘][^'’]+['’])$/.exec(common) : null;
  if (cultivar) {
    const details = [cultivar[1], family].filter(Boolean).join(' · ');
    return `${scientific} ${cultivar[2]}${details ? `\n${details}` : ''}`;
  }
  const title = scientific ?? common ?? entry;
  const details = [common && common !== title ? common : undefined, family].filter(Boolean).join(' · ');
  return details ? `${title}\n${details}` : title;
};

/** "Moreton Bay Chestnut · Kahanu": the description of a photo, the species and the garden */
export const describeSpecies = (entry: string, garden: string) => {
  const { common, scientific } = parseTaxon(entry);
  return `${common ?? scientific ?? entry} · ${garden.trim()}`;
};

const formatPages = (pages: number[]) =>
  pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.slice(0, -1).join(', ')} and ${pages.at(-1)}`;

/**
 * The nature pack's own check of its books: the plates of a field guide whose species has no scientific name (a name
 * read from a cultivar label, or given from what the photo shows)
 */
export const reviewFieldGuide = ({ pages, photos }: CollectionReviewInput): CollectionReviewIssue[] => {
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const unnamed: Array<{ page: number; assetId: string; entry: string }> = [];
  for (const [index, page] of pages.entries()) {
    for (const asset of page.assets) {
      const tag = byId.get(asset.assetId)?.collection;
      if (tag?.pack !== 'nature' || tag.kind !== 'entry' || !tag.entry) {
        continue;
      }
      if (!parseTaxon(tag.entry).scientific) {
        unnamed.push({ page: index + 1, assetId: asset.assetId, entry: tag.entry });
      }
    }
  }
  if (unnamed.length === 0) {
    return [];
  }
  const numbers = [...new Set(unnamed.map(({ page }) => page))];
  return [
    {
      severity: 'low',
      type: 'could-look-better',
      message:
        `${formatPages(numbers)} ${numbers.length === 1 ? 'names' : 'name'} ${unnamed.length === 1 ? 'a species' : `${unnamed.length} species`} ` +
        `without its scientific name (e.g. ${unnamed[0].entry}): a field guide gives it in italics, rename the entry ` +
        '"Common name (Genus species, Family)" if the label or the user knows it',
      pages: numbers,
      assetIds: unnamed.map(({ assetId }) => assetId),
    },
  ];
};
