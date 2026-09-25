import {
  IMPROVE_MIN_GAIN,
  TIGHTEN_MIN_KEEP,
  chooseAspectCrop,
  chooseTighteningCrop,
  describeImprovement,
  getOverallScore,
  getPoolScore,
  getPoolSize,
  getPotentialScore,
  getRecipeKey,
  hasPrintResolution,
  isEmptyRecipe,
  mapFaces,
  toEstimate,
} from 'src/utils/agent/improve.js';
import { ImageAnalysis } from 'src/utils/agent/scoring.js';

const good: ImageAnalysis = {
  width: 512,
  height: 384,
  laplacianVariance: 1500,
  meanLuma: 0.5,
  shadowClip: 0,
  highlightClip: 0,
  colorfulness: 70,
  contrast: 0.22,
  saturation: 0.4,
  focusX: 1 / 3,
  focusY: 1 / 3,
};

/** a sharp photo of a great moment that is dark, flat, muted and loosely framed */
const fixable: ImageAnalysis = {
  ...good,
  meanLuma: 0.2,
  contrast: 0.08,
  saturation: 0.12,
  colorfulness: 40,
  focusX: 0.5,
  focusY: 0.5,
};

const blurry: ImageAnalysis = { ...good, laplacianVariance: 15 };

const size = { width: 4000, height: 3000 };

describe('getPoolScore', () => {
  it('should not penalize fixable weaknesses', () => {
    expect(getOverallScore(fixable, [])).toBeLessThan(getOverallScore(good, []) - 0.1);
    expect(getPoolScore(fixable, [], {}, size)).toBeGreaterThan(getOverallScore(fixable, []) + 0.1);
    expect(getPoolScore(fixable, [], {}, size)).toBeGreaterThan(getPoolScore(good, [], {}, size) - 0.1);
  });

  it('should never score below the photo as it is', () => {
    for (const analysis of [good, fixable, blurry, { ...good, meanLuma: 0.97, highlightClip: 0.4 }]) {
      expect(getPoolScore(analysis, [], {}, size)).toBeGreaterThanOrEqual(getOverallScore(analysis, []) - 1e-9);
    }
  });

  it('should keep penalizing blur', () => {
    expect(getPoolScore(blurry, [], {}, size)).toBeLessThan(getPoolScore(fixable, [], {}, size));
    expect(getPoolScore(blurry, [], {}, size) - getOverallScore(blurry, [])).toBeLessThan(0.01);
  });

  it('should keep penalizing clipping and extreme exposure', () => {
    const black = { ...fixable, meanLuma: 0.04, shadowClip: 0.5 };
    expect(getPoolScore(black, [], {}, size)).toBeLessThan(getPoolScore(fixable, [], {}, size) - 0.2);
  });

  it('should only enlarge small faces when a crop keeps enough pixels', () => {
    const faces = [{ x1: 0.45, y1: 0.3, x2: 0.5, y2: 0.36 }];
    const large = getPoolScore(good, faces, {}, size);
    const small = getPoolScore(good, faces, {}, { width: 1600, height: 1200 });
    expect(large).toBeGreaterThan(small);
    expect(small).toBeCloseTo(getOverallScore(good, faces), 6);
  });

  it('should fall back to the metadata score without an analysis', () => {
    expect(getPoolScore(null, [], { isFavorite: true })).toBe(getOverallScore(null, [], { isFavorite: true }));
  });
});

describe('getPotentialScore', () => {
  it('should not reward sharpening a blurry photo', () => {
    const sharpened = { ...blurry, laplacianVariance: 1500 };
    expect(getPotentialScore(sharpened, blurry, [], {}, { enhance: { strength: 'normal' } })).toBeCloseTo(
      getOverallScore(blurry, []),
      6,
    );
  });

  it('should value straightening a tilt', () => {
    expect(getPotentialScore(good, good, [], {}, { rotate: 3 })).toBeGreaterThan(getOverallScore(good, []));
  });
});

describe('toEstimate', () => {
  it('should keep the potential at or above now', () => {
    expect(toEstimate(0.5, 0.4, { enhance: { strength: 'normal' } })).toEqual({
      now: 0.5,
      potential: 0.5,
      gain: 0,
      recipe: {},
    });
  });

  it('should only keep a recipe that measurably helps', () => {
    expect(toEstimate(0.5, 0.5 + IMPROVE_MIN_GAIN / 2, { rotate: 2 }).recipe).toEqual({});
    expect(toEstimate(0.5, 0.6, {}).recipe).toEqual({});
    expect(toEstimate(0.5, 0.6, { rotate: 2 })).toEqual({ now: 0.5, potential: 0.6, gain: 0.1, recipe: { rotate: 2 } });
  });
});

