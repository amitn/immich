import {
  BookStylePreset,
  BookStyleTheme,
  getBookStylePresets,
  type BookStyle,
  type BookStylePresetResponseDto,
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

const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** The value of a style option, with the defaults of the server for the options older styles don't have */
const valueOf = (style: BookStyle, key: StyleKey) => {
  switch (key) {
    case 'theme': {
      return style.theme ?? BookStyleTheme.Plain;
    }
    case 'accentColor': {
      return style.accentColor ?? style.textColor;
    }
    default: {
      return style[key];
    }
  }
};

/** The style's theme, e.g. food for the printed-menu look of the food preset */
export const getBookStyleTheme = (style?: BookStyle) => (style ? valueOf(style, 'theme') : undefined);

/** The color of the rules and ornaments of the food theme */
export const getBookStyleAccent = (style?: BookStyle) => (style ? valueOf(style, 'accentColor') : undefined);

/** The preset the style is exactly equal to, or undefined for a custom style */
export const findBookStylePreset = (
  style: BookStyle,
  available: BookStylePresetResponseDto[],
): BookStylePresetResponseDto | undefined =>
  available.find((preset) => STYLE_KEYS.every((key) => sameValue(valueOf(style, key), valueOf(preset.style, key))));
