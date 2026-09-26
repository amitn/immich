import { describe, expect, it } from 'vitest';
import {
  chooseMenuOcr,
  cleanItemText,
  isDate,
  isMenuTitle,
  isPageFurniture,
  isSectionHeading,
  mergeMenuItems,
  parseMenu,
  splitPrice,
} from 'src/utils/food/menu.js';
import { OcrBoxInput } from 'src/utils/food/ocr.js';

/** an OCR box of `text` at (left, top), about as wide as the text in a font of `height` */
const box = (text: string, left: number, top: number, height = 0.022, width?: number): OcrBoxInput => {
  const right = left + (width ?? text.length * height * 0.45);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.95 };
};

/** a box on a photo of the page taken at an angle (radians), about the center of a photo of the aspect ratio */
const tiltBox = (input: OcrBoxInput, angle: number, aspectRatio: number): OcrBoxInput => {
  const rotate = (x: number, y: number) => {
    const px = (x - 0.5) * aspectRatio;
    const py = y - 0.5;
    return [
      (px * Math.cos(angle) - py * Math.sin(angle)) / aspectRatio + 0.5,
      px * Math.sin(angle) + py * Math.cos(angle) + 0.5,
    ];
  };
  const [x1, y1] = rotate(input.x1, input.y1);
  const [x2, y2] = rotate(input.x2, input.y2);
  const [x3, y3] = rotate(input.x3, input.y3);
  const [x4, y4] = rotate(input.x4, input.y4);
  return { ...input, x1, y1, x2, y2, x3, y3, x4, y4 };
};

/** a right-aligned price that ends at `right` */
const price = (text: string, right: number, top: number, height = 0.022) =>
  box(text, right - text.length * height * 0.45, top, height);

const trattoria: OcrBoxInput[] = [
  box('Trattoria da Nino', 0.28, 0.03, 0.05),
  box('Via Umberto I, 145 · Taormina', 0.36, 0.09, 0.015),
  // left column
  box('ANTIPASTI', 0.06, 0.15, 0.03),
  box('Bruschetta al pomodoro (1)', 0.06, 0.2),
  price('6,00', 0.44, 0.2),
  box('pane casereccio, pomodorini, basilico', 0.06, 0.226, 0.016),
  box('Caponata siciliana', 0.06, 0.26),
  price('8,00', 0.44, 0.26),
  box('melanzane, sedano, capperi, olive', 0.06, 0.286, 0.016),
  box('PRIMI PIATTI', 0.06, 0.33, 0.03),
  box('Spaghetti alle vongole', 0.06, 0.38),
  price('14,00', 0.44, 0.38),
  box('Pasta alla Norma 1,3,7', 0.06, 0.44),
  price('12,00', 0.44, 0.44),
  box('melanzane fritte, ricotta salata', 0.06, 0.466, 0.016),
  box('Busiate con pesto alla', 0.06, 0.5),
  box('trapanese', 0.06, 0.526),
  price('13,00', 0.44, 0.526),
  // right column
  box('SECONDI', 0.54, 0.15, 0.03),
  box('Pesce spada alla griglia', 0.54, 0.2),
  price('18,00', 0.93, 0.2),
  box('Involtini di pesce spada', 0.54, 0.26),
  price('16,00', 0.93, 0.26),
  box('pangrattato, pinoli, uvetta', 0.54, 0.286, 0.016),
  box('DOLCI', 0.54, 0.33, 0.03),
  box('Cannolo siciliano', 0.54, 0.38),
  price('5,00', 0.93, 0.38),
  box('Granita di mandorla con brioche', 0.54, 0.44),
  price('4,50', 0.93, 0.44),
  // footer
  box('Coperto € 2,50', 0.06, 0.93, 0.016),
  box('* prodotto surgelato', 0.06, 0.955, 0.014),
  box('Tel. 0942 123456', 0.7, 0.93, 0.016),
];

