import { BookStylePreset, getBookStylePresets, type BookStyle, type BookStylePresetResponseDto } from '@immich/sdk';
import type { Translations } from 'svelte-i18n';

/** TODO: `BookStylePreset.Food` once the SDK is regenerated */
export const BOOK_STYLE_PRESET_FOOD = 'food' as BookStylePreset;

export const BOOK_STYLE_PRESETS = [
  BookStylePreset.Soft,
  BookStylePreset.Classic,
  BookStylePreset.Bold,
  BOOK_STYLE_PRESET_FOOD,
] as const;

export const DEFAULT_BOOK_STYLE_PRESET = BookStylePreset.Soft;

export const BOOK_STYLE_PRESET_LABEL_KEYS: Record<BookStylePreset, { name: Translations; description: Translations }> =
  {
    [BookStylePreset.Soft]: { name: 'book_style_preset_soft', description: 'book_style_preset_soft_description' },
    [BookStylePreset.Classic]: {
      name: 'book_style_preset_classic',
      description: 'book_style_preset_classic_description',
    },
    [BookStylePreset.Bold]: { name: 'book_style_preset_bold', description: 'book_style_preset_bold_description' },
    [BOOK_STYLE_PRESET_FOOD]: { name: 'book_style_preset_food', description: 'book_style_preset_food_description' },
  };

let presets: Promise<BookStylePresetResponseDto[]> | undefined;

const presetOrder = (preset: BookStylePresetResponseDto) => {
  const index = (BOOK_STYLE_PRESETS as readonly BookStylePreset[]).indexOf(preset.id);
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
] as const satisfies ReadonlyArray<keyof BookStyle>;

/**
 * Style options the SDK does not know yet, with their defaults on the server.
 * TODO: add them to `STYLE_KEYS` once the SDK is regenerated
 */
const NEW_STYLE_DEFAULTS: Record<string, string> = { theme: 'plain' };

const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;

const newValue = (style: BookStyle, key: string) => (style as Record<string, unknown>)[key] ?? NEW_STYLE_DEFAULTS[key];

/** The style's theme, e.g. food for the printed-menu look of the food preset */
export const getBookStyleTheme = (style?: BookStyle) => (style ? String(newValue(style, 'theme')) : undefined);

/** The color of the rules and ornaments of the food theme */
export const getBookStyleAccent = (style?: BookStyle) =>
  style ? String((style as Record<string, unknown>).accentColor ?? style.textColor) : undefined;

/** The preset the style is exactly equal to, or undefined for a custom style */
export const findBookStylePreset = (
  style: BookStyle,
  available: BookStylePresetResponseDto[],
): BookStylePresetResponseDto | undefined =>
  available.find(
    (preset) =>
      STYLE_KEYS.every((key) => sameValue(style[key], preset.style[key])) &&
      Object.keys(NEW_STYLE_DEFAULTS).every((key) => sameValue(newValue(style, key), newValue(preset.style, key))),
  );
