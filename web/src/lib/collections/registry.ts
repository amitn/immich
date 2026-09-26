import type { WebCollectionPack } from '$lib/collections/pack';

/**
 * The collection packs of the web: every `packs/<id>.ts` module whose default export is a pack, in the order of their
 * `order` (food first). A new pack is a new file there, so packs added on different branches never touch a shared
 * list.
 */
const modules = import.meta.glob<{ default: WebCollectionPack }>(['./packs/*.ts', '!./packs/*.spec.ts'], {
  eager: true,
});

export const collectionPacks: readonly WebCollectionPack[] = Object.values(modules)
  .map((module) => module.default)
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export const getCollectionPack = (id: string) => collectionPacks.find((pack) => pack.id === id);
