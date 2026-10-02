import { AssignOptions, DEFAULT_MATCH_OPTIONS } from 'src/utils/collections/match.js';
import {
  findAge,
  findArtworkYear,
  formatArtworkName,
  parseArtwork,
  parseArtworkName,
  readArtwork,
} from 'src/utils/collections/packs/kids-art/artwork.js';
import { assignArtworks } from 'src/utils/collections/packs/kids-art/artworks.js';

const box = (text: string, top: number, height = 0.06, score = 0.8, left = 0.1) => {
  const right = Math.min(0.95, left + text.length * height * 0.4);
  return {
    x1: left,
    y1: top,
    x2: right,
    y2: top,
    x3: right,
    y3: top + height,
    x4: left,
    y4: top + height,
    text,
    textScore: score,
  };
};

const options: AssignOptions = { ...DEFAULT_MATCH_OPTIONS, baselines: [], suggestions: 3 };
const photo = (id: string, time: number, ocr: Array<ReturnType<typeof box>>) => ({
  id,
  time,
  embedding: new Float32Array(0),
  ocr,
});

const firstPage = [
  box('RUON NAITHU', 0.07),
  box('pima leterina.', 0.69),
  box('nouta. pie', 0.8),
  box('Buon natble', 0.86),
  box('1947', 0.93),
];
const secondPage = [
  box('li auguni per il m pi buono e', 0.32),
  box('santo natale. piu bravo.', 0.44),
  box('rego Bambino Buon nalale', 0.56),
  box('tti forl La uperioa augua buon metal', 0.8),
];
const otherLetter = [
  box('Caro pepa wsono moltoang', 0.6),
  box('biala.con ti pershi vaivia', 0.68),
  box('rempree io voorei-chetuf', 0.74),
];

describe('kids art artworks', () => {
  it('should read an age and a year written on an artwork', () => {
    expect(findAge('Lina, 7 years old')).toBe('7');
    expect(findAge('age: 10')).toBe('10');
    expect(findAge('5 anni')).toBe('5');
    expect(findAge('1947')).toBeUndefined();
    expect(findArtworkYear('Natale 1947')).toBe('1947');
    expect(findArtworkYear('1847')).toBeUndefined();
  });

  it('should name an artwork after a greeting written on it, never surely when it was misread', () => {
    const reading = readArtwork(firstPage);
    expect(reading).toMatchObject({ title: 'Buon Natale', year: '1947', sure: false, continues: false });
    expect(formatArtworkName(reading!)).toBe('Buon Natale (1947)');
    expect(readArtwork([box('Happy Birthday', 0.1), box('age 6', 0.2)])).toMatchObject({
      title: 'Happy Birthday',
      age: '6',
      sure: true,
    });
    expect(parseArtwork([box('a dog', 0.5)])).toMatchObject({
      items: [],
      warnings: [expect.stringContaining('Cyrillic')],
    });
  });

  it('should read a name back into its title, age and year', () => {
    expect(parseArtworkName('Two foxes under green leaves (age 8)')).toEqual({
      title: 'Two foxes under green leaves',
      age: '8',
    });
    expect(parseArtworkName('Buon Natale (1947)')).toEqual({ title: 'Buon Natale', year: '1947' });
    expect(parseArtworkName('Dandelions')).toEqual({ title: 'Dandelions' });
  });

  it('should take the pages of a letter for one artwork, and two letters for two', () => {
    const { matches, entries } = assignArtworks(
      [photo('a', 0, firstPage), photo('b', 3000, secondPage), photo('c', 5000, otherLetter), photo('d', 7000, [])],
      [],
      options,
    );
    expect(matches.map(({ ids, item, unsure }) => ({ ids, item, unsure }))).toEqual([
      { ids: ['a', 'b'], item: 0, unsure: true },
      { ids: ['c'], item: undefined, unsure: true },
      { ids: ['d'], item: undefined, unsure: true },
    ]);
    expect(entries).toEqual([{ name: 'Buon Natale (1947)', sourceId: 'a' }]);
  });
});
