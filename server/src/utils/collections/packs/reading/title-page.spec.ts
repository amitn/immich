import {
  findCity,
  findYear,
  formatBookDetails,
  formatBookName,
  parseBookName,
  parseBooks,
  readBookPage,
} from 'src/utils/collections/packs/reading/title-page.js';

/** an OCR box of a line of a page, `height` tall, centred on `center` */
const box = (text: string, top: number, height = 0.03, score = 0.98, center = 0.5) => {
  const width = Math.min(0.9, text.length * height * 0.5);
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

describe('title pages', () => {
  describe('findYear', () => {
    it('should read the year of an imprint, as OCR prints it', () => {
      expect(findYear('1882.')).toBe('1882');
      expect(findYear('Stuttgart 1911')).toBe('1911');
      expect(findYear('1S39.')).toBe('1839');
      expect(findYear('182 9.')).toBe('1829');
    });

    it('should not take other numbers for a year', () => {
      expect(findYear('LL 800.432')).toBeUndefined();
      expect(findYear('Mit 15 Holzschnitten')).toBeUndefined();
      expect(findYear('1324849')).toBeUndefined();
    });
  });

  describe('findCity', () => {
    it('should read the place of publication, misread by a letter', () => {
      expect(findCity('Etuttgart 1911')).toBe('Stuttgart');
      expect(findCity('DELPHIN-VERLAG/MUNCHEN')).toBe('München');
      expect(findCity('DRESDEN und LEIPZAIG,')).toBe('Dresden');
      expect(findCity('Roman')).toBeUndefined();
    });
  });

  it('should read a title page in roman type: the title, the author after "von", the imprint', () => {
    const reading = readBookPage([
      box('WANDERUNGEN', 0.12, 0.046),
      box('IN-DEN', 0.2, 0.013),
      box('DOLOMITEN.', 0.25, 0.073),
      box('VON', 0.35, 0.014),
      box('PAUL GROHMANN.', 0.41, 0.039),
      box('MIT 4 HOLZSCHNITTEN IN TONDRUCK.', 0.54, 0.023),
      box('WIEN.', 0.82, 0.021),
      box('VERLAG VON CARL GEROLDS SOHN', 0.84, 0.021),
      box('1877.', 0.87, 0.026),
    ]);
    expect(reading).toMatchObject({
      title: 'Wanderungen in den Dolomiten',
      author: 'Paul Grohmann',
      year: '1877',
      place: 'Wien',
      sure: true,
      fraktur: false,
    });
    expect(formatBookName(reading!)).toBe('Wanderungen in den Dolomiten — Paul Grohmann');
    expect(formatBookDetails(reading!)).toBe('1877 · Carl Gerolds Sohn · Wien');
  });

  it('should read a cover that names its author above the title', () => {
    const reading = readBookPage([
      box('ARTE MODERNA ITALIANA N. 9', 0.05, 0.026),
      box('EMILIO SZITTYA', 0.16, 0.024),
      box('ERNESTO DE FIORI', 0.23, 0.084),
      box('1927', 0.88, 0.022),
      box('MILANO', 0.94, 0.025),
    ]);
    expect(reading).toMatchObject({ title: 'Ernesto de Fiori', author: 'Emilio Szittya', year: '1927' });
  });

  it('should read the author of a title that names it first', () => {
    const reading = readBookPage([
      box("Dante Alighieri's", 0.16, 0.033),
      box('GÖTTLICHE COMOEDIE.', 0.21, 0.035),
      box('ERSTER THEIL.', 0.44, 0.017),
      box('1839.', 0.77, 0.018),
    ]);
    expect(reading).toMatchObject({ title: 'Göttliche Comoedie', author: 'Dante Alighieri', year: '1839' });
  });

  it('should never be sure of a page set in Fraktur', () => {
    const reading = readBookPage([
      box('Rumft mmd Proletariat', 0.15, 0.072, 0.91),
      box('Bon Rlara Setin', 0.23, 0.032, 0.91),
      box('Bortrag, gebalten am erften Ritnftlerabeno', 0.38, 0.023, 0.89),
      box('Etuttgart 1911', 0.88, 0.029, 0.95),
      box('Berlag Des BilbungBanfcufes', 0.91, 0.026, 0.82),
    ]);
    expect(reading).toMatchObject({
      title: 'Rumft mmd Proletariat',
      author: 'Rlara Setin',
      year: '1911',
      place: 'Stuttgart',
    });
    expect(reading?.fraktur).toBe(true);
    expect(reading?.sure).toBe(false);
  });

  it('should leave out library stamps and shelf marks', () => {
    const reading = readBookPage([
      box('Das Gericht', 0.07, 0.066),
      box('Roman von', 0.15, 0.028),
      box('Stanislaw Przybyszewski', 0.18, 0.04),
      box('Slavisches Seminar', 0.73, 0.021),
      box('BIBLIOTHEK LL 800.432', 0.8, 0.025),
      box('Im Xenien-Verlag zu Leipzig 1913', 0.86, 0.033),
    ]);
    expect(reading).toMatchObject({
      title: 'Das Gericht',
      author: 'Stanislaw Przybyszewski',
      year: '1913',
      place: 'Leipzig',
    });
    expect(reading?.words).toEqual(['gericht']);
  });

  it('should read the initials of a name, and never take a name for the title', () => {
    const reading = readBookPage([
      box('THE GREAT', 0.27, 0.041),
      box('K&A', 0.3, 0.082),
      box('TRAIN-ROBBERY', 0.38, 0.044),
      box('PAUL·L·FORD', 0.43, 0.039),
    ]);
    expect(reading).toMatchObject({ title: 'The Great K&A Train-robbery', author: 'Paul L. Ford' });
  });

  it('should give no title to a page of running text', () => {
    const lyric = 'I walked out one morning for pleasure and spied a cow-puncher riding alone';
    const reading = readBookPage([
      box('Lackey Bill', 0.17, 0.025),
      ...Array.from({ length: 12 }, (_, index) => box(lyric, 0.2 + 0.04 * index, 0.022)),
      box('86 87', 0.79, 0.02),
    ]);
    expect(reading).toMatchObject({ openPage: true, sure: false });
    expect(reading?.title).toBeUndefined();
  });

  it('should parse a title page as one book and a reading list as a book per line', () => {
    expect(
      parseBooks([box('MY ANTONIA', 0.11, 0.076), box('BY', 0.19, 0.027), box('WILLA S. CATHER', 0.23, 0.032)]),
    ).toMatchObject({ items: [{ name: 'My Antonia — Willa S. Cather' }] });
    const list = parseBooks([
      box('Jörn Uhl - Gustav Frenssen', 0.1),
      box('Menschen im Hotel - Vicki Baum', 0.15),
      box('Der Paria - Michael Beer', 0.2),
    ]);
    expect(list.items.map(({ name }) => name)).toEqual([
      'Jörn Uhl — Gustav Frenssen',
      'Menschen im Hotel — Vicki Baum',
      'Der Paria — Michael Beer',
    ]);
  });

  it('should read a name back into its title and author', () => {
    expect(parseBookName('Der Paria — Michael Beer')).toEqual({ title: 'Der Paria', author: 'Michael Beer' });
    expect(parseBookName('Der Paria')).toEqual({ title: 'Der Paria' });
  });
});
