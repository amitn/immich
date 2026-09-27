/**
 * The photos of a collection are organized with tags, which are the contract between the matcher (that writes them)
 * and photo books (that read them): `<Root>/<Place>/<Entry>` on a subject photo, e.g. `Food/<Restaurant>/<Dish>`, and
 * `<Root>/<Place>/<SourceLeaf>` on a photo of the source, e.g. `Food/<Restaurant>/Menu`.
 */
export type CollectionTagRules = {
  /** the first level of the tags, e.g. Food */
  tagRoot: string;
  /** the leaf that marks a source photo instead of an entry, e.g. Menu */
  sourceLeaf: string;
  /** the name of a subject, e.g. dish: an entry named like the source leaf gets it, "Menu (dish)" */
  subject: string;
  /** other leaves that mark a source photo, e.g. Seed packet beside Tag */
  otherSourceLeaves?: string[];
};

/** the leaf of a source photo named `name` (case aside), e.g. "Seed packet", or undefined for an entry */
export const findSourceLeaf = (rules: CollectionTagRules, name: string) =>
  [rules.sourceLeaf, ...(rules.otherSourceLeaves ?? [])].find((leaf) => leaf.toLowerCase() === name.toLowerCase());

export type CollectionTag = { place: string } & ({ kind: 'entry'; entry: string } | { kind: 'source' });

/** tag values are split on "/", so names can't contain one */
const cleanName = (name: string) => name.replaceAll('/', '-').replaceAll(/\s+/g, ' ').trim();

export const getPlaceTag = (rules: CollectionTagRules, place: string) => `${rules.tagRoot}/${cleanName(place)}`;

/** the name of a place as it is used in the tags */
export const getTagPlaceName = (rules: CollectionTagRules, place: string) =>
  getPlaceTag(rules, place).slice(rules.tagRoot.length + 1);

export const getEntryTag = (rules: CollectionTagRules, place: string, entry: string) => {
  const name = cleanName(entry);
  // an entry that happens to be called like the source leaf ("Menu") would read as a source photo
  return `${getPlaceTag(rules, place)}/${findSourceLeaf(rules, name) ? `${name} (${rules.subject})` : name}`;
};

/** the tag of a source photo, with the pack's source leaf or another of its source leaves (`leaf`) */
export const getSourceTag = (rules: CollectionTagRules, place: string, leaf = rules.sourceLeaf) =>
  `${getPlaceTag(rules, place)}/${leaf}`;

/** the prefix of every tag of the collection, e.g. `Food/` */
export const getTagPrefix = (rules: CollectionTagRules) => `${rules.tagRoot}/`;

/** Reads a tag value written by `getEntryTag` or `getSourceTag`; anything else is not a tag of the collection. */
export const parseCollectionTag = (rules: CollectionTagRules, value: string): CollectionTag | undefined => {
  const parts = value.split('/');
  if (parts.length !== 3 || parts[0] !== rules.tagRoot || !parts[1] || !parts[2]) {
    return;
  }
  const [, place, leaf] = parts;
  return leaf === rules.sourceLeaf || rules.otherSourceLeaves?.includes(leaf)
    ? { place, kind: 'source' }
    : { place, kind: 'entry', entry: leaf };
};
