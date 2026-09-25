import { BookStyle, NormalizedRect, resolveBookStyle } from 'src/dtos/book.dto.js';
import {
  BookLayout,
  LayoutRect,
  LayoutTextArea,
  PageSize,
  PxRect,
  getLayout,
  getLayoutBox,
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
  'empty-slot' | 'missing-asset' | 'low-dpi' | 'fallback-source' | 'crop-trimmed' | 'render-error' | 'unknown-layout';

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

/**
 * The crop used when a photo is placed without one: the largest centred rect with the slot's aspect ratio,
 * moved so the faces' bounding box stays centred when there are faces.
 * TODO: replace with `suggestCrop` from src/utils/agent/crop.ts once it is merged.
 */
export const getDefaultCrop = (
  image: { width: number; height: number },
  faces: NormalizedRect[],
  slotAspect: number,
): NormalizedRect => {
  if (!image.width || !image.height || !(slotAspect > 0)) {
    return { ...FULL_CROP };
  }

  const imageAspect = image.width / image.height;
  const width = imageAspect > slotAspect ? slotAspect / imageAspect : 1;
  const height = imageAspect > slotAspect ? 1 : imageAspect / slotAspect;

  let centerX = 0.5;
  let centerY = 0.5;
  if (faces.length > 0) {
    const x1 = Math.min(...faces.map((face) => face.x));
    const y1 = Math.min(...faces.map((face) => face.y));
    const x2 = Math.max(...faces.map((face) => face.x + face.width));
    const y2 = Math.max(...faces.map((face) => face.y + face.height));
    centerX = (x1 + x2) / 2;
    centerY = (y1 + y2) / 2;
  }

  const x = round4(clamp(centerX - width / 2, 0, 1 - width));
  const y = round4(clamp(centerY - height / 2, 0, 1 - height));
  return { x, y, width: Math.min(round4(width), 1 - x), height: Math.min(round4(height), 1 - y) };
};

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

const CHAR_WIDTH = 0.52;
const LINE_HEIGHT = 1.25;

/** Greedy word wrap based on an average character width */
export const wrapText = (text: string, maxWidthPx: number, fontPx: number): string[] => {
  const maxChars = Math.max(1, Math.floor(maxWidthPx / (fontPx * CHAR_WIDTH)));
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
export const fitText = (text: string, box: { width: number; height: number }, fontPx: number) => {
  const minPx = fontPx * 0.6;
  for (let size = fontPx; size >= minPx; size *= 0.9) {
    const lines = wrapText(text, box.width, size);
    if (lines.length * size * LINE_HEIGHT <= box.height) {
      return { lines, fontPx: size };
    }
  }

  const size = Math.min(minPx, box.height / LINE_HEIGHT);
  const maxLines = Math.max(1, Math.floor(box.height / (size * LINE_HEIGHT)));
  const lines = wrapText(text, box.width, size);
  if (lines.length <= maxLines) {
    return { lines, fontPx: size };
  }

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/.$/, '')}…`;
  return { lines: kept, fontPx: size };
};

type TextBlock = {
  rect: PxRect;
  text: string;
  fontPx: number;
  align: LayoutTextArea['align'];
  color: string;
  bold?: boolean;
  italic?: boolean;
  /** draws a translucent band behind the text, for captions over photos */
  band?: boolean;
  valign?: 'middle' | 'bottom';
};

const renderTextBlock = (block: TextBlock, fontFamily: string) => {
  const padding = block.band ? block.fontPx * 0.5 : 0;
  const inner = {
    width: Math.max(1, block.rect.width - 2 * padding),
    height: Math.max(1, block.rect.height - 2 * padding),
  };
  const { lines, fontPx } = fitText(block.text, inner, block.fontPx);
  const lineHeight = fontPx * LINE_HEIGHT;
  const textHeight = lines.length * lineHeight;

  const anchor = block.align === 'left' ? 'start' : block.align === 'right' ? 'end' : 'middle';
  const x =
    block.align === 'left'
      ? block.rect.left + padding
      : block.align === 'right'
        ? block.rect.left + block.rect.width - padding
        : block.rect.left + block.rect.width / 2;

  const parts: string[] = [];
  let top: number;
  if (block.valign === 'bottom') {
    const bandHeight = textHeight + 2 * padding;
    const bandTop = block.rect.top + block.rect.height - bandHeight;
    if (block.band) {
      parts.push(
        `<rect x="${block.rect.left}" y="${bandTop.toFixed(1)}" width="${block.rect.width}" height="${bandHeight.toFixed(1)}" fill="#000000" fill-opacity="0.45"/>`,
      );
    }
    top = bandTop + padding;
  } else {
    top = block.rect.top + (block.rect.height - textHeight) / 2;
  }

  const tspans = lines.map((line, i) => {
    const baseline = top + i * lineHeight + (lineHeight - fontPx) / 2 + fontPx * 0.8;
    return `<tspan x="${x.toFixed(1)}" y="${baseline.toFixed(1)}">${escapeXml(line)}</tspan>`;
  });

  parts.push(
    `<text font-family="${escapeXml(fontFamily)}" font-size="${fontPx.toFixed(1)}" fill="${escapeXml(block.color)}" text-anchor="${anchor}"${block.bold ? ' font-weight="bold"' : ''}${block.italic ? ' font-style="italic"' : ''}>${tspans.join('')}</text>`,
  );

  return parts.join('');
};

const renderPlaceholder = (rect: PxRect, label: string, fontFamily: string) => {
  const fontPx = Math.max(8, Math.min(rect.height * 0.12, rect.width * 0.09, 28));
  const stroke = Math.max(1, Math.round(fontPx / 10));
  return (
    `<rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" fill="#e9e9e9" stroke="#a0a0a0" stroke-width="${stroke}" stroke-dasharray="${stroke * 6},${stroke * 4}"/>` +
    renderTextBlock({ rect, text: label, fontPx, align: 'center', color: '#707070' }, fontFamily)
  );
};

