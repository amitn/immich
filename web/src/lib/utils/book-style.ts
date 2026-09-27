import {
  BookStylePreset,
  BookStyleTheme,
  getBookStylePresets,
  getBookUserStyles,
  type BookStyle,
  type BookStylePresetResponseDto,
  type BookUserStyleResponseDto,
} from '@immich/sdk';
import type { Translations } from 'svelte-i18n';
import { collectionPacks } from '$lib/collections/registry';

/** the presets in the order of the picker: the built-in ones, then the preset of each collection pack (e.g. food) */
export const BOOK_STYLE_PRESETS: readonly BookStylePreset[] = [
  BookStylePreset.Soft,
  BookStylePreset.Classic,
  BookStylePreset.Bold,
  ...collectionPacks.map((pack) => pack.bookStylePreset),
];

export const DEFAULT_BOOK_STYLE_PRESET = BookStylePreset.Soft;

type PresetLabels = { name: Translations; description: Translations };

/** the labels of the built-in presets, then of the preset of each collection pack */
export const BOOK_STYLE_PRESET_LABEL_KEYS = {
  [BookStylePreset.Soft]: { name: 'book_style_preset_soft', description: 'book_style_preset_soft_description' },
  [BookStylePreset.Classic]: {
    name: 'book_style_preset_classic',
    description: 'book_style_preset_classic_description',
  },
  [BookStylePreset.Bold]: { name: 'book_style_preset_bold', description: 'book_style_preset_bold_description' },
  ...Object.fromEntries(collectionPacks.map((pack) => [pack.bookStylePreset, pack.bookStyleLabels])),
} as Record<BookStylePreset, PresetLabels>;

let presets: Promise<BookStylePresetResponseDto[]> | undefined;

const presetOrder = (preset: BookStylePresetResponseDto) => {
  const index = BOOK_STYLE_PRESETS.indexOf(preset.id);
  return index === -1 ? BOOK_STYLE_PRESETS.length : index;
};

/**
 * The presets in the order of the picker. They rarely change, so they are fetched once; a failed request is retried
 * next time
 */
export const loadBookStylePresets = () => {
  presets ??= getBookStylePresets()
    .then((result) => [...(result ?? [])].sort((a, b) => presetOrder(a) - presetOrder(b)))
    .catch((error: unknown) => {
      presets = undefined;
      throw error;
    });
  return presets;
};

/** for tests */
export const resetBookStylePresets = () => {
  presets = undefined;
};

/**
 * The styles of the user's own (e.g. designed with the assistant), oldest first like the presets. They change (the
 * assistant saves new ones), so they are fetched every time
 */
