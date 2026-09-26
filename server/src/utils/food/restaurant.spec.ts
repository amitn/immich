import { describe, expect, it } from 'vitest';
import { OcrBoxInput } from 'src/utils/food/ocr.js';
import { cleanRestaurantName, findRestaurantNames, isGarbled, toTitleCase } from 'src/utils/food/restaurant.js';

const box = (text: string, left: number, top: number, height = 0.022): OcrBoxInput => {
  const right = left + text.length * height * 0.45;
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.9 };
};

const menu = [
  box('Trattoria da Nino', 0.28, 0.03, 0.05),
  box('Via Umberto I, 145', 0.36, 0.09, 0.015),
  box('ANTIPASTI', 0.06, 0.15, 0.03),
  box('Bruschetta al pomodoro', 0.06, 0.2),
  box('6,00', 0.4, 0.2),
  box('Caponata siciliana', 0.06, 0.26),
  box('8,00', 0.4, 0.26),
];

const sign = [box('OSTERIA', 0.3, 0.2, 0.09), box('da Carlo', 0.33, 0.3, 0.05), box('dal 1987', 0.4, 0.37, 0.02)];

const receipt = [
  box('IL GABBIANO S.R.L.', 0.25, 0.04, 0.03),
  box('Lungomare 12 Giardini Naxos', 0.2, 0.08, 0.018),
  box('P.IVA 01234567890', 0.2, 0.1, 0.018),
  box('Spaghetti 14,00', 0.1, 0.2),
  box('TOTALE 37,00', 0.1, 0.3),
];

describe('toTitleCase', () => {
  it('should title-case text in capitals', () => {
    expect(toTitleCase('TRATTORIA DA NINO')).toBe('Trattoria da Nino');
    expect(toTitleCase("L'OSTERIA DEL CAMPO")).toBe("L'Osteria del Campo");
  });

  it('should keep mixed case', () => {
    expect(toTitleCase('Caffè dei Mori')).toBe('Caffè dei Mori');
  });
});

describe('cleanRestaurantName', () => {
  it.each([
    ['IL GABBIANO S.R.L.', 'Il Gabbiano'],
    ['Benvenuti alla Trattoria Rosa', 'Trattoria Rosa'],
    ['"Da Michele"', 'Da Michele'],
  ])('should clean %s', (text, name) => {
    expect(cleanRestaurantName(text)).toBe(name);
  });

  it.each([
    'ANTIPASTI',
    'Tel. 0942 123456',
    '12,00',
    'Via Roma 12',
    'x',
    'A very long line of text that cannot be a name at all',
  ])('should reject %s', (text) => {
    expect(cleanRestaurantName(text)).toBeUndefined();
  });
});

/** the confidence of a sign read as `text`, next to a menu */
const readSign = (text: string, textScore = 0.97) =>
  findRestaurantNames([
    { assetId: 'sign', kind: 'sign', ocr: [{ ...box(text, 0.2, 0.3, 0.1), textScore }] },
    { assetId: 'menu', kind: 'menu', ocr: [box('Spaghetti alla Norma', 0.1, 0.5), box('12,00', 0.8, 0.5)] },
  ])[0]?.confidence ?? 0;

describe('isGarbled', () => {
  it.each(['MZSDGUICAT', 'Trattoria Brndl'])('should take %s for letters OCR made up', (name) => {
    expect(isGarbled(name)).toBe(true);
  });

  it.each(["Katz's Delicatessen", 'noma', 'Schnitzelhaus', 'The Rench Aundry'])('should keep %s', (name) => {
    expect(isGarbled(name)).toBe(false);
  });
});

