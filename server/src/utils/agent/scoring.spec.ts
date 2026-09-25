import { describe, expect, it } from 'vitest';
import {
  aestheticScore,
  colorfulnessScore,
  compositionScore,
  contrastScore,
  exposureScore,
  faceScore,
  normalizeFaceBox,
  overallScore,
  scorePhoto,
  sharpnessScore,
  vividnessScore,
} from 'src/utils/agent/scoring.js';

const analysis = {
  width: 512,
  height: 384,
  laplacianVariance: 1500,
  meanLuma: 0.5,
  shadowClip: 0,
  highlightClip: 0,
  colorfulness: 70,
  contrast: 0.25,
  saturation: 0.4,
  focusX: 1 / 3,
  focusY: 1 / 3,
};

describe('sharpnessScore', () => {
  it('should be 0 for a flat image', () => {
    expect(sharpnessScore(0)).toBe(0);
  });

  it('should be about 0.5 at a variance of 150', () => {
    expect(sharpnessScore(150)).toBeCloseTo(0.49, 1);
  });

  it('should saturate at 1', () => {
    expect(sharpnessScore(1500)).toBeCloseTo(1);
    expect(sharpnessScore(100_000)).toBe(1);
  });

  it('should be monotonic', () => {
    const values = [0, 10, 50, 100, 300, 800, 1500].map((value) => sharpnessScore(value));
    expect(values).toEqual(values.toSorted((a, b) => a - b));
  });

  it('should ignore negative input', () => {
    expect(sharpnessScore(-5)).toBe(0);
  });
});

describe('exposureScore', () => {
  it('should be 1 for a mid-tone image without clipping', () => {
    expect(exposureScore({ meanLuma: 0.5, shadowClip: 0, highlightClip: 0 })).toBe(1);
  });

  it('should penalize dark and bright images', () => {
    expect(exposureScore({ meanLuma: 0.1, shadowClip: 0, highlightClip: 0 })).toBe(0);
    expect(exposureScore({ meanLuma: 0.3, shadowClip: 0, highlightClip: 0 })).toBeCloseTo(0.75);
    expect(exposureScore({ meanLuma: 0.7, shadowClip: 0, highlightClip: 0 })).toBeCloseTo(0.75);
  });

  it('should penalize clipping', () => {
    expect(exposureScore({ meanLuma: 0.5, shadowClip: 0.1, highlightClip: 0.15 })).toBeCloseTo(0.5);
    expect(exposureScore({ meanLuma: 0.5, shadowClip: 0.3, highlightClip: 0.3 })).toBe(0);
  });
});

describe('faceScore', () => {
  it('should be 0 without faces', () => {
    expect(faceScore([])).toEqual({ faces: 0, faceArea: 0, faceScore: 0 });
  });

  it('should grow with the largest face', () => {
    const small = faceScore([{ x1: 0, y1: 0, x2: 0.1, y2: 0.1 }]);
    const large = faceScore([
      { x1: 0, y1: 0, x2: 0.1, y2: 0.1 },
      { x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.6 },
    ]);
    expect(small.faceScore).toBeGreaterThan(0.5);
    expect(large.faces).toBe(2);
    expect(large.faceArea).toBeCloseTo(0.16);
    expect(large.faceScore).toBe(1);
  });
});

