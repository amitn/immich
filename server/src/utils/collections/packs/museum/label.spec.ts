import {
  cleanArtist,
  cleanDate,
  cleanMedium,
  fixLabelText,
  mergeFragments,
  parseWallLabel,
  readWallLabels,
  splitTrailingDate,
} from 'src/utils/collections/packs/museum/label.js';

const box = (text: string, left: number, top: number, height = 0.03, textScore = 0.97) => {
  const right = Math.min(1, left + text.length * height * 0.45);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore };
};

/** lines of a label, one below the other */
const lines = (texts: string[], { left = 0.1, top = 0.2, height = 0.03, gap = 0.012 } = {}) =>
  texts.map((text, index) => box(text, left, top + index * (height + gap), height));

describe('wall labels', () => {
  it('should read a label in two languages as one artwork, in English, with its original title', () => {
    const ocr = lines([
      'Nicolau Chanterene (act. 1511 circa 1551)',
      'Virgem com o Menino',
      '1535-1540',
      'Mármore',
      'Palácio dos Condes de Sortelha, Évora',
      'ME 1774',
      'Virgin and Child',
      '1535-1540',
      'Marble',
      'Palace of Condes de Sortelha, Évora',
      'ME 1774',
    ]);
    expect(readWallLabels(ocr)).toEqual([
      expect.objectContaining({
        title: 'Virgin and Child',
        artist: 'Nicolau Chanterene',
        date: '1535-1540',
        medium: 'Marble',
        originalTitle: 'Virgem com o Menino',
        inventory: 'ME 1774',
      }),
    ]);
    expect(parseWallLabel(ocr).items).toEqual([
      expect.objectContaining({
        name: 'Virgin and Child — Nicolau Chanterene, 1535-1540, marble',
        description: 'Virgem com o Menino · Inv. ME 1774',
        column: 0,
      }),
    ]);
  });

  it('should read the artist over two lines, in English, with the qualifiers of the attribution', () => {
    const [label] = readWallLabels(
      lines([
        'Autor desconhecido, a partir de um modelo de Peter',
        'Lely (1618-1680)',
        'Unknown Master after Peter Lely (1618-1680)',
        'Retrato de Dona Catarina de Bragança, rainha de',
        'Inglaterra',
        'Óleo sobre tela',
        'Escola Portuguesa, circa 1660',
        'ME1534',
        'Portrait of Catherine of Braganza, Queen of England',
        'Oil on canvas',
        'Portuguese School, circa 1660',
        'ME1534',
      ]),
    );
    expect(label).toMatchObject({
      title: 'Portrait of Catherine of Braganza, Queen of England',
      originalTitle: 'Retrato de Dona Catarina de Bragança, rainha de Inglaterra',
      artist: 'Unknown Master after Peter Lely',
      date: 'c. 1660',
      medium: 'Oil on canvas',
      inventory: 'ME1534',
    });

    const [attributed] = readWallLabels(
      lines([
        'Francisco Niculoso (atribuido I assigned)',
        '(act.1503-1526)',
        'Anunciação',
        '1501-1523',
        'Majólica',
        'ME 231',
        'Annunciation',
        '1501-1523',
        'Majolica',
        'ME231',
      ]),
    );
    expect(attributed).toMatchObject({ title: 'Annunciation', artist: 'Attributed to Francisco Niculoso' });
  });

  it('should read a French cartel with the date after the title, and leave the credit line out', () => {
    const [label] = readWallLabels(
      lines([
        'Antoine CALBET -',
        'Engayrac 1860-Paris, 1944',
        'Léda et le cygne, 1901',
        'Huile str toile',
        "Dépot de I'Etat au Musée",
        "d'Agen en 1903, puis",
        'transfert de propriété de',
        "I'Etat au Musée en 2013",
      ]),
    );
    expect(label).toEqual(
      expect.objectContaining({
        title: 'Léda et le cygne',
        artist: 'Antoine Calbet',
        date: '1901',
        medium: 'Huile sur toile',
      }),
    );
    expect(label.originalTitle).toBeUndefined();
  });

  it('should take the title lines of an explanatory panel, not its prose', () => {
    const [label] = readWallLabels(
      lines([
        '4. Joseph-Désiré Court (1797-1865)',
        "S.A.R. Mgr le duc d'Orléans posant la première pierre du pont-",
        "canal d'Agen",
        '1844',
        'Huile sur toile, 271 X 306 cm',
        'Centre National des Arts Plastiques- actuellement en dépot a la préfecture du',
        "département de Lot-et-Garonne a Agen -°d'inv:D.848.1.2",
        'Le 25 août 1839 eut lieu, à Agen, la cérémonie de la pose de la première pierre du pont-',
        "canal par Ferdinand-Philippe (1810-1842), duc d'Orléans, fils aîné de Louis-Philippe Ier. A la",
        'demande du député du Lot-et-Garonne Pierre-Sylvain Dumon (1797-1870), commande fut',
      ]),
    );
    expect(label).toMatchObject({
      title: "S.A.R. Mgr le duc d'Orléans posant la première pierre du pont-canal d'Agen",
      artist: 'Joseph-Désiré Court',
      date: '1844',
      medium: 'Huile sur toile',
      inventory: 'D.848.1.2',
    });
  });

  it('should read each object of a case under its maker', () => {
    const labels = readWallLabels(
      lines(
        [
          'Les porcelaines tendres',
          'Manufacture de CHANTILLY',
          'A Rafraichissoir a bouteille, décor a la haie',
          'de type Kakiemon, vers 1735',
          'Legs du Comte Chaudordy, 1899',
          'Manufacture de SEVRES',
          'B Assiette, 1772',
          'Legs du Comte Chaudordy, 1899',
          'Manufacture de SEVRES',
          'C Plateau et ses pots a creme, 1770',
          'Legs du Comte Chaudordy, 1899',
        ],
        { height: 0.05 },
      ),
    );
    expect(labels.map(({ item, title, artist, date }) => ({ item, title, artist, date }))).toEqual([
      {
        item: 'A',
        title: 'Rafraichissoir a bouteille, décor a la haie de type Kakiemon',
        artist: 'Manufacture de Chantilly',
        date: 'c. 1735',
      },
      { item: 'B', title: 'Assiette', artist: 'Manufacture de Sevres', date: '1772' },
      { item: 'C', title: 'Plateau et ses pots a creme', artist: 'Manufacture de Sevres', date: '1770' },
    ]);
    expect(labels.every(({ heading }) => heading === 'Les porcelaines tendres')).toBe(true);
    expect(parseWallLabel(lines(['Les porcelaines tendres'])).items).toEqual([]);
  });

  it('should read a plaque in three scripts, and OCR noise, as its English lines', () => {
    const ocr = [
      box('3961/24126', 0.27, 0.48, 0.014),
      box('faouy', 0.53, 0.5, 0.024, 0.64),
      box('可.10式', 0.47, 0.52, 0.02, 0.77),
      box('Varahavatara', 0.45, 0.58, 0.022),
      box('(The Boar incarnation of Lord Vishnu)', 0.34, 0.6, 0.022),
      box('Ca. 14h century C.E.', 0.44, 0.624, 0.016),
      box('Basalt', 0.5, 0.64, 0.016),
      box('Surajkund, I Nalanda, Bihar', 0.42, 0.656, 0.018),
    ];
    expect(readWallLabels(ocr)).toEqual([
      expect.objectContaining({
        title: 'Varahavatara (The Boar incarnation of Lord Vishnu)',
        date: 'c. 14th century C.E.',
        medium: 'Basalt',
        inventory: '3961/24126',
      }),
    ]);
    // a number of the museum printed like a range of years, above the title
    const [yakshi] = readWallLabels([
      box('1796-1797', 0.25, 0.22, 0.025),
      box('Yakshi', 0.52, 0.47, 0.05),
      box('Ca. 2na century B.C.E', 0.47, 0.52, 0.031),
      box('Red Sandstone', 0.49, 0.56, 0.038),
    ]);
    expect(yakshi).toMatchObject({ title: 'Yakshi', date: 'c. 2nd century B.C.E', inventory: '1796-1797' });
  });

  it('should not read an artwork where there is only a title, or no text', () => {
    expect(readWallLabels([])).toEqual([]);
    expect(readWallLabels(lines(['EXIT']))).toEqual([]);
    expect(parseWallLabel(lines(['Welcome to the museum shop', 'Open daily'])).items).toEqual([]);
  });

  it('should mend what OCR breaks on labels', () => {
    expect(fixLabelText('Vers1840')).toBe('Vers 1840');
    expect(fixLabelText('Ca.13th century CE')).toBe('Ca. 13th century CE');
    expect(fixLabelText('Ca. 1Oth century C.E.')).toBe('Ca. 10th century C.E.');
    expect(fixLabelText('Ca. 2na century B.C.E')).toBe('Ca. 2nd century B.C.E');
    expect(fixLabelText("Dépot de I'Etat")).toBe("Dépot de l'Etat");
    expect(fixLabelText('Francisco Niculoso (atribuido I assigned)')).toBe('Francisco Niculoso (atribuido / assigned)');
    expect(fixLabelText("Sand 'stone")).toBe('Sandstone');
    // the same words read twice where two tiles meet
    expect(mergeFragments('Triptych with the Passion', 'ssion of Christ')).toBe('Triptych with the Passion of Christ');
    expect(mergeFragments('Nicolau Chanterene', 'rene (act. 1511 circa 1551)')).toBe(
      'Nicolau Chanterene (act. 1511 circa 1551)',
    );
    expect(mergeFragments('Enamel onc', 'copper')).toBe('Enamel on copper');
    expect(mergeFragments('Ca. 9th cer C.E.', 'century')).toBe('Ca. 9th century C.E.');
    expect(mergeFragments('Ca. h century C.E.', '11th')).toBe('Ca. 11th century C.E.');
  });

  it('should clean the parts of a label', () => {
    expect(cleanArtist('5.Joseph-Désiré Court (1797-1865)')).toBe('Joseph-Désiré Court');
    expect(cleanArtist('JeanILEMAIRE, dit LEMAIRE-POUSSIN')).toBe('Jean Lemaire, dit Lemaire-Poussin');
    expect(cleanArtist('Jean Pénicaud (atribuído / ass')).toBe('Attributed to Jean Pénicaud');
    expect(cleanArtist('Claude MoNET')).toBe('Claude Monet');
    expect(cleanDate('Portuguese School, circa 1760')).toBe('c. 1760');
    expect(cleanDate('Italian School (Tuscany), circa 1410')).toBe('c. 1410');
    expect(cleanDate('Escola portuguesa 1° quartel do séc. XVI')).toBe('1° quartel do séc. XVI');
    expect(cleanMedium('Huile sur toile, 60,5 X 50 cm')).toBe('Huile sur toile');
    expect(cleanMedium('Majólica 154')).toBe('Majólica');
    expect(splitTrailingDate('Tasse et sa soucoupe, vers 1768-1771')).toEqual([
      'Tasse et sa soucoupe',
      'vers 1768-1771',
    ]);
    expect(splitTrailingDate('Femme d’Alger, 1885')).toEqual(['Femme d’Alger', '1885']);
    expect(splitTrailingDate('Agnus Dei')).toEqual(['Agnus Dei']);
  });
});
