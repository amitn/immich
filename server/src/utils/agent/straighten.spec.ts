import {
  boxToStraightened,
  estimateTilt,
  getRotatedCanvasSize,
  getStraightenedFrame,
  getStraightenedSize,
  getStraightenScale,
  toCanvasRect,
  toStraightened,
} from 'src/utils/agent/straighten.js';

/** inverse of toStraightened */
const toOriginal = (point: { x: number; y: number }, width: number, height: number, angle: number) => {
  const radians = (angle * Math.PI) / 180;
  const size = getStraightenedSize(width, height, angle);
  const dx = point.x - size.width / 2;
  const dy = point.y - size.height / 2;
  return {
    x: dx * Math.cos(radians) + dy * Math.sin(radians) + width / 2,
    y: -dx * Math.sin(radians) + dy * Math.cos(radians) + height / 2,
  };
};

/** an anti-aliased gray image split by a straight line through the center at `lineAngle` degrees (y down) */
const horizon = (width: number, height: number, lineAngle: number, { vertical = false, noise = 0 } = {}) => {
  const data = new Uint8Array(width * height);
  const radians = (lineAngle * Math.PI) / 180;
  let seed = 7;
  const random = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      // signed distance to the line, smoothed over about a pixel like a downscaled photo
      const distance = vertical
        ? dx * Math.cos(radians) + dy * Math.sin(radians)
        : dy * Math.cos(radians) - dx * Math.sin(radians);
      const light = 1 / (1 + Math.exp(distance / 0.7));
      const value = 60 + 140 * light + (random() - 0.5) * noise;
      data[y * width + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return { data, width, height };
};

describe('straighten geometry', () => {
  it('should not change anything without rotation', () => {
    expect(getStraightenScale(4000, 3000, 0)).toBe(1);
    expect(getStraightenedFrame({ width: 4000, height: 3000 }, { width: 4000, height: 3000 }, 0)).toEqual({
      x: 0,
      y: 0,
      width: 4000,
      height: 3000,
    });
    expect(toStraightened({ x: 10, y: 20 }, 4000, 3000, 0)).toEqual({ x: 10, y: 20 });
  });

  it('should keep the aspect ratio and shrink more for larger angles', () => {
    const small = getStraightenedSize(4000, 3000, 2);
    const large = getStraightenedSize(4000, 3000, 10);
    expect(small.width / small.height).toBeCloseTo(4 / 3, 6);
    expect(large.width).toBeLessThan(small.width);
    expect(getStraightenScale(4000, 3000, -5)).toBeCloseTo(getStraightenScale(4000, 3000, 5), 10);
  });

  it('should fit a square rotated by 45° into 1/√2 of its size', () => {
    expect(getStraightenScale(1000, 1000, 45)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('should size the rotated canvas like sharp', () => {
    const canvas = getRotatedCanvasSize(4000, 3000, 90);
    expect(canvas.width).toBeCloseTo(3000, 6);
    expect(canvas.height).toBeCloseTo(4000, 6);
  });

  it('should keep every corner of the straightened photo inside the original', () => {
    for (const [width, height] of [
      [4000, 3000],
      [3000, 4000],
      [6000, 1500],
      [1000, 1000],
    ]) {
      for (const angle of [-20, -7.5, -1, 0.3, 3, 12, 20]) {
        const size = getStraightenedSize(width, height, angle);
        for (const corner of [
          { x: 0, y: 0 },
          { x: size.width, y: 0 },
          { x: 0, y: size.height },
          { x: size.width, y: size.height },
        ]) {
          const original = toOriginal(corner, width, height, angle);
          expect(original.x).toBeGreaterThanOrEqual(-1e-6);
          expect(original.y).toBeGreaterThanOrEqual(-1e-6);
          expect(original.x).toBeLessThanOrEqual(width + 1e-6);
          expect(original.y).toBeLessThanOrEqual(height + 1e-6);
        }
      }
    }
  });

  it('should map the center to the center', () => {
    const size = getStraightenedSize(4000, 3000, 8);
    const center = toStraightened({ x: 2000, y: 1500 }, 4000, 3000, 8);
    expect(center.x).toBeCloseTo(size.width / 2, 6);
    expect(center.y).toBeCloseTo(size.height / 2, 6);
  });

  it('should turn the picture clockwise for positive angles', () => {
    // a point right of the center moves down
    const point = toStraightened({ x: 3000, y: 1500 }, 4000, 3000, 10);
    const size = getStraightenedSize(4000, 3000, 10);
    expect(point.y).toBeGreaterThan(size.height / 2);
  });

  it('should map face boxes and drop the ones that are cut away', () => {
    const face = boxToStraightened({ x1: 1900, y1: 1400, x2: 2100, y2: 1600 }, 4000, 3000, 5);
    expect(face).not.toBeNull();
    expect(face!.x2 - face!.x1).toBeGreaterThan(200);
    expect(boxToStraightened({ x1: 0, y1: 0, x2: 20, y2: 20 }, 4000, 3000, 15)).toBeNull();
  });

  it('should place crops of the straightened photo in the rotated canvas', () => {
    const source = { width: 4000, height: 3000 };
    const canvas = getRotatedCanvasSize(4000, 3000, 4);
    const frame = getStraightenedFrame(canvas, source, 4);
    expect(toCanvasRect(null, canvas, source, 4)).toEqual(frame);
    expect(toCanvasRect({ x: 10, y: 20, width: 100, height: 50 }, canvas, source, 4)).toEqual({
      x: frame.x + 10,
      y: frame.y + 20,
      width: 100,
      height: 50,
    });
  });
});

describe('estimateTilt', () => {
  it.each([-6, -3, -1.5, 2, 4.5])('should find the correction for a horizon tilted by %s°', (lineAngle) => {
    const tilt = estimateTilt(horizon(512, 384, lineAngle, { noise: 20 }));
    expect(tilt.angle).toBeCloseTo(-lineAngle, 0);
    expect(Math.abs(tilt.angle + lineAngle)).toBeLessThan(0.5);
    expect(tilt.recommended).toBe(true);
  });

  it('should find tilted vertical lines', () => {
    const tilt = estimateTilt(horizon(384, 512, 3, { vertical: true, noise: 20 }));
    expect(Math.abs(Math.abs(tilt.angle) - 3)).toBeLessThan(0.5);
    expect(tilt.recommended).toBe(true);
  });

  it('should not recommend straightening a level photo', () => {
    const tilt = estimateTilt(horizon(512, 384, 0, { noise: 20 }));
    expect(Math.abs(tilt.angle)).toBeLessThan(0.3);
    expect(tilt.recommended).toBe(false);
  });

  it('should not be confident without lines', () => {
    let seed = 3;
    const data = new Uint8Array(512 * 384).map(() => {
      seed = (seed * 16_807) % 2_147_483_647;
      return seed % 256;
    });
    const tilt = estimateTilt({ data, width: 512, height: 384 });
    expect(tilt.recommended).toBe(false);
    expect(tilt.confidence).toBeLessThan(0.3);
  });

  it('should ignore flat images', () => {
    expect(estimateTilt({ data: new Uint8Array(100 * 100).fill(128), width: 100, height: 100 })).toEqual({
      angle: 0,
      confidence: 0,
      recommended: false,
    });
  });
});
