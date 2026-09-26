import { BookMap, BookStyle, NormalizedRect, resolveBookStyle } from 'src/dtos/book.dto.js';
import { normalizeRect, suggestCrop } from 'src/utils/agent/crop.js';
import { getFontStack } from 'src/utils/book/fonts.js';
import {
  BookLayout,
  LayoutRect,
  LayoutTextArea,
  PageSize,
  PxRect,
  getLayout,
  getLayoutBox,
  getMapRectMm,
  getSlotRectsMm,
  getTextRectsMm,
  mmToPx,
  toPxRect,
} from 'src/utils/book/layouts.js';

/** thumbnail: contact sheets from thumbnail files; review: ~1200px pages from previews; print: 300 dpi from originals */
export type BookRenderMode = 'thumbnail' | 'review' | 'print';

export const PRINT_DPI = 300;
export const MIN_PRINT_DPI = 150;
export const REVIEW_LONG_EDGE_PX = 1200;

export const FULL_CROP: NormalizedRect = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

export const getDpiForLongEdge = (size: PageSize, longEdgePx: number) =>
  (longEdgePx * 25.4) / Math.max(size.pageWidthMm, size.pageHeightMm);

export type BookPageComposeSlot = PxRect & { input: string | Buffer; crop: NormalizedRect };

export type BookPageComposeSpec = {
  width: number;
  height: number;
  background: string;
  /** null entries are skipped; the result keeps the same indexes */
  slots: (BookPageComposeSlot | null)[];
  /** SVG drawn over the photos */
  overlay: string | null;
  quality: number;
};

/** the size of the source region used for a slot, or why it could not be drawn */
export type BookPageComposeSlotResult = { width: number; height: number } | { error: string } | null;

export type BookPageComposeResult = { data: Buffer; slots: BookPageComposeSlotResult[] };

export type RenderBookInput = PageSize & {
  title: string;
  subtitle: string | null;
  style: BookStyle;
  coverAssetId: string | null;
};

export type RenderPlacement = { slot: number; assetId: string; crop: NormalizedRect | null; caption: string | null };

export type RenderPageInput = {
  layout: string;
  sectionTitle: string | null;
  caption: string | null;
  background: string | null;
  assets: RenderPlacement[];
  map?: BookMap | null;
};

export type RenderSource = {
  /** file (or decoded image) the slot is drawn from */
  input: string | Buffer;
  /** full-resolution size of the asset as displayed (0 when unknown), used to estimate the print resolution */
  width: number;
  height: number;
  /** set when a lower quality file had to be used */
  fallback?: string;
};

export type BookRenderWarningType =
  | 'empty-slot'
  | 'missing-asset'
  | 'low-dpi'
  | 'fallback-source'
  | 'crop-trimmed'
  | 'render-error'
  | 'unknown-layout'
  | 'map';

export type BookRenderWarning = {
  /** one-based page number */
  page: number;
  /** one-based slot number */
  slot?: number;
  type: BookRenderWarningType;
  message: string;
  dpi?: number;
};

export type PagePlanSlot = {
  index: number;
  rect: PxRect;
  rectMm: LayoutRect;
  assetId: string | null;
  crop: NormalizedRect;
  hasCrop: boolean;
  caption: string | null;
  source: RenderSource | null;
};