describe('overallScore', () => {
  it('should combine the weights', () => {
    expect(overallScore({ sharpness: 1, exposure: 1, faceScore: 1, aesthetic: 1 })).toBe(1);
    expect(overallScore({ sharpness: 1, exposure: 0, faceScore: 0, aesthetic: 0 })).toBeCloseTo(0.4);
    expect(overallScore({ sharpness: 0, exposure: 1, faceScore: 0, aesthetic: 0 })).toBeCloseTo(0.25);
    expect(overallScore({ sharpness: 0, exposure: 0, faceScore: 0, aesthetic: 1 })).toBeCloseTo(0.25);
    expect(overallScore({ sharpness: 0, exposure: 0, faceScore: 1, aesthetic: 0 })).toBeCloseTo(0.1);
    // a neutral aesthetic score without an image
    expect(overallScore({ sharpness: 0, exposure: 0, faceScore: 0 })).toBeCloseTo(0.125);
  });

  it('should reward favorites and ratings', () => {
    const base = overallScore({ sharpness: 0.5, exposure: 0.5, faceScore: 0 });
    expect(overallScore({ sharpness: 0.5, exposure: 0.5, faceScore: 0, isFavorite: true })).toBeCloseTo(base + 0.1);
    expect(overallScore({ sharpness: 0.5, exposure: 0.5, faceScore: 0, rating: 5 })).toBeCloseTo(base + 0.06);
    expect(overallScore({ sharpness: 0.5, exposure: 0.5, faceScore: 0, rating: 1 })).toBeCloseTo(base - 0.06);
  });

  it('should stay within 0..1', () => {
    expect(overallScore({ sharpness: 1, exposure: 1, faceScore: 1, isFavorite: true, rating: 5 })).toBe(1);
    expect(overallScore({ sharpness: 0, exposure: 0, faceScore: 0, aesthetic: 0, rating: 1 })).toBe(0);
  });
});

describe('aesthetic scores', () => {
  it('should rate colourfulness on the Hasler–Süsstrunk scale', () => {
    expect(colorfulnessScore(0)).toBe(0);
    expect(colorfulnessScore(35)).toBeCloseTo(0.5);
    expect(colorfulnessScore(120)).toBe(1);
  });

  it('should prefer a clear but not harsh contrast', () => {
    expect(contrastScore(0)).toBe(0);
    expect(contrastScore(0.25)).toBe(1);
    expect(contrastScore(0.5)).toBeLessThan(0.6);
  });

  it('should prefer vivid over grey or garish colours', () => {
    expect(vividnessScore(0)).toBe(0);
    expect(vividnessScore(0.4)).toBe(1);
    expect(vividnessScore(0.8)).toBe(0);
    expect(vividnessScore(0.3)).toBeGreaterThan(vividnessScore(0.7));
  });

  it('should reward the detail on a rule-of-thirds point', () => {
    expect(compositionScore(1 / 3, 2 / 3)).toBe(1);
    expect(compositionScore(0.5, 0.5)).toBeCloseTo(0.6);
    expect(compositionScore(0.02, 0.98)).toBe(0);
  });

  it('should prefer the vivid photo over the dull one', () => {
    const vivid = { ...analysis, colorfulness: 62, contrast: 0.24, saturation: 0.42, focusX: 0.35, focusY: 0.6 };
    const dull = { ...analysis, colorfulness: 6, contrast: 0.06, saturation: 0.05, focusX: 0.5, focusY: 0.5 };
    expect(aestheticScore(vivid)).toBeGreaterThan(0.85);
    expect(aestheticScore(dull)).toBeLessThan(0.3);
    expect(scorePhoto(vivid, []).overall).toBeGreaterThan(scorePhoto(dull, []).overall + 0.1);
  });
});

describe('scorePhoto', () => {
  it('should score a good photo', () => {
    expect(scorePhoto(analysis, [])).toEqual({
      sharpness: 1,
      exposure: 1,
      faces: 0,
      faceArea: 0,
      faceScore: 0,
      aesthetic: 1,
      overall: 0.9,
    });
  });

  it('should fall back to neutral technical scores without an image', () => {
    const score = scorePhoto(null, [], { isFavorite: true });
    expect(score.sharpness).toBe(0.5);
    expect(score.exposure).toBe(0.5);
    expect(score.overall).toBe(0.55);
  });
});

describe('normalizeFaceBox', () => {
  it('should normalize and clamp', () => {
    expect(
      normalizeFaceBox({
        boundingBoxX1: 100,
        boundingBoxY1: 50,
        boundingBoxX2: 300,
        boundingBoxY2: 1200,
        imageWidth: 1000,
        imageHeight: 1000,
      }),
    ).toEqual({ x1: 0.1, y1: 0.05, x2: 0.3, y2: 1 });
  });

  it('should not divide by zero', () => {
    expect(
      normalizeFaceBox({
        boundingBoxX1: 0,
        boundingBoxY1: 0,
        boundingBoxX2: 0,
        boundingBoxY2: 0,
        imageWidth: 0,
        imageHeight: 0,
      }),
    ).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });
});
