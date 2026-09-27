import sharp from 'sharp';
import { Colorspace } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { Bitmap, RawImageInfo } from 'src/types.js';
import { estimateTilt, getStraightenedSize } from 'src/utils/agent/straighten.js';
import { automock } from 'test/utils.js';

/** a bright image with a dark band at `lineAngle` degrees, so blank (black) corners would stand out */
const tiltedBand = (width: number, height: number, lineAngle: number): Bitmap => {
  const radians = (lineAngle * Math.PI) / 180;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = (y - height / 2) * Math.cos(radians) - (x - width / 2) * Math.sin(radians);
      const value = Math.abs(distance) < 6 ? 120 : 230;
      data.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return { data, info: { width, height, channels: 3 } as RawImageInfo };
};

describe(`${MediaRepository.name} straightening`, () => {
  let sut: MediaRepository;

  beforeEach(() => {
    sut = new MediaRepository(
      automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }], strict: false }),
    );
  });

  it('should rotate and crop away the blank corners', async () => {
    const image = tiltedBand(800, 600, -4);
    const { data, width, height } = await sut.straightenImage(image, 4, null, { colorspace: Colorspace.Srgb });

    const expected = getStraightenedSize(800, 600, 4);
    expect(Math.abs(width - expected.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(height - expected.height)).toBeLessThanOrEqual(2);

    const { data: pixels, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
    for (const [x, y] of [
      [0, 0],
      [info.width - 1, 0],
      [0, info.height - 1],
      [info.width - 1, info.height - 1],
    ]) {
      // jpeg can soften the edge a bit, but a blank corner would be near black
      expect(pixels[(y * info.width + x) * info.channels]).toBeGreaterThan(180);
    }
  });

  it('should return the same pixels without encoding them', async () => {
    const image = tiltedBand(800, 600, -4);
    const encoded = await sut.straightenImage(
      image,
      4,
      { x: 10, y: 20, width: 300, height: 200 },
      {
        colorspace: Colorspace.Srgb,
      },
    );
    const raw = await sut.straightenBitmap(image, 4, { x: 10, y: 20, width: 300, height: 200 });
    expect(raw.info).toMatchObject({ width: encoded.width, height: encoded.height, channels: 3 });

    const cropped = await sut.cropBitmap(image, { x: 700, y: 500, width: 300, height: 300 });
    expect(cropped.info).toMatchObject({ width: 100, height: 100, channels: 3 });

    const jpeg = await sut.encodeJpeg(cropped, { colorspace: Colorspace.Srgb });
    expect(await sharp(jpeg.data).metadata()).toMatchObject({ width: 100, height: 100, format: 'jpeg' });
  });

  it('should analyze decoded pixels like an encoded image', async () => {
    const image = tiltedBand(400, 300, 0);
    const png = await sharp(image.data, { raw: image.info }).png().toBuffer();
    const [fromBitmap, fromFile] = await Promise.all([sut.analyzeImage(image), sut.analyzeImage(png)]);
    expect(fromBitmap.meanLuma).toBeCloseTo(fromFile.meanLuma, 3);
    expect(fromBitmap.laplacianVariance).toBeCloseTo(fromFile.laplacianVariance, 0);
    const small = await sut.getSmallRgb(png, 200);
    expect(small.info).toMatchObject({ width: 200, height: 150, channels: 3 });
  });

  it('should level the band', async () => {
    const image = tiltedBand(800, 600, -4);
    const { data } = await sut.straightenImage(image, 4, null, { colorspace: Colorspace.Srgb });
    const gray = await sut.getGrayscale(data, 512);
    expect(Math.abs(estimateTilt(gray).angle)).toBeLessThan(0.5);
  });

  it('should crop inside the straightened photo and resize', async () => {
    const image = tiltedBand(800, 600, 0);
    const { width, height } = await sut.straightenImage(
      image,
      2,
      { x: 10, y: 10, width: 300, height: 200 },
      { colorspace: Colorspace.Srgb, size: 150 },
    );
    expect(width).toBe(150);
    expect(height).toBe(100);
  });
});
