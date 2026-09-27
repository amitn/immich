import type { PxRect } from 'src/utils/book/layouts.js';
import type { PageDecoration, PageTextBlock } from 'src/utils/book/render.js';

/*
 * The setlist page of a concert book (the `setlist` layout): the caption typeset beside the photo of the setlist (or
 * of the line-up) like the sheet taped to the stage floor, in bold capitals. The caption is plain text a person can
 * edit (see `formatSetlistPage` of the concerts pack): a first paragraph with the act (or the stage of a line-up) and
 * lines such as the venue and the date, then paragraphs of numbered songs ("1. Ohio"), acts with their start ("20:20
 * Malihini") or other lines ("Interlude", "Encore"), each paragraph under an optional heading that ends with a colon
 * ("Saturday:").
 */

type Item =
  | { kind: 'heading'; text: string }
  | { kind: 'numbered'; label: string; text: string }
  | { kind: 'marker'; text: string };

export type SetlistText = { title?: string; lines: string[]; items: Item[] };

const HEADING = /^(.{1,40}):\s*$/;
const NUMBERED = /^(\d{1,2}[.)]|\d{1,2}:\d{2})\s+(.+)$/;

/** Reads the setlist of a caption: its header, then its songs or acts */
export const parseSetlistText = (caption: string): SetlistText => {
  const paragraphs = caption
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .filter((lines) => lines.length > 0);
  const result: SetlistText = { lines: [], items: [] };
  for (const [index, lines] of paragraphs.entries()) {
    const numbered = lines.filter((line) => NUMBERED.test(line)).length;
    if (index === 0 && numbered === 0 && !HEADING.test(lines[0])) {
      result.title = lines[0];
      result.lines = lines.slice(1);
      continue;
    }
    for (const line of lines) {
      const heading = HEADING.exec(line);
      const item = NUMBERED.exec(line);
      if (heading) {
        result.items.push({ kind: 'heading', text: heading[1] });
      } else if (item) {
        result.items.push({ kind: 'numbered', label: item[1].replace(/[.)]$/, ''), text: item[2] });
      } else {
        result.items.push({ kind: 'marker', text: line });
      }
    }
  }
  return result;
};

export type SetlistBlockOptions = {
  /** the caption's font size in pixels */
  fontPx: number;
  ink: string;
  accent: string;
  pxPerMm: number;
  wrap: (text: string, widthPx: number, fontPx: number, charWidth: number) => string[];
  lineHeight: number;
  /** the average width of a capital, as a share of the font size (see `getCharWidth`) */
  capsCharWidth: number;
  charWidth: number;
};

/** bold capitals, a little spaced, like a setlist written with a marker */
const CAPS = { smallCaps: true, bold: true, letterSpacing: 0.04 } as const;

/** at most this much smaller than the caption's size, then the last items are left out */
const MIN_SCALE = 0.5;

/**
 * The text blocks and rules of a setlist caption in `rect`: the act large in the accent, its lines in spaced small
 * capitals, a thick rule, then the songs in bold capitals with their numbers (or the acts with their starts) in the
 * accent, in two columns when one is too long, at the largest size (up to twice the caption's) that fits.
 */
