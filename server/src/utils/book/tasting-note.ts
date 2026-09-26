import type { PxRect } from 'src/utils/book/layouts.js';
import type { PageDecoration, PageTextBlock } from 'src/utils/book/render.js';

/*
 * The tasting note of a bottle (the `tasting-note` layouts of wine books): beside or below the photo of the bottle, a
 * small typeset fiche, with the producer in spaced small caps, the wine in italics and the vintage large, then the
 * region and the grape as labelled rows between hairlines, and the note written in the photo's description, or ruled
 * lines to write one by hand. The caption is plain text a person can edit (see `getWineCaption` of the wine pack):
 * lines of "Label: value" (Producer, Wine, Vintage, Region, Grape, Style), then the note after a blank line; a
 * caption without labels ("Producer · Wine · Vintage") is read as the name.
 */

export type TastingNote = {
  producer?: string;
  wine?: string;
  vintage?: string;
  /** the other labelled rows, e.g. Region and Grape, in the order they are written */
  rows: Array<{ label: string; value: string }>;
  note?: string;
};

const NAME_LABELS: Record<string, 'producer' | 'wine' | 'vintage'> = {
  producer: 'producer',
  winery: 'producer',
  brewery: 'producer',
  wine: 'wine',
  cuvee: 'wine',
  cuvée: 'wine',
  beer: 'wine',
  vintage: 'vintage',
  year: 'vintage',
};

const ROW_LABELS = new Set(['region', 'appellation', 'grape', 'grapes', 'style', 'colour', 'color', 'type', 'score']);

/** Reads the fiche and the note of a caption */
export const parseTastingNote = (caption: string): TastingNote => {
  const result: TastingNote = { rows: [] };
  const notes: string[] = [];
  for (const paragraph of caption.split(/\n\s*\n/)) {
    const free: string[] = [];
    for (const line of paragraph.split(/\r?\n/)) {
      const match = /^\s*([\p{L} ]{2,14}):\s*(.+?)\s*$/u.exec(line);
      const label = match?.[1].trim().toLowerCase();
      if (match && label && NAME_LABELS[label]) {
        result[NAME_LABELS[label]] = match[2];
      } else if (match && label && ROW_LABELS.has(label)) {
        result.rows.push({ label: match[1].trim(), value: match[2] });
      } else if (line.trim()) {
        free.push(line.trim());
      }
    }
    // a name without labels: "Producer · Wine · Vintage"
    if (!result.producer && !result.wine && free.length > 0 && / · /.test(free[0]) && notes.length === 0) {
      const parts = free.shift()!.split(' · ');
      if (/^(?:\d{4}|NV)$/i.test(parts.at(-1)!)) {
        result.vintage = parts.pop();
      }
      if (parts.length > 1) {
        result.producer = parts.shift();
      }
      result.wine = parts.join(' · ') || undefined;
    }
    if (free.length > 0) {
      notes.push(free.join(' '));
    }
  }
  if (!result.producer && !result.wine && notes.length > 0 && !caption.includes('\n')) {
    // a caption of one line is the name of the wine
    result.wine = notes.shift();
  }
  if (notes.length > 0) {
    result.note = notes.join('\n');
  }
  return result;
};

export type TastingNoteOptions = {
  /** the caption's font size in pixels */
  fontPx: number;
  ink: string;
  accent: string;
  pxPerMm: number;
  wrap: (text: string, widthPx: number, fontPx: number, charWidth: number) => string[];
  lineHeight: number;
  charWidth: number;
  smallCapsCharWidth: number;
};

type Placed = { blocks: PageTextBlock[]; decorations: PageDecoration[]; bottom: number };

/**
 * The text blocks and rules of a tasting note in `rect`, at the largest size (up to 1.15 times the caption's) that
 * fits; a wide area (below a landscape photo) sets the name on the left and the rows and note on the right
 */
