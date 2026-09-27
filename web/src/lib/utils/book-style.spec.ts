import { BookStylePreset, BookStyleTheme } from '@immich/sdk';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import {
  findBookStylePreset,
  findBookUserStyle,
  getBookStyleAccent,
  getBookStyleLook,
  getBookStyleTheme,
  isBookStylePreset,
  loadBookStylePresets,
  loadBookUserStyles,
  normalizeFontFamily,
  resetBookStylePresets,
} from '$lib/utils/book-style';
import { bookUserStyleFactory } from '@test-data/factories/book-factory';
import { bookStylePresets } from '@test-data/factories/book-review-factory';

const [classic, soft, bold, food] = bookStylePresets;

describe('findBookStylePreset', () => {
  it('should find the preset with the same style', () => {
    expect(findBookStylePreset({ ...bold.style }, bookStylePresets)).toBe(bold);
    expect(findBookStylePreset({ ...classic.style }, bookStylePresets)).toBe(classic);
    expect(findBookStylePreset({ ...food.style }, bookStylePresets)).toBe(food);
  });

  it('should tell the food theme from a plain style with the same values', () => {
    expect(findBookStylePreset({ ...food.style, theme: BookStyleTheme.Plain }, bookStylePresets)).toBeUndefined();
    expect(getBookStyleTheme(food.style)).toBe('food');
    expect(getBookStyleTheme(classic.style)).toBe('plain');
    expect(getBookStyleAccent(food.style)).toBe('#8c3b2a');
    expect(getBookStyleAccent(classic.style)).toBe(classic.style.textColor);
  });

  it('should ignore the case of colors', () => {
    expect(findBookStylePreset({ ...soft.style, textColor: '#5B4636' }, bookStylePresets)).toBe(soft);
  });

  it('should not match a style that differs in any value', () => {
    expect(findBookStylePreset({ ...soft.style, gutterMm: 4 }, bookStylePresets)).toBeUndefined();
    expect(findBookStylePreset({ ...soft.style, fontFamily: 'sans-serif' }, bookStylePresets)).toBeUndefined();
    expect(findBookStylePreset({ ...soft.style, captionSizePt: 11 }, bookStylePresets)).toBeUndefined();
    expect(findBookStylePreset({ ...food.style, accentColor: '#000000' }, bookStylePresets)).toBeUndefined();
  });

  it('should find the preset of a style whose font was expanded to its stack', () => {
    const expanded = "'Liberation Serif', 'Times New Roman', Times, 'DejaVu Serif', 'Noto Serif', FreeSerif, serif";

    expect(findBookStylePreset({ ...soft.style, fontFamily: expanded }, bookStylePresets)).toBe(soft);
    expect(findBookStylePreset({ ...soft.style, fontFamily: 'Serif' }, bookStylePresets)).toBe(soft);
    expect(
      findBookStylePreset(
        { ...food.style, fontFamily: `FreeSerif, ${expanded.replace(', FreeSerif', '')}` },
        bookStylePresets,
      ),
    ).toBe(food);
    expect(findBookStylePreset({ ...food.style, fontFamily: "'FreeSerif'" }, bookStylePresets)).toBe(food);
  });

  it('should tell styles apart by the first family of their fonts', () => {
    expect(findBookStylePreset({ ...soft.style, fontFamily: 'FreeSerif, serif' }, bookStylePresets)).toBeUndefined();
    expect(findBookStylePreset({ ...food.style, fontFamily: 'serif' }, bookStylePresets)).toBeUndefined();
  });

  it('should compare colors and sizes by their values', () => {
    expect(
      findBookStylePreset({ ...classic.style, background: '#FFF', textColor: '#222222ff' }, bookStylePresets),
    ).toBe(classic);
    expect(findBookStylePreset({ ...food.style, captionSizePt: 10.50000001 }, bookStylePresets)).toBe(food);
  });

  it('should give a style without sizes the sizes of the server', () => {
    expect(
      findBookStylePreset({ ...soft.style, titleSizePt: undefined, captionSizePt: undefined }, bookStylePresets),
    ).toBe(soft);
  });

  it('should normalize font families to the first one', () => {
    expect(normalizeFontFamily('FreeSerif, serif')).toBe('freeserif');
    expect(normalizeFontFamily("'Liberation Sans', Arial, sans-serif")).toBe('sans-serif');
    expect(normalizeFontFamily('"DejaVu Serif", serif')).toBe('dejavu serif');
    expect(normalizeFontFamily('')).toBe('serif');
    expect(normalizeFontFamily(undefined)).toBe('serif');
  });

  it('should treat a style without a theme or accent as plain, with the accent of its text', () => {
    const classicStyle = { ...classic.style, theme: BookStyleTheme.Plain, accentColor: classic.style.textColor };
    const presets = [{ ...classic, style: classicStyle }];

    expect(findBookStylePreset({ ...classic.style }, presets)).toBe(presets[0]);
    expect(findBookStylePreset({ ...classic.style, accentColor: '#abcdef' }, presets)).toBeUndefined();
  });
});