export const getSetlistBlocks = (
  caption: string,
  rect: PxRect,
  options: SetlistBlockOptions,
): { blocks: PageTextBlock[]; decorations: PageDecoration[] } => {
  const setlist = parseSetlistText(caption);
  const { wrap, lineHeight, capsCharWidth, ink, accent, pxPerMm } = options;
  const capsWidth = capsCharWidth + CAPS.letterSpacing;
  const timed = setlist.items.some((item) => item.kind === 'numbered' && item.label.includes(':'));

  const layout = (fontPx: number, columns: number, items: Item[]) => {
    const blocks: PageTextBlock[] = [];
    const decorations: PageDecoration[] = [];
    let top = rect.top;
    if (setlist.title) {
      const titlePx = fontPx * 2.1;
      const lines = wrap(setlist.title.toUpperCase(), rect.width, titlePx, capsWidth);
      const height = Math.min(2, lines.length) * titlePx * lineHeight;
      blocks.push({
        kind: 'caption',
        rect: { left: rect.left, top, width: rect.width, height },
        text: setlist.title.toUpperCase(),
        fontPx: titlePx,
        align: 'left',
        color: accent,
        ...CAPS,
        letterSpacing: 0.02,
        valign: 'top',
      });
      top += height + fontPx * 0.2;
    }
    for (const line of setlist.lines) {
      const linePx = fontPx * 0.85;
      const height = wrap(line, rect.width, linePx, capsCharWidth + 0.12).length * linePx * lineHeight;
      blocks.push({
        kind: 'caption',
        rect: { left: rect.left, top, width: rect.width, height },
        text: line,
        fontPx: linePx,
        align: 'left',
        color: ink,
        smallCaps: true,
        letterSpacing: 0.12,
        valign: 'top',
      });
      top += height;
    }
    if (setlist.title || setlist.lines.length > 0) {
      top += fontPx * 0.45;
      decorations.push({
        kind: 'line',
        x1: rect.left,
        y1: top,
        x2: rect.left + Math.min(rect.width, pxPerMm * 70),
        y2: top,
        color: accent,
        width: Math.max(pxPerMm * 1.1, fontPx * 0.18),
      });
      top += fontPx * 1.1;
    }

    const gap = fontPx * 1.2;
    const width = (rect.width - gap * (columns - 1)) / columns;
    const indent = fontPx * (timed ? 3.4 : 1.9);
    const heights = items.map((item) => {
      if (item.kind === 'heading') {
        return fontPx * 0.95 * lineHeight + fontPx * 0.5;
      }
      const text = item.kind === 'numbered' ? width - indent : width;
      return wrap(item.text.toUpperCase(), text, fontPx, capsWidth).length * fontPx * lineHeight + fontPx * 0.18;
    });
    // the items fill the columns in turn, about as tall as each other
    const total = heights.reduce((sum, height) => sum + height, 0);
    const room = rect.top + rect.height - top;
    let column = 0;
    let y = top;
    let fits = true;
    for (const [index, item] of items.entries()) {
      const height = heights[index];
      if (column < columns - 1 && y - top + height > Math.max(total / columns, 0) + fontPx * 0.5) {
        column++;
        y = top;
      }
      if (y + height > rect.top + rect.height + 0.5) {
        fits = false;
      }
      const left = rect.left + column * (width + gap);
      if (item.kind === 'heading') {
        blocks.push({
          kind: 'caption',
          rect: { left, top: y + fontPx * 0.25, width, height: fontPx * 0.95 * lineHeight },
          text: item.text,
          fontPx: fontPx * 0.95,
          align: 'left',
          color: accent,
          smallCaps: true,
          letterSpacing: 0.14,
          valign: 'top',
        });
      } else if (item.kind === 'numbered') {
        blocks.push(
          {
            kind: 'caption',
            rect: { left, top: y, width: indent - fontPx * 0.35, height: fontPx * lineHeight },
            text: item.label,
            fontPx,
            align: 'right',
            color: accent,
            bold: true,
            valign: 'top',
          },
          {
            kind: 'caption',
            rect: { left: left + indent, top: y, width: width - indent, height: height - fontPx * 0.18 },
            text: item.text.toUpperCase(),
            fontPx,
            align: 'left',
            color: ink,
            ...CAPS,
            valign: 'top',
          },
        );
      } else {
        blocks.push({
          kind: 'caption',
          rect: { left: left + (timed ? 0 : indent), top: y, width: width - (timed ? 0 : indent), height },
          text: `— ${item.text} —`,
          fontPx: fontPx * 0.9,
          align: 'left',
          color: accent,
          italic: true,
          valign: 'top',
        });
      }
      y += height;
    }
    return { blocks, decorations, fits: fits && room > 0 };
  };

  const items = setlist.items;
  for (const columns of items.length > 12 ? [1, 2] : [1]) {
    for (let scale = columns === 1 ? 1.35 : 1.15; scale >= (columns === 1 ? 0.8 : MIN_SCALE); scale *= 0.94) {
      const result = layout(options.fontPx * scale, columns, items);
      if (result.fits) {
        return result;
      }
    }
  }
  // too long even at the smallest size: the last items are left out
  let kept = items;
  let result = layout(options.fontPx * MIN_SCALE, 2, kept);
  while (!result.fits && kept.length > 1) {
    kept = kept.slice(0, -1);
    result = layout(options.fontPx * MIN_SCALE, 2, kept);
  }
  return result;
};
