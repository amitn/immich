import { createMatcher, fuzzyMatch, normalizeName, stemWord } from 'src/utils/collections/fuzzy.js';

describe(normalizeName.name, () => {
  it.each([
    ["Katz's Pastrami", 'katzs pastrami'],
    ['Gougères', 'gougeres'],
    ['"Oysters and Pearls"', 'oysters and pearls'],
    ['Citrus Pre-Dessert', 'citrus pre dessert'],
    ['Œufs en meurette', 'oeufs en meurette'],
    ['  Smørrebrød ', 'smorrebrod'],
    ['PIE: dried scallops', 'pie dried scallops'],
  ])('should normalize %s', (text, expected) => {
    expect(normalizeName(text)).toBe(expected);
  });
});

describe(stemWord.name, () => {
  it.each([
    ['desserts', 'dessert'],
    ['pastries', 'pastry'],
    ['dishes', 'dish'],
    ['glass', 'glass'],
    ['katzs', 'katz'],
    ['fries', 'fry'],
    ['gas', 'gas'],
    ['2010s', '2010s'],
  ])('should stem %s', (word, expected) => {
    expect(stemWord(word)).toBe(expected);
  });
});

describe(fuzzyMatch.name, () => {
  it.each([
    ['noma', 'Noma Australia'],
    ['NOMA', 'Noma Australia'],
    ['the french laundry', 'The French Laundry'],
    ['french laundry', 'The French Laundry'],
    ['frenchlaundry', 'The French Laundry'],
    ['katz', "Katz's Delicatessen"],
    ["katz's", "Katz's Delicatessen"],
    ['quiche', 'Quiche Lorraine'],
    ['desserts', '"Assortment of Desserts"'],
    ['dessert', 'Citrus Pre-Dessert'],
    ['gougere', 'Gougères'],
    ['gougères', 'Gougeres'],
    ['fries', 'Steak Fries'],
    ['pastrami', "Katz's Pastrami"],
    ['choc', 'Chocolate fondant'],
    ['lamingtons', 'Rum lamington'],
    ['lamingtom', 'Rum lamington'],
    ['monet', 'Water Lilies — Claude Monet, 1906, oil on canvas'],
    ['oysters pearls', '"Oysters and Pearls"'],
    ['the', 'The French Laundry'],
  ])('should match %s with %s', (query, text) => {
    expect(fuzzyMatch(query, text)).toBe(true);
  });

  it.each([
    ['noma', 'The French Laundry'],
    ['pie', 'Pieces of eight'],
    ['ham', 'Champagne'],
    ['bread', 'Breakfast burrito'],
    ['quiche', 'Quinoa salad'],
    ['french laundry', 'French toast'],
    ['', 'Anything'],
    ['desserts', 'Golden petits fours'],
    ['dessert', 'Porridge of golden & desert oak wattleseed'],
  ])('should not match %s with %s', (query, text) => {
    expect(fuzzyMatch(query, text)).toBe(false);
  });
});

describe(createMatcher.name, () => {
  it('should match any of the alternatives', () => {
    const match = createMatcher(['dessert', 'petits fours']);
    expect(match('Golden petits fours')).toBe(true);
    expect(match('Citrus Pre-Dessert')).toBe(true);
    expect(match('Rum lamington')).toBe(false);
    expect(match(null)).toBe(false);
  });

  it('should match everything without alternatives', () => {
    expect(createMatcher(undefined)('anything')).toBe(true);
    expect(createMatcher([])('anything')).toBe(true);
    expect(createMatcher(['  '])(null)).toBe(true);
  });
});
