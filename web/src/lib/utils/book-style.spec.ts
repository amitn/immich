import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { findBookStylePreset, loadBookStylePresets, resetBookStylePresets } from '$lib/utils/book-style';
import { bookStylePresets } from '@test-data/factories/book-review-factory';

const [classic, soft, bold] = bookStylePresets;

describe('findBookStylePreset', () => {
  it('should find the preset with the same style', () => {
    expect(findBookStylePreset({ ...bold.style }, bookStylePresets)).toBe(bold);
    expect(findBookStylePreset({ ...classic.style }, bookStylePresets)).toBe(classic);
  });

  it('should ignore the case of colors', () => {
    expect(findBookStylePreset({ ...soft.style, textColor: '#5B4636' }, bookStylePresets)).toBe(soft);
  });

  it('should not match a style that differs in any value', () => {
    expect(findBookStylePreset({ ...soft.style, gutterMm: 4 }, bookStylePresets)).toBeUndefined();
    expect(findBookStylePreset({ ...soft.style, fontFamily: 'sans-serif' }, bookStylePresets)).toBeUndefined();
    expect(findBookStylePreset({ ...soft.style, captionSizePt: undefined }, bookStylePresets)).toBeUndefined();
  });
});

describe('loadBookStylePresets', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetBookStylePresets();
  });

  it('should load the presets once, in the order of the picker', async () => {
    sdkMock.getBookStylePresets.mockResolvedValue(bookStylePresets);

    await expect(loadBookStylePresets()).resolves.toEqual([soft, classic, bold]);
    await loadBookStylePresets();

    expect(sdkMock.getBookStylePresets).toHaveBeenCalledTimes(1);
  });

  it('should try again after a failure', async () => {
    sdkMock.getBookStylePresets.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(bookStylePresets);

    await expect(loadBookStylePresets()).rejects.toThrow('offline');
    await expect(loadBookStylePresets()).resolves.toHaveLength(3);
  });
});
