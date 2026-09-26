import { CollectionPack, validateCollectionPack } from 'src/utils/collections/pack.js';
// (keep this line: the packs are imported in alphabetical order, one per reserved line, between lines like this one)
import { cookbookPack } from 'src/utils/collections/packs/cookbook/pack.js';
// (keep this line)
import { foodPack } from 'src/utils/collections/packs/food/pack.js';
// (keep this line)
import { museumPack } from 'src/utils/collections/packs/museum/pack.js';
// (keep this line)
import { travelPack } from 'src/utils/collections/packs/travel/pack.js';
// (keep this line)
import { winePack } from 'src/utils/collections/packs/wine/pack.js';
// (keep this line)

/**
 * The packs of the collections engine, in the order they are listed (food first). To add a pack, replace its reserved
 * line here and in the imports above with the import and the name of the pack (keep the "(keep this line)" lines
 * between them, so that packs added on different branches merge without conflicts).
 */
export const BUILT_IN_COLLECTION_PACKS: readonly CollectionPack[] = [
  foodPack,
  // (keep this line)
  museumPack,
  // (keep this line)
  winePack,
  // (keep this line)
  cookbookPack,
  // (keep this line)
  travelPack,
  // (keep this line)
];

const packs = new Map<string, CollectionPack>();

/** Adds a pack; built-in packs are registered when this module loads, tests may register their own. */
export const registerCollectionPack = (pack: CollectionPack) => {
  const errors = validateCollectionPack(pack, packs.values().toArray());
  if (errors.length > 0) {
    throw new Error(`Invalid collection pack ${pack.id}: ${errors.join('; ')}`);
  }
  packs.set(pack.id, pack);
};

/** Removes a pack that a test registered */
export const unregisterCollectionPack = (id: string) => {
  if (BUILT_IN_COLLECTION_PACKS.some((pack) => pack.id === id)) {
    throw new Error(`Collection pack ${id} is built in`);
  }
  packs.delete(id);
};

for (const pack of BUILT_IN_COLLECTION_PACKS) {
  registerCollectionPack(pack);
}

export const getCollectionPacks = (): CollectionPack[] => packs.values().toArray();

export const getCollectionPack = (id: string): CollectionPack | undefined => packs.get(id);

/** the pack whose tags start with `tagRoot`, e.g. Food */
export const getCollectionPackByTagRoot = (tagRoot: string): CollectionPack | undefined =>
  packs.values().find((pack) => pack.tagRoot === tagRoot);
