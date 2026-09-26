import { describe, expect, it } from 'vitest';
import { findColumns, splitAtPrices, splitLine } from 'src/utils/collections/layout.js';
import { OcrBoxInput, groupLines, toTextBox, toTextBoxes } from 'src/utils/collections/ocr.js';

/** an OCR box of `text` at (left, top), about as wide as the text in a font of `height` */
const box = (text: string, left: number, top: number, height = 0.02, width?: number): OcrBoxInput => {
  const right = left + (width ?? text.length * height * 0.45);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.95 };
};

/** a box turned by `degrees` about its left end, as on a warped page */
const turned = (input: OcrBoxInput, degrees: number): OcrBoxInput => {
  const angle = (degrees * Math.PI) / 180;
  const dx = input.x2 - input.x1;
  const dy = input.y4 - input.y1;
  const rotate = (x: number, y: number) => [
    input.x1 + x * Math.cos(angle) - y * Math.sin(angle),
    input.y1 + x * Math.sin(angle) + y * Math.cos(angle),
  ];
  const [x2, y2] = rotate(dx, 0);
  const [x3, y3] = rotate(dx, dy);
  const [x4, y4] = rotate(0, dy);
  return { ...input, x2, y2, x3, y3, x4, y4 };
};

const texts = (lines: Array<{ text: string }>) => lines.map(({ text }) => text);

describe('groupLines', () => {
  it('should keep close lines of a warped page apart', () => {
    // lines 1.3 text heights apart, each turned 8° the other way than the page is levelled
    const lines = groupLines(
      toTextBoxes([
        turned(box('Unripe macadamia and spanner crab', 0.2, 0.2, 0.02, 0.3), 8),
        turned(box('Wild seasonal berries flavoured with gubinge', 0.2, 0.246, 0.02, 0.33), 8),
        turned(box('Porridge of golden wattleseed with saltbush', 0.2, 0.292, 0.02, 0.33), 8),
      ]),
    );
    expect(texts(lines)).toEqual([
      'Unripe macadamia and spanner crab',
      'Wild seasonal berries flavoured with gubinge',
      'Porridge of golden wattleseed with saltbush',
    ]);
  });

  it('should not put a box on the row of a box it is over or under', () => {
    const boxes = toTextBoxes([box('Tuna Salad', 0.1, 0.5), box('with pickles', 0.12, 0.51)]);
    expect(texts(groupLines(boxes))).toEqual(['Tuna Salad', 'with pickles']);
  });
});

describe('toTextBox', () => {
  it('should read full-width letters and digits as ASCII', () => {
    expect(toTextBox(box('ＪＡＮＵＡＲＹ ２０１４', 0.1, 0.1)).text).toBe('JANUARY 2014');
  });
});

describe('splitAtPrices', () => {
  it('should split a box that runs from one priced item into the next', () => {
    const [first, second] = splitAtPrices(toTextBox(box('Egg Salad 9.75 Tuna or Chicken Salad 10.95', 0.1, 0.1)));
    expect([first.text, second.text]).toEqual(['Egg Salad 9.75', 'Tuna or Chicken Salad 10.95']);
    expect(first.right).toBeLessThanOrEqual(second.left);
  });

  it('should keep numbers that are part of a name', () => {
    expect(splitAtPrices(toTextBox(box('Pizza 4 formaggi 9,50', 0.1, 0.1))).map(({ text }) => text)).toEqual([
      'Pizza 4 formaggi 9,50',
    ]);
  });
});

describe('splitLine', () => {
  it('should split a row at a gutter and after a price, but keep a price with its name', () => {
    const [line] = groupLines(
      toTextBoxes([
        box('Steak Fries', 0.1, 0.5),
        box('5.45', 0.3, 0.5),
        box('Knoblewurst', 0.34, 0.5),
        box('Hot Moist and Tender', 0.7, 0.5),
      ]),
    );
    expect(texts(splitLine(line))).toEqual(['Steak Fries 5.45', 'Knoblewurst', 'Hot Moist and Tender']);
  });
});

describe('findColumns', () => {
  it('should find the columns of a crowded menu board with narrow gutters', () => {
    const rows = [
      ['Matzo Ball Soup', '5.95', 'Tossed Green Salad', '5.95', 'Frankfurter', '3.45'],
      ['Split Pea Soup', '5.45', 'Potato Salad', '4.95', 'Knoblewurst', '7.10'],
      ['Chicken Noodle Soup', '5.45', 'Cole Slaw', '4.95', 'Chili Dog', '5.45'],
      ['Beverages', '', 'Steak Fries', '5.45', 'Bowl of Meat Chili', '9.60'],
      ['Dr. Browns Soda', '2.90', 'Macaroni Salad', '4.95', 'Knockwurst', '12.70'],
    ];
    const ocr = rows.flatMap((row, index) => {
      const top = 0.3 + index * 0.024;
      // the columns are a little slanted, as on a board photographed from below
      const shift = index * 0.004;
      return [
        box(row[0], 0.1 + shift, top, 0.012),
        ...(row[1] ? [box(row[1], 0.26 + shift, top, 0.012)] : []),
        box(row[2], 0.3 + shift, top, 0.012),
        box(row[3], 0.46 + shift, top, 0.012),
        box(row[4], 0.5 + shift, top, 0.012),
        box(row[5], 0.66 + shift, top, 0.012),
      ];
    });
    const { columns, spanning } = findColumns(toTextBoxes(ocr));

    expect(columns.map(({ lines }) => texts(lines))).toEqual([
      ['Matzo Ball Soup 5.95', 'Split Pea Soup 5.45', 'Chicken Noodle Soup 5.45', 'Beverages', 'Dr. Browns Soda 2.90'],
      ['Tossed Green Salad 5.95', 'Potato Salad 4.95', 'Cole Slaw 4.95', 'Steak Fries 5.45', 'Macaroni Salad 4.95'],
      ['Frankfurter 3.45', 'Knoblewurst 7.10', 'Chili Dog 5.45', 'Bowl of Meat Chili 9.60', 'Knockwurst 12.70'],
    ]);
    expect(spanning).toEqual([]);
  });

  it('should keep a centered menu in one column and a title over two columns across', () => {
    const centered = findColumns(
      toTextBoxes([
        box('OYSTERS AND PEARLS', 0.42, 0.2, 0.012),
        box('Sabayon of Pearl Tapioca with Island Creek Oysters', 0.34, 0.214, 0.014),
        box('and White Sturgeon Caviar', 0.4, 0.23, 0.014),
        box('SALAD OF HEARTS OF PEACH PALM', 0.38, 0.3, 0.012),
      ]),
    );
    expect(centered.columns).toHaveLength(1);

    const twoColumns = findColumns(
      toTextBoxes([
        box('Trattoria da Nino', 0.15, 0.05, 0.05, 0.6),
        box('Bruschetta', 0.1, 0.2),
        box('Caponata', 0.1, 0.25),
        box('Arancini', 0.1, 0.3),
        box('Cannolo', 0.6, 0.2),
        box('Granita', 0.6, 0.25),
        box('Cassata', 0.6, 0.3),
      ]),
    );
    expect(twoColumns.columns.map(({ lines }) => texts(lines))).toEqual([
      ['Bruschetta', 'Caponata', 'Arancini'],
      ['Cannolo', 'Granita', 'Cassata'],
    ]);
    expect(texts(twoColumns.spanning)).toEqual(['Trattoria da Nino']);
  });
});
