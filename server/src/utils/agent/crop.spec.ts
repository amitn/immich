import { CropBox, CropRect, normalizeRect, parseAspectRatio, scaleBox, suggestCrop } from 'src/utils/agent/crop.js';

const face = (x1: number, y1: number, x2: number, y2: number, direction?: number) => ({ x1, y1, x2, y2, direction });
const lookingFace = (direction?: number) => [face(1800, 800, 2400, 1500, direction)];

const containsBox = (rect: CropRect, box: CropBox) =>
  rect.x <= box.x1 && rect.y <= box.y1 && rect.x + rect.width >= box.x2 && rect.y + rect.height >= box.y2;

const cutsBox = (rect: CropRect, box: CropBox) => {
  const overlapX = Math.min(rect.x + rect.width, box.x2) - Math.max(rect.x, box.x1);
  const overlapY = Math.min(rect.y + rect.height, box.y2) - Math.max(rect.y, box.y1);
  return overlapX > 1 && overlapY > 1 && !containsBox(rect, box);
};

const expectInBounds = (rect: CropRect, width: number, height: number) => {
  for (const value of Object.values(rect)) {
    expect(Number.isSafeInteger(value)).toBe(true);
  }
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(width);
  expect(rect.y + rect.height).toBeLessThanOrEqual(height);
};

describe('parseAspectRatio', () => {
  it.each([
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['16:9', 16 / 9],
    ['2:3', 2 / 3],
    ['2/3', 2 / 3],
    ['16x9', 16 / 9],
    [' 4 : 5 ', 4 / 5],
    ['1.5', 1.5],
    [1.5, 1.5],
  ])('should parse %s', (value, expected) => {
    expect(parseAspectRatio(value)).toBeCloseTo(expected);
  });

  it.each(['abc', '0:1', '1:0', '', '100:1', 0, -1, NaN])('should reject %s', (value) => {
    expect(() => parseAspectRatio(value)).toThrow('Invalid aspect ratio');
  });
});

describe('scaleBox', () => {
  it('should scale from the preview into the original dimensions', () => {
    expect(
      scaleBox(
        { x1: 100, y1: 50, x2: 200, y2: 150, id: 'a' },
        { width: 1000, height: 750 },
        { width: 4000, height: 3000 },
      ),
    ).toEqual({ x1: 400, y1: 200, x2: 800, y2: 600, id: 'a' });
  });

  it('should not scale without source dimensions', () => {
    expect(scaleBox({ x1: 1, y1: 2, x2: 3, y2: 4 }, { width: 0, height: 0 }, { width: 10, height: 10 })).toEqual({
      x1: 1,
      y1: 2,
      x2: 3,
      y2: 4,
    });
  });
});

describe('normalizeRect', () => {
  it('should normalize to 0..1', () => {
    expect(normalizeRect({ x: 1000, y: 0, width: 2000, height: 3000 }, 4000, 3000)).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });
});

