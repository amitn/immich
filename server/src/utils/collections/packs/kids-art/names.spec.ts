import { getFirstName, redactChildNames } from 'src/utils/collections/packs/kids-art/names.js';

describe('kids art names', () => {
  it('should keep at most the first name of a child', () => {
    expect(redactChildNames('Vera Petrova')).toBe('Vera');
    expect(redactChildNames('Drawings by Vera Petrova')).toBe('Drawings by Vera');
    expect(redactChildNames('HANAKO TANAKA')).toBe('HANAKO');
    expect(redactChildNames('Вера Петрова')).toBe('Вера');
    expect(redactChildNames('Carl von Lützow')).toBe('Carl');
    expect(redactChildNames('a card (Vera Petrova, age 9)')).toBe('a card (Vera, age 9)');
  });

  it('should keep the given name of a name signed surname first', () => {
    expect(redactChildNames('Rossi Marco al caro Nonnino')).toBe('Marco al caro Nonnino');
    expect(redactChildNames('TANAKA HANAKO')).toBe('HANAKO');
  });

  it('should keep one word of the child of a place, and a family as it is', () => {
    expect(redactChildNames('Lily Green, 2020')).toBe('Lily, 2020');
    expect(redactChildNames('Vera Petrova, 2023')).toBe('Vera, 2023');
    expect(redactChildNames('Hanako, 2017')).toBe('Hanako, 2017');
    expect(redactChildNames('The Tanaka family, 2011–2021')).toBe('The Tanaka family, 2011–2021');
  });

  it('should leave titles and greetings alone', () => {
    for (const title of [
      'Buon Natale (1947)',
      'Two foxes under green leaves (age 8)',
      'Letter to Santa Claus (age 4)',
      'Happy Birthday Mom',
      'Merry Christmas',
      "Kids' art 2026",
    ]) {
      expect(redactChildNames(title)).toBe(title);
    }
  });

  it('should read the first name of a child', () => {
    expect(getFirstName('Vera Petrova, age 9')).toBe('Vera');
    expect(getFirstName('the kitchen')).toBeUndefined();
  });
});