export type PagePlan = {
  mode: BookRenderMode;
  dpi: number;
  layout: BookLayout;
  unknownLayout: boolean;
  slots: PagePlanSlot[];
  /** titles and captions, in pixels; drawn into `spec.overlay` */
  text: PageTextBlock[];
  /** rules, ornaments and frames, in pixels; drawn into `spec.overlay` under the text */
  decorations: PageDecoration[];
  /** the map area of the layout, if it has one */
  map: { rect: PxRect; rectMm: LayoutRect } | null;
  spec: BookPageComposeSpec;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export const normalizeFaces = (
  faces: {
    imageWidth: number;
    imageHeight: number;
    boundingBoxX1: number;
    boundingBoxY1: number;
    boundingBoxX2: number;
    boundingBoxY2: number;
  }[],
): NormalizedRect[] =>
  faces
    .filter((face) => face.imageWidth > 0 && face.imageHeight > 0)
    .map((face) => {
      const x1 = clamp(face.boundingBoxX1 / face.imageWidth, 0, 1);
      const y1 = clamp(face.boundingBoxY1 / face.imageHeight, 0, 1);
      const x2 = clamp(face.boundingBoxX2 / face.imageWidth, 0, 1);
      const y2 = clamp(face.boundingBoxY2 / face.imageHeight, 0, 1);
      return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
    });

export type SmartCrop = {
  crop: NormalizedRect;
  /** false when every crop with the slot's aspect ratio cuts through the main face (or another large face) */
  feasible: boolean;
  /** fraction of the image area inside the crop */
  kept: number;
  /** number of faces left out of the crop */
  droppedFaces: number;
};

/**
 * The largest crop with the slot's aspect ratio that keeps the faces whole, with headroom and the eyes on the upper
 * third (see `suggestCrop`); centred when there are no faces.
 */
export const getSmartCrop = (
  image: { width: number; height: number },
  faces: NormalizedRect[],
  slotAspect: number,
): SmartCrop => {
  if (!image.width || !image.height || !(slotAspect > 0)) {
    return { crop: { ...FULL_CROP }, feasible: true, kept: 1, droppedFaces: 0 };
  }

  const { width, height } = image;
  const suggestion = suggestCrop({
    width,
    height,
    aspectRatio: clamp(slotAspect, 0.1, 10),
    faces: faces.map((face) => ({
      x1: face.x * width,
      y1: face.y * height,
      x2: (face.x + face.width) * width,
      y2: (face.y + face.height) * height,
    })),
  });

  const rect = normalizeRect(suggestion.rect, width, height);
  const x = round4(clamp(rect.x, 0, 1));
  const y = round4(clamp(rect.y, 0, 1));
  const crop = { x, y, width: Math.min(round4(rect.width), 1 - x), height: Math.min(round4(rect.height), 1 - y) };
  return {
    crop,
    feasible: suggestion.feasible,
    kept: crop.width * crop.height,
    droppedFaces: suggestion.droppedFaces.length,
  };
};

/** The crop used when a photo is placed without one */
export const getDefaultCrop = (
  image: { width: number; height: number },
  faces: NormalizedRect[],
  slotAspect: number,
): NormalizedRect => getSmartCrop(image, faces, slotAspect).crop;

/** The pixel region of a normalized crop in an image of the given size */
export const getCropRegion = (crop: NormalizedRect, width: number, height: number): PxRect => {
  const left = clamp(Math.round(crop.x * width), 0, width - 1);
  const top = clamp(Math.round(crop.y * height), 0, height - 1);
  return {
    left,
    top,
    width: clamp(Math.round(crop.width * width), 1, width - left),
    height: clamp(Math.round(crop.height * height), 1, height - top),
  };
};

/** Source pixels per inch of a crop that is cover-fitted into a slot of the given size */
export const getEffectiveDpi = (cropPx: { width: number; height: number }, slotMm: { width: number; height: number }) =>
  Math.min(cropPx.width / (slotMm.width / 25.4), cropPx.height / (slotMm.height / 25.4));

export const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** average character width, as a share of the font size */
export const CHAR_WIDTH = 0.52;
const SMALL_CAPS_CHAR_WIDTH = 0.6;
export const LINE_HEIGHT = 1.25;

/** Greedy word wrap based on an average character width */
export const wrapText = (text: string, maxWidthPx: number, fontPx: number, charWidth = CHAR_WIDTH): string[] => {
  const maxChars = Math.max(1, Math.floor(maxWidthPx / (fontPx * charWidth)));
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (let word of paragraph.split(/\s+/)) {
      if (!word) {
        continue;
      }

      while (word.length > maxChars) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(word.slice(0, maxChars));
        word = word.slice(maxChars);
      }

      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxChars) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }

  return lines;
};

