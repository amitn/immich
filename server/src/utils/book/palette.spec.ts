import sharp from 'sharp';
import {
  extractPalette,
  fromHex,
  hslToRgb,
  rgbToHsl,
  shiftColor,
  toHex,
  withContrast,
} from 'src/utils/book/palette.js';
import { getContrast } from 'src/utils/book/render.js';

/** a real image drawn by sharp, read back as small RGB pixels the way the service reads thumbnails */
const draw = async (svg: string, size = 96) => {
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const { data, info } = await sharp(png)
    .resize(size, size, { fit: 'inside' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, channels: info.channels };
};

const stripes = (colors: Array<[string, number]>) => {
  let x = 0;
  const rects = colors.map(([color, width]) => {
    const rect = `<rect x="${x}" y="0" width="${width}" height="200" fill="${color}"/>`;
    x += width;
    return rect;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">${rects.join('')}</svg>`;
};

const hueOf = (hex: string) => rgbToHsl(fromHex(hex))[0] * 360;

describe('palette', () => {
  describe('colour helpers', () => {
    it('should convert between hex, RGB and HSL', () => {
      expect(toHex(fromHex('#8c3b2a'))).toBe('#8c3b2a');
      expect(toHex(fromHex('#abc'))).toBe('#aabbcc');
      expect(toHex(hslToRgb(rgbToHsl(fromHex('#5b7a61'))))).toBe('#5b7a61');
    });

    it('should shift the lightness and keep the hue', () => {
      const pale = shiftColor('#5b7a61', 0.95, 0.35);
      expect(rgbToHsl(fromHex(pale))[2]).toBeCloseTo(0.95, 1);
      expect(Math.abs(hueOf(pale) - hueOf('#5b7a61'))).toBeLessThan(6);
    });

    it('should darken a colour until it is readable', () => {
      const color = withContrast('#e8d9a0', '#fbfaf5', 3);
      expect(getContrast(color, '#fbfaf5')).toBeGreaterThanOrEqual(3);
    });
  });

  describe('extractPalette', () => {
    it('should find the dominant and accent colours of a real image', async () => {
      // ivory (60%), sage (30%) and gold (10%), like a wedding
      const image = await draw(
        stripes([
          ['#f3eee0', 120],
          ['#8a9a7b', 60],
          ['#c9a13b', 20],
        ]),
      );
      const palette = extractPalette([image], 4);

      expect(palette.dominant.lightness).toBeGreaterThan(0.85);
      expect(palette.dominant.share).toBeGreaterThan(0.5);
      const hexes = palette.colors.map((color) => color.hex);
      expect(hexes.some((hex) => Math.abs(hueOf(hex) - hueOf('#8a9a7b')) < 10)).toBe(true);
      // gold is the most striking accent
      expect(Math.abs(hueOf(palette.accents[0].hex) - hueOf('#c9a13b'))).toBeLessThan(10);
    });

    it('should weigh every image the same, whatever its size', async () => {
      const red = await draw(stripes([['#c0392b', 200]]), 96);
      const blue = await draw(stripes([['#2e5fa8', 200]]), 24);
      const palette = extractPalette([red, blue], 4);
      expect(palette.colors).toHaveLength(2);
      expect(palette.colors[0].share).toBeCloseTo(0.5, 1);
    });

    it('should suggest a readable style', async () => {
      const image = await draw(
        stripes([
          ['#1d3557', 100],
          ['#e63946', 40],
          ['#a8dadc', 60],
        ]),
      );
      const { suggestion } = extractPalette([image]);
      expect(getContrast(suggestion.textColor, suggestion.background)).toBeGreaterThanOrEqual(7);
      expect(getContrast(suggestion.accentColor, suggestion.background)).toBeGreaterThanOrEqual(3);
      expect(rgbToHsl(fromHex(suggestion.background))[2]).toBeGreaterThan(0.9);
    });

    it('should be deterministic', async () => {
      const image = await draw(
        `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff7f50"/><stop offset="1" stop-color="#2f4f4f"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/></svg>`,
      );
      expect(extractPalette([image])).toEqual(extractPalette([image]));
    });

    it('should fail without pixels', () => {
      expect(() => extractPalette([{ data: Buffer.alloc(0), channels: 3 }])).toThrow('No pixels');
    });
  });
});
