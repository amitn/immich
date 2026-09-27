import sharp from 'sharp';
import type { BookStyle } from 'src/dtos/book.dto.js';
import { isGalleryTheme, isPrintedTheme } from 'src/utils/book/collections.js';
import { getFontStack } from 'src/utils/book/fonts.js';
import {
  CHAR_WIDTH,
  LINE_HEIGHT,
  PageDecoration,
  balanceLines,
  escapeXml,
  fitText,
  getMenuFrame,
  getOrnament,
  getReadableColor,
  renderDecoration,
} from 'src/utils/book/render.js';
import { HIGHLIGHT_HEIGHT, HIGHLIGHT_WIDTH, getSafeArea } from 'src/utils/highlight/plan.js';

/**
 * The title cards and lower thirds of a highlight video, drawn like the pages of a photo book in the same style: the
 * colors and fonts of the style, the small caps, hairline frame and ornament of a printed theme (a menu, a travel
 * journal, a tasting notebook), the left-aligned labels of the gallery theme (an exhibition catalogue).
 *
 * In a vertical frame, the text is larger (it is watched on a phone) and stays in its safe band, clear of the top and
 * bottom of the frame where the phone apps draw their buttons and captions (see `getSafeArea`).
 */

export type HighlightCardText = { title: string; subtitle?: string; detail?: string };

type CardLook = 'plain' | 'printed' | 'gallery';

/** the pixels per inch the millimetre sizes of the book decorations are drawn at, so that they suit a 1080p frame */
const CARD_DPI = 144;
const SMALL_CAPS_WIDTH = 0.6;
const FRAME_SIZE = { width: HIGHLIGHT_WIDTH, height: HIGHLIGHT_HEIGHT };

const getLook = (style: Required<BookStyle>): CardLook =>
  isGalleryTheme(style.theme) ? 'gallery' : isPrintedTheme(style.theme) ? 'printed' : 'plain';

const px = (value: number) => value.toFixed(1);

type TextLine = {
  text: string;
  x: number;
  y: number;
  fontPx: number;
  color: string;
  anchor: 'start' | 'middle';
  smallCaps?: boolean;
  italic?: boolean;
  bold?: boolean;
  letterSpacing?: number;
  opacity?: number;
};

const renderLine = (line: TextLine, fontFamily: string) =>
  `<text x="${px(line.x)}" y="${px(line.y)}" font-family="${escapeXml(fontFamily)}" font-size="${px(line.fontPx)}" fill="${escapeXml(line.color)}" text-anchor="${line.anchor}"` +
  `${line.smallCaps ? ' font-variant="small-caps"' : ''}${line.italic ? ' font-style="italic"' : ''}${line.bold ? ' font-weight="bold"' : ''}` +
  `${line.letterSpacing ? ` letter-spacing="${px(line.letterSpacing * line.fontPx)}"` : ''}${line.opacity === undefined ? '' : ` opacity="${line.opacity}"`}>${escapeXml(line.text)}</text>`;

const svg = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;

/** a block of wrapped lines, returned with the height it takes */
const wrapBlock = (
  text: string,
  box: { width: number; height: number },
  fontPx: number,
  charWidth: number,
): { lines: string[]; fontPx: number; height: number } => {
  const fitted = fitText(text, box, fontPx, charWidth);
  // lines of about the same length, not a word left alone on the last one
  const lines = balanceLines(text, fitted.lines, box.width, fitted.fontPx, charWidth);
  return { lines, fontPx: fitted.fontPx, height: lines.length * fitted.fontPx * LINE_HEIGHT };
};

/**
 * A full-frame title card: the title of the film (`size` title) or of a chapter (`size` chapter), its dates and places,
 * in the colors, fonts and ornaments of the style
 */
