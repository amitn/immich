import type { PageDecoration, PageTextBlock } from 'src/utils/book/render.js';
import { LayoutRect, PxRect, mmToPx } from 'src/utils/book/layouts.js';

/*
 * The mounted look of a pack's book theme (the Refrigerator gallery of kids' art): every photo is shown whole on a
 * white paper mat with a soft shadow, held on the page by strips of tape or by photo corners, and labelled below in a
 * handwriting-like face, the title first and the age and date under it in the accent colour; headings are underlined
 * with a crayon squiggle. The overlay is drawn over the photos, so the mat is a ring around the photo (the photo sits
 * inside its slot, inset by the mat) and the shadow is drawn outside it.
 */

/** the width of the paper mat around a photo */
export const MOUNT_MAT_MM = 3.2;

/** the slot of a photo inset by its mat, and by room for its tape */
export const insetForMount = (rect: LayoutRect): LayoutRect => {
  const inset = Math.min(MOUNT_MAT_MM + 1.2, Math.min(rect.width, rect.height) * 0.12);
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(1, rect.width - 2 * inset),
    height: Math.max(1, rect.height - 2 * inset),
  };
};

const point = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/** a polygon as a path */
const polygon = (points: Array<[number, number]>) => `M${points.map(([x, y]) => point(x, y)).join('L')}Z`;