describe('loadBookStylePresets', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetBookStylePresets();
  });

  it('should load the presets once, in the order of the picker', async () => {
    sdkMock.getBookStylePresets.mockResolvedValue(bookStylePresets);

    await expect(loadBookStylePresets()).resolves.toEqual([soft, classic, bold, food]);
    await loadBookStylePresets();

    expect(sdkMock.getBookStylePresets).toHaveBeenCalledTimes(1);
  });

  it('should try again after a failure', async () => {
    sdkMock.getBookStylePresets.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(bookStylePresets);

    await expect(loadBookStylePresets()).rejects.toThrow('offline');
    await expect(loadBookStylePresets()).resolves.toHaveLength(4);
  });
});

describe('styles of your own', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should load them every time, oldest first', async () => {
    const [older, newer] = bookUserStyleFactory.buildList(2);
    sdkMock.getBookUserStyles.mockResolvedValue([newer, older]);

    await expect(loadBookUserStyles()).resolves.toEqual([older, newer]);
    await loadBookUserStyles();

    expect(sdkMock.getBookUserStyles).toHaveBeenCalledTimes(2);
  });

  it('should find the style of your own a book has a copy of', () => {
    const [wedding, polaroid] = bookUserStyleFactory.buildList(2, { style: bookUserStyleFactory.build().style });
    const other = { ...polaroid, style: { ...polaroid.style, background: '#000000' } };

    expect(findBookUserStyle({ ...wedding.style, background: '#F7F3E8' }, [other, wedding])).toBe(wedding);
    expect(findBookUserStyle({ ...wedding.style, marginMm: 3 }, [other, wedding])).toBeUndefined();
  });

  it('should find the style of your own when the font of the copy was expanded to its stack', () => {
    const wedding = bookUserStyleFactory.build({
      style: { ...bookUserStyleFactory.build().style, fontFamily: 'sans-serif' },
    });
    const copy = { ...wedding.style, fontFamily: "'Liberation Sans', Arial, Helvetica, sans-serif" };

    expect(findBookUserStyle(copy, [wedding])).toBe(wedding);
  });

  it('should tell presets from the ids of styles of your own', () => {
    expect(isBookStylePreset(BookStylePreset.Soft)).toBe(true);
    expect(isBookStylePreset('5f0c3a52-8f4e-4a3b-9d51-7f2b9d3c1e11')).toBe(false);
  });

  it('should give every theme the look the renderer draws', () => {
    const { style } = bookUserStyleFactory.build();
    expect(getBookStyleLook()).toBe('plain');
    expect(getBookStyleLook({ ...style, theme: undefined })).toBe('plain');
    expect(getBookStyleLook({ ...style, theme: BookStyleTheme.Gallery })).toBe('gallery');
    for (const theme of [BookStyleTheme.Food, BookStyleTheme.Wine, BookStyleTheme.Cookbook, BookStyleTheme.Travel]) {
      expect(getBookStyleLook({ ...style, theme })).toBe('printed');
    }
  });
});
