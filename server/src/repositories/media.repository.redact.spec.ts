import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssetEditAction } from 'src/dtos/editing.dto.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { Bitmap, RawImageInfo } from 'src/types.js';
import { automock } from 'test/utils.js';

// #14: the pixels of a redacted region carry nothing of what they covered

const WIDTH = 400;
const HEIGHT = 300;

/** a grey photo with a black and white checkerboard (a "face") at 100..200 x 100..200 */
const createPhoto = async (): Promise<Bitmap> => {
  const cells: string[] = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      if ((x + y) % 2 === 0) {
        cells.push(`<rect x="${100 + x * 10}" y="${100 + y * 10}" width="10" height="10" fill="#000"/>`);
      }
    }
  }
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">` +
      `<rect width="100%" height="100%" fill="#808080"/><rect x="100" y="100" width="100" height="100" fill="#fff"/>` +
      `${cells.join('')}</svg>`,
  );
  const { data, info } = await sharp(svg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info: info as RawImageInfo };
};

/** the standard deviation of the luma of a region: high for a checkerboard, low once it is blurred */
const contrast = (image: Bitmap, left: number, top: number, width: number, height: number) => {
  const { channels } = image.info;
  const values: number[] = [];
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      values.push(image.data[(y * image.info.width + x) * channels]);
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

const pixel = (image: Bitmap, x: number, y: number) => {
  const offset = (y * image.info.width + x) * image.info.channels;
  return [...image.data.subarray(offset, offset + 3)];
};

describe('MediaRepository redaction', () => {
  let sut: MediaRepository;

  beforeEach(() => {
    // eslint-disable-next-line no-sparse-arrays
    sut = new MediaRepository(automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false }));
  });

  it.each(['blur', 'pixelate'] as const)(
    'should %s a region and leave the rest of the photo as it is',
    async (style) => {
      const photo = await createPhoto();
      expect(contrast(photo, 100, 100, 100, 100)).toBeGreaterThan(100);

      const redacted = await sut.redactBitmap(photo, [{ x: 100, y: 100, width: 100, height: 100 }], style);
      expect(redacted.info).toMatchObject({ width: WIDTH, height: HEIGHT });
      // the checkerboard is gone...
      expect(contrast(redacted, 100, 100, 100, 100)).toBeLessThan(style === 'blur' ? 20 : 60);
      // ...and nothing else changed
      expect(pixel(redacted, 20, 20)).toEqual([128, 128, 128]);
      expect(pixel(redacted, 300, 250)).toEqual([128, 128, 128]);
      expect(contrast(redacted, 0, 0, 90, 90)).toBe(0);
    },
  );

  it('should leave a photo without regions as it is', async () => {
    const photo = await createPhoto();
    await expect(sut.redactBitmap(photo, [], 'blur')).resolves.toBe(photo);
    // a region outside the photo is nothing to blur
    await expect(sut.redactBitmap(photo, [{ x: 500, y: 500, width: 10, height: 10 }], 'blur')).resolves.toBe(photo);
  });

  it('should redact a file by fractions of it, as a JPEG', async () => {
    const photo = await createPhoto();
    const file = await sharp(photo.data, { raw: photo.info }).png().toBuffer();

    const data = await sut.redactImage(file, [{ x: 0.25, y: 1 / 3, width: 0.25, height: 1 / 3 }]);
    const { data: pixels, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
    const metadata = await sharp(data).metadata();
    expect(metadata.format).toBe('jpeg');
    const decoded = { data: pixels, info: info as RawImageInfo };
    expect(info).toMatchObject({ width: WIDTH, height: HEIGHT });
    expect(contrast(decoded, 105, 105, 90, 90)).toBeLessThan(25);

    const small = await sut.redactImage(file, [{ x: 0.25, y: 1 / 3, width: 0.25, height: 1 / 3 }], { size: 200 });
    expect(await sharp(small).metadata()).toMatchObject({ width: 200, height: 150 });
  });

  it('should apply the edits of a photo before it is redacted', async () => {
    const photo = await createPhoto();
    const cropped = await sut.applyBitmapEdits(photo, [
      { action: AssetEditAction.Crop, parameters: { x: 100, y: 100, width: 200, height: 100 } },
    ]);
    expect(cropped.info).toMatchObject({ width: 200, height: 100 });
  });
});