/** Shrinks the font (down to 60%) until the text fits the box, then truncates it with an ellipsis */
export const fitText = (
  text: string,
  box: { width: number; height: number },
  fontPx: number,
  charWidth = CHAR_WIDTH,
) => {
  const minPx = fontPx * 0.6;
  // the text shrinks rather than break a word
  const longestWord = Math.max(0, ...text.split(/\s+/).map((word) => word.length));
  for (let size = fontPx; size >= minPx; size *= 0.9) {
    const lines = wrapText(text, box.width, size, charWidth);
    const breaksWords = longestWord > Math.max(1, Math.floor(box.width / (size * charWidth)));
    if (!breaksWords && lines.length * size * LINE_HEIGHT <= box.height) {
      return { lines, fontPx: size };
    }
  }

  const size = Math.min(minPx, box.height / LINE_HEIGHT);
  const maxLines = Math.max(1, Math.floor(box.height / (size * LINE_HEIGHT)));
  const lines = wrapText(text, box.width, size, charWidth);
  if (lines.length <= maxLines) {
    return { lines, fontPx: size };
  }

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/.$/, '')}…`;
  return { lines: kept, fontPx: size };
};

/**
 * The same text in no more lines, wrapped as narrowly as possible so the lines have about the same length, e.g.
 * "Four Story Hill Farm / Milk-Poached Poularde" instead of "Four Story Hill Farm Milk-Poached / Poularde"; lines
 * that were shortened with an ellipsis are kept
 */
export const balanceLines = (text: string, lines: string[], width: number, fontPx: number, charWidth = CHAR_WIDTH) => {
  if (lines.length < 2 || lines.at(-1)!.endsWith('…') || text.includes('\n')) {
    return lines;
  }
  const longestWord = Math.max(...text.split(/\s+/).map((word) => word.length));
  let low = Math.min(width, Math.max(width / lines.length, longestWord * fontPx * charWidth));
  let high = width;
  for (let step = 0; step < 12; step++) {
    const middle = (low + high) / 2;
    if (wrapText(text, middle, fontPx, charWidth).length <= lines.length) {
      high = middle;
    } else {
      low = middle;
    }
  }
  const balanced = wrapText(text, high, fontPx, charWidth);
  return balanced.length <= lines.length ? balanced : lines;
};

export type PageTextKind = LayoutTextArea['kind'] | 'slotCaption';

export type PageTextBlock = {
  kind: PageTextKind;
  rect: PxRect;
  text: string;
  fontPx: number;
  align: LayoutTextArea['align'];
  color: string;
  bold?: boolean;
  italic?: boolean;
  smallCaps?: boolean;
  /** wraps the text into lines of about the same length */
  balance?: boolean;
  /** extra space between the letters, as a share of the font size */
  letterSpacing?: number;
  /** draws a translucent band behind the text, for captions over photos */
  band?: boolean;
  /** default black at 45% */
  bandColor?: string;
  bandOpacity?: number;
  valign?: 'top' | 'middle' | 'bottom';
};

/** Rules, ornaments and frames drawn over the page, in pixels */
export type PageDecoration =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; opacity?: number }
  | { kind: 'diamond'; x: number; y: number; size: number; color: string; opacity?: number }
  | { kind: 'frame'; rect: PxRect; color: string; width: number; opacity?: number };

/** the average character width of a text block, as a share of its font size, see `wrapText` */
export const getCharWidth = (block: Pick<PageTextBlock, 'smallCaps' | 'letterSpacing'>) =>
  (block.smallCaps ? SMALL_CAPS_CHAR_WIDTH : CHAR_WIDTH) + (block.letterSpacing ?? 0);

const px = (value: number) => value.toFixed(1);

const opacityOf = (opacity?: number) => (opacity === undefined ? '' : ` opacity="${opacity}"`);

export const renderDecoration = (decoration: PageDecoration) => {
  const color = escapeXml(decoration.color);
  switch (decoration.kind) {
    case 'line': {
      return `<line x1="${px(decoration.x1)}" y1="${px(decoration.y1)}" x2="${px(decoration.x2)}" y2="${px(decoration.y2)}" stroke="${color}" stroke-width="${px(decoration.width)}"${opacityOf(decoration.opacity)}/>`;
    }
    case 'diamond': {
      const { x, y, size } = decoration;
      const half = size / 2;
      return `<path d="M${px(x)} ${px(y - half)}L${px(x + half)} ${px(y)}L${px(x)} ${px(y + half)}L${px(x - half)} ${px(y)}Z" fill="${color}"${opacityOf(decoration.opacity)}/>`;
    }
    case 'frame': {
      const { rect } = decoration;
      return `<rect x="${px(rect.left)}" y="${px(rect.top)}" width="${px(rect.width)}" height="${px(rect.height)}" fill="none" stroke="${color}" stroke-width="${px(decoration.width)}"${opacityOf(decoration.opacity)}/>`;
    }
  }
};

const renderTextBlock = (block: PageTextBlock, fontFamily: string) => {
  const padding = block.band ? block.fontPx * 0.5 : 0;
  const inner = {
    width: Math.max(1, block.rect.width - 2 * padding),
    height: Math.max(1, block.rect.height - 2 * padding),
  };
  const fitted = fitText(block.text, inner, block.fontPx, getCharWidth(block));
  const { fontPx } = fitted;
  const lines = block.balance ? balanceLines(block.text, fitted.lines, inner.width, fontPx, getCharWidth(block)) : fitted.lines;
  const lineHeight = fontPx * LINE_HEIGHT;
  const textHeight = lines.length * lineHeight;

  const anchor = block.align === 'left' ? 'start' : block.align === 'right' ? 'end' : 'middle';
  // letter spacing is added after every letter, the last one too
  const spacing = (block.letterSpacing ?? 0) * fontPx;
  const x =
    block.align === 'left'
      ? block.rect.left + padding
      : block.align === 'right'
        ? block.rect.left + block.rect.width - padding + spacing
        : block.rect.left + block.rect.width / 2 + spacing / 2;

  const parts: string[] = [];
  let top: number;
  if (block.valign === 'bottom') {
    const bandHeight = textHeight + 2 * padding;
    const bandTop = block.rect.top + block.rect.height - bandHeight;
    if (block.band) {
      parts.push(
        `<rect x="${block.rect.left}" y="${bandTop.toFixed(1)}" width="${block.rect.width}" height="${bandHeight.toFixed(1)}" fill="${escapeXml(block.bandColor ?? '#000000')}" fill-opacity="${block.bandOpacity ?? 0.45}"/>`,
      );
    }
    top = bandTop + padding;
  } else if (block.valign === 'top') {
    top = block.rect.top + padding;
  } else {
    top = block.rect.top + (block.rect.height - textHeight) / 2;
  }

  const tspans = lines.map((line, i) => {
    const baseline = top + i * lineHeight + (lineHeight - fontPx) / 2 + fontPx * 0.8;
    return `<tspan x="${x.toFixed(1)}" y="${baseline.toFixed(1)}">${escapeXml(line)}</tspan>`;
  });

  parts.push(
    `<text font-family="${escapeXml(getFontStack(fontFamily))}" font-size="${fontPx.toFixed(1)}" fill="${escapeXml(block.color)}" text-anchor="${anchor}"${block.bold ? ' font-weight="bold"' : ''}${block.italic ? ' font-style="italic"' : ''}${block.smallCaps ? ' font-variant="small-caps"' : ''}${block.letterSpacing ? ` letter-spacing="${(block.letterSpacing * fontPx).toFixed(2)}"` : ''}>${tspans.join('')}</text>`,
  );

  return parts.join('');
};

const renderPlaceholder = (rect: PxRect, label: string, fontFamily: string) => {
  const fontPx = Math.max(8, Math.min(rect.height * 0.12, rect.width * 0.09, 28));
  const stroke = Math.max(1, Math.round(fontPx / 10));
  return (
    `<rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" fill="#e9e9e9" stroke="#a0a0a0" stroke-width="${stroke}" stroke-dasharray="${stroke * 6},${stroke * 4}"/>` +
    renderTextBlock({ kind: 'caption', rect, text: label, fontPx, align: 'center', color: '#707070' }, fontFamily)
  );
};