const bistro: OcrBoxInput[] = [
  box('Le Petit Zinc', 0.3, 0.04, 0.06),
  box('Entrées', 0.1, 0.16, 0.03),
  box("Soupe à l'oignon gratinée ........ 9 €", 0.1, 0.21, 0.022, 0.78),
  box('Escargots de Bourgogne ........ 12 €', 0.1, 0.25, 0.022, 0.78),
  box('Plats', 0.1, 0.31, 0.03),
  box('Magret de canard', 0.1, 0.36),
  price('24 €', 0.88, 0.36),
  box('sauce aux cerises, pommes sarladaises', 0.1, 0.386),
  box('Steak frites', 0.1, 0.43),
  price('19 €', 0.88, 0.43),
  box('Desserts', 0.1, 0.49, 0.03),
  box('Crème brûlée', 0.1, 0.54),
  price('8 €', 0.88, 0.54),
  box('Tarte Tatin, crème fraîche', 0.1, 0.58),
  price('9 €', 0.88, 0.58),
  box('Service compris', 0.4, 0.9, 0.016),
];

const tapas: OcrBoxInput[] = [
  box('Bar El Tío Pepe', 0.25, 0.03, 0.055),
  box('TAPAS', 0.1, 0.14, 0.03),
  box('Patatas bravas 5,50 €', 0.1, 0.19),
  box('Pimientos de Padrón 6 €', 0.1, 0.23),
  box('Croquetas de jamón (6 uds.) 7,50 €', 0.1, 0.27),
  box('RACIONES', 0.1, 0.33, 0.03),
  box('Pulpo a la gallega 16,00 €', 0.1, 0.38),
  box('Calamares a la romana 12,00 €', 0.1, 0.42),
  box('POSTRES', 0.1, 0.48, 0.03),
  box('Crema catalana 5 €', 0.1, 0.53),
  box('IVA incluido', 0.1, 0.9, 0.016),
];

const pub: OcrBoxInput[] = [
  box('MAINS', 0.1, 0.1, 0.03),
  box('1. Fish & chips (GF)', 0.1, 0.15),
  box('£16.50', 0.8, 0.15),
  box('beer-battered haddock, mushy peas, tartare sauce', 0.1, 0.176, 0.016),
  box('2. Mushroom risotto (V)', 0.1, 0.22),
  box('£14.00', 0.8, 0.22),
  box('Sticky toffee pudding¹²', 0.1, 0.27),
  box('£7.50', 0.8, 0.27),
  box('Allergens: 1 gluten, 2 milk', 0.1, 0.9, 0.014),
  box('www.theredlion.co.uk', 0.1, 0.93, 0.014),
];

const tasting: OcrBoxInput[] = [
  box('Menù Degustazione', 0.25, 0.08, 0.05),
  box('Crudo di ricciola', 0.32, 0.2, 0.026),
  box('agrumi e finocchio', 0.34, 0.232, 0.017),
  box('Risotto allo zafferano', 0.3, 0.3, 0.026),
  box('midollo e polvere di liquirizia', 0.3, 0.332, 0.017),
  box('Piccione', 0.42, 0.4, 0.026),
  box('Cannolo scomposto', 0.33, 0.48, 0.026),
  box('€ 85', 0.45, 0.8, 0.026),
];

/** a centered box of `text`, in capitals or not */
const centered = (text: string, top: number, height = 0.012) => {
  const width = text.length * height * 0.45;
  return box(text, 0.5 - width / 2, top, height, width);
};

// a tasting menu: the restaurant, the title and the date, then courses in capitals with their descriptions
const chefs: OcrBoxInput[] = [
  centered('THE GARDEN HOUSE', 0.08, 0.02),
  centered("CHEF'S TASTING MENU", 0.13),
  centered('MARCH 14, 2024', 0.145),
  centered('"OYSTERS AND PEARLS"', 0.2),
  centered('Sabayon of Pearl Tapioca with Island Creek Oysters', 0.213, 0.014),
  centered('and White Sturgeon Caviar', 0.227, 0.014),
  centered('ROYAL OSSETRA CAVIAR', 0.243),
  centered('Hen Egg Mousse, Kohlrabi Relish', 0.256, 0.014),
  centered('(75.00 supplement)', 0.27, 0.014),
  centered('SALAD OF HEARTS OF PEACH PALM', 0.32),
  centered('Ruby Red Grapefruit, Tokyo Turnips', 0.333, 0.014),
  centered('LAMB SADDLE', 0.4),
  centered('Long of Naples Squash, Black Trumpet Mushrooms', 0.413, 0.014),
  centered('and Garden Mache', 0.45, 0.014),
  centered('"ASSORTMENT OF DESSERTS"', 0.5),
  centered('Fruit, Ice Cream, Chocolate', 0.513, 0.014),
  centered('PRIX FIXE 295.00  SERVICE INCLUDED', 0.6),
  centered('6640 Washington Street, Yountville CA 94599', 0.62),
];

