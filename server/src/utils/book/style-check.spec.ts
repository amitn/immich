import { bookStylePresetIds, bookStylePresets } from 'src/dtos/book.dto.js';
import { BOOK_STYLE_FONTS, checkBookStyle, splitFontFamily } from 'src/utils/book/style-check.js';

describe('checkBookStyle', () => {
  it.each(bookStylePresetIds)('should accept the built-in preset %s', (id) => {
    expect(checkBookStyle(bookStylePresets[id].style).errors).toEqual([]);
  });

  it('should accept every listed font', () => {
    for (const { fontFamily } of BOOK_STYLE_FONTS) {
      expect(checkBookStyle({ fontFamily }).errors).toEqual([]);
    }
  });

  describe('fonts', () => {
    it('should accept fonts of the stacks in any case and with quotes', () => {
      expect(checkBookStyle({ fontFamily: "'Liberation Serif', SERIF" }).errors).toEqual([]);
      expect(checkBookStyle({ fontFamily: 'Arial, sans-serif' }).errors).toEqual([]);
    });

    it('should refuse fonts that do not render', () => {
      const { errors } = checkBookStyle({ fontFamily: 'Comic Sans MS, cursive' });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('"Comic Sans MS", "cursive"');
      expect(errors[0]).toContain('FreeSerif, serif');
    });

    it('should split a font-family list', () => {
      expect(splitFontFamily(` 'EB Garamond' , "serif",`)).toEqual(['EB Garamond', 'serif']);
    });
  });

  describe('colours', () => {
    it('should refuse unreadable text', () => {
      const { errors, contrast } = checkBookStyle({ background: '#ffffff', textColor: '#dddddd' });
      expect(contrast.text).toBeLessThan(3);
      expect(errors.join(',')).toContain("can't be read");
    });

    it('should refuse light text on a pale page and accept it on a dark one', () => {
      expect(checkBookStyle({ background: '#f6f1e7', textColor: '#c8b89a' }).errors).not.toEqual([]);
      expect(checkBookStyle({ background: '#1f2a24', textColor: '#f1e9dc', accentColor: '#c9a24a' }).errors).toEqual(
        [],
      );
    });

    it('should warn about text that is readable but weak', () => {
      const { errors, warnings } = checkBookStyle({ background: '#ffffff', textColor: '#888888' });
      expect(errors).toEqual([]);
      expect(warnings.join(',')).toContain('hard to read');
    });

    it('should refuse an invisible accent and warn about a faint one', () => {
      expect(checkBookStyle({ background: '#ffffff', accentColor: '#fafafa' }).errors.join(',')).toContain('invisible');
      const faint = checkBookStyle({ background: '#ffffff', accentColor: '#bbbbbb' });
      expect(faint.errors).toEqual([]);
      expect(faint.warnings.join(',')).toContain('faint');
    });

    it('should refuse translucent colours', () => {
      expect(checkBookStyle({ background: '#ffffff80' }).errors.join(',')).toContain('opaque');
      expect(checkBookStyle({ background: '#ffff' }).errors).toEqual([]);
    });
  });

  describe('sizes', () => {
    it('should refuse sizes that do not print well', () => {
      expect(checkBookStyle({ marginMm: 1 }).errors.join(',')).toContain('marginMm must be between 3 and 35');
      expect(checkBookStyle({ titleSizePt: 120 }).errors.join(',')).toContain('titleSizePt');
      expect(checkBookStyle({ captionSizePt: 4 }).errors.join(',')).toContain('captionSizePt');
    });

    it('should refuse captions as large as the titles', () => {
      expect(checkBookStyle({ titleSizePt: 14, captionSizePt: 14 }).errors.join(',')).toContain(
        'smaller than the titles',
      );
    });

    it('should warn about small captions and wide gutters', () => {
      expect(checkBookStyle({ captionSizePt: 7 }).warnings.join(',')).toContain('small in print');
      expect(checkBookStyle({ marginMm: 5, gutterMm: 15 }).warnings.join(',')).toContain('wider than the margins');
    });

    it('should refuse margins that do not fit the page', () => {
      expect(
        checkBookStyle({ marginMm: 35, gutterMm: 20 }, { pageWidthMm: 100, pageHeightMm: 100 }).errors.join(','),
      ).toContain('too large');
    });
  });

  it('should refuse an unknown theme', () => {
    expect(checkBookStyle({ theme: 'disco' }).errors.join(',')).toContain('Unknown theme "disco"');
    expect(checkBookStyle({ theme: 'food' }).errors).toEqual([]);
  });
});