const FOOD_CAPS = { smallCaps: true, letterSpacing: 0.12, balance: true } as const;

/** relative luminance of a hex color (#rgb, #rrggbb, alpha ignored), 0..1 */
export const getLuminance = (hex: string) => {
  const value = hex.replace('#', '');
  const full = value.length <= 4 ? [...value.slice(0, 3)].map((digit) => digit + digit).join('') : value.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((index) => {
    const channel = Number.parseInt(full.slice(index, index + 2), 16) / 255;
    return channel <= 0.039_28 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return Number.isFinite(r + g + b) ? 0.2126 * r + 0.7152 * g + 0.0722 * b : 0;
};

export const getContrast = (a: string, b: string) => {
  const [light, dark] = [getLuminance(a), getLuminance(b)].toSorted((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/** the color, or a light or a dark one when it is hard to read on the background (e.g. a page set on charcoal) */
export const getReadableColor = (
  color: string,
  background: string,
  minContrast = 3,
  light = '#f1e9dc',
  dark = '#2a2420',
) => {
  if (getContrast(color, background) >= minContrast) {
    return color;
  }
  return getContrast(light, background) >= getContrast(dark, background) ? light : dark;
};

type Align = LayoutTextArea['align'];

const alignedLeft = (rect: PxRect, width: number, align: Align) =>
  align === 'left' ? rect.left : align === 'right' ? rect.left + rect.width - width : rect.left + (rect.width - width) / 2;

/** a double hairline frame in the margins, like the border of a printed menu */
export const getMenuFrame = (
  page: { width: number; height: number },
  marginPx: number,
  dpi: number,
  color: string,
): PageDecoration[] => {
  if (marginPx < mmToPx(8, dpi)) {
    return [];
  }
  const inset = marginPx * 0.4;
  const inner = inset + mmToPx(1.2, dpi);
  const frame = (value: number): PxRect => ({
    left: value,
    top: value,
    width: page.width - 2 * value,
    height: page.height - 2 * value,
  });
  return [
    { kind: 'frame', rect: frame(inset), color, width: mmToPx(0.35, dpi), opacity: 0.55 },
    { kind: 'frame', rect: frame(inner), color, width: mmToPx(0.15, dpi), opacity: 0.45 },
  ];
};

/** a thin rule with a diamond in the middle, under a heading */
export const getOrnament = (rect: PxRect, y: number, align: Align, dpi: number, color: string): PageDecoration[] => {
  const width = Math.min(rect.width * 0.5, mmToPx(44, dpi));
  const size = mmToPx(2.2, dpi);
  const stroke = mmToPx(0.25, dpi);
  const left = alignedLeft(rect, width, align);
  const middle = left + width / 2;
  const gap = size * 1.1;
  return [
    { kind: 'line', x1: left, y1: y, x2: middle - gap, y2: y, color, width: stroke },
    { kind: 'diamond', x: middle, y, size, color },
    { kind: 'line', x1: middle + gap, y1: y, x2: left + width, y2: y, color, width: stroke },
  ];
};

/** the short rule above the name of a dish */
const getDishRule = (rect: PxRect, y: number, align: Align, dpi: number, color: string): PageDecoration => {
  const width = Math.min(rect.width * 0.3, mmToPx(10, dpi));
  const left = alignedLeft(rect, width, align);
  return { kind: 'line', x1: left, y1: y, x2: left + width, y2: y, color, width: mmToPx(0.3, dpi), opacity: 0.85 };
};

/** "Trattoria da Nino · Taormina, 23 June 2009" → ["Trattoria da Nino", "Taormina, 23 June 2009"] */
export const splitMenuHeading = (title: string): [string, string?] => {
  const index = title.indexOf(' · ');
  return index === -1 ? [title] : [title.slice(0, index), title.slice(index + 3)];
};

/** the heading of a food page: the name in spaced small caps, then (after an ornament) the rest in italics */
const getMenuHeading = (
  title: string,
  rect: PxRect,
  align: Align,
  titlePx: number,
  color: string,
  accent: string,
): PageTextBlock[] => {
  const [name, detail] = splitMenuHeading(title);
  const blocks: PageTextBlock[] = [
    {
      kind: 'sectionTitle',
      rect: { ...rect, height: rect.height * (detail ? 0.58 : 0.74) },
      text: name,
      fontPx: titlePx * 0.9,
      align,
      color,
      valign: 'bottom',
      ...FOOD_CAPS,
    },
  ];
  if (detail) {
    blocks.push({
      kind: 'subtitle',
      rect: { ...rect, top: rect.top + rect.height * 0.74, height: rect.height * 0.26 },
      text: detail,
      fontPx: titlePx * 0.46,
      align,
      color: accent,
      italic: true,
      balance: true,
      valign: 'top',
    });
  }
  return blocks;
};

const getMenuHeadingRuleY = (title: string, rect: PxRect) =>
  rect.top + rect.height * (splitMenuHeading(title)[1] ? 0.66 : 0.86);

export const ptToPx = (pt: number, dpi: number) => (pt * dpi) / 72;

/** Lays out one page: pixel rects for every slot, the sources to draw and the SVG text overlay */
export const planPage = (
  book: RenderBookInput,
  page: RenderPageInput,
  options: {
    dpi: number;
    mode: BookRenderMode;
    sources: Map<string, RenderSource>;
    quality?: number;
    /** the rendered map, drawn in the layout's map area (see `renderMapImage`) */
    mapImage?: Buffer | null;
  },
): PagePlan => {
  const { dpi, mode } = options;
  const style = resolveBookStyle(book.style);
  const size: PageSize = { pageWidthMm: book.pageWidthMm, pageHeightMm: book.pageHeightMm };
  const knownLayout = getLayout(page.layout);
  const layout = knownLayout ?? getLayout('single')!;

  const width = Math.round(mmToPx(size.pageWidthMm, dpi));
  const height = Math.round(mmToPx(size.pageHeightMm, dpi));

  const slots: PagePlanSlot[] = getSlotRectsMm(layout, size, style).map((rectMm, index) => {
    let placement = page.assets.find((asset) => asset.slot === index);
    if (!placement && layout.id === 'cover' && index === 0 && book.coverAssetId) {
      placement = { slot: 0, assetId: book.coverAssetId, crop: null, caption: null };
    }

    return {
      index,
      rect: toPxRect(rectMm, dpi),
      rectMm,
      assetId: placement?.assetId ?? null,
      crop: placement?.crop ?? FULL_CROP,
      hasCrop: !!placement?.crop,
      caption: placement?.caption ?? null,
      source: placement ? (options.sources.get(placement.assetId) ?? null) : null,
    };
  });

  const mapRectMm = getMapRectMm(layout, size, style);
  const map = mapRectMm ? { rect: toPxRect(mapRectMm, dpi), rectMm: mapRectMm } : null;

  const titlePx = ptToPx(style.titleSizePt, dpi);
  const captionPx = ptToPx(style.captionSizePt, dpi);
  const food = style.theme === 'food';
  const pageBackground = page.background ?? style.background;
  // a food page set on dark paper (e.g. charcoal) keeps its text readable
  const ink = food ? getReadableColor(style.textColor, pageBackground) : style.textColor;
  const accent = food
    ? getReadableColor(style.accentColor ?? style.textColor, pageBackground, 2.2, '#d4957c', '#8c3b2a')
    : style.textColor;
  const blocks: PageTextBlock[] = [];
  const decorations: PageDecoration[] = [];
  let hasCaptionArea = false;
  const captionedSlots = new Set<number>();

  if (food && !layout.fullBleed) {
    decorations.push(...getMenuFrame({ width, height }, mmToPx(style.marginMm, dpi), dpi, accent));
  }

  for (const area of getTextRectsMm(layout, size, style)) {
    const rect = toPxRect(area, dpi);
    const base = { rect, align: area.align, color: ink };
    switch (area.kind) {
      case 'title': {
        if (food) {
          const text = { ...rect, height: rect.height * 0.78 };
          blocks.push({ ...base, rect: text, kind: area.kind, text: book.title, fontPx: titlePx, ...FOOD_CAPS });
          decorations.push(...getOrnament(rect, rect.top + rect.height * 0.9, area.align, dpi, accent));
        } else {
          blocks.push({ ...base, kind: area.kind, text: book.title, fontPx: titlePx, bold: true });
        }
        break;
      }
      case 'subtitle': {
        if (book.subtitle) {
          blocks.push({
            ...base,
            kind: area.kind,
            text: book.subtitle,
            fontPx: titlePx * 0.55,
            italic: true,
            ...(food && { color: accent }),
          });
        }
        break;
      }
      case 'sectionTitle': {
        if (!page.sectionTitle) {
          break;
        }
        if (!food) {
          blocks.push({ ...base, kind: area.kind, text: page.sectionTitle, fontPx: titlePx * 0.9, bold: true });
          break;
        }
        blocks.push(...getMenuHeading(page.sectionTitle, rect, area.align, titlePx, ink, accent));
        decorations.push(...getOrnament(rect, getMenuHeadingRuleY(page.sectionTitle, rect), area.align, dpi, accent));
        break;
      }
      case 'caption': {
        hasCaptionArea = true;
        if (page.caption) {
          // text-only pages read like a story, so the caption is a little larger there
          blocks.push({
            ...base,
            kind: area.kind,
            text: page.caption,
            fontPx: (layout.slots.length === 0 ? captionPx * 1.3 : captionPx) * (food ? 1.1 : 1),
            // e.g. the dishes on a menu page follow its heading
            ...(food && { italic: true, balance: true, ...(layout.food && { valign: 'top' as const }) }),
          });
        }
        break;
      }
      case 'slotCaption': {
        const slot = area.slot === undefined ? undefined : slots[area.slot];
        if (!slot?.caption || !slot.assetId) {
          break;
        }
        captionedSlots.add(slot.index);
        const slotArea = layout.slots[slot.index];
        // below its photo, the caption starts right under it; beside it, it is centred on the photo
        const below = area.y >= slotArea.y + slotArea.height - 1e-6;
        const offset = below ? captionPx * (food ? 1.1 : 0.3) : 0;
        const block: PageTextBlock = {
          ...base,
          kind: 'slotCaption',
          rect: { ...rect, top: rect.top + offset, height: Math.max(1, rect.height - offset) },
          text: slot.caption,
          fontPx: food ? captionPx * 1.3 : captionPx,
          valign: below ? 'top' : 'middle',
          ...(food && { italic: true, balance: true }),
        };
        blocks.push(block);
        if (food) {
          // a short rule above the name of the dish
          const { lines, fontPx } = fitText(block.text, block.rect, block.fontPx, getCharWidth(block));
          const textHeight = lines.length * fontPx * LINE_HEIGHT;
          const textTop = below ? block.rect.top : block.rect.top + (block.rect.height - textHeight) / 2;
          decorations.push(getDishRule(rect, textTop - captionPx * 0.55, area.align, dpi, accent));
        }
        break;
      }
    }
  }

  if (page.caption && !hasCaptionArea) {
    const box = toPxRect(getLayoutBox(layout, size, style), dpi);
    const marginPx = mmToPx(style.marginMm, dpi);
    blocks.push(
      !layout.fullBleed && marginPx >= captionPx * 1.6
        ? {
            kind: 'caption',
            rect: {
              left: box.left,
              top: box.top + box.height,
              width: box.width,
              // above the frame of a food page
              height: height - box.top - box.height - (food ? marginPx * 0.5 : 0),
            },
            text: page.caption,
            fontPx: captionPx,
            align: 'center',
            color: ink,
            ...(food && { italic: true }),
          }
        : {
            kind: 'caption',
            rect: { ...box, top: box.top + box.height * 0.7, height: box.height * 0.3 },
            text: page.caption,
            fontPx: captionPx,
            align: 'center',
            band: true,
            valign: 'bottom',
            ...(food
              ? { color: ink, italic: true, bandColor: pageBackground, bandOpacity: 0.88 }
              : { color: '#ffffff' }),
          },
    );
  }

  for (const slot of slots) {
    if (slot.caption && slot.source && !captionedSlots.has(slot.index)) {
      blocks.push({
        kind: 'slotCaption',
        rect: { ...slot.rect, top: slot.rect.top + slot.rect.height * 0.6, height: slot.rect.height * 0.4 },
        text: slot.caption,
        fontPx: captionPx * 0.9,
        align: 'left',
        band: true,
        valign: 'bottom',
        // on food pages the caption is a paper label on the photo
        ...(food
          ? { color: ink, italic: true, bandColor: pageBackground, bandOpacity: 0.88 }
          : { color: '#ffffff' }),
      });
    }
  }

  const parts: string[] = [];
  if (mode !== 'print') {
    for (const slot of slots) {
      if (!slot.assetId) {
        parts.push(renderPlaceholder(slot.rect, `Slot ${slot.index + 1} (empty)`, style.fontFamily));
      } else if (!slot.source) {
        parts.push(renderPlaceholder(slot.rect, `Slot ${slot.index + 1}: missing photo`, style.fontFamily));
      }
    }
    if (map && !options.mapImage) {
      parts.unshift(renderPlaceholder(map.rect, 'Map', style.fontFamily));
    }
  }
  const text = blocks.filter((block) => block.text.trim());
  parts.push(...decorations.map((decoration) => renderDecoration(decoration)));
  parts.push(...text.map((block) => renderTextBlock(block, style.fontFamily)));

  const overlay =
    parts.length > 0
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
      : null;

  return {
    mode,
    dpi,
    layout,
    unknownLayout: !knownLayout,
    slots,
    text,
    decorations,
    map,
    spec: {
      width,
      height,
      background: page.background ?? style.background,
      quality: options.quality ?? (mode === 'print' ? 90 : 80),
      overlay,
      slots: [
        ...slots.map((slot) => (slot.source ? { ...slot.rect, input: slot.source.input, crop: slot.crop } : null)),
        // drawn after the photos, so its result comes after theirs
        ...(map && options.mapImage ? [{ ...map.rect, input: options.mapImage, crop: FULL_CROP }] : []),
      ],
    },
  };
};

/** Problems the agent (or user) should fix before printing */
export const getPageWarnings = (
  plan: PagePlan,
  result: BookPageComposeResult | null,
  pageNumber: number,
): BookRenderWarning[] => {
  const warnings: BookRenderWarning[] = [];
  const at = `Page ${pageNumber}`;

  if (plan.unknownLayout) {
    warnings.push({ page: pageNumber, type: 'unknown-layout', message: `${at} has an unknown layout` });
  }

  for (const slot of plan.slots) {
    const number = slot.index + 1;
    const where = `${at}, slot ${number}`;
    if (!slot.assetId) {
      warnings.push({ page: pageNumber, slot: number, type: 'empty-slot', message: `${where} is empty` });
      continue;
    }

    if (!slot.source) {
      warnings.push({
        page: pageNumber,
        slot: number,
        type: 'missing-asset',
        message: `${where}: photo ${slot.assetId} is missing, trashed or not accessible`,
      });
      continue;
    }

    const composed = result?.slots[slot.index];
    if (composed && 'error' in composed) {
      warnings.push({
        page: pageNumber,
        slot: number,
        type: 'render-error',
        message: `${where}: photo ${slot.assetId} could not be drawn (${composed.error})`,
      });
      continue;
    }

    if (slot.source.fallback) {
      warnings.push({
        page: pageNumber,
        slot: number,
        type: 'fallback-source',
        message: `${where}: ${slot.source.fallback}`,
      });
    }

    const { width, height } = slot.source;
    const measured = plan.mode === 'print' && composed && 'width' in composed ? composed : null;
    const cropPx =
      measured ?? (width && height ? { width: slot.crop.width * width, height: slot.crop.height * height } : null);
    if (cropPx) {
      const dpi = Math.round(getEffectiveDpi(cropPx, slot.rectMm));
      if (dpi < MIN_PRINT_DPI) {
        warnings.push({
          page: pageNumber,
          slot: number,
          type: 'low-dpi',
          dpi,
          message: `${where}: ${measured ? '' : 'estimated '}print resolution is ${dpi} dpi (minimum ${MIN_PRINT_DPI}); use a smaller slot, a looser crop or another photo`,
        });
      }
    }

    if (!slot.hasCrop || !width || !height) {
      continue;
    }

    const cropAspect = (slot.crop.width * width) / (slot.crop.height * height);
    const slotAspect = slot.rectMm.width / slot.rectMm.height;
    if (Math.abs(Math.log(cropAspect / slotAspect)) > Math.log(1.05)) {
      warnings.push({
        page: pageNumber,
        slot: number,
        type: 'crop-trimmed',
        message: `${where}: the crop's aspect ratio (${cropAspect.toFixed(2)}) differs from the slot's (${slotAspect.toFixed(2)}), so it is trimmed around its centre`,
      });
    }
  }

  return warnings;
};

export type ContactSheetPage = { number: number; image: Buffer };

/** Lays out rendered page thumbnails as two-page spreads (even pages on the left), labelled with page numbers */
export const planContactSheet = (
  pages: ContactSheetPage[],
  thumb: { width: number; height: number },
  options: { spreadsPerRow: number; fontFamily?: string },
): BookPageComposeSpec => {
  const gap = Math.round(Math.max(thumb.width, thumb.height) * 0.08) + 8;
  const labelHeight = Math.max(16, Math.round(thumb.height * 0.07));
  const spreadKeys = [...new Set(pages.map((page) => Math.floor(page.number / 2)))].sort((a, b) => a - b);
  const columns = Math.max(1, Math.min(options.spreadsPerRow, spreadKeys.length));
  const rows = Math.ceil(spreadKeys.length / columns);
  const spreadWidth = thumb.width * 2;

  const width = gap + columns * (spreadWidth + gap);
  const height = gap + rows * (thumb.height + labelHeight + gap);
  const fontFamily = options.fontFamily ?? 'sans-serif';

  const slots: BookPageComposeSlot[] = [];
  const parts: string[] = [];
  for (const page of pages) {
    const spread = spreadKeys.indexOf(Math.floor(page.number / 2));
    const left = gap + (spread % columns) * (spreadWidth + gap) + (page.number % 2 === 0 ? 0 : thumb.width);
    const top = gap + Math.floor(spread / columns) * (thumb.height + labelHeight + gap);
    slots.push({ left, top, width: thumb.width, height: thumb.height, input: page.image, crop: FULL_CROP });
    parts.push(
      renderTextBlock(
        {
          kind: 'caption',
          rect: { left, top: top + thumb.height, width: thumb.width, height: labelHeight },
          text: String(page.number),
          fontPx: labelHeight * 0.75,
          align: 'center',
          color: '#333333',
        },
        fontFamily,
      ),
    );
  }

  for (const index of spreadKeys.keys()) {
    const left = gap + (index % columns) * (spreadWidth + gap) + thumb.width;
    const top = gap + Math.floor(index / columns) * (thumb.height + labelHeight + gap);
    parts.push(
      `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + thumb.height}" stroke="#999999" stroke-width="1"/>`,
    );
  }

  return {
    width,
    height,
    background: '#d4d4d4',
    quality: 80,
    slots,
    overlay: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`,
  };
};

/** Chooses the number of spreads per row and the page thumbnail size so a contact sheet stays readable */
export const getContactSheetLayout = (size: PageSize, spreadCount: number) => {
  const spreadsPerRow = spreadCount <= 1 ? 1 : spreadCount <= 6 ? 2 : 3;
  const maxWidth = 1800;
  const maxHeight = 2400;
  const rows = Math.ceil(spreadCount / spreadsPerRow);
  const aspect = size.pageWidthMm / size.pageHeightMm;

  let thumbWidth = Math.min(480, Math.floor(maxWidth / (spreadsPerRow * 2.2)));
  const maxThumbHeight = Math.floor(maxHeight / (rows * 1.2));
  if (thumbWidth / aspect > maxThumbHeight) {
    thumbWidth = Math.floor(maxThumbHeight * aspect);
  }
  thumbWidth = Math.max(80, thumbWidth);

  return { spreadsPerRow, thumb: { width: thumbWidth, height: Math.round(thumbWidth / aspect) } };
};