export const getTastingNoteBlocks = (
  caption: string,
  rect: PxRect,
  options: TastingNoteOptions,
): { blocks: PageTextBlock[]; decorations: PageDecoration[] } => {
  const note = parseTastingNote(caption);
  const { wrap, lineHeight, charWidth, smallCapsCharWidth, ink, accent, pxPerMm } = options;
  const wide = rect.width > 1.9 * rect.height;

  const text = (
    value: string,
    left: number,
    top: number,
    width: number,
    fontPx: number,
    style: Partial<PageTextBlock>,
    spacing = 0,
  ) => {
    const lines = wrap(value, width, fontPx, (style.smallCaps ? smallCapsCharWidth : charWidth) + spacing);
    const height = lines.length * fontPx * lineHeight;
    const block: PageTextBlock = {
      kind: 'slotCaption',
      rect: { left, top, width, height },
      text: value,
      fontPx,
      align: 'left',
      color: ink,
      valign: 'top',
      ...(spacing > 0 && { letterSpacing: spacing }),
      ...style,
    };
    return { block, height };
  };
  const rule = (left: number, y: number, width: number, opacity = 0.6): Extract<PageDecoration, { kind: 'line' }> => ({
    kind: 'line',
    x1: left,
    y1: y,
    x2: left + width,
    y2: y,
    color: accent,
    width: pxPerMm * 0.22,
    opacity,
  });

  /** the producer, the wine and the vintage */
  const placeName = (left: number, top: number, width: number, fontPx: number): Placed => {
    const blocks: PageTextBlock[] = [];
    const decorations: PageDecoration[] = [];
    let y = top;
    if (note.producer) {
      const { block, height } = text(
        note.producer,
        left,
        y,
        width,
        fontPx * 1.05,
        { color: accent, smallCaps: true },
        0.14,
      );
      blocks.push(block);
      y += height + fontPx * 0.35;
    }
    if (note.wine) {
      const { block, height } = text(note.wine, left, y, width, fontPx * 1.45, { italic: true });
      blocks.push(block);
      y += height + fontPx * 0.3;
    }
    if (note.vintage) {
      const { block, height } = text(note.vintage, left, y, width, fontPx * 2.1, { color: accent });
      blocks.push(block);
      y += height;
    }
    return { blocks, decorations, bottom: y };
  };

  /** the labelled rows between hairlines, and the note (or ruled lines to write one) */
  const placeDetails = (left: number, top: number, width: number, bottom: number, fontPx: number): Placed => {
    const blocks: PageTextBlock[] = [];
    const decorations: PageDecoration[] = [];
    let y = top;
    const labelWidth = Math.min(width * 0.36, fontPx * 7);
    if (note.rows.length > 0) {
      decorations.push(rule(left, y, width));
      y += fontPx * 0.6;
      for (const row of note.rows) {
        const label = text(row.label, left, y, labelWidth, fontPx * 0.82, { color: accent, smallCaps: true }, 0.12);
        const value = text(row.value, left + labelWidth, y, width - labelWidth, fontPx, {});
        blocks.push({ ...label.block, rect: { ...label.block.rect, top: y + fontPx * 0.12 } }, value.block);
        y += Math.max(label.height, value.height) + fontPx * 0.3;
      }
      decorations.push(rule(left, y + fontPx * 0.1, width));
      y += fontPx * 0.9;
    } else {
      decorations.push(rule(left, y, width));
      y += fontPx * 0.8;
    }
    const heading = text('Tasting note', left, y, width, fontPx * 0.82, { color: accent, smallCaps: true }, 0.12);
    blocks.push(heading.block);
    y += heading.height + fontPx * 0.35;
    if (note.note) {
      const body = text(note.note, left, y, width, fontPx, { italic: true });
      blocks.push(body.block);
      y += body.height;
    } else {
      // room to write the note by hand
      const gap = fontPx * 1.7;
      for (let line = y + gap; line <= bottom && line <= y + gap * 6; line += gap) {
        decorations.push({ ...rule(left, line, width, 0.35), dash: `${pxPerMm * 0.6} ${pxPerMm * 0.9}` });
      }
      y = Math.min(bottom, y + gap * 6);
    }
    return { blocks, decorations, bottom: y };
  };

  const layout = (fontPx: number, shift = 0) => {
    if (wide) {
      const gap = rect.width * 0.06;
      const nameWidth = rect.width * 0.42;
      const name = placeName(rect.left, rect.top, nameWidth, fontPx);
      const details = placeDetails(
        rect.left + nameWidth + gap,
        rect.top + fontPx * 0.2,
        rect.width - nameWidth - gap,
        rect.top + rect.height,
        fontPx,
      );
      return {
        blocks: [...name.blocks, ...details.blocks],
        decorations: [...name.decorations, ...details.decorations],
        bottom: Math.max(name.bottom, details.bottom),
      };
    }
    // the fiche starts a little below the top of the photo, like a card set beside it
    const top = rect.top + Math.min(rect.height * 0.06, fontPx * 2) + shift;
    const name = placeName(rect.left, top, rect.width, fontPx);
    const details = placeDetails(rect.left, name.bottom + fontPx * 0.9, rect.width, rect.top + rect.height, fontPx);
    return {
      blocks: [...name.blocks, ...details.blocks],
      decorations: [...name.decorations, ...details.decorations],
      bottom: details.bottom,
    };
  };

  let scale = 1.15;
  let result = layout(options.fontPx * scale);
  while (result.bottom > rect.top + rect.height && scale > 0.6) {
    scale *= 0.92;
    result = layout(options.fontPx * scale);
  }
  // a short fiche sits a little higher than the middle of the photo
  const free = rect.top + rect.height - result.bottom;
  if (!wide && free > rect.height * 0.25) {
    result = layout(options.fontPx * scale, free * 0.35);
  }
  return { blocks: result.blocks, decorations: result.decorations };
};
