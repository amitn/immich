import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { automock } from 'test/utils.js';

const solid = (width: number, height: number, background: { r: number; g: number; b: number }) =>
  sharp({ create: { width, height, channels: 3, background } });

const noise = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: '#000', noise: { type: 'gaussian', mean: 128, sigma: 40 } },
  });

const pixelAt = async (image: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
};

const expectColor = (actual: number[], expected: number[], tolerance = 12) => {
  for (const [i, value] of expected.entries()) {
    expect(Math.abs(actual[i] - value)).toBeLessThanOrEqual(tolerance);
  }
};

describe(MediaRepository.name, () => {
  let sut: MediaRepository;
  let folder: string;
  let red: string;
  let wide: string;
  let sharpNoise: string;
  let blurred: string;

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'immich-agent-media-'));
    red = join(folder, 'red.jpg');
    wide = join(folder, 'wide.png');
    sharpNoise = join(folder, 'noise.png');
    blurred = join(folder, 'blurred.png');
    await solid(300, 300, { r: 255, g: 0, b: 0 }).jpeg().toFile(red);
    await solid(400, 100, { r: 0, g: 0, b: 255 }).png().toFile(wide);
    const noiseImage = await noise(600, 400).png().toBuffer();
    await sharp(noiseImage).toFile(sharpNoise);
    await sharp(noiseImage).blur(6).toFile(blurred);
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  beforeEach(() => {
    // eslint-disable-next-line no-sparse-arrays
    sut = new MediaRepository(automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false }));
  });

  describe('resizeToJpeg', () => {
    it('should fit the image in the size', async () => {
      const image = await solid(2000, 1000, { r: 10, g: 20, b: 30 }).png().toBuffer();
      const result = await sut.resizeToJpeg(image, 1024);
      expect(await sharp(result).metadata()).toMatchObject({ format: 'jpeg', width: 1024, height: 512 });
    });

    it('should not enlarge small images', async () => {
      const result = await sut.resizeToJpeg(red, 1024);
      expect(await sharp(result).metadata()).toMatchObject({ width: 300, height: 300 });
    });
  });

  describe('createContactSheet', () => {
    it('should lay tiles out in a grid', async () => {
      const result = await sut.createContactSheet(
        [
          { input: red, label: '1' },
          { input: wide, label: '2' },
          { input: join(folder, 'missing.jpg'), label: '3' },
          { input: null, label: '4' },
          { input: sharpNoise, label: '5' },
        ],
        { tileSize: 100, gap: 4 },
      );

      expect(await sharp(result).metadata()).toMatchObject({ format: 'jpeg', width: 316, height: 212 });
      // center of the first tile is the red photo
      expectColor(await pixelAt(result, 4 + 50, 4 + 70), [255, 0, 0]);
      // the wide photo is letterboxed on the dark background
      expectColor(await pixelAt(result, 108 + 50, 4 + 50), [0, 0, 255]);
      expectColor(await pixelAt(result, 108 + 50, 4 + 95), [28, 28, 28]);
      // missing and empty inputs become placeholders
      expectColor(await pixelAt(result, 212 + 50, 4 + 70), [58, 58, 58]);
      expectColor(await pixelAt(result, 4 + 50, 108 + 70), [58, 58, 58]);
    });

    it('should draw the labels', async () => {
      const plain = await sut.createContactSheet([{ input: red, label: '' }], { tileSize: 200, gap: 0 });
      const labelled = await sut.createContactSheet([{ input: red, label: '12' }], { tileSize: 200, gap: 0 });
      const [r] = await pixelAt(labelled, 6, 6);
      const [plainR] = await pixelAt(plain, 100, 100);
      expect(plainR).toBeGreaterThan(200);
      expect(r).toBeLessThan(120);
    });

    it('should respect the column count', async () => {
      const tiles = Array.from({ length: 4 }, (_, i) => ({ input: red, label: String(i + 1) }));
      const result = await sut.createContactSheet(tiles, { tileSize: 50, gap: 2, columns: 4 });
      expect(await sharp(result).metadata()).toMatchObject({ width: 4 * 50 + 5 * 2, height: 50 + 2 * 2 });
    });
  });

  describe('analyzeImage', () => {
    it('should measure a flat grey image', async () => {
      const image = await solid(800, 600, { r: 128, g: 128, b: 128 }).png().toBuffer();
      const result = await sut.analyzeImage(image);
      expect(result.width).toBe(512);
      expect(result.height).toBe(384);
      expect(result.laplacianVariance).toBeCloseTo(0);
      expect(result.meanLuma).toBeCloseTo(0.5, 1);
      expect(result.shadowClip).toBe(0);
      expect(result.highlightClip).toBe(0);
    });

    it('should detect clipped shadows and highlights', async () => {
      const black = await sut.analyzeImage(await solid(100, 100, { r: 0, g: 0, b: 0 }).png().toBuffer());
      expect(black).toMatchObject({ meanLuma: 0, shadowClip: 1, highlightClip: 0 });

      const white = await sut.analyzeImage(await solid(100, 100, { r: 255, g: 255, b: 255 }).png().toBuffer());
      expect(white).toMatchObject({ meanLuma: 1, shadowClip: 0, highlightClip: 1 });
    });

    it('should rank a sharp image above a blurred one', async () => {
      const crisp = await sut.analyzeImage(sharpNoise);
      const soft = await sut.analyzeImage(blurred);
      expect(crisp.laplacianVariance).toBeGreaterThan(1000);
      expect(soft.laplacianVariance).toBeLessThan(50);
    });
  });
});
