import { bookStylePresets } from 'src/dtos/book.dto.js';
import { getFontStack } from 'src/utils/book/fonts.js';

describe('getFontStack', () => {
  it('should put installed fonts before the generic families', () => {
    expect(getFontStack('serif')).toBe(
      "'Liberation Serif', 'Times New Roman', Times, 'DejaVu Serif', 'Noto Serif', FreeSerif, serif",
    );
    expect(getFontStack('sans-serif')).toMatch(/^'Liberation Sans', Arial, .*, sans-serif$/);
  });

  it('should keep the named fonts first and fall back to serif', () => {
    expect(getFontStack('Georgia, serif')).toBe(`Georgia, ${getFontStack('serif')}`);
    expect(getFontStack("'EB Garamond'")).toBe(`'EB Garamond', ${getFontStack('serif')}`);
    expect(getFontStack(' Sans-Serif ')).toBe(getFontStack('sans-serif'));
    expect(getFontStack('')).toBe(getFontStack('serif'));
  });

  it('should not repeat a font', () => {
    expect(
      getFontStack('Arial, sans-serif')
        .split(', ')
        .filter((name) => name === 'Arial'),
    ).toHaveLength(1);
  });

  it('should give every preset a serif or sans-serif stack', () => {
    expect(getFontStack(bookStylePresets.soft.style.fontFamily)).toBe(getFontStack('serif'));
    expect(getFontStack(bookStylePresets.bold.style.fontFamily)).toBe(getFontStack('sans-serif'));
    // FreeSerif renders on the server, and a browser without it falls back to the metric-compatible serif stack
    expect(getFontStack(bookStylePresets.food.style.fontFamily)).toBe(
      "FreeSerif, 'Liberation Serif', 'Times New Roman', Times, 'DejaVu Serif', 'Noto Serif', serif",
    );
  });
});