export const getCardSvg = (
  text: HighlightCardText,
  style: Required<BookStyle>,
  kind: 'title' | 'chapter',
  size: { width: number; height: number } = FRAME_SIZE,
) => {
  const { width, height } = size;
  const look = getLook(style);
  const fontFamily = getFontStack(style.fontFamily);
  const ink = getReadableColor(style.textColor, style.background, 4.5);
  const accent = getReadableColor(style.accentColor, style.background, 2.5);
  const portrait = height > width;
  // the text is laid out in the band of the frame that phone apps leave free (all of a landscape frame)
  const safe = getSafeArea(size);
  const bandTop = safe.top * height;
  const band = height * (1 - safe.top - safe.bottom);
  const u = (portrait ? width : height) / 1080;
  const titlePx = (kind === 'title' ? (portrait ? 124 : 112) : portrait ? 100 : 84) * u;
  const subtitlePx = (kind === 'title' ? (portrait ? 52 : 40) : portrait ? 46 : 36) * u;
  const detailPx = (portrait ? 40 : 30) * u;
  const smallCaps = look === 'printed';
  const titleWidth = smallCaps ? SMALL_CAPS_WIDTH + 0.12 : CHAR_WIDTH;

  const parts: string[] = [`<rect width="${width}" height="${height}" fill="${escapeXml(style.background)}"/>`];
  const decorations: PageDecoration[] = [];
  const lines: TextLine[] = [];

  if (look === 'gallery') {
    // an exhibition wall: the title left-aligned under a thin rule, then the dates and places in grey
    const left = (portrait ? 96 : 200) * u;
    const box = { width: width - 2 * left, height: band * 0.4 };
    const title = wrapBlock(text.title, box, titlePx, CHAR_WIDTH);
    const blockHeight = title.height + (text.subtitle ? subtitlePx * 1.8 : 0) + (text.detail ? detailPx * 1.6 : 0);
    let y = bandTop + (band - blockHeight) / 2;
    decorations.push({
      kind: 'line',
      x1: left,
      y1: y - 36 * u,
      x2: left + 96 * u,
      y2: y - 36 * u,
      color: accent,
      width: 3 * u,
    });
    for (const line of title.lines) {
      y += title.fontPx * LINE_HEIGHT;
      lines.push({ text: line, x: left, y: y - title.fontPx * 0.3, fontPx: title.fontPx, color: ink, anchor: 'start' });
    }
    if (text.subtitle) {
      y += subtitlePx * 1.8;
      lines.push({ text: text.subtitle, x: left, y, fontPx: subtitlePx, color: ink, anchor: 'start', opacity: 0.7 });
    }
    if (text.detail) {
      y += detailPx * 1.6;
      lines.push({ text: text.detail, x: left, y, fontPx: detailPx, color: accent, anchor: 'start', italic: true });
    }
  } else {
    // centred: the title, a rule (an ornament in a printed theme), the dates and the places
    const box = { width: width * (portrait ? 0.84 : 0.78), height: band * (portrait ? 0.5 : 0.42) };
    const title = wrapBlock(text.title, box, titlePx, titleWidth);
    const ruleGap = 44 * u;
    const blockHeight =
      title.height + ruleGap * 2 + (text.subtitle ? subtitlePx * 1.4 : 0) + (text.detail ? detailPx * 1.6 : 0);
    let y = bandTop + (band - blockHeight) / 2;
    for (const line of title.lines) {
      y += title.fontPx * LINE_HEIGHT;
      lines.push({
        text: line,
        x: width / 2,
        y: y - title.fontPx * 0.3,
        fontPx: title.fontPx,
        color: ink,
        anchor: 'middle',
        smallCaps,
        ...(smallCaps && { letterSpacing: 0.12 }),
      });
    }
    y += ruleGap;
    if (smallCaps) {
      decorations.push(
        ...getOrnament({ left: 0, top: 0, width, height }, y, 'center', CARD_DPI, accent),
        ...getMenuFrame({ width, height }, 90 * u, CARD_DPI, accent),
      );
    } else {
      const half = 60 * u;
      decorations.push({
        kind: 'line',
        x1: width / 2 - half,
        y1: y,
        x2: width / 2 + half,
        y2: y,
        color: accent,
        width: 3 * u,
      });
    }
    y += ruleGap;
    if (text.subtitle) {
      y += subtitlePx * 1.1;
      lines.push({
        text: text.subtitle,
        x: width / 2,
        y,
        fontPx: subtitlePx,
        color: ink,
        anchor: 'middle',
        opacity: 0.75,
      });
    }
    if (text.detail) {
      y += detailPx * 1.6;
      lines.push({
        text: text.detail,
        x: width / 2,
        y,
        fontPx: detailPx,
        color: accent,
        anchor: 'middle',
        smallCaps: true,
        letterSpacing: 0.1,
      });
    }
  }

  parts.push(
    ...decorations.map((decoration) => renderDecoration(decoration)),
    ...lines.map((line) => renderLine(line, fontFamily)),
  );
  return svg(width, height, parts.join(''));
};