export const loadBookUserStyles = async (): Promise<BookUserStyleResponseDto[]> => {
  const result = await getBookUserStyles();
  return [...(result ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
};

/** a preset id, or the id of one of the user's own styles */
export type BookStyleChoice = BookStylePreset | string;

export const isBookStylePreset = (choice: BookStyleChoice): choice is BookStylePreset =>
  (Object.values(BookStylePreset) as string[]).includes(choice);

const STYLE_KEYS = [
  'background',
  'textColor',
  'fontFamily',
  'marginMm',
  'gutterMm',
  'titleSizePt',
  'captionSizePt',
  'theme',
  'accentColor',
] as const satisfies ReadonlyArray<keyof BookStyle>;

type StyleKey = (typeof STYLE_KEYS)[number];

/** the defaults of the server (`defaultBookStyle`) for the sizes older styles don't have */
const DEFAULT_TITLE_SIZE_PT = 28;
const DEFAULT_CAPTION_SIZE_PT = 10;

/**
 * The first font of each of the server's font stacks (`BOOK_FONT_STACKS` in `server/src/utils/book/fonts.ts`): a font
 * family expanded to its stack starts with it, so it stands for the generic family it was expanded from
 */
const FONT_STACK_HEADS: Record<string, string> = {
  'liberation serif': 'serif',
  'liberation sans': 'sans-serif',
  'liberation mono': 'monospace',
};

/** e.g. "#F6F1E7" and "#f6f1e7ff" → "#f6f1e7", "#abc" → "#aabbcc" */
const normalizeColor = (color: string) => {
  let hex = color.trim().toLowerCase();
  if (/^#[\da-f]{3,4}$/.test(hex)) {
    hex = `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}`;
  }
  return hex.length === 9 && hex.endsWith('ff') ? hex.slice(0, 7) : hex;
};

/**
 * The first family of a font-family list, the font the pages are drawn with, e.g. "FreeSerif, serif" → "freeserif". A
 * list expanded to the server's stack of a generic family ("'Liberation Serif', 'Times New Roman', …, serif") is that
 * generic family, and an empty one the default serif
 */
export const normalizeFontFamily = (fontFamily: string | undefined) => {
  const [first = ''] = (fontFamily ?? '').split(',', 1);
  const name = first
    .trim()
    .replaceAll(/^['"]+|['"]+$/g, '')
    .trim()
    .toLowerCase();
  return FONT_STACK_HEADS[name] ?? (name || 'serif');
};

/** sizes and distances to a hundredth, so that e.g. 10.5 and 10.500000001 are the same */
const normalizeNumber = (value: number) => Math.round(value * 100) / 100;

/** The value of a style option, normalized, with the defaults of the server for the options older styles don't have */
const valueOf = (style: BookStyle, key: StyleKey): string | number => {
  switch (key) {
    case 'theme': {
      return style.theme ?? BookStyleTheme.Plain;
    }
    case 'accentColor': {
      return normalizeColor(style.accentColor ?? style.textColor);
    }
    case 'background':
    case 'textColor': {
      return normalizeColor(style[key]);
    }
    case 'fontFamily': {
      return normalizeFontFamily(style.fontFamily);
    }
    case 'titleSizePt': {
      return normalizeNumber(style.titleSizePt ?? DEFAULT_TITLE_SIZE_PT);
    }
    case 'captionSizePt': {
      return normalizeNumber(style.captionSizePt ?? DEFAULT_CAPTION_SIZE_PT);
    }
    default: {
      return normalizeNumber(style[key]);
    }
  }
};

/** Whether two styles draw the same pages: their values are equal once normalized (see `valueOf`) */
export const isSameBookStyle = (a: BookStyle, b: BookStyle) =>
  STYLE_KEYS.every((key) => valueOf(a, key) === valueOf(b, key));

/** The style's theme, e.g. food for the printed-menu look of the food preset */
export const getBookStyleTheme = (style?: BookStyle) => (style ? (style.theme ?? BookStyleTheme.Plain) : undefined);

/** The color of the rules and ornaments of the food theme */
export const getBookStyleAccent = (style?: BookStyle) => (style ? (style.accentColor ?? style.textColor) : undefined);

/**
 * The preset the style is equal to, or undefined for a custom style. The values are compared normalized (see
 * `isSameBookStyle`), so a book keeps its preset when the server changes how it writes it, e.g. expands its fonts
 */
export const findBookStylePreset = (
  style: BookStyle,
  available: BookStylePresetResponseDto[],
): BookStylePresetResponseDto | undefined => available.find((preset) => isSameBookStyle(style, preset.style));

/** The user's own style the book's style is equal to (the book has a copy of it) */
export const findBookUserStyle = (
  style: BookStyle,
  available: BookUserStyleResponseDto[],
): BookUserStyleResponseDto | undefined => available.find((item) => isSameBookStyle(style, item.style));

/** how the renderer draws a theme: plain pages, a printed menu (rules, ornaments, small caps) or a gallery catalogue */
export type BookStyleLook = 'plain' | 'printed' | 'gallery' | 'mounted';

export const getBookStyleLook = (style?: BookStyle): BookStyleLook => {
  switch (getBookStyleTheme(style) ?? BookStyleTheme.Plain) {
    case BookStyleTheme.Plain: {
      return 'plain';
    }
    case BookStyleTheme.Gallery: {
      return 'gallery';
    }
    // the artworks of kids' art on paper mats, taped to the page
    case BookStyleTheme.KidsArt: {
      return 'mounted';
    }
    default: {
      return 'printed';
    }
  }
};