describe('hasPrintResolution', () => {
  it('should require 150 dpi at the print size', () => {
    const crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
    // 2000×1500 px over 200×150 mm is 254 dpi
    expect(hasPrintResolution(crop, size, { width: 200, height: 150 })).toBe(true);
    // over 400×300 mm it is 127 dpi
    expect(hasPrintResolution(crop, size, { width: 400, height: 300 })).toBe(false);
  });

  it('should require 12×8 inches at 150 dpi without a print size', () => {
    expect(hasPrintResolution({ x: 0, y: 0, width: 1, height: 1 }, { width: 2000, height: 1500 })).toBe(true);
    expect(hasPrintResolution({ x: 0, y: 0, width: 0.8, height: 0.8 }, { width: 2000, height: 1500 })).toBe(false);
    expect(hasPrintResolution({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 0 })).toBe(false);
  });
});

describe('chooseTighteningCrop', () => {
  it('should bring the detail onto a third, keeping the shape and most of the photo', () => {
    const crop = chooseTighteningCrop({ focus: { x: 0.45, y: 0.45 }, faces: [] })!;
    expect(crop).not.toBeNull();
    expect(crop.width).toBeCloseTo(crop.height, 6);
    expect(crop.width * crop.height).toBeGreaterThanOrEqual(TIGHTEN_MIN_KEEP - 1e-3);
  });

  it('should leave a well composed photo alone', () => {
    expect(chooseTighteningCrop({ focus: { x: 1 / 3, y: 1 / 3 }, faces: [] })).toBeNull();
  });

  it('should never cut a face', () => {
    const faces = [{ x1: 0.01, y1: 0.2, x2: 0.2, y2: 0.45 }];
    const crop = chooseTighteningCrop({ focus: { x: 0.45, y: 0.45 }, faces });
    if (crop) {
      expect(crop.x).toBeLessThanOrEqual(0.01);
    }
  });

  it('should be deterministic', () => {
    const input = { focus: { x: 0.55, y: 0.62 }, faces: [] };
    expect(chooseTighteningCrop(input)).toEqual(chooseTighteningCrop(input));
  });
});

describe('chooseAspectCrop', () => {
  it('should crop to the aspect ratio around the faces', () => {
    const crop = chooseAspectCrop({
      size,
      aspectRatio: '1:1',
      focus: { x: 0.5, y: 0.5 },
      faces: [{ x1: 0.6, y1: 0.3, x2: 0.7, y2: 0.45 }],
    })!;
    expect((crop.width * size.width) / (crop.height * size.height)).toBeCloseTo(1, 2);
    expect(crop.x).toBeLessThanOrEqual(0.6);
    expect(crop.x + crop.width).toBeGreaterThanOrEqual(0.7);
  });

  it('should not crop to the shape the photo already has, or lose too much', () => {
    expect(chooseAspectCrop({ size, aspectRatio: '4:3', focus: { x: 0.5, y: 0.5 }, faces: [] })).toBeNull();
    expect(chooseAspectCrop({ size, aspectRatio: '1:3', focus: { x: 0.5, y: 0.5 }, faces: [] })).toBeNull();
  });
});

describe('mapFaces', () => {
  it('should map faces into the crop and drop the ones outside', () => {
    const faces = [
      { x1: 0.5, y1: 0.5, x2: 0.6, y2: 0.6 },
      { x1: 0, y1: 0, x2: 0.05, y2: 0.05 },
    ];
    const mapped = mapFaces(faces, { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }, size);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].x1).toBeCloseTo(0.5, 6);
    expect(mapped[0].x2).toBeCloseTo(0.7, 6);
  });

  it('should follow the straightening', () => {
    const [face] = mapFaces([{ x1: 0.45, y1: 0.45, x2: 0.55, y2: 0.55 }], { rotate: 3 }, size);
    expect((face.x1 + face.x2) / 2).toBeCloseTo(0.5, 2);
    expect(face.x2 - face.x1).toBeGreaterThan(0.1);
  });
});

describe('recipes', () => {
  it('should have stable keys', () => {
    const recipe = {
      rotate: 2.5,
      crop: { x: 0.1, y: 0, width: 0.9, height: 0.9 },
      enhance: { strength: 'normal' } as const,
    };
    expect(getRecipeKey(recipe)).toBe(getRecipeKey({ ...recipe }));
    expect(getRecipeKey(recipe)).not.toBe(getRecipeKey({ ...recipe, rotate: 2.6 }));
    expect(getRecipeKey({})).toBe('');
    expect(isEmptyRecipe({})).toBe(true);
    expect(isEmptyRecipe({ rotate: 1 })).toBe(false);
  });

  it('should size the pool', () => {
    expect(getPoolSize(20, 1000)).toBe(50);
    expect(getPoolSize(20, 30)).toBe(30);
    expect(getPoolSize(200, 1000)).toBe(300);
    expect(getPoolSize(400, 1000)).toBe(400);
  });

  it('should describe the improvement', () => {
    expect(
      describeImprovement('IMG_0001.jpg', { rotate: -2.43, cropped: true, corrections: ['levels', 'whiteBalance'] }),
    ).toBe('Improved from IMG_0001.jpg: straightened 2.4°, cropped, auto-enhanced (levels, white balance)');
  });
});
