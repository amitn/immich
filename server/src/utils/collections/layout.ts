import { TextBox, TextLine, groupLines, isPrice, toTextLine, verticalOverlap } from 'src/utils/collections/ocr.js';

/** a column of a page: its lines top to bottom */
export type Column = { left: number; right: number; lines: TextLine[] };

export type Layout = {
  /** left to right */
  columns: Column[];
  /** titles, addresses and headings across more than one column */
  spanning: TextLine[];
};

/** a gap wider than this many text heights between two boxes of a row separates two columns */
const COLUMN_GAP = 2.5;
/** a line at most this many text heights below another can be the next line of its column */
const LINE_GAP = 4.5;

const PRICE_AT_END = /(?:^|\s)(?:[$£€¥₹]\s?)?\d{1,4}[.,]\d{2}(?:\s?[$£€¥₹])?$/;

const endsWithPrice = (text: string) => isPrice(text) || PRICE_AT_END.test(text);

type Extent = { left: number; right: number };

const overlapX = (a: Extent, b: Extent) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
const width = (a: Extent) => a.right - a.left;

/**
 * Splits a box whose text runs on from one priced item into the next, as OCR reads crowded menu boards:
 * "Egg Salad 9.75 Tuna or Chicken Salad 10.95" → "Egg Salad 9.75", "Tuna or Chicken Salad 10.95". The boxes are cut
 * where the characters are, in proportion.
 */
export const splitAtPrices = (box: TextBox): TextBox[] => {
  const match = /^(.*?\p{L}.*?\s(?:[$£€¥₹]\s?)?\d{1,4}[.,]\d{2}(?:\s?[$£€¥₹])?)\s+(\p{Lu}.*\p{L}{2}.*)$/u.exec(
    box.text,
  );
  if (!match) {
    return [box];
  }
  const [, head, tail] = match;
  const at = (index: number) => box.left + (box.width * index) / box.text.length;
  const cut = at(head.length);
  const next = at(box.text.length - tail.length);
  return [
    { ...box, text: head, right: cut, width: cut - box.left },
    ...splitAtPrices({ ...box, text: tail, left: next, width: box.right - next }),
  ];
};

/**
 * Splits a row of boxes where it crosses from one column into the next: at a gap much wider than a space, or after a
 * price that more text follows. A price on its own stays with the text on its left, however far.
 */
