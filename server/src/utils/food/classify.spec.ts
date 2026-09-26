import { describe, expect, it } from 'vitest';
import {
  FOOD_PROMPT_LIST,
  FoodKind,
  OcrSummary,
  classifyFood,
  getClipKindScores,
  getOcrMenuScore,
  getOcrReceiptScore,
  getOcrSignScore,
  softmax,
  summarizeOcr,
} from 'src/utils/food/classify.js';
import { OcrBoxInput } from 'src/utils/food/ocr.js';

/** CLIP similarities with every prompt of a kind set to the given value (default 0.15) */
const similarities = (values: Partial<Record<FoodKind, number>>) =>
  FOOD_PROMPT_LIST.map(({ kind }) => values[kind] ?? 0.15);

const box = (text: string, left: number, top: number, height = 0.022): OcrBoxInput => {
  const right = left + text.length * height * 0.45;
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.9 };
};

const noText: OcrSummary = { lines: 0, prices: 0, items: 0, receiptWords: 0, restaurantWord: false, largestText: 0 };

const menuBoxes = [
  box('ANTIPASTI', 0.1, 0.1, 0.03),
  ...[
    'Bruschetta',
    'Caponata',
    'Arancini',
    'Parmigiana',
    'Spaghetti alle vongole',
    'Pasta alla Norma',
    'Cannolo',
  ].flatMap((name, i) => [box(name, 0.1, 0.16 + i * 0.05), box(`${8 + i},00`, 0.8, 0.16 + i * 0.05)]),
];

const receiptBoxes = [
  box('RISTORANTE IL GABBIANO', 0.2, 0.05, 0.03),
  box('2 x Coperto 5,00', 0.1, 0.2),
  box('Spaghetti 14,00', 0.1, 0.24),
  box('Vino rosso 18,00', 0.1, 0.28),
  box('TOTALE EUR 37,00', 0.1, 0.34),
  box('IVA 10% 3,36', 0.1, 0.38),
  box('Pagamento carta', 0.1, 0.42),
];

describe('softmax', () => {
  it('should sum to 1 and favour the largest value', () => {
    const result = softmax([0.3, 0.2, 0.1]);
    expect(result.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(result[0]).toBeGreaterThan(0.99);
  });

  it('should handle an empty list', () => {
    expect(softmax([])).toEqual([]);
  });
});

describe('getClipKindScores', () => {
  it('should use the best prompt of each kind', () => {
    const values = similarities({ other: 0.2 });
    values[FOOD_PROMPT_LIST.findIndex(({ kind }) => kind === 'dish') + 1] = 0.3;
    const scores = getClipKindScores(values);
    expect(scores.dish).toBeGreaterThan(0.99);
  });
});

describe('summarizeOcr', () => {
  it('should count lines, prices and menu items', () => {
    const summary = summarizeOcr(menuBoxes);
    expect(summary.lines).toBe(8);
    expect(summary.prices).toBe(7);
    expect(summary.items).toBe(7);
    expect(summary.receiptWords).toBe(0);
  });

  it('should find receipt words and restaurant words', () => {
    const summary = summarizeOcr(receiptBoxes);
    expect(summary.receiptWords).toBeGreaterThanOrEqual(3);
    expect(summary.restaurantWord).toBe(true);
  });
});

describe('ocr scores', () => {
  it('should score menus, receipts and signs', () => {
    expect(getOcrMenuScore(summarizeOcr(menuBoxes))).toBeGreaterThan(0.6);
    expect(getOcrReceiptScore(summarizeOcr(receiptBoxes))).toBeGreaterThan(0.7);
    expect(getOcrSignScore(summarizeOcr([box('Trattoria da Nino', 0.2, 0.3, 0.08)]))).toBeGreaterThan(0.7);
  });

  it('should not see a menu in a little text', () => {
    expect(getOcrMenuScore({ ...noText, lines: 2, prices: 1 })).toBe(0);
    expect(getOcrReceiptScore({ ...noText, prices: 5 })).toBe(0);
    expect(getOcrSignScore({ ...noText, lines: 20, restaurantWord: true, largestText: 0.1 })).toBe(0);
  });
});

describe('classifyFood', () => {
  it('should find a dish', () => {
    const result = classifyFood({ similarities: similarities({ dish: 0.3, other: 0.22 }), ocr: noText });
    expect(result.kind).toBe('dish');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('should leave other photos alone', () => {
    const result = classifyFood({ similarities: similarities({ dish: 0.2, other: 0.29 }) });
    expect(result.kind).toBe('other');
  });

  it('should find a menu from CLIP and the text', () => {
    const result = classifyFood({
      similarities: similarities({ menu: 0.24, dish: 0.25, other: 0.23 }),
      ocr: summarizeOcr(menuBoxes),
    });
    expect(result.kind).toBe('menu');
  });

  it('should find a menu from the text alone', () => {
    expect(classifyFood({ ocr: summarizeOcr(menuBoxes) }).kind).toBe('menu');
  });

  it('should not take a plate with a lot of text on the table for a dish', () => {
    const result = classifyFood({
      similarities: similarities({ dish: 0.27, menu: 0.25, other: 0.2 }),
      ocr: summarizeOcr(menuBoxes),
    });
    expect(result.kind).toBe('menu');
  });

  it('should find a receipt rather than a menu', () => {
    const result = classifyFood({
      similarities: similarities({ menu: 0.26, receipt: 0.25, other: 0.2 }),
      ocr: summarizeOcr(receiptBoxes),
    });
    expect(result.kind).toBe('receipt');
  });

  it('should find a restaurant sign', () => {
    const result = classifyFood({
      similarities: similarities({ sign: 0.21, other: 0.22 }),
      ocr: summarizeOcr([box('OSTERIA', 0.3, 0.2, 0.09), box('da Carlo', 0.35, 0.32, 0.05)]),
    });
    expect(result.kind).toBe('sign');
  });

  it('should find nothing without embeddings or text', () => {
    expect(classifyFood({})).toMatchObject({ kind: 'other', confidence: 1 });
  });
});
