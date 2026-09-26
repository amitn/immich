import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Colorspace } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { Bitmap } from 'src/types.js';
import { computeImageStats, percentile, planEnhancement } from 'src/utils/enhance.js';
import { automock } from 'test/utils.js';

const WIDTH = 640;
const HEIGHT = 480;

/** a textured scene with coloured shapes, squeezed into a dark, narrow range of tones */
const createScene = async ({
  low,
  high,
  tint = [1, 1, 1],
  sky = ['#8ab4e8', '#f0e6d2'],
  grain = 6,
}: {
  low: number;
  high: number;
  tint?: number[];
  sky?: string[];
  grain?: number;
}) => {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">` +
      `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#sky)"/>` +
      `<rect x="0" y="300" width="${WIDTH}" height="180" fill="#4a7a3a"/>` +
      `<circle cx="160" cy="260" r="90" fill="#c0392b"/>` +
      `<rect x="330" y="150" width="200" height="220" fill="#7f8c8d"/>` +
      `<rect x="360" y="190" width="50" height="60" fill="#f7f7f7"/>` +
      `<rect x="450" y="190" width="50" height="60" fill="#111111"/>` +
      `</svg>`,
  );
  const scale = (high - low) / 255;
  const { data, info } = await sharp(svg)
    .composite([
      {
        input: await sharp({
          create: {
            width: WIDTH,
            height: HEIGHT,
            channels: 3,
            background: '#808080',
            noise: { type: 'gaussian', mean: 128, sigma: grain },
          },
        })
          .png()
          .toBuffer(),
        blend: 'overlay',
      },
    ])
    .removeAlpha()
    .linear(
      tint.map((t) => scale * t),
      tint.map((t) => low * t),
    )
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info: { width: info.width, height: info.height, channels: info.channels } } as Bitmap;
};

const measure = async (jpeg: Buffer) => {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  return computeImageStats(data, info.width, info.height, info.channels);
};

/** standard deviation of the luma around its local (blurred) mean */
const localContrast = async (image: Buffer | Bitmap) => {
  const input = Buffer.isBuffer(image) ? sharp(image) : sharp(image.data, { raw: image.info });
  const { data, info } = await input.greyscale().raw().toBuffer({ resolveWithObject: true });
  const blurred = await sharp(data, { raw: info }).blur(8).raw().toBuffer();
  let squares = 0;
  for (const [i, value] of data.entries()) {
    squares += (value - blurred[i]) ** 2;
  }
  return Math.sqrt(squares / data.length);
};

const spread = (histogram: number[]) => percentile(histogram, 0.995) - percentile(histogram, 0.005);

