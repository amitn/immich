import { getCollectionTagRules } from 'src/utils/collections/pack.js';
import { foodPack, getDishDescription } from 'src/utils/collections/packs/food/pack.js';
import { getEntryTag, getPlaceTag, getSourceTag, parseCollectionTag } from 'src/utils/collections/tags.js';

const rules = getCollectionTagRules(foodPack);

describe('food tags', () => {
  it('should build dish, menu and restaurant tags', () => {
    expect(getPlaceTag(rules, 'Trattoria da Nino')).toBe('Food/Trattoria da Nino');
    expect(getEntryTag(rules, 'Trattoria da Nino', 'Spaghetti alle vongole')).toBe(
      'Food/Trattoria da Nino/Spaghetti alle vongole',
    );
    expect(getSourceTag(rules, 'Trattoria da Nino')).toBe('Food/Trattoria da Nino/Menu');
  });

  it('should keep slashes and extra spaces out of the names', () => {
    expect(getEntryTag(rules, 'Bar  1/2 ', 'Fish / chips')).toBe('Food/Bar 1-2/Fish - chips');
  });

  it('should not let a dish read as a menu', () => {
    expect(getEntryTag(rules, 'Nino', 'menu')).toBe('Food/Nino/menu (dish)');
    expect(parseCollectionTag(rules, getEntryTag(rules, 'Nino', 'Menu'))).toEqual({
      place: 'Nino',
      kind: 'entry',
      entry: 'Menu (dish)',
    });
  });

  it('should parse the tags it writes and nothing else', () => {
    expect(parseCollectionTag(rules, 'Food/Nino/Arancini')).toEqual({
      place: 'Nino',
      kind: 'entry',
      entry: 'Arancini',
    });
    expect(parseCollectionTag(rules, 'Food/Nino/Menu')).toEqual({ place: 'Nino', kind: 'source' });
    for (const value of ['Food', 'Food/Nino', 'Food/Nino/A/B', 'Edits/Cropped/X', 'Food//Arancini']) {
      expect(parseCollectionTag(rules, value)).toBeUndefined();
    }
  });

  it('should describe a dish with its restaurant', () => {
    expect(getDishDescription(' Nino ', 'Arancini ')).toBe('Arancini · Nino');
    expect(foodPack.describe('Arancini ', ' Nino ')).toBe('Arancini · Nino');
  });
});