describe('splitPrice', () => {
  it.each([
    ['Margherita 8,50', 'Margherita', '8,50'],
    ['Margherita .... 8', 'Margherita', '8'],
    ['Steak frites 19 €', 'Steak frites', '19 €'],
    ['Burger $12.00', 'Burger', '$12.00'],
    ['Pizza 8 / 12', 'Pizza', '8 / 12'],
    ['Pesce del giorno s.q.', 'Pesce del giorno', 's.q.'],
    ['Branzino al sale - prezzo di mercato', 'Branzino al sale', 'prezzo di mercato'],
  ])('should split %s', (text, name, amount) => {
    expect(splitPrice(text)).toEqual({ text: name, price: amount });
  });

  it.each(['Pizza 4 formaggi', 'Quattro stagioni', '12', 'Menu 2024'])('should keep %s', (text) => {
    expect(splitPrice(text).price === undefined || text === 'Menu 2024').toBe(true);
  });

  it('should not take a number in a name for a price', () => {
    expect(splitPrice('Pizza 4 formaggi')).toEqual({ text: 'Pizza 4 formaggi' });
    expect(splitPrice('Menu 2024')).toEqual({ text: 'Menu 2024' });
  });
});

describe('cleanItemText', () => {
  it.each([
    ['Pasta alla Norma 1,3,7', 'Pasta alla Norma'],
    ['Bruschetta (1, 7)', 'Bruschetta'],
    ['Fish & chips (GF)', 'Fish & chips'],
    ['Sticky toffee pudding¹²', 'Sticky toffee pudding'],
    ['12. Margherita', 'Margherita'],
    ['Tiramisù*', 'Tiramisù'],
    ['Carbonara ..........', 'Carbonara'],
    ['Wagyu (100.00 supplement)', 'Wagyu'],
    ['Tartufo bianco supplemento 30 €', 'Tartufo bianco'],
  ])('should clean %s', (text, expected) => {
    expect(cleanItemText(text)).toBe(expected);
  });
});

describe('isSectionHeading', () => {
  it.each([
    'Antipasti',
    'PRIMI PIATTI',
    'I nostri dolci',
    'Entrées',
    'Postres',
    'Hauptgerichte',
    'Desserts',
    'Menu',
    'Juice pairing',
  ])('should know %s', (text) => {
    expect(isSectionHeading(text)).toBe(true);
  });

  it.each(['Spaghetti alle vongole', 'Crema catalana', 'Pizza margherita'])('should not take %s', (text) => {
    expect(isSectionHeading(text)).toBe(false);
  });
});

describe('isDate', () => {
  it.each(['JANUARY 11, 2014', 'January 2O14', '11 gennaio 2024', '3 de mayo', '14/03/2024', '1er avril'])(
    'should recognize %s',
    (text) => {
      expect(isDate(text)).toBe(true);
    },
  );

  it.each(['Arroz del mar 18', 'Mai Tai 12', 'Pizza 4 formaggi', 'Tagliata 250g'])('should keep %s', (text) => {
    expect(isDate(text)).toBe(false);
  });
});

describe('isMenuTitle', () => {
  it.each(["CHEF'S TASTING MENU", 'Menu dégustation', 'Tasting Menu March 14, 2024', 'Prix Fixe Lunch'])(
    'should recognize %s',
    (text) => {
      expect(isMenuTitle(text)).toBe(true);
    },
  );

  it.each(['Tasting of spring vegetables', 'Kids menu burger with fries', 'Oysters and pearls'])(
    'should keep %s',
    (text) => {
      expect(isMenuTitle(text)).toBe(false);
    },
  );
});