describe(`${MediaRepository.name} auto-enhance`, () => {
  let sut: MediaRepository;
  let dark: Bitmap;

  beforeAll(async () => {
    dark = await createScene({ low: 10, high: 95 });
  });

  beforeEach(() => {
    // eslint-disable-next-line no-sparse-arrays
    sut = new MediaRepository(automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false }));
  });

  describe('getEnhanceStats', () => {
    it('should compute the statistics of a downscaled copy', async () => {
      const stats = await sut.getEnhanceStats(dark, 256);
      expect(stats.width).toBe(256);
      expect(stats.height).toBe(192);
      expect(stats.lumaMean).toBeGreaterThan(20);
      expect(stats.lumaMean).toBeLessThan(90);
    });

    it('should accept images with alpha', async () => {
      const { data, info } = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ff000080' } })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const stats = await sut.getEnhanceStats({ data, info: { width: 20, height: 10, channels: info.channels } });
      expect(stats.mean.r).toBeGreaterThan(stats.mean.b);
    });
  });

  describe('enhanceImage', () => {
    it('should brighten and stretch an underexposed, low-contrast photo', async () => {
      const before = await sut.getEnhanceStats(dark);
      const { plan, corrections } = planEnhancement(before, { outputSize: WIDTH });
      expect(corrections.map(({ type }) => type)).toEqual(expect.arrayContaining(['levels', 'exposure']));

      const output = await sut.enhanceImage(dark, plan, { colorspace: Colorspace.Srgb });
      const after = await measure(output.data);

      expect(output).toMatchObject({ width: WIDTH, height: HEIGHT });
      expect(after.lumaMean).toBeGreaterThan(before.lumaMean + 25);
      expect(spread(after.histogram.luma)).toBeGreaterThan(spread(before.histogram.luma) * 1.4);
      // the result is not blown out
      expect(percentile(after.histogram.luma, 0.99)).toBeLessThan(255);
    });

    it('should neutralize a colour cast', async () => {
      // an overcast scene: the sky is neutral, so the tint is a cast rather than the colour of the scene
      const tinted = await createScene({ low: 30, high: 230, tint: [0.82, 0.95, 1.15], sky: ['#c8c8c8', '#f4f4f4'] });
      const before = await sut.getEnhanceStats(tinted);
      const { plan } = planEnhancement(before, { only: ['whiteBalance'] });
      expect(plan.whiteBalance).toBeDefined();

      const output = await sut.enhanceImage(tinted, plan, { colorspace: Colorspace.Srgb });
      const after = await measure(output.data);
      const ratio = (stats: typeof before) => stats.neutralMean.b / stats.neutralMean.r;
      expect(Math.abs(ratio(after) - 1)).toBeLessThan(Math.abs(ratio(before) - 1) * 0.6);
    });

    it('should add local contrast without changing the input', async () => {
      const flat = await createScene({ low: 90, high: 150, grain: 40 });
      const original = Buffer.from(flat.data);
      const plan = { localContrast: { grid: 8, clipLimit: 3, amount: 0.8 } };

      const output = await sut.enhanceImage(flat, plan, { colorspace: Colorspace.Srgb });
      expect(output).toMatchObject({ width: WIDTH, height: HEIGHT });
      expect(await localContrast(output.data)).toBeGreaterThan((await localContrast(flat)) * 1.3);
      expect(flat.data.equals(original)).toBe(true);
    });

    it('should apply every correction', async () => {
      const plan = planEnhancement(await sut.getEnhanceStats(dark), { iso: 6400, strength: 'strong' }).plan;
      expect(Object.keys(plan)).toEqual(expect.arrayContaining(['denoise', 'levels', 'sharpen']));

      const output = await sut.enhanceImage(
        dark,
        { ...plan, exposure: { gamma: 1.2 }, saturation: { factor: 1.1 } },
        { colorspace: Colorspace.Srgb },
      );
      const { format } = await sharp(output.data).metadata();
      expect(format).toBe('jpeg');
    });

    it('should darken with a gamma below 1', async () => {
      const bright = await createScene({ low: 120, high: 255 });
      const output = await sut.enhanceImage(bright, { exposure: { gamma: 0.8 } }, { colorspace: Colorspace.Srgb });
      const { lumaMean } = await measure(output.data);
      expect(lumaMean).toBeLessThan(computeImageStats(bright.data, WIDTH, HEIGHT, 3).lumaMean - 5);
    });
  });

  describe('renderEnhanceComparison', () => {
    it('should render the image before and after side by side', async () => {
      const { plan } = planEnhancement(await sut.getEnhanceStats(dark), { outputSize: 508 });
      const comparison = await sut.renderEnhanceComparison(dark, plan, { width: 1024 });
      const { width, height, format } = await sharp(comparison).metadata();

      expect(format).toBe('jpeg');
      expect(width).toBe(508 * 2 + 8);
      expect(height).toBe(381);

      const { data, info } = await sharp(comparison).raw().toBuffer({ resolveWithObject: true });
      const half = (left: number) => {
        const { data: pixels } = { data: Buffer.alloc(508 * 300 * 3) };
        for (let y = 0; y < 300; y++) {
          data.copy(pixels, y * 508 * 3, ((y + 60) * info.width + left) * 3, ((y + 60) * info.width + left + 508) * 3);
        }
        return computeImageStats(pixels, 508, 300, 3).lumaMean;
      };
      expect(half(516)).toBeGreaterThan(half(0) + 20);
    });
  });
});