/**
 * A lower third over a photo: a label in the paper color of the style at the bottom left, with the caption in its ink:
 * the first line (the name of the dish, the title of the artwork) larger, in small caps in a printed theme and in
 * italics in the gallery theme, the others (the artist and date) smaller. Transparent elsewhere. In a vertical frame
 * it is larger, and sits just above the bottom of the safe band, clear of the buttons on the right.
 */
export const getLowerThirdSvg = (
  caption: string,
  style: Required<BookStyle>,
  size: { width: number; height: number } = FRAME_SIZE,
) => {
  const { width, height } = size;
  const look = getLook(style);
  const fontFamily = getFontStack(style.fontFamily);
  const ink = getReadableColor(style.textColor, style.background, 4.5);
  const accent = getReadableColor(style.accentColor, style.background, 2.5);
  const portrait = height > width;
  const safe = getSafeArea(size);
  const u = (portrait ? width : height) / 1080;
  const [first, ...rest] = caption
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!first) {
    return svg(width, height, '');
  }

  const maxWidth = width * (portrait ? 0.74 : 0.5);
  const firstPx = (portrait ? 56 : 46) * u;
  const restPx = (portrait ? 38 : 30) * u;
  const smallCaps = look === 'printed';
  const firstWidth = smallCaps ? SMALL_CAPS_WIDTH + 0.08 : CHAR_WIDTH;
  const title = wrapBlock(first, { width: maxWidth, height: firstPx * LINE_HEIGHT * 2 }, firstPx, firstWidth);
  const details =
    rest.length > 0
      ? wrapBlock(rest.join(' · '), { width: maxWidth, height: restPx * LINE_HEIGHT * 2 }, restPx, CHAR_WIDTH)
      : undefined;

  const longest = Math.max(
    ...title.lines.map((line) => line.length * title.fontPx * firstWidth),
    ...(details?.lines ?? []).map((line) => line.length * details!.fontPx * CHAR_WIDTH),
  );
  const padX = 34 * u;
  const padY = 24 * u;
  const bar = look === 'gallery' ? 0 : 8 * u;
  const left = (portrait ? 64 : 96) * u;
  const boxWidth = Math.min(width - 2 * left, longest + 2 * padX + bar);
  const boxHeight = title.height + (details ? details.height + 8 * u : 0) + 2 * padY;
  const bottom = portrait ? height * (1 - safe.bottom) - 24 * u : height - 96 * u;
  const top = bottom - boxHeight;

  const parts = [
    `<rect x="${px(left)}" y="${px(top)}" width="${px(boxWidth)}" height="${px(boxHeight)}" fill="${escapeXml(style.background)}" fill-opacity="0.92"${look === 'gallery' ? '' : ` rx="${px(4 * u)}"`}/>`,
  ];
  if (bar > 0) {
    parts.push(
      `<rect x="${px(left)}" y="${px(top)}" width="${px(bar)}" height="${px(boxHeight)}" fill="${escapeXml(accent)}"/>`,
    );
  }
  let y = top + padY;
  const x = left + bar + padX;
  for (const line of title.lines) {
    y += title.fontPx * LINE_HEIGHT;
    parts.push(
      renderLine(
        {
          text: line,
          x,
          y: y - title.fontPx * 0.28,
          fontPx: title.fontPx,
          color: ink,
          anchor: 'start',
          smallCaps,
          italic: look === 'gallery',
          ...(smallCaps && { letterSpacing: 0.08 }),
        },
        fontFamily,
      ),
    );
  }
  if (details) {
    y += 8 * u;
    for (const line of details.lines) {
      y += details.fontPx * LINE_HEIGHT;
      parts.push(
        renderLine(
          {
            text: line,
            x,
            y: y - details.fontPx * 0.28,
            fontPx: details.fontPx,
            color: ink,
            anchor: 'start',
            opacity: 0.8,
          },
          fontFamily,
        ),
      );
    }
  }
  return svg(width, height, parts.join(''));
};

/** a title card as an opaque JPEG frame */
export const renderCard = (cardSvg: string) =>
  sharp(Buffer.from(cardSvg))
    .flatten({ background: '#000000' })
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();

/** a lower third as a transparent PNG frame */
export const renderOverlay = (overlaySvg: string) => sharp(Buffer.from(overlaySvg)).png().toBuffer();
