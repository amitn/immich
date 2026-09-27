import type { PageDecoration, PageTextBlock } from 'src/utils/book/render.js';
import { PxRect, mmToPx } from 'src/utils/book/layouts.js';

/*
 * The growth timeline of a plant (the `growth-timeline` layouts of garden journals): its photos down the page in the
 * order they were taken, and beside them a line with a dot level with each photo, the date in small spaced capitals
 * and the stage (or the note of the photo) in italics under it. The caption of each photo is plain text a person can
 * edit: the date on the first line, the stage on the next.
 */

/**
 * the line of the timeline at `x`, from the first photo to the last, a dot level with the middle of each photo, and a
 * leaf-like tick at the end
 */
export const getTimelineDecorations = (
  x: number,
  photos: PxRect[],
  dpi: number,
  colors: { accent: string; page: string },
): PageDecoration[] => {
  if (photos.length === 0) {
    return [];
  }
  const middles = photos.map((photo) => photo.top + photo.height / 2).toSorted((a, b) => a - b);
  const radius = mmToPx(1.6, dpi);
  const top = photos[0].top + mmToPx(2, dpi);
  const bottom = Math.max(...photos.map((photo) => photo.top + photo.height)) - mmToPx(2, dpi);
  const decorations: PageDecoration[] = [
    { kind: 'line', x1: x, y1: top, x2: x, y2: bottom, color: colors.accent, width: mmToPx(0.35, dpi), opacity: 0.7 },
  ];
  for (const y of middles) {
    decorations.push(
      { kind: 'circle', x, y, r: radius * 1.6, color: colors.page, width: 0, fill: colors.page },
      { kind: 'circle', x, y, r: radius, color: colors.accent, width: mmToPx(0.35, dpi), fill: colors.accent },
    );
  }
  // a small leaf at the end of the line: the plant grows on
  const leaf = mmToPx(2.4, dpi);
  decorations.push({
    kind: 'path',
    d: `M${x.toFixed(1)} ${bottom.toFixed(1)}Q${(x + leaf).toFixed(1)} ${(bottom + leaf * 0.2).toFixed(1)} ${(x + leaf * 1.2).toFixed(1)} ${(bottom + leaf).toFixed(1)}Q${(x + leaf * 0.2).toFixed(1)} ${(bottom + leaf * 0.9).toFixed(1)} ${x.toFixed(1)} ${bottom.toFixed(1)}Z`,
    color: colors.accent,
    fill: colors.accent,
    opacity: 0.8,
  });
  return decorations;
};

/** the label of a photo on a growth timeline: the date in small capitals, the stage or note in italics under it */
export const getTimelineLabel = (
  caption: string,
  rect: PxRect,
  options: { captionPx: number; ink: string; accent: string; lineHeight: number },
): PageTextBlock[] => {
  const { captionPx, ink, accent, lineHeight } = options;
  const [date, ...rest] = caption.split('\n');
  const note = rest.join(' ').trim();
  const dateHeight = captionPx * 1.05 * lineHeight;
  const total = dateHeight + (note ? captionPx * 1.15 * lineHeight * 2 : 0);
  // level with the dot: the label is centred on the middle of its area
  const top = rect.top + Math.max(0, (rect.height - total) / 2);
  const blocks: PageTextBlock[] = [
    {
      kind: 'slotCaption',
      rect: { left: rect.left, top, width: rect.width, height: dateHeight },
      text: date,
      fontPx: captionPx * 1.05,
      align: 'left',
      color: accent,
      smallCaps: true,
      letterSpacing: 0.1,
      valign: 'top',
    },
  ];
  if (note) {
    blocks.push({
      kind: 'slotCaption',
      rect: {
        left: rect.left,
        top: top + dateHeight,
        width: rect.width,
        height: Math.max(1, rect.top + rect.height - top - dateHeight),
      },
      text: note,
      fontPx: captionPx * 1.15,
      align: 'left',
      color: ink,
      italic: true,
      valign: 'top',
    });
  }
  return blocks;
};