describe('findRestaurantNames', () => {
  it('should read the title of a menu', () => {
    const [best] = findRestaurantNames([{ assetId: 'menu', kind: 'menu', ocr: menu }]);
    expect(best).toMatchObject({ name: 'Trattoria da Nino', source: 'menu', assetIds: ['menu'] });
    expect(best.confidence).toBeGreaterThan(0.5);
  });

  it('should join a restaurant word with the name below it on a sign', () => {
    const [best] = findRestaurantNames([{ assetId: 'sign', kind: 'sign', ocr: sign }]);
    expect(best).toMatchObject({ name: 'Osteria da Carlo', source: 'sign' });
  });

  it('should read the header of a receipt', () => {
    const [best] = findRestaurantNames([{ assetId: 'receipt', kind: 'receipt', ocr: receipt }]);
    expect(best).toMatchObject({ name: 'Il Gabbiano', source: 'receipt' });
  });

  it('should prefer a name repeated on several photos', () => {
    const candidates = findRestaurantNames([
      { assetId: 'menu', kind: 'menu', ocr: menu },
      { assetId: 'receipt', kind: 'receipt', ocr: [box('TRATTORIA DA NINO', 0.2, 0.04, 0.03), ...receipt.slice(3)] },
    ]);
    expect(candidates[0]).toMatchObject({ name: 'Trattoria da Nino', assetIds: ['menu', 'receipt'] });
    expect(candidates[0].confidence).toBe(1);
  });

  describe('signs of the demo photos', () => {
    it('should read a single word on a sign', () => {
      const [best] = findRestaurantNames([
        { assetId: 'noma-sign', kind: 'sign', ocr: [box('noma', 0.35, 0.4, 0.12), box('BARANGAROO', 0.7, 0.9, 0.02)] },
      ]);
      expect(best).toMatchObject({ name: 'noma', source: 'sign' });
    });

    it('should join a name above a restaurant word', () => {
      const [best] = findRestaurantNames([
        { assetId: 'katz', kind: 'sign', ocr: [box("ATZ'S", 0.3, 0.2, 0.1), box('DELICATESEN', 0.2, 0.32, 0.08)] },
      ]);
      expect(best).toMatchObject({ name: "Atz's Delicatesen", source: 'sign' });
    });

    it('should skip hotel associations and prefer the complete reading of a name', () => {
      const candidates = findRestaurantNames([
        {
          assetId: 'outside',
          kind: 'sign',
          ocr: [box('THE RENCH AUNDRY', 0.2, 0.3, 0.06), box('RELAIS& CHATEAUX', 0.25, 0.8, 0.08)],
        },
        {
          assetId: 'menu',
          kind: 'menu',
          ocr: [box('THE FRENCH LAUNDRY', 0.2, 0.05, 0.05), box('CHEF’S TASTING MENU', 0.25, 0.12, 0.03)],
        },
      ]);
      expect(candidates[0]).toMatchObject({ name: 'The French Laundry', assetIds: ['menu', 'outside'] });
      expect(candidates.map(({ name }) => name)).not.toContain('Relais& Chateaux');
    });
  });

  it('should be less sure of a garbled reading than of a clean one', () => {
    const clean = readSign('TRATTORIA SAVOIA');
    expect(readSign('TRATTORIA SVZDGOIA')).toBeLessThan(clean);
    expect(readSign('TRATTORIA SAVOIA', 0.82)).toBeLessThan(clean);
  });

  it('should count a name its photos support for more than a word no other photo has', () => {
    const sign = { assetId: 'sign', kind: 'sign' as const, ocr: [box('Trattoria Savoia', 0.2, 0.3, 0.1)] };
    const supported = findRestaurantNames([
      sign,
      { assetId: 'menu', kind: 'menu', ocr: [box('Pasta Savoia', 0.1, 0.5), box('12,00', 0.8, 0.5)] },
    ])[0];
    const alone = findRestaurantNames([
      sign,
      { assetId: 'menu', kind: 'menu', ocr: [box('Pasta alla Norma', 0.1, 0.5), box('12,00', 0.8, 0.5)] },
    ])[0];
    expect(supported.confidence).toBeGreaterThan(alone.confidence);
  });

  it('should find nothing in text that names no place', () => {
    expect(findRestaurantNames([{ assetId: 'menu', kind: 'menu', ocr: menu.slice(2) }])).toEqual([]);
    expect(findRestaurantNames([])).toEqual([]);
  });
});
