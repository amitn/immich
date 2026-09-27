import { getCollectionPacks } from 'src/utils/collections/registry.js';
import { getCollectionSearchTerms, hasSearchTerms } from 'src/utils/collections/search-terms.js';

const terms = (question: string) => getCollectionSearchTerms(question, getCollectionPacks());

describe(getCollectionSearchTerms.name, () => {
  it.each([
    ['what did we eat at noma', { pack: 'food', text: ['noma'] }],
    ['What did we eat at The French Laundry?', { pack: 'food', text: ['french laundry'] }],
    ['which museums did we visit in 2025', { pack: 'museum', text: [], from: '2025', to: '2025' }],
    ['which wine did we have at Noma?', { pack: 'wine', text: ['noma'] }],
    ['when did we last make the quiche?', { text: ['quiche'] }],
    ['what dessert did we have at noma', { text: ['dessert', 'noma'] }],
    ['which trips did we take between 2016 and 2019', { pack: 'travel', text: [], from: '2016', to: '2019' }],
    ['where were we on 4 October 2016', { text: [], from: '2016', to: '2016' }],
    ['Café Sacher', { text: ['cafe sacher'] }],
  ])('should read "%s"', (question, expected) => {
    expect(terms(question)).toEqual(expected);
  });

  it('should not pick a pack when the words point to two equally', () => {
    expect(terms('which wine did we drink at the restaurant').pack).toBe('wine');
    expect(terms('recipe museum').pack).toBeUndefined();
  });

  it('should send the words of gardens, books and children to their packs, and small words to none', () => {
    expect(terms('what did we grow in the garden in 2015').pack).toBe('garden');
    expect(terms('which trees did we see at the botanical garden').pack).toBe('nature');
    expect(terms('which books did I read last year').pack).toBe('reading');
    expect(terms("the kids' drawings of 2020").pack).toBe('kids-art');
    // "photos" and "years" are in the names of packs, but point to none
    expect(terms('photos of the trips').pack).toBe('travel');
  });

  it('should tell when there is nothing to look for', () => {
    expect(hasSearchTerms(terms('what did we do?'))).toBe(false);
    expect(hasSearchTerms(terms('which museums'))).toBe(true);
    expect(hasSearchTerms(terms('noma'))).toBe(true);
    expect(hasSearchTerms(terms('where were we in 2016?'))).toBe(true);
  });
});
