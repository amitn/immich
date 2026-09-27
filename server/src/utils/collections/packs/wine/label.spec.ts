import {
  findTerms,
  findVintages,
  formatWineName,
  isWineList,
  parseWine,
  parseWineName,
  readWineLabel,
} from 'src/utils/collections/packs/wine/label.js';
import { normalizeWords } from 'src/utils/collections/packs/wine/lexicon.js';

/** an OCR box of a line of a label, `height` tall, centred on `center` */
const box = (text: string, top: number, height = 0.03, score = 0.98, center = 0.5) => {
  const width = text.length * height * 0.45;
  const left = center - width / 2;
  return {
    x1: left,
    y1: top,
    x2: left + width,
    y2: top,
    x3: left + width,
    y3: top + height,
    x4: left,
    y4: top + height,
    text,
    textScore: score,
  };
};

const terms = (text: string) => findTerms(normalizeWords(text).split(' ')).map(({ entry }) => entry.name);

describe('wine labels', () => {
  describe('findVintages', () => {
    it('should read the years of a label, as OCR prints them', () => {
      expect(findVintages('2009')).toEqual(['2009']);
      expect(findVintages('1979er')).toEqual(['1979']);
      expect(findVintages('20II')).toEqual(['2011']);
      expect(findVintages('Wehlener Sonnenuhr 2008')).toEqual(['2008']);
    });

    it('should not take other numbers for a year', () => {
      expect(findVintages('A.P.Nr. 2577049 110')).toEqual([]);
      expect(findVintages('1259 l')).toEqual([]);
      expect(findVintages('12')).toEqual([]);
      expect(findVintages('750 ml')).toEqual([]);
    });
  });

  describe('findTerms', () => {
    it('should find the words of the lexicon, misread or cut at the edge of the label', () => {
      expect(terms('RIESLING SPATLESE')).toEqual(['Riesling', 'Spätlese']);
      expect(terms('Eigwein')).toEqual(['Eiswein']);
      expect(terms('RRONTES')).toEqual(['Torrontés']);
      expect(terms('NRGOGNE')).toEqual(['Bourgogne']);
      expect(terms('Vin de la Tierre de Cadiz')).toEqual(['Vino de la Tierra de Cádiz']);
      expect(terms('MOSEI')).toEqual(['Mosel']);
    });

    it('should prefer the exact reading of a word, and leave other words alone', () => {
      expect(terms('Weinbau')).toEqual(['Weinbau']);
      expect(terms('RESERVE')).toEqual(['Reserve']);
      // a cherry is not a sherry
      expect(terms('Lemon Myrtle Cherry')).toEqual([]);
    });
  });

  describe('readWineLabel', () => {
    it('should read a German label: the producer, the site, the grape, the style and the vintage', () => {
      const label = readWineLabel([
        box('MOSEL', 0.6, 0.017),
        box('SELBACH-OSTER', 0.66, 0.03),
        box('2008', 0.72, 0.017),
        box('ZELTINGER SCHLOSSBERG', 0.75, 0.022),
        box('RIESLING SPATLESE', 0.78, 0.021),
        box('TROCKEN', 0.81, 0.017),
        box('A.P.Nr. 2 576 801 04 09', 0.85, 0.011),
        box('GUTSABFULLUNG', 0.87, 0.011),
        box('12% vol 750ml', 0.9, 0.011),
      ]);
      expect(label).toMatchObject({
        producer: 'Selbach-Oster',
        wine: 'Zeltinger Schlossberg Riesling Spätlese Trocken',
        vintage: '2008',
        region: 'Mosel',
        grape: 'Riesling',
        type: 'White',
        sure: true,
        several: false,
      });
      expect(formatWineName(label!)).toBe('Selbach-Oster · Zeltinger Schlossberg Riesling Spätlese Trocken · 2008');
    });

    it('should join a producer word to the name beside it', () => {
      expect(readWineLabel([box('CAIRDEAS', 0.5, 0.1), box('WINERY', 0.62, 0.03)])?.producer).toBe('Cairdeas Winery');
      expect(
        readWineLabel([box('Chateau De', 0.5, 0.09), box('RocheMory', 0.6, 0.09), box('PESSAC-LEOGNAN', 0.7, 0.05)]),
      ).toMatchObject({ producer: 'Château RocheMory', wine: 'Pessac-Léognan', region: 'Pessac-Léognan' });
    });

    it('should keep the longer reading of a name repeated on the neck label', () => {
      const label = readWineLabel([
        box('HAAG', 0.18, 0.026),
        box('WILLI HAAG', 0.69, 0.025),
        box('Brauneberger Juffer Spatlese', 0.73, 0.028),
        box('Riesling - trocken', 0.76, 0.026),
      ]);
      expect(label).toMatchObject({ producer: 'Willi Haag', wine: 'Brauneberger Juffer Spätlese Riesling Trocken' });
    });

    it('should name a wine by its appellation and grape, and a bare one by its region', () => {
      expect(
        readWineLabel([
          box('Louis Chavy', 0.14, 0.07),
          box('2010', 0.21, 0.04),
          box('NRGOGNE', 0.68, 0.05),
          box('PINOT NOIR', 0.7, 0.07),
        ]),
      ).toMatchObject({ producer: 'Louis Chavy', wine: 'Bourgogne Pinot Noir', vintage: '2010', type: 'Red' });
      expect(
        readWineLabel([
          box('DOMINICAN OAKS', 0.52, 0.054),
          box('—Napa Valley', 0.6, 0.05),
          box('20II', 0.71, 0.02, 0.78),
        ]),
      ).toMatchObject({ producer: 'Dominican Oaks', wine: 'Napa Valley', vintage: '2011', sure: false });
    });

    it('should leave out the story of a back label', () => {
      const label = readWineLabel([
        box('NACHTGOLD', 0.2, 0.021),
        box('Eiswein', 0.52, 0.05),
        box('EDELSUSS', 0.57, 0.02),
        box('Im Dunkel der frühen', 0.59, 0.018),
        box('Morgenstunden, wenn die', 0.61, 0.018),
        box('Temperatur des Nachtfrostes', 0.63, 0.019),
        box('Trauben fin diesen', 0.65, 0.018),
        box('werden die gefrorenen', 0.67, 0.018),
      ]);
      expect(label).toMatchObject({ producer: 'Nachtgold', wine: 'Eiswein Edelsüß', type: 'Sweet' });
    });

    it('should say when a photo shows several labels', () => {
      const label = readWineLabel([
        box('Wehlener Sonnenuhr', 0.7, 0.02, 0.98, 0.3),
        box('2009', 0.74, 0.015, 0.98, 0.3),
        box('Graacher Himmelreich', 0.7, 0.02, 0.98, 0.75),
        box('2008', 0.74, 0.015, 0.98, 0.75),
        box('Riesling Kabinett', 0.78, 0.02, 0.98, 0.3),
      ]);
      expect(label).toMatchObject({ several: true, sure: false });
    });

    it('should never be sure of a fragment', () => {
      expect(readWineLabel([box('KUDOS', 0.65, 0.12), box('2012', 0.83, 0.02, 0.86)])).toMatchObject({
        producer: 'Kudos',
        vintage: '2012',
        sure: false,
      });
      expect(readWineLabel([box('Snarebtee', 0.7, 0.08, 0.74)])).toMatchObject({ sure: false, words: [] });
      expect(readWineLabel([box('A.P.Nr. 2577049', 0.8, 0.01), box('750ml', 0.82, 0.01)])).toBeUndefined();
      expect(readWineLabel([])).toBeUndefined();
    });
  });

  describe('the names of wines', () => {
    it('should write "Producer · Wine · Vintage" and leave out what is unknown', () => {
      expect(formatWineName({ producer: 'Kudos', wine: 'Pinot Noir', vintage: '2012' })).toBe(
        'Kudos · Pinot Noir · 2012',
      );
      expect(formatWineName({ producer: 'Kudos', vintage: '2012' })).toBe('Kudos · 2012');
      expect(formatWineName({ wine: 'Snakebite' })).toBe('Snakebite');
      // a tag cannot hold a slash
      expect(formatWineName({ wine: 'Roussanne 50% / Viognier 50%' })).toBe('Roussanne 50% - Viognier 50%');
    });

    it('should read the parts of a name back', () => {
      expect(parseWineName('Willi Haag · Brauneberger Juffer Riesling Spätlese · 2009')).toEqual({
        producer: 'Willi Haag',
        wine: 'Brauneberger Juffer Riesling Spätlese',
        vintage: '2009',
      });
      expect(parseWineName('Kudos · 2012')).toEqual({ wine: 'Kudos', vintage: '2012' });
      expect(parseWineName('2012')).toEqual({ vintage: '2012' });
      expect(parseWineName('Snakebite')).toEqual({ wine: 'Snakebite' });
      expect(parseWineName('Casal Garcia · Vinho Verde · NV')).toEqual({
        producer: 'Casal Garcia',
        wine: 'Vinho Verde',
        vintage: 'NV',
      });
    });
  });

  describe('parseWine', () => {
    it('should read a label as one wine', () => {
      const parsed = parseWine([box('THOMAS RATH', 0.81, 0.017), box('AUSLESE', 0.84, 0.025), box('2009', 0.87, 0.01)]);
      expect(parsed.items.map(({ name }) => name)).toEqual(['Thomas Rath · Auslese · 2009']);
      expect(parsed.items[0].box[1]).toBeGreaterThan(0.8);
    });

    it('should read a wine list like a menu, a wine per line', () => {
      const lines = [
        '2015 Barolo, Vietti 95',
        '2018 Chablis, William Fèvre 60',
        '2016 Rioja Reserva, La Rioja Alta 55',
        '2019 Sancerre, Vacheron 58',
        '2014 Riesling Spätlese, Dönnhoff 70',
        'NV Champagne Brut, Billecart-Salmon 90',
        '2017 Brunello di Montalcino, Biondi-Santi 180',
        '2020 Grüner Veltliner, Hirsch 45',
      ];
      const ocr = [box('WINE LIST', 0.05, 0.04), ...lines.map((line, index) => box(line, 0.12 + index * 0.05, 0.02))];
      expect(isWineList(ocr)).toBe(true);
      expect(parseWine(ocr).items.length).toBeGreaterThanOrEqual(6);
      expect(isWineList([box('KUDOS', 0.6, 0.1), box('2012', 0.8)])).toBe(false);
    });
  });
});