export const splitLine = (line: TextLine, aspectRatio = 1): TextLine[] => {
  const parts: TextBox[][] = [];
  let current: TextBox[] = [];
  for (const box of line.boxes) {
    const previous = current.at(-1);
    if (previous && !isPrice(box.text)) {
      const gap = ((box.left - previous.right) * aspectRatio) / Math.max(previous.height, box.height);
      if (gap > COLUMN_GAP || (gap > 0.2 && endsWithPrice(previous.text))) {
        parts.push(current);
        current = [];
      }
    }
    current.push(box);
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts.map((part) => toTextLine(part));
};

const isBelow = (upper: TextLine, lower: TextLine) => lower.centerY >= upper.bottom;

/** the gap between a line and a line below it, when it can be the next line of the same column */
const columnGap = (upper: TextLine, lower: TextLine) => {
  if (
    !isBelow(upper, lower) ||
    overlapX(upper, lower) < 0.3 * Math.min(width(upper), width(lower)) ||
    // a title is not the first line of the column below it
    Math.max(upper.height, lower.height) > 2 * Math.min(upper.height, lower.height)
  ) {
    return;
  }
  const gap = lower.top - upper.bottom;
  return gap <= LINE_GAP * Math.max(upper.height, lower.height) ? gap : undefined;
};

/** a line over two columns, each at least two lines long, e.g. the title of the page over its columns */
const isAcrossColumns = (line: TextLine, lines: TextLine[], aspectRatio: number) => {
  const window = (other: TextLine, gaps: number) =>
    other !== line &&
    !isPrice(other.text) &&
    isBelow(line, other) &&
    other.top - line.bottom <= gaps * LINE_GAP * Math.max(line.height, other.height);
  const below = lines.filter((other) => window(other, 1) && overlapX(line, other) >= 0.5 * width(other));
  const nearby = lines.filter((other) => window(other, 2));
  // lines of the column of `a`, and not of `b`
  const column = (a: TextLine, b: TextLine) =>
    nearby.filter((other) => overlapX(other, a) > 0.3 * width(a) && overlapX(other, b) === 0).length;
  return below.some((a) =>
    below.some(
      (b) =>
        a !== b &&
        verticalOverlap(a, b) >= 0.5 &&
        ((b.left - a.right) * aspectRatio) / Math.max(a.height, b.height) > 1 &&
        width(line) > width(a) &&
        column(a, b) >= 2 &&
        column(b, a) >= 2,
    ),
  );
};

type Chain = Extent & { top: number; bottom: number; lines: TextLine[] };

const toChain = (lines: TextLine[]): Chain => ({
  lines,
  left: Math.min(...lines.map((line) => line.left)),
  right: Math.max(...lines.map((line) => line.right)),
  top: Math.min(...lines.map((line) => line.top)),
  bottom: Math.max(...lines.map((line) => line.bottom)),
});

/**
 * Finds the columns of a page: the boxes are grouped into rows, the rows split where they cross a gutter (a wide gap,
 * or a price followed by more text), and each part joined to the part right below it that it lines up with (each
 * the nearest of the other), so that columns may be ragged, centered, slanted by the perspective of the photo, or
 * packed close together as on a menu board. Chains of lines that line up are one column; lines over two columns, and
 * chains that reach over more than one column, are titles, addresses and headings of the whole page.
 */
export const findColumns = (boxes: TextBox[], aspectRatio = 1): Layout => {
  const lines = groupLines(boxes).flatMap((line) => splitLine(line, aspectRatio));
  const spanning = lines.filter((line) => !isPrice(line.text) && isAcrossColumns(line, lines, aspectRatio));
  const rest = lines.filter((line) => !spanning.includes(line));

  // each line and the nearest line below it that lines up with it, when each is the other's nearest
  const nearestBelow = new Map<TextLine, TextLine>();
  const nearestAbove = new Map<TextLine, { line: TextLine; gap: number }>();
  for (const upper of rest) {
    let best: { line: TextLine; gap: number } | undefined;
    for (const lower of rest) {
      const gap = lower === upper ? undefined : columnGap(upper, lower);
      if (gap !== undefined && (!best || gap < best.gap)) {
        best = { line: lower, gap };
      }
    }
    if (!best) {
      continue;
    }
    nearestBelow.set(upper, best.line);
    const above = nearestAbove.get(best.line);
    if (!above || best.gap < above.gap) {
      nearestAbove.set(best.line, { line: upper, gap: best.gap });
    }
  }
  const chains: Chain[] = [];
  const chained = new Set<TextLine>();
  for (const line of rest.toSorted((a, b) => a.top - b.top)) {
    if (chained.has(line)) {
      continue;
    }
    const members = [line];
    chained.add(line);
    let current = line;
    for (;;) {
      const next = nearestBelow.get(current);
      if (!next || chained.has(next) || nearestAbove.get(next)?.line !== current) {
        break;
      }
      members.push(next);
      chained.add(next);
      current = next;
    }
    chains.push(toChain(members));
  }

  // chains that line up, one above the other, are parts of one column: the longest first
  const columns: Chain[][] = [];
  const across: TextLine[] = [];
  for (const chain of chains.toSorted((a, b) => b.lines.length - a.lines.length || a.top - b.top)) {
    const extents = columns.map((column) => toChain(column.flatMap(({ lines }) => lines)));
    const matching = columns.filter(
      (_, index) => overlapX(extents[index], chain) >= 0.5 * Math.min(width(extents[index]), width(chain)),
    );
    // the chain reaches into two of them, or crosses the gutter between them
    // columns of more than one line beside the chain (not far above or below it)
    const margin = LINE_GAP * Math.max(...chain.lines.map(({ height }) => height));
    const established = extents.filter(
      (extent, index) =>
        columns[index].some(({ lines }) => lines.length > 1) &&
        extent.top - margin <= chain.bottom &&
        extent.bottom + margin >= chain.top,
    );
    const touching = established.filter((extent) => overlapX(extent, chain) > 0.15 * width(chain));
    const crossing = established.some((a) =>
      established.some((b) => a.right <= b.left && chain.left < a.right && chain.right > b.left),
    );
    const [column] = matching;
    const free =
      column && column.every((other) => other.bottom <= chain.top + 0.01 || other.top >= chain.bottom - 0.01);
    if (touching.length > 1 || crossing) {
      across.push(...chain.lines);
    } else if (matching.length === 1 && free) {
      column.push(chain);
    } else {
      columns.push([chain]);
    }
  }

  const result = columns.map((column) => {
    const members = column.flatMap(({ lines }) => lines);
    const extent = toChain(members);
    return { left: extent.left, right: extent.right, lines: members };
  });

  // a row that OCR read across a narrow gutter goes back to its columns, box by box
  const rows: TextLine[] = [];
  for (const line of [...spanning, ...across]) {
    rows.push(...splitAcross(line, result));
  }

  return {
    columns: result
      .map((column) => ({
        ...column,
        lines: column.lines.toSorted((a, b) => a.top - b.top || a.left - b.left),
      }))
      .toSorted((a, b) => a.left - b.left),
    spanning: rows.toSorted((a, b) => a.top - b.top || a.left - b.left),
  };
};

const quantile = (values: number[], q: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
};

/**
 * The boxes of a line across columns that each sit inside one column, in text of the column's size, join that
 * column (the line is returned without them); a title or a heading in larger text stays across the page.
 */
const splitAcross = (line: TextLine, columns: Column[]): TextLine[] => {
  if (line.boxes.length < 2) {
    return [line];
  }
  const cores = columns.map((column) => ({
    column,
    left: quantile(
      column.lines.map(({ left }) => left),
      0.2,
    ),
    right: quantile(
      column.lines.map(({ right }) => right),
      0.8,
    ),
    height: quantile(
      column.lines.map(({ height }) => height),
      0.5,
    ),
  }));
  const home = line.boxes.map((box) => {
    const center = (box.left + box.right) / 2;
    return cores.find(
      (core) =>
        core.column.lines.length > 1 &&
        center >= core.left &&
        center <= core.right &&
        box.height <= 1.6 * core.height &&
        overlapX(core, box) >= 0.5 * box.width,
    )?.column;
  });
  if (new Set(home.filter(Boolean)).size < 2) {
    return [line];
  }

  const rest: TextBox[] = [];
  const parts = new Map<Column, TextBox[]>();
  for (const [index, box] of line.boxes.entries()) {
    const column = home[index];
    if (column) {
      parts.set(column, [...(parts.get(column) ?? []), box]);
    } else {
      rest.push(box);
    }
  }
  for (const [column, boxes] of parts) {
    column.lines.push(toTextLine(boxes));
  }
  return rest.length > 0 ? [toTextLine(rest)] : [];
};
