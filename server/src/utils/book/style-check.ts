import { BookStyle, bookStyleThemes, resolveBookStyle } from 'src/dtos/book.dto.js';
import { BOOK_FONT_STACKS } from 'src/utils/book/fonts.js';
import { PageSize, validatePageStyle } from 'src/utils/book/layouts.js';
import { getContrast } from 'src/utils/book/render.js';

/**
 * The font families a designed style can use, with what they look like. Every name comes from the stacks of
 * `BOOK_FONT_STACKS`, so it renders the same on the pages, in the PDF and in the HTML export; a font that isn't
 * installed falls back to the rest of its stack.
 */
export const BOOK_STYLE_FONTS: ReadonlyArray<{ fontFamily: string; look: string }> = [
  { fontFamily: 'serif', look: 'a Times-like book serif (Liberation Serif)' },
  { fontFamily: 'FreeSerif, serif', look: 'a classic, slightly lighter book serif; used by the food and wine styles' },
  { fontFamily: 'DejaVu Serif, serif', look: 'a sturdy, wide serif with a modern, slab-like feel' },
  { fontFamily: 'Noto Serif, serif', look: 'a clean contemporary serif' },
  { fontFamily: 'sans-serif', look: 'a neutral Arial-like sans-serif (Liberation Sans)' },
  { fontFamily: 'FreeSans, sans-serif', look: 'a Helvetica-like sans-serif, Swiss and graphic' },
  { fontFamily: 'DejaVu Sans, sans-serif', look: 'a wide, friendly, very legible sans-serif' },
  { fontFamily: 'Noto Sans, sans-serif', look: 'a light, contemporary sans-serif' },
  { fontFamily: 'monospace', look: 'a typewriter face (Liberation Mono), for a notebook or archive look' },
  { fontFamily: 'FreeMono, monospace', look: 'a thin Courier-like typewriter face, for a vintage look' },
  { fontFamily: 'DejaVu Sans Mono, monospace', look: 'a sturdy monospaced face, for a technical or retro look' },
  {
    fontFamily: 'Patrick Hand, Comic Neue, sans-serif',
    look: "a handwriting-like face where one is installed (else the sans-serif), for the labels of children's art",
  },
];

const ALLOWED_FONTS = new Map(
  Object.values(BOOK_FONT_STACKS)
    .flat()
    .map((name) => [name.toLowerCase(), name]),
);

/** limits of a designed style, stricter than the API schema: what still prints well */
export const BOOK_STYLE_LIMITS = {
  marginMm: { min: 3, max: 35 },
  gutterMm: { min: 0, max: 20 },
  titleSizePt: { min: 12, max: 72 },
  captionSizePt: { min: 6, max: 18 },
} as const;

/** the contrast (WCAG ratio) of text on the page: below `min` it can't be read, below `good` it reads poorly */
export const TEXT_CONTRAST = { min: 3, good: 4.5 } as const;
/** the accent is drawn as thin rules, ornaments and small labels */
export const ACCENT_CONTRAST = { min: 1.5, good: 2.5 } as const;

export type BookStyleCheck = {
  /** problems that make the style unusable (unreadable text, a font that does not exist, …) */
  errors: string[];
  /** things that work but may not print well */
  warnings: string[];
  /** the contrast ratios of the text and the accent on the background */
  contrast: { text: number; accent: number };
};

const DEFAULT_PAGE_SIZE: PageSize = Object.freeze({ pageWidthMm: 210, pageHeightMm: 210 });

const round2 = (value: number) => Math.round(value * 100) / 100;

const isOpaque = (color: string) => {
  const hex = color.replace('#', '');
  if (hex.length === 4) {
    return hex[3].toLowerCase() === 'f';
  }
  return hex.length !== 8 || hex.slice(6).toLowerCase() === 'ff';
};