describe('isPageFurniture', () => {
  it.each([
    'Coperto € 2,50',
    'Tel. 0942 123456',
    '+39 0942 123 456',
    'www.trattoria.it',
    'Via Roma 12, Taormina',
    'Aperto 12:00 - 15:00',
    'IVA inclusa',
    'Allergens: 1 gluten, 2 milk',
    '* prodotto surgelato',
    'Service compris',
  ])('should recognize %s', (text) => {
    expect(isPageFurniture(text)).toBe(true);
  });

  it.each(['Spaghetti alle vongole', 'Pizza viennese', 'Tarte Tatin'])('should keep %s', (text) => {
    expect(isPageFurniture(text)).toBe(false);
  });
});

describe('parseMenu', () => {
  it('should read a two-column Italian menu', () => {
    const menu = parseMenu(trattoria);

    expect(menu.title).toBe('Trattoria da Nino');
    expect(menu.columns).toBe(2);
    expect(menu.sections).toEqual(['ANTIPASTI', 'SECONDI', 'PRIMI PIATTI', 'DOLCI']);
    expect(
      menu.items.map(({ name, description, price, section, column }) => ({
        name,
        description,
        price,
        section,
        column,
      })),
    ).toEqual([
      {
        name: 'Bruschetta al pomodoro',
        description: 'pane casereccio, pomodorini, basilico',
        price: '6,00',
        section: 'ANTIPASTI',
        column: 0,
      },
      {
        name: 'Caponata siciliana',
        description: 'melanzane, sedano, capperi, olive',
        price: '8,00',
        section: 'ANTIPASTI',
        column: 0,
      },
      { name: 'Spaghetti alle vongole', description: undefined, price: '14,00', section: 'PRIMI PIATTI', column: 0 },
      {
        name: 'Pasta alla Norma',
        description: 'melanzane fritte, ricotta salata',
        price: '12,00',
        section: 'PRIMI PIATTI',
        column: 0,
      },
      {
        name: 'Busiate con pesto alla trapanese',
        description: undefined,
        price: '13,00',
        section: 'PRIMI PIATTI',
        column: 0,
      },
      { name: 'Pesce spada alla griglia', description: undefined, price: '18,00', section: 'SECONDI', column: 1 },
      {
        name: 'Involtini di pesce spada',
        description: 'pangrattato, pinoli, uvetta',
        price: '16,00',
        section: 'SECONDI',
        column: 1,
      },
      { name: 'Cannolo siciliano', description: undefined, price: '5,00', section: 'DOLCI', column: 1 },
      { name: 'Granita di mandorla con brioche', description: undefined, price: '4,50', section: 'DOLCI', column: 1 },
    ]);
    expect(menu.items[3].priceValue).toBe(12);
    expect(menu.items[8].priceValue).toBe(4.5);
  });

  it('should give the position of each item', () => {
    const [first] = parseMenu(trattoria).items;
    expect(first.box[0]).toBeCloseTo(0.06, 2);
    expect(first.box[1]).toBeCloseTo(0.2, 2);
    expect(first.box[2]).toBeCloseTo(0.44, 2);
    expect(first.box[3]).toBeCloseTo(0.242, 2);
  });

  it('should read a French menu with leader dots and descriptions of the same size', () => {
    const menu = parseMenu(bistro);

    expect(menu.title).toBe('Le Petit Zinc');
    expect(menu.columns).toBe(1);
    expect(menu.items.map(({ name, description, price, section }) => ({ name, description, price, section }))).toEqual([
      { name: "Soupe à l'oignon gratinée", description: undefined, price: '9 €', section: 'Entrées' },
      { name: 'Escargots de Bourgogne', description: undefined, price: '12 €', section: 'Entrées' },
      {
        name: 'Magret de canard',
        description: 'sauce aux cerises, pommes sarladaises',
        price: '24 €',
        section: 'Plats',
      },
      { name: 'Steak frites', description: undefined, price: '19 €', section: 'Plats' },
      { name: 'Crème brûlée', description: undefined, price: '8 €', section: 'Desserts' },
      { name: 'Tarte Tatin, crème fraîche', description: undefined, price: '9 €', section: 'Desserts' },
    ]);
  });

  it('should read a Spanish menu with the prices in the text', () => {
    const menu = parseMenu(tapas);

    expect(menu.title).toBe('Bar El Tío Pepe');
    expect(menu.items.map(({ name, price, section }) => [name, price, section])).toEqual([
      ['Patatas bravas', '5,50 €', 'TAPAS'],
      ['Pimientos de Padrón', '6 €', 'TAPAS'],
      ['Croquetas de jamón (6 uds.)', '7,50 €', 'TAPAS'],
      ['Pulpo a la gallega', '16,00 €', 'RACIONES'],
      ['Calamares a la romana', '12,00 €', 'RACIONES'],
      ['Crema catalana', '5 €', 'POSTRES'],
    ]);
  });

  it('should drop numbering, allergen codes and page furniture', () => {
    const menu = parseMenu(pub);

    expect(menu.items.map(({ name, description, price }) => ({ name, description, price }))).toEqual([
      { name: 'Fish & chips', description: 'beer-battered haddock, mushy peas, tartare sauce', price: '£16.50' },
      { name: 'Mushroom risotto', description: undefined, price: '£14.00' },
      { name: 'Sticky toffee pudding', description: undefined, price: '£7.50' },
    ]);
    expect(menu.items[0].priceValue).toBe(16.5);
  });

  it('should take a price below the description for the item above it', () => {
    const menu = parseMenu([
      box('SMALL PLATES', 0.1, 0.1, 0.03),
      box('Grilled octopus', 0.1, 0.16, 0.024),
      box('smoked paprika, potatoes, aioli', 0.1, 0.188, 0.017),
      box('18', 0.1, 0.21, 0.02),
      box('Burrata', 0.1, 0.27, 0.024),
      box('heirloom tomatoes, basil oil', 0.1, 0.298, 0.017),
      box('14', 0.1, 0.32, 0.02),
    ]);

    expect(menu.items.map(({ name, description, price, section }) => ({ name, description, price, section }))).toEqual([
      {
        name: 'Grilled octopus',
        description: 'smoked paprika, potatoes, aioli',
        price: '18',
        section: 'SMALL PLATES',
      },
      { name: 'Burrata', description: 'heirloom tomatoes, basil oil', price: '14', section: 'SMALL PLATES' },
    ]);
  });

  it('should read a menu without prices by the size of the text', () => {
    const menu = parseMenu(tasting);

    expect(menu.title).toBe('Menù Degustazione');
    expect(menu.items.map(({ name, description, price }) => ({ name, description, price }))).toEqual([
      { name: 'Crudo di ricciola', description: 'agrumi e finocchio', price: undefined },
      { name: 'Risotto allo zafferano', description: 'midollo e polvere di liquirizia', price: undefined },
      { name: 'Piccione', description: undefined, price: undefined },
      { name: 'Cannolo scomposto', description: undefined, price: undefined },
    ]);
  });

  it('should read a tilted page', () => {
    // a Noma-like tasting menu photographed at an angle: one course per line, no prices
    const courses = [
      'Unripe macadamia and spanner crab',
      'Wild seasonal berries flavoured with gubinge',
      'Porridge of golden & desert oak wattleseed with saltbush',
      'Seafood platter and crocodile fat',
      'W.A. deep sea snow crab with cured egg yolk',
    ];
    const aspectRatio = 1.5;
    const tilt = (input: OcrBoxInput) => tiltBox(input, (5 * Math.PI) / 180, aspectRatio);
    const ocr = [
      box('noma australia', 0.35, 0.1, 0.04),
      ...courses.map((course, i) => box(course, 0.2, 0.25 + i * 0.07, 0.02, course.length * 0.0085)),
    ].map((input) => tilt(input));

    const menu = parseMenu(ocr, { aspectRatio });

    expect(menu.items.map(({ name }) => name)).toEqual(courses);
    expect(menu.title).toBe('noma australia');

    // prices far from their names only line up again once the page is levelled
    const level = parseMenu(trattoria).items.map(({ name, price }) => [name, price]);
    expect(
      parseMenu(
        trattoria.map((input) => tilt(input)),
        { aspectRatio },
      ).items.map(({ name, price }) => [name, price]),
    ).toEqual(level);
  });

  it('should ignore unreadable boxes and return nothing for an empty photo', () => {
    expect(parseMenu([])).toEqual({ items: [], sections: [], columns: 0, lines: 0 });
    expect(parseMenu([{ ...box('Spaghetti', 0.1, 0.1), textScore: 0.2 }]).items).toEqual([]);
  });

  it('should list an item repeated by the OCR once', () => {
    const menu = parseMenu([
      box('Margherita', 0.1, 0.1),
      price('8,00', 0.8, 0.1),
      box('Margherita', 0.1, 0.5),
      price('8,00', 0.8, 0.5),
    ]);
    expect(menu.items.map(({ name }) => name)).toEqual(['Margherita']);
  });

  it('should read a centered tasting menu with names in capitals and no prices', () => {
    const menu = parseMenu(chefs);

    expect(menu.items.map(({ name, description }) => ({ name, description }))).toEqual([
      {
        name: '"OYSTERS AND PEARLS"',
        description: 'Sabayon of Pearl Tapioca with Island Creek Oysters and White Sturgeon Caviar',
      },
      { name: 'ROYAL OSSETRA CAVIAR', description: 'Hen Egg Mousse, Kohlrabi Relish' },
      { name: 'SALAD OF HEARTS OF PEACH PALM', description: 'Ruby Red Grapefruit, Tokyo Turnips' },
      {
        name: 'LAMB SADDLE',
        description: 'Long of Naples Squash, Black Trumpet Mushrooms and Garden Mache',
      },
      { name: '"ASSORTMENT OF DESSERTS"', description: 'Fruit, Ice Cream, Chocolate' },
    ]);
  });

  it('should drop single words that are not dishes', () => {
    const menu = parseMenu([box("CHEF'S", 0.1, 0.1), box('Bologna', 0.1, 0.2), price('11.95', 0.6, 0.2)]);
    expect(menu.items.map(({ name }) => name)).toEqual(['Bologna']);
  });

  it('should read two lines set tight in a spaced list of courses as one name', () => {
    const courses = [
      'Seafood platter and crocodile fat',
      'PIE: dried scallops and nasturtium flowers',
      'Truffle and Avocado',
    ];
    const menu = parseMenu([
      ...courses.slice(0, 2).map((course, i) => box(course, 0.2, 0.2 + i * 0.05, 0.02)),
      box("BBQ'd milk 'dumpling'", 0.2, 0.3, 0.02),
      box('Marron and Magpie goose', 0.2, 0.325, 0.02),
      box(courses[2], 0.2, 0.37, 0.02),
    ]);
    expect(menu.items.map(({ name }) => name)).toEqual([
      ...courses.slice(0, 2),
      "BBQ'd milk 'dumpling' Marron and Magpie goose",
      courses[2],
    ]);
  });
});

describe('chooseMenuOcr', () => {
  it('should prefer the tiled reading unless it read much less text', () => {
    const stored = [box('Spaghetti alle vongole', 0.1, 0.1), box('Caponata', 0.1, 0.2)];
    const tiles = [box('Spaghetti alle vongole', 0.1, 0.1), box('Caponata siciliana', 0.1, 0.2)];
    expect(chooseMenuOcr(stored, tiles)).toBe('tiles');
    expect(chooseMenuOcr(stored, tiles.slice(1))).toBe('stored');
  });
});

describe('mergeMenuItems', () => {
  it('should list the items of the pages of a menu once, in order', () => {
    const item = (name: string) => ({ name, column: 0, box: [0, 0, 1, 1] as [number, number, number, number] });
    const merged = mergeMenuItems([
      { assetId: 'a', items: [item('Oysters and Pearls'), item('Salad')] },
      { assetId: 'b', items: [item('"OYSTERS AND PEARLS"'), item('Salad'), item('Lamb')] },
    ]);
    expect(merged.map(({ menuId, item }) => [menuId, item.name])).toEqual([
      ['a', 'Oysters and Pearls'],
      ['a', 'Salad'],
      ['b', 'Lamb'],
    ]);
  });
});
