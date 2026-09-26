import en from '$i18n/en.json';
import { collectionLabels, getCollectionLabel, getPlaceSourceLabel } from '$lib/collections/pack';
import { foodPack } from '$lib/collections/packs/food';
import { collectionPacks, getCollectionPack } from '$lib/collections/registry';

const hasKey = (key: string) => {
  let node: unknown = en;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return node !== undefined;
};

describe('collection packs', () => {
  it('should find the packs by themselves, food first', () => {
    expect(collectionPacks[0]).toBe(foodPack);
    expect(getCollectionPack('food')).toBe(foodPack);
    expect(new Set(collectionPacks.map(({ id }) => id)).size).toBe(collectionPacks.length);
  });

  it.each(collectionPacks.map((pack) => [pack.id, pack] as const))('should have every label of %s', (_, pack) => {
    for (const label of collectionLabels) {
      expect(hasKey(getCollectionLabel(pack, label)), label).toBe(true);
    }
    expect(getPlaceSourceLabel(pack, 'fallback')).toBe(`collections.${pack.id}.place_source_fallback`);
    expect(hasKey(pack.bookStyleLabels.name)).toBe(true);
  });

  it('should keep the labels of food', () => {
    expect(en.collections.food.name_action).toBe('Name the dishes…');
    expect(en.collections.food.title).toBe('Name the dishes');
    expect(en.collections.food.saved).toBe(
      'Named {subjects, plural, one {# dish photo} other {# dish photos}} and {sources, plural, one {# menu photo} other {# menu photos}} at {place}',
    );
  });
});