/** a strip of tape centred on (x, y), turned by `angle` degrees, with torn ends */
const tape = (x: number, y: number, length: number, width: number, angle: number): string => {
  const radians = (angle * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  const at = (u: number, v: number): [number, number] => [x + u * cos - v * sin, y + u * sin + v * cos];
  const half = length / 2;
  const teeth = 4;
  const tooth = width / teeth;
  const points: Array<[number, number]> = [at(-half, -width / 2), at(half, -width / 2)];
  // a torn end: small teeth across the width
  for (let index = 1; index <= teeth; index++) {
    points.push(at(half - (index % 2 === 1 ? tooth * 0.45 : 0), -width / 2 + tooth * index));
  }
  points.push(at(-half, width / 2));
  for (let index = teeth - 1; index >= 1; index--) {
    points.push(at(-half + (index % 2 === 1 ? tooth * 0.45 : 0), -width / 2 + tooth * index));
  }
  return polygon(points);
};

/** the part of a rect moved by (dx, dy) that is outside the rect: the shadow it casts to the lower right */
const shadowOf = (rect: PxRect, dx: number, dy: number) => {
  const [left, top, right, bottom] = [rect.left, rect.top, rect.left + rect.width, rect.top + rect.height];
  return polygon([
    [right, top + dy],
    [right + dx, top + dy],
    [right + dx, bottom + dy],
    [left + dx, bottom + dy],
    [left + dx, bottom],
    [right, bottom],
  ]);
};

export type MountColors = { mat: string; edge: string; shadow: string; tape: string; corner: string };

export const DEFAULT_MOUNT_COLORS: MountColors = {
  mat: '#fffdf7',
  edge: '#e2d8c6',
  shadow: '#4b3b2c',
  tape: '#f4e29a',
  corner: '#5b4636',
};

/**
 * The mat, shadow and tape (or photo corners) of the photo in `rect`, the `index`th of the page: the kind of mount
 * and the tilt of the tape change from photo to photo, the same way every time
 */
export const getMountDecorations = (
  rect: PxRect,
  index: number,
  dpi: number,
  colors: MountColors = DEFAULT_MOUNT_COLORS,
): PageDecoration[] => {
  const mat = Math.min(mmToPx(MOUNT_MAT_MM, dpi), Math.min(rect.width, rect.height) * 0.08);
  const outer: PxRect = {
    left: rect.left - mat,
    top: rect.top - mat,
    width: rect.width + 2 * mat,
    height: rect.height + 2 * mat,
  };
  const decorations: PageDecoration[] = [];
  // a soft shadow to the lower right of the mat
  for (const [offset, opacity] of [
    [0.5, 0.1],
    [1, 0.07],
    [1.6, 0.04],
  ] as const) {
    const shift = mmToPx(offset, dpi);
    decorations.push({
      kind: 'path',
      d: shadowOf(outer, shift, shift * 1.2),
      color: colors.shadow,
      fill: colors.shadow,
      opacity,
    });
  }
  // the mat: a ring of paper around the photo, with a fine edge
  decorations.push(
    {
      kind: 'frame',
      rect: { left: rect.left - mat / 2, top: rect.top - mat / 2, width: rect.width + mat, height: rect.height + mat },
      color: colors.mat,
      width: mat,
    },
    { kind: 'frame', rect: outer, color: colors.edge, width: Math.max(1, mmToPx(0.18, dpi)) },
  );

  const mount = index % 3;
  if (mount === 2) {
    // photo corners of craft paper at the four corners
    const size = Math.min(mmToPx(8, dpi), Math.min(rect.width, rect.height) * 0.22);
    const [left, top, right, bottom] = [outer.left, outer.top, outer.left + outer.width, outer.top + outer.height];
    for (const [x, y, dx, dy] of [
      [left, top, 1, 1],
      [right, top, -1, 1],
      [right, bottom, -1, -1],
      [left, bottom, 1, -1],
    ] as const) {
      decorations.push({
        kind: 'path',
        d: polygon([
          [x - dx * mat * 0.25, y - dy * mat * 0.25],
          [x + dx * size, y - dy * mat * 0.25],
          [x - dx * mat * 0.25, y + dy * size],
        ]),
        color: colors.corner,
        fill: colors.corner,
        opacity: 0.88,
      });
    }
    return decorations;
  }

  const length = Math.min(mmToPx(18, dpi), outer.width * 0.4);
  const width = Math.min(mmToPx(6, dpi), length * 0.4);
  const tilt = [-4, 3, -2, 5][index % 4];
  const strips =
    mount === 0
      ? [
          // across the two top corners
          { x: outer.left + width * 0.55, y: outer.top + width * 0.55, angle: -42 + tilt },
          { x: outer.left + outer.width - width * 0.55, y: outer.top + width * 0.55, angle: 42 + tilt },
        ]
      : [
          // one strip across the top edge, and one at the foot
          { x: outer.left + outer.width / 2, y: outer.top, angle: tilt },
          { x: outer.left + outer.width / 2, y: outer.top + outer.height, angle: -tilt },
        ];
  for (const strip of strips) {
    decorations.push({
      kind: 'path',
      d: tape(strip.x, strip.y, length, width, strip.angle),
      color: colors.tape,
      fill: colors.tape,
      opacity: 0.78,
    });
  }
  return decorations;
};

/** a crayon squiggle under a heading, from `left` to `left + width` at `y` */
export const getSquiggle = (left: number, y: number, width: number, dpi: number, color: string): PageDecoration => {
  const wave = mmToPx(1.1, dpi);
  const step = mmToPx(6, dpi);
  const count = Math.max(2, Math.round(width / step));
  const segment = width / count;
  let d = `M${point(left, y)}`;
  for (let index = 0; index < count; index++) {
    const x = left + segment * (index + 1);
    d += `Q${point(x - segment / 2, y + (index % 2 === 0 ? -wave : wave))} ${point(x, y)}`;
  }
  return { kind: 'path', d, color, width: mmToPx(0.9, dpi), opacity: 0.85 };
};

/**
 * The label of a mounted photo, like the one a parent writes: the title, then the age and the date in the accent
 * colour, from the top of `rect` down
 */
export const getMountedLabel = (
  caption: string,
  rect: PxRect,
  align: PageTextBlock['align'],
  options: {
    captionPx: number;
    ink: string;
    accent: string;
    /** the lines a text wraps to, see `wrapText` */
    wrap: (text: string, widthPx: number, fontPx: number) => string[];
    lineHeight: number;
  },
): PageTextBlock[] => {
  const { captionPx, ink, accent, wrap, lineHeight } = options;
  const [title, ...rest] = caption.split('\n');
  const details = rest.join(' · ').trim();
  const titlePx = captionPx * 1.15;
  // the title takes the lines it needs, three at most; the details go under it
  const titleLines = Math.min(3, wrap(title, rect.width, titlePx).length);
  const titleHeight = Math.min(rect.height, titleLines * titlePx * lineHeight);
  const blocks: PageTextBlock[] = [
    {
      kind: 'slotCaption',
      rect: { ...rect, height: details ? Math.max(1, titleHeight) : rect.height },
      text: title,
      fontPx: titlePx,
      align,
      color: ink,
      valign: 'top',
      balance: true,
    },
  ];
  if (details) {
    const top = rect.top + titleHeight + captionPx * 0.15;
    blocks.push({
      kind: 'slotCaption',
      rect: { ...rect, top, height: Math.max(1, rect.top + rect.height - top) },
      text: details,
      fontPx: captionPx * 0.95,
      align,
      color: accent,
      valign: 'top',
    });
  }
  return blocks;
};