/** the font names of a CSS font-family list, without quotes */
export const splitFontFamily = (fontFamily: string) =>
  fontFamily
    .split(',')
    .map((name) => name.trim().replaceAll(/^['"]+|['"]+$/g, ''))
    .filter(Boolean);

/**
 * Checks a designed book style strictly: fonts from the stacks that render, opaque colours, readable text on the
 * background, sizes and margins that print well, a known theme, and margins that fit the page.
 */
export const checkBookStyle = (input: Partial<BookStyle>, size: PageSize = DEFAULT_PAGE_SIZE): BookStyleCheck => {
  const style = resolveBookStyle(input);
  const errors: string[] = [];
  const warnings: string[] = [];

  const names = splitFontFamily(style.fontFamily);
  const unknown = names.filter((name) => !ALLOWED_FONTS.has(name.toLowerCase()));
  if (names.length === 0 || unknown.length > 0) {
    errors.push(
      `Font ${unknown.map((name) => `"${name}"`).join(', ') || '(none)'} is not available for books; use one of: ` +
        BOOK_STYLE_FONTS.map(({ fontFamily }) => `"${fontFamily}"`).join(', '),
    );
  }

  for (const key of ['background', 'textColor', 'accentColor'] as const) {
    if (!isOpaque(style[key])) {
      errors.push(`${key} must be an opaque colour (#rrggbb), not ${style[key]}`);
    }
  }

  const text = getContrast(style.textColor, style.background);
  if (text < TEXT_CONTRAST.min) {
    errors.push(
      `The text (${style.textColor}) can't be read on the background (${style.background}): contrast ${round2(text)}:1, ` +
        `it needs at least ${TEXT_CONTRAST.min}:1 (${TEXT_CONTRAST.good}:1 or more is better). Darken the text or ` +
        'lighten the background (or the other way round)',
    );
  } else if (text < TEXT_CONTRAST.good) {
    warnings.push(
      `The text (${style.textColor}) is hard to read in small captions on ${style.background}: contrast ` +
        `${round2(text)}:1, ${TEXT_CONTRAST.good}:1 or more reads well`,
    );
  }

  const accent = getContrast(style.accentColor, style.background);
  if (accent < ACCENT_CONTRAST.min) {
    errors.push(
      `The accent (${style.accentColor}) is invisible on the background (${style.background}): contrast ` +
        `${round2(accent)}:1, it needs at least ${ACCENT_CONTRAST.min}:1`,
    );
  } else if (accent < ACCENT_CONTRAST.good) {
    warnings.push(
      `The accent (${style.accentColor}) is faint on ${style.background} (contrast ${round2(accent)}:1): thin rules and ` +
        'ornaments may disappear in print',
    );
  }

  for (const key of Object.keys(BOOK_STYLE_LIMITS) as Array<keyof typeof BOOK_STYLE_LIMITS>) {
    const { min, max } = BOOK_STYLE_LIMITS[key];
    const value = style[key];
    if (!Number.isFinite(value) || value < min || value > max) {
      errors.push(`${key} must be between ${min} and ${max}, not ${value}`);
    }
  }
  if (style.captionSizePt >= style.titleSizePt) {
    errors.push(`The captions (${style.captionSizePt}pt) must be smaller than the titles (${style.titleSizePt}pt)`);
  }
  if (style.captionSizePt < 7.5) {
    warnings.push(`Captions of ${style.captionSizePt}pt are small in print; 8pt or more reads comfortably`);
  }
  if (style.gutterMm > style.marginMm * 1.5 && style.gutterMm > 8) {
    warnings.push(
      `The gutters (${style.gutterMm}mm) are much wider than the margins (${style.marginMm}mm): the photos float ` +
        'apart and crowd the edges',
    );
  }

  if (!bookStyleThemes.includes(style.theme)) {
    errors.push(`Unknown theme "${style.theme}"; use one of: ${bookStyleThemes.join(', ')}`);
  }

  const pageError = validatePageStyle(size, style);
  if (pageError) {
    errors.push(pageError);
  }

  return { errors, warnings, contrast: { text: round2(text), accent: round2(accent) } };
};