export const ptToPx = (pt: number, dpi: number) => (pt * dpi) / 72;

/** Lays out one page: pixel rects for every slot, the sources to draw and the SVG text overlay */
export const planPage = (
  book: RenderBookInput,
  page: RenderPageInput,
  options: { dpi: number; mode: BookRenderMode; sources: Map<string, RenderSource>; quality?: number },
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

  const titlePx = ptToPx(style.titleSizePt, dpi);
  const captionPx = ptToPx(style.captionSizePt, dpi);
  const blocks: TextBlock[] = [];
  let hasCaptionArea = false;

  for (const area of getTextRectsMm(layout, size, style)) {
    const rect = toPxRect(area, dpi);
    const base = { rect, align: area.align, color: style.textColor };
    switch (area.kind) {
      case 'title': {
        blocks.push({ ...base, text: book.title, fontPx: titlePx, bold: true });
        break;
      }
      case 'subtitle': {
        if (book.subtitle) {
          blocks.push({ ...base, text: book.subtitle, fontPx: titlePx * 0.55, italic: true });
        }
        break;
      }
      case 'sectionTitle': {
        if (page.sectionTitle) {
          blocks.push({ ...base, text: page.sectionTitle, fontPx: titlePx * 0.9, bold: true });
        }
        break;
      }
      case 'caption': {
        hasCaptionArea = true;
        if (page.caption) {
          // text-only pages read like a story, so the caption is a little larger there
          blocks.push({ ...base, text: page.caption, fontPx: layout.slots.length === 0 ? captionPx * 1.3 : captionPx });
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
            rect: {
              left: box.left,
              top: box.top + box.height,
              width: box.width,
              height: height - box.top - box.height,
            },
            text: page.caption,
            fontPx: captionPx,
            align: 'center',
            color: style.textColor,
          }
        : {
            rect: { ...box, top: box.top + box.height * 0.7, height: box.height * 0.3 },
            text: page.caption,
            fontPx: captionPx,
            align: 'center',
            color: '#ffffff',
            band: true,
            valign: 'bottom',
          },
    );
  }

  for (const slot of slots) {
    if (slot.caption && slot.source) {
      blocks.push({
        rect: { ...slot.rect, top: slot.rect.top + slot.rect.height * 0.6, height: slot.rect.height * 0.4 },
        text: slot.caption,
        fontPx: captionPx * 0.9,
        align: 'left',
        color: '#ffffff',
        band: true,
        valign: 'bottom',
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
  }
  parts.push(...blocks.filter((block) => block.text.trim()).map((block) => renderTextBlock(block, style.fontFamily)));

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
    spec: {
      width,
      height,
      background: page.background ?? style.background,
      quality: options.quality ?? (mode === 'print' ? 90 : 80),
      overlay,
      slots: slots.map((slot) => (slot.source ? { ...slot.rect, input: slot.source.input, crop: slot.crop } : null)),
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
