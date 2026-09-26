import { getDishDescription, getDishTag, getMenuTag, getRestaurantTag, parseFoodTag } from 'src/utils/food/tags.js';

describe('food tags', () => {
  it('should build dish, menu and restaurant tags', () => {
    expect(getRestaurantTag('Trattoria da Nino')).toBe('Food/Trattoria da Nino');
    expect(getDishTag('Trattoria da Nino', 'Spaghetti alle vongole')).toBe(
      'Food/Trattoria da Nino/Spaghetti alle vongole',
    );
    expect(getMenuTag('Trattoria da Nino')).toBe('Food/Trattoria da Nino/Menu');
  });

  it('should keep slashes and extra spaces out of the names', () => {
    expect(getDishTag('Bar  1/2 ', 'Fish / chips')).toBe('Food/Bar 1-2/Fish - chips');
  });

  it('should not let a dish read as a menu', () => {
    expect(getDishTag('Nino', 'menu')).toBe('Food/Nino/menu (dish)');
    expect(parseFoodTag(getDishTag('Nino', 'Menu'))).toEqual({ restaurant: 'Nino', kind: 'dish', dish: 'Menu (dish)' });
  });

  it('should parse the tags it writes and nothing else', () => {
    expect(parseFoodTag('Food/Nino/Arancini')).toEqual({ restaurant: 'Nino', kind: 'dish', dish: 'Arancini' });
    expect(parseFoodTag('Food/Nino/Menu')).toEqual({ restaurant: 'Nino', kind: 'menu' });
    for (const value of ['Food', 'Food/Nino', 'Food/Nino/A/B', 'Edits/Cropped/X', 'Food//Arancini']) {
      expect(parseFoodTag(value)).toBeUndefined();
    }
  });

  it('should describe a dish with its restaurant', () => {
    expect(getDishDescription(' Nino ', 'Arancini ')).toBe('Arancini · Nino');
  });
});
