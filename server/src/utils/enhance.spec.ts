import {
  ImageStats,
  applyLocalContrast,
  computeClaheLuts,
  computeImageStats,
  getLinearCoefficients,
  percentile,
  planEnhancement,
} from 'src/utils/enhance.js';

type Pixel = [number, number, number];

const random = (seed: number) => () => {
  seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
  return seed / 2 ** 32;
};

const hsv = (hue: number, saturation: number, value: number): Pixel => {
  const c = value * saturation;
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h) % 6];
  const m = value - c;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
};

const render = (width: number, height: number, pixel: (x: number, y: number, rand: () => number) => Pixel) => {
  const rand = random(42);
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      for (const [i, value] of pixel(x, y, rand).entries()) {
        data[offset + i] = Math.min(255, Math.max(0, Math.round(value)));
      }
    }
  }
  return data;
};

const SIZE = 160;

/** a colourful scene with a smooth range of tones, some texture and a median brightness of about 46% */
const scene = ({
  value = (t: number) => 1.2 * t ** 0.7 - 0.12,
  saturation = 0.5,
  hue = (x: number, y: number) => (x * 7 + y * 3) % 360,
  tint = [1, 1, 1] as Pixel,
  grain = 3,
} = {}) =>
  render(SIZE, SIZE, (x, y, rand) => {
    const t = (x + y) / (2 * SIZE - 2);
    const [r, g, b] = hsv(hue(x, y), saturation, Math.min(1, Math.max(0, value(t))));
    const n = (rand() + rand() + rand() - 1.5) * 2 * grain;
    return [r * tint[0] + n, g * tint[1] + n, b * tint[2] + n];
  });

const stats = (data: Uint8Array) => computeImageStats(data, SIZE, SIZE, 3);

const wellExposed = () => stats(scene());
const dark = () => stats(scene({ value: (t) => 0.35 * t ** 0.9 }));
const flat = () => stats(scene({ value: (t) => 0.42 + 0.18 * t, saturation: 0.25, grain: 1 }));
const blueCast = () => stats(scene({ saturation: 0.08, tint: [0.84, 0.97, 1.22] }));
const sunset = () =>
  stats(
    scene({
      hue: (x, y) => 12 + ((x + 2 * y) % 30),
      saturation: 0.75,
      value: (t) => 0.15 + 0.8 * t,
    }),
  );

const types = (s: ImageStats, options?: Parameters<typeof planEnhancement>[1]) =>
  planEnhancement(s, options).corrections.map(({ type }) => type);

describe('computeImageStats', () => {
  it('should compute histograms and moments', () => {
    const data = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255]);
    const result = computeImageStats(data, 2, 2, 3);

    expect(result.histogram.r[255]).toBe(2);
    expect(result.histogram.luma[0]).toBe(1);
    expect(result.histogram.luma[255]).toBe(1);
    expect(result.mean).toEqual({ r: 127.5, g: 63.75, b: 127.5 });
    expect(result.saturation).toBe(0.5);
    expect(result.hueHistogram[0]).toBe(0.25);
    expect(result.hueHistogram[8]).toBe(0.25);
  });

  it('should ignore the alpha channel and accept grayscale', () => {
    const rgba = computeImageStats(new Uint8Array([10, 20, 30, 0, 10, 20, 30, 255]), 2, 1, 4);
    expect(rgba.mean).toEqual({ r: 10, g: 20, b: 30 });

    const gray = computeImageStats(new Uint8Array([50, 150]), 2, 1, 1);
    expect(gray.mean).toEqual({ r: 100, g: 100, b: 100 });
    expect(gray.saturation).toBe(0);
  });

  it('should find the neutral colour of a tinted scene', () => {
    const { neutralMean, neutralFraction } = blueCast();
    expect(neutralFraction).toBeGreaterThan(0.5);
    expect(neutralMean.b).toBeGreaterThan(neutralMean.r * 1.3);
  });

  it('should measure sharpness and noise', () => {
    const smooth = stats(scene({ grain: 0 }));
    const noisy = stats(scene({ grain: 20 }));
    expect(noisy.sharpness).toBeGreaterThan(smooth.sharpness * 10);
    expect(noisy.noise).toBeGreaterThan(5);
    expect(smooth.noise).toBeLessThan(2);
  });

  it('should be deterministic', () => {
    expect(stats(scene())).toEqual(stats(scene()));
  });
});

describe('percentile', () => {
  it('should find the value at a fraction of the pixels', () => {
    const histogram = Array.from({ length: 256 }, () => 0);
    histogram[10] = 50;
    histogram[200] = 50;
    expect(percentile(histogram, 0.005)).toBe(10);
    expect(percentile(histogram, 0.5)).toBe(10);
    expect(percentile(histogram, 0.51)).toBe(200);
    expect(percentile(histogram, 0.995)).toBe(200);
  });
});

