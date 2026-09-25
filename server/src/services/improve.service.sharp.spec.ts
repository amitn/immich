import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { ImproveService, ImproveSource } from 'src/services/improve.service.js';
import { analysisCache, tiltCache } from 'src/utils/agent/analysis-cache.js';
import { automock, newTestService } from 'test/utils.js';

const COLORS = [
  [220, 40, 40],
  [40, 200, 60],
  [40, 70, 220],
  [230, 210, 40],
  [40, 200, 210],
  [210, 50, 200],
  [250, 250, 250],
  [128, 128, 128],
  [6, 6, 6],
];

/** colourful tiles with fine texture: sharp, well exposed, full range, neutral on average */
const tiles = (width: number, height: number, scale = 1) => {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = (Math.floor(x / 32) * 5 + Math.floor(y / 32) * 7) % COLORS.length;
      const noise = ((x * 13 + y * 7) % 5) - 2;
      for (let c = 0; c < 3; c++) {
        data[(y * width + x) * 3 + c] = Math.max(0, Math.min(255, Math.round((COLORS[tile][c] + noise) * scale)));
      }
    }
  }
  return data;
};

/** dark lines tilted by `angle` degrees on a light background */
const tiltedLines = (width: number, height: number, angle: number) => {
  const radians = (angle * Math.PI) / 180;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = (y - height / 2) * Math.cos(radians) - (x - width / 2) * Math.sin(radians);
      const value = Math.abs(((distance % 40) + 40) % 40) < 5 ? 40 : 200;
      data.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return data;
};

describe(`${ImproveService.name} simulation`, () => {
  let sut: ImproveService;
  let dir: string;

  const source = async (name: string, data: Buffer, width = 720, height = 540): Promise<ImproveSource> => {
    const path = join(dir, `${name}.jpeg`);
    await sharp(data, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 95 })
      .toFile(path);
    return {
      id: name,
      checksum: Buffer.from(name),
      previewPath: path,
      width: width * 5,
      height: height * 5,
      faces: [],
    };
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'immich-improve-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const media = new MediaRepository(
      automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }], strict: false }),
    );
    ({ sut } = newTestService(ImproveService, { media }));
  });

  it('should enhance a dark photo and score it higher', async () => {
    const estimate = await sut.estimate(await source('dark', tiles(720, 540, 0.35)));

    expect(estimate!.recipe.enhance).toEqual({ strength: 'normal' });
    expect(estimate!.potential).toBeGreaterThan(estimate!.now + 0.05);
    expect(estimate!.gain).toBeCloseTo(estimate!.potential - estimate!.now, 2);
  });

  it('should straighten a tilted photo', async () => {
    const estimate = await sut.estimate(await source('tilted', tiltedLines(720, 540, -3)));

    expect(estimate!.recipe.rotate).toBeCloseTo(3, 0);
    expect(estimate!.potential).toBeGreaterThan(estimate!.now);
  });

  it('should leave a sharp, well exposed photo alone', async () => {
    const estimate = await sut.estimate(await source('good', tiles(720, 540)));

    expect(estimate).toEqual({ now: estimate!.now, potential: estimate!.now, gain: 0, recipe: {} });
  });

  it('should give the same result every time', async () => {
    const dark = await source('dark-again', tiles(720, 540, 0.35));
    const first = await sut.estimate(dark);
    analysisCache.clear();
    tiltCache.clear();
    expect(await sut.estimate(dark)).toEqual(first);
  });

  it('should skip photos without a preview', async () => {
    expect(
      await sut.estimate({
        id: 'none',
        checksum: Buffer.from('none'),
        previewPath: null,
        width: 0,
        height: 0,
        faces: [],
      }),
    ).toBeNull();
  });
});