describe('suggestCrop', () => {
  it('should reject missing dimensions', () => {
    expect(() => suggestCrop({ width: 0, height: 100, aspectRatio: '1:1' })).toThrow();
  });

  it('should return the whole image when it already has the aspect ratio', () => {
    const result = suggestCrop({ width: 4000, height: 3000, aspectRatio: '4:3', faces: [face(10, 10, 100, 100)] });
    expect(result).toMatchObject({
      feasible: true,
      rect: { x: 0, y: 0, width: 4000, height: 3000 },
      includedFaces: [0],
      droppedFaces: [],
    });
  });

  describe('without faces', () => {
    it('should centre on the image', () => {
      const result = suggestCrop({ width: 4000, height: 3000, aspectRatio: '1:1' });
      expect(result).toMatchObject({
        feasible: true,
        rect: { x: 500, y: 0, width: 3000, height: 3000 },
        includedFaces: [],
        droppedFaces: [],
      });
      expect(result.reason).toContain('centred on the image');
    });

    it('should centre on the saliency point', () => {
      const result = suggestCrop({ width: 3000, height: 4000, aspectRatio: '16:9', saliency: { x: 1500, y: 1200 } });
      expect(result.rect).toEqual({ x: 0, y: 356, width: 3000, height: 1688 });
      expect(result.reason).toContain('salient');
    });

    it('should clamp a saliency point near the edge', () => {
      const result = suggestCrop({ width: 4000, height: 3000, aspectRatio: '1:1', saliency: { x: 3900, y: 100 } });
      expect(result.rect).toEqual({ x: 1000, y: 0, width: 3000, height: 3000 });
    });
  });

  describe('a single face', () => {
    it('should centre the face horizontally in a landscape image', () => {
      const result = suggestCrop({
        width: 4000,
        height: 3000,
        aspectRatio: '1:1',
        faces: [face(1800, 800, 2400, 1500)],
      });
      expect(result).toMatchObject({ feasible: true, includedFaces: [0], droppedFaces: [] });
      expect(result.rect).toEqual({ x: 600, y: 0, width: 3000, height: 3000 });
    });

    it('should put the eye line on the upper third in a portrait image', () => {
      const result = suggestCrop({
        width: 3000,
        height: 4000,
        aspectRatio: '1:1',
        faces: [face(1100, 800, 1900, 1600)],
      });
      expect(result.feasible).toBe(true);
      expect(result.rect).toEqual({ x: 0, y: 120, width: 3000, height: 3000 });
      const eyeLine = 800 + 0.4 * 800;
      expect((eyeLine - result.rect.y) / result.rect.height).toBeCloseTo(1 / 3, 2);
    });

    it('should keep headroom above a large face', () => {
      // the eye line on the third would leave less than 0.6x the face height above the head
      const result = suggestCrop({
        width: 3000,
        height: 5000,
        aspectRatio: '1:1',
        faces: [face(900, 2000, 2000, 3100)],
      });
      expect(result.feasible).toBe(true);
      expect(result.rect.y).toBe(2000 - 0.6 * 1100);
    });

    it('should share the margins when there is not enough room', () => {
      const result = suggestCrop({
        width: 3000,
        height: 4000,
        aspectRatio: '3:2',
        faces: [face(1000, 1000, 2000, 2800)],
      });
      expect(result.feasible).toBe(true);
      expect(result.rect.height).toBe(2000);
      expect(containsBox(result.rect, face(1000, 1000, 2000, 2800))).toBe(true);
      // 200px of slack, shared 0.6:1.0 between head and body room
      expect(result.rect.y).toBe(925);
    });

    it('should handle a face on the top edge', () => {
      const result = suggestCrop({ width: 3000, height: 4000, aspectRatio: '1:1', faces: [face(1000, 0, 1600, 600)] });
      expect(result).toMatchObject({ feasible: true, rect: { x: 0, y: 0, width: 3000, height: 3000 } });
    });

    it('should handle a face on the right edge', () => {
      const result = suggestCrop({
        width: 4000,
        height: 3000,
        aspectRatio: '1:1',
        faces: [face(3600, 1000, 4000, 1500)],
      });
      expect(result).toMatchObject({ feasible: true, rect: { x: 1000, y: 0, width: 3000, height: 3000 } });
    });

    it('should handle a face on the left edge', () => {
      const result = suggestCrop({ width: 4000, height: 3000, aspectRatio: '4:5', faces: [face(0, 1000, 300, 1400)] });
      expect(result).toMatchObject({ feasible: true, rect: { x: 0, y: 0, width: 2400, height: 3000 } });
    });

    it('should clamp face boxes that extend past the image', () => {
      const result = suggestCrop({
        width: 4000,
        height: 3000,
        aspectRatio: '1:1',
        faces: [face(3600, -50, 4100, 500)],
      });
      expect(result.feasible).toBe(true);
      expectInBounds(result.rect, 4000, 3000);
      expect(result.rect.x).toBe(1000);
    });

    it('should leave lead room towards where the face looks', () => {
      const neutral = suggestCrop({ width: 5000, height: 3000, aspectRatio: '1:1', faces: lookingFace() });
      const right = suggestCrop({ width: 5000, height: 3000, aspectRatio: '1:1', faces: lookingFace(1) });
      const left = suggestCrop({ width: 5000, height: 3000, aspectRatio: '1:1', faces: lookingFace(-1) });
      expect(right.rect.x).toBeGreaterThan(neutral.rect.x);
      expect(left.rect.x).toBeLessThan(neutral.rect.x);
      expect(right.rect.x - neutral.rect.x).toBe(300);
      for (const result of [neutral, left, right]) {
        expect(containsBox(result.rect, lookingFace()[0])).toBe(true);
      }
    });

    it('should report a face that is larger than the crop as not feasible', () => {
      const result = suggestCrop({ width: 4000, height: 3000, aspectRatio: '1:3', faces: [face(500, 0, 3500, 3000)] });
      expect(result.feasible).toBe(false);
      expect(result.reason).toContain('main face does not fit');
      expect(result.includedFaces).toEqual([]);
      expect(result.droppedFaces).toEqual([0]);
      expectInBounds(result.rect, 4000, 3000);
      expect(result.rect).toEqual({ x: 1500, y: 0, width: 1000, height: 3000 });
    });
  });

  describe('a group', () => {
    const group = [face(1500, 1000, 1900, 1500), face(2500, 900, 2900, 1400), face(3500, 1100, 3900, 1600)];

    it('should keep every face', () => {
      const result = suggestCrop({ width: 6000, height: 4000, aspectRatio: '1:1', faces: group });
      expect(result).toMatchObject({ feasible: true, includedFaces: [0, 1, 2], droppedFaces: [] });
      expect(result.reason).toBe('All 3 faces fit');
      expect(result.rect).toEqual({ x: 700, y: 0, width: 4000, height: 4000 });
    });

    it('should place a group on the upper third in a tall crop', () => {
      const result = suggestCrop({
        width: 3000,
        height: 6000,
        aspectRatio: '4:5',
        faces: [face(500, 2000, 900, 2500), face(1500, 2100, 1900, 2600), face(2100, 1900, 2500, 2400)],
      });
      expect(result.feasible).toBe(true);
      expect(result.rect.height).toBe(3750);
      for (const box of [face(500, 2000, 900, 2500), face(1500, 2100, 1900, 2600), face(2100, 1900, 2500, 2400)]) {
        expect(containsBox(result.rect, box)).toBe(true);
      }
      const eyeLine = 2000 + 0.4 * 500 + 100 / 3;
      expect(Math.abs((eyeLine - result.rect.y) / result.rect.height - 1 / 3)).toBeLessThan(0.02);
    });

    it('should drop the least important faces in a panorama', () => {
      const faces = [face(1000, 800, 1400, 1250), face(5800, 700, 6300, 1300), face(7000, 800, 7400, 1250)];
      const result = suggestCrop({ width: 12_000, height: 2000, aspectRatio: '1:1', faces });
      expect(result).toMatchObject({ feasible: true, includedFaces: [1, 2], droppedFaces: [0] });
      expect(result.reason).toContain('Kept 2 of 3 faces');
      expect(containsBox(result.rect, faces[1])).toBe(true);
      expect(containsBox(result.rect, faces[2])).toBe(true);
      expect(cutsBox(result.rect, faces[0])).toBe(false);
    });

    it('should not cut through a face that is dropped', () => {
      const faces = [face(1000, 1000, 1600, 1700), face(1700, 1000, 2300, 1700), face(2400, 1000, 3000, 1700)];
      const result = suggestCrop({ width: 4000, height: 3000, aspectRatio: '9:16', faces });
      expect(result.feasible).toBe(true);
      expect(result.includedFaces).toHaveLength(2);
      expect(result.includedFaces).toContain(1);
      for (const box of faces) {
        expect(cutsBox(result.rect, box)).toBe(false);
      }
    });

    it('should prefer the larger face when faces are far apart', () => {
      const faces = [face(200, 1000, 500, 1300), face(3200, 800, 3800, 1500)];
      const result = suggestCrop({ width: 4000, height: 3000, aspectRatio: '2:3', faces });
      expect(result).toMatchObject({ feasible: true, includedFaces: [1], droppedFaces: [0] });
      expect(containsBox(result.rect, faces[1])).toBe(true);
      expect(cutsBox(result.rect, faces[0])).toBe(false);
    });

    it('should allow cutting small background faces', () => {
      const main = face(1300, 800, 2600, 2100);
      const background = face(2650, 1000, 2900, 1300);
      const result = suggestCrop({ width: 4000, height: 3000, aspectRatio: '1:2', faces: [main, background] });
      expect(result).toMatchObject({ feasible: true, includedFaces: [0], droppedFaces: [1] });
      expect(result.rect.x).toBe(1200);
      expect(containsBox(result.rect, main)).toBe(true);
      expect(cutsBox(result.rect, background)).toBe(true);
    });

    it('should report a crop that must cut a face as not feasible', () => {
      const faces = [0, 1, 2, 3, 4, 5].map((i) => face(100 + i * 600, 1000, 700 + i * 600, 1700));
      const result = suggestCrop({ width: 4000, height: 3000, aspectRatio: '1:2', faces });
      expect(result.feasible).toBe(false);
      expect(result.reason).toContain('cuts through another face');
      expectInBounds(result.rect, 4000, 3000);
    });
  });

  it('should always return an in-bounds crop that respects its own report', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647;
      return seed / 2_147_483_647;
    };

    for (let i = 0; i < 500; i++) {
      const width = Math.round(500 + random() * 8000);
      const height = Math.round(500 + random() * 8000);
      const aspectRatio = ['1:1', '4:3', '3:4', '16:9', '2:3', '3:1'][Math.floor(random() * 6)];
      const faces = Array.from({ length: Math.floor(random() * 6) }, () => {
        const size = (0.05 + random() * 0.25) * Math.min(width, height);
        const x1 = random() * (width - size);
        const y1 = random() * (height - size);
        return face(x1, y1, x1 + size, y1 + size * 1.2);
      });

      const result = suggestCrop({ width, height, aspectRatio, faces });
      expectInBounds(result.rect, width, height);
      expect(result.rect.width / result.rect.height).toBeCloseTo(parseAspectRatio(aspectRatio), 1);
      expect([...result.includedFaces, ...result.droppedFaces].sort((a, b) => a - b)).toEqual(faces.map((_, i) => i));

      if (!result.feasible) {
        continue;
      }

      const loose = {
        x: result.rect.x - 1,
        y: result.rect.y - 1,
        width: result.rect.width + 2,
        height: result.rect.height + 2,
      };
      const clamped = faces.map((box) => ({ ...box, y2: Math.min(box.y2, height) }));
      const tallest = Math.max(...clamped.map((box) => box.y2 - box.y1));
      for (const index of result.includedFaces) {
        expect(containsBox(loose, clamped[index])).toBe(true);
      }
      for (const index of result.droppedFaces) {
        if (clamped[index].y2 - clamped[index].y1 >= tallest) {
          expect(cutsBox(result.rect, clamped[index])).toBe(false);
        }
      }
    }
  });
});