describe('planEnhancement', () => {
  it('should leave a well-exposed photo (almost) alone', () => {
    const result = planEnhancement(wellExposed());

    expect(result.corrections.length).toBeLessThanOrEqual(1);
    expect(result.plan.exposure).toBeUndefined();
    expect(result.plan.whiteBalance).toBeUndefined();
    expect(result.plan.localContrast).toBeUndefined();
    expect(result.plan.levels).toBeUndefined();
    expect(result.notes).toContain('Levels: the photo already uses the full tonal range');
  });

  it('should lift a dark photo', () => {
    const result = planEnhancement(dark());

    expect(result.plan.levels!.white).toBeLessThan(200);
    expect(result.plan.exposure!.gamma).toBeGreaterThan(1.2);
    expect(result.adjustments).toEqual(expect.arrayContaining([expect.stringMatching(/^Brighter midtones/)]));
    expect(result.corrections.find(({ type }) => type === 'exposure')!.reason).toMatch(/underexposed/);
  });

  it('should limit the stretch of the levels', () => {
    const { levels } = planEnhancement(dark(), { strength: 'strong' }).plan;
    expect(255 / (levels!.white - levels!.black)).toBeLessThanOrEqual(2.001);
  });

  it('should add local contrast to a flat photo', () => {
    const result = planEnhancement(flat());

    expect(result.plan.localContrast).toEqual({ grid: 8, clipLimit: 2.5, amount: expect.any(Number) });
    expect(result.plan.localContrast!.amount).toBeGreaterThan(0.2);
    expect(result.plan.levels).toBeDefined();
  });

  it('should not add local contrast to a contrasty photo', () => {
    expect(planEnhancement(wellExposed()).plan.localContrast).toBeUndefined();
  });

  it('should correct a blue cast', () => {
    const result = planEnhancement(blueCast());
    const { r, g, b } = result.plan.whiteBalance!;

    expect(b).toBeLessThan(0.95);
    expect(r).toBeGreaterThan(1.03);
    expect(b).toBeLessThan(g);
    expect(result.adjustments).toContainEqual(expect.stringMatching(/^Neutralized a blue color cast/));
  });

  it('should reduce the cast of the corrected neutral tones', () => {
    const s = blueCast();
    const { whiteBalance } = planEnhancement(s, { strength: 'strong' }).plan;
    const before = s.neutralMean.b / s.neutralMean.r;
    const after = (s.neutralMean.b * whiteBalance!.b) / (s.neutralMean.r * whiteBalance!.r);
    expect(Math.abs(after - 1)).toBeLessThan(Math.abs(before - 1) / 2);
  });

  it('should leave the colours of a sunset alone', () => {
    const result = planEnhancement(sunset());

    expect(result.plan.whiteBalance).toBeUndefined();
    expect(result.plan.saturation).toBeUndefined();
    expect(result.plan.localContrast?.amount ?? 0).toBeLessThan(0.25);
    expect(result.notes).toEqual(expect.arrayContaining([expect.stringMatching(/comes from the scene/)]));
  });

  it('should leave a forest alone', () => {
    const forest = stats(scene({ hue: (x, y) => 95 + ((x + y) % 40), saturation: 0.55 }));
    expect(planEnhancement(forest).plan.whiteBalance).toBeUndefined();
  });

  it('should boost muted colours, less with skin', () => {
    const muted = stats(scene({ saturation: 0.2 }));
    const skin = stats(scene({ saturation: 0.35, hue: (x, y) => 18 + ((x + y) % 10), tint: [1, 0.95, 0.9] }));

    const mutedFactor = planEnhancement(muted).plan.saturation!.factor;
    expect(mutedFactor).toBeGreaterThan(1.05);
    expect(mutedFactor).toBeLessThanOrEqual(1.1);
    expect(skin.skinFraction).toBeGreaterThan(0.2);
    expect(planEnhancement(skin).plan.saturation?.factor ?? 1).toBeLessThan(mutedFactor);
  });

  it('should not saturate a black and white photo', () => {
    const result = planEnhancement(stats(scene({ saturation: 0 })));
    expect(result.plan.saturation).toBeUndefined();
    expect(result.plan.whiteBalance).toBeUndefined();
  });

  it('should keep the highlights of a high-key photo', () => {
    const highKey = stats(scene({ value: (t) => 0.3 + 0.62 * t ** 0.4, saturation: 0.2 }));
    const { levels } = planEnhancement(highKey).plan;
    expect(levels!.white).toBeGreaterThanOrEqual(255);
    expect(levels!.black).toBeGreaterThan(10);
  });

  it('should gently darken an overexposed photo', () => {
    const bright = stats(scene({ value: (t) => t ** 0.2, saturation: 0.2 }));
    const { gamma } = planEnhancement(bright).plan.exposure!;
    expect(gamma).toBeLessThan(1);
    expect(gamma).toBeGreaterThanOrEqual(0.87);
  });

  it('should brighten a night scene less', () => {
    const night = stats(
      scene({ value: (t) => (t > 0.8 ? 0.95 : 0.12 * t), saturation: 0.4, hue: () => 220, tint: [1.1, 1, 0.95] }),
    );
    const result = planEnhancement(night);
    expect(result.corrections.find(({ type }) => type === 'exposure')?.reason).toMatch(/night/);
  });

  it('should scale the corrections with the strength', () => {
    const [subtle, normal, strong] = (['subtle', 'normal', 'strong'] as const).map(
      (strength) => planEnhancement(dark(), { strength }).plan,
    );

    expect(subtle.exposure!.gamma).toBeLessThan(normal.exposure!.gamma);
    expect(normal.exposure!.gamma).toBeLessThan(strong.exposure!.gamma);
    expect(subtle.levels!.white).toBeGreaterThan(normal.levels!.white);
    expect(subtle.sharpen!.m2).toBeLessThan(normal.sharpen!.m2);
    expect(normal.sharpen!.m2).toBeLessThan(strong.sharpen!.m2);

    const [subtleCast, strongCast] = (['subtle', 'strong'] as const).map(
      (strength) => planEnhancement(blueCast(), { strength }).plan.whiteBalance!,
    );
    expect(1 - subtleCast.b).toBeLessThan(1 - strongCast.b);
    expect(1 - subtleCast.b).toBeLessThanOrEqual(0.060001);
  });

  it('should scale the sharpening radius with the output size', () => {
    const small = planEnhancement(dark(), { outputSize: 1000 }).plan.sharpen!;
    const large = planEnhancement(dark(), { outputSize: 6000 }).plan.sharpen!;
    expect(small.sigma).toBeLessThan(large.sigma);
    expect(large.sigma).toBe(1.25);
  });

  it('should denoise high-ISO photos', () => {
    expect(types(wellExposed(), { iso: 6400 })).toContain('denoise');
    expect(types(wellExposed(), { iso: 3200, strength: 'subtle' })).not.toContain('denoise');
    expect(types(wellExposed(), { iso: 400 })).not.toContain('denoise');
    // noise in flat areas is not sharpened
    expect(planEnhancement(dark(), { iso: 6400 }).plan.sharpen!.m1).toBe(0);
  });

  it('should only consider the requested corrections', () => {
    const result = planEnhancement(dark(), { only: ['exposure'] });
    expect(Object.keys(result.plan)).toEqual(['exposure']);
    expect(result.corrections).toHaveLength(1);
  });

  it('should list the corrections in the order they are applied', () => {
    const order = ['denoise', 'whiteBalance', 'levels', 'exposure', 'localContrast', 'saturation', 'sharpen'];
    const result = types(stats(scene({ saturation: 0.08, tint: [0.84, 0.97, 1.22], value: (t) => 0.4 * t })), {
      iso: 6400,
    });
    expect(result).toEqual([...result].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  });

  it('should be deterministic', () => {
    for (const s of [wellExposed(), dark(), flat(), blueCast(), sunset()]) {
      expect(planEnhancement(s, { iso: 800 })).toEqual(planEnhancement(s, { iso: 800 }));
    }
  });
});

describe('getLinearCoefficients', () => {
  it('should combine levels and white balance', () => {
    const { a, b } = getLinearCoefficients({
      levels: { black: 51, white: 204 },
      whiteBalance: { r: 1.1, g: 1, b: 0.9 },
    });
    expect(a).toEqual([1.1 * (255 / 153), 255 / 153, 0.9 * (255 / 153)]);
    expect(b).toEqual([-85, -85, -85]);
  });

  it('should be the identity without levels and white balance', () => {
    expect(getLinearCoefficients({})).toEqual({ a: [1, 1, 1], b: [-0, -0, -0] });
  });
});

describe('local contrast', () => {
  it('should equalize a flat luma image', () => {
    const luma = new Uint8Array(64 * 64).map((_, i) => 100 + (i % 64) / 4);
    const { columns, rows, luts } = computeClaheLuts(luma, 64, 64, { grid: 4, clipLimit: 4 });
    expect([columns, rows]).toEqual([4, 4]);
    // the lookup table spreads the narrow range of the first tile
    expect(luts[103] - luts[100]).toBeGreaterThan(3);
  });

  it('should keep the hue while changing the luma', () => {
    const width = 32;
    const height = 32;
    const data = render(width, height, (x) => [120 + x, 80 + x / 2, 60]);
    const luma = new Uint8Array(width * height).map((_, i) =>
      Math.round(0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2]),
    );
    const luts = computeClaheLuts(luma, width, height, { grid: 2, clipLimit: 3 });

    const before = [...data];
    applyLocalContrast(data, width, height, 3, luts, 1);

    expect(data).not.toEqual(before);
    for (let i = 0; i < data.length; i += 3 * 37) {
      if (before[i + 2] > 0) {
        expect(data[i] / data[i + 2]).toBeCloseTo(before[i] / before[i + 2], 1);
      }
    }
  });

  it('should do nothing with an amount of 0', () => {
    const data = render(16, 16, (x, y) => [x * 10, y * 10, 100]);
    const luma = new Uint8Array(256).map((_, i) => data[i * 3]);
    const before = [...data];
    applyLocalContrast(data, 16, 16, 3, computeClaheLuts(luma, 16, 16, { grid: 2, clipLimit: 2 }), 0);
    for (const [i, value] of data.entries()) {
      expect(Math.abs(value - before[i])).toBeLessThanOrEqual(1);
    }
  });
});
