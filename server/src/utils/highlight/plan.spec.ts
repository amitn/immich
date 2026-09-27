import { NormalizedRect, bookStylePresets, defaultBookStyle } from 'src/dtos/book.dto.js';
import { AutoLayoutPhoto } from 'src/utils/book/auto-layout.js';
import {
  HIGHLIGHT_ASPECT,
  HIGHLIGHT_FADE,
  HighlightPhoto,
  HighlightPhotoShot,
  HighlightPlan,
  HighlightRect,
  HighlightVideo,
  allocateShots,
  fitDurations,
  getClipStart,
  getContainBox,
  getHighlightFrame,
  getHighlightLength,
  getLocationSpreadKm,
  getPanRects,
  getPhotoFraming,
  getSafeArea,
  planHighlight,
} from 'src/utils/highlight/plan.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const start = Date.UTC(2024, 5, 12, 9);
const style = { ...defaultBookStyle };

let counter = 0;
const photo = (dto: Partial<HighlightPhoto> = {}): HighlightPhoto => {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    width: 4000,
    height: 3000,
    takenAt: start + counter * 60_000,
    score: 0.5,
    faces: [],
    isFavorite: false,
    ...dto,
  };
};

const video = (dto: Partial<HighlightVideo> = {}): HighlightVideo => {
  counter++;
  return {
    id: `00000000-0000-4000-9000-${String(counter).padStart(12, '0')}`,
    width: 1920,
    height: 1080,
    takenAt: start + counter * 60_000,
    isFavorite: false,
    duration: 12,
    ...dto,
  };
};

/** photos of one event, five minutes apart */
const event = (count: number, at: number, dto: (i: number) => Partial<AutoLayoutPhoto> = () => ({})) =>
  Array.from({ length: count }, (_, i) => photo({ takenAt: at + i * 5 * 60_000, ...dto(i) }));

/** a day in each of three towns, walking a couple of kilometres around each */
const walk = (i: number) => (i % 6) * 0.004;
const trip = () => [
  ...event(30, start, (i) => ({ lat: 37.85 + walk(i), lon: 15.28, city: 'Taormina', score: 0.3 + (i % 5) * 0.1 })),
  ...event(30, start + DAY, (i) => ({
    lat: 37.5 + walk(i),
    lon: 15.09,
    city: 'Catania',
    score: 0.3 + (i % 4) * 0.1,
  })),
  ...event(30, start + 2 * DAY, (i) => ({
    lat: 38.11 + walk(i),
    lon: 13.36,
    city: 'Palermo',
    score: 0.3 + (i % 3) * 0.1,
  })),
];

const artwork = (place: string, entry: string) => ({
  collection: { pack: 'museum', place, kind: 'entry' as const, entry },
});

/** three museums a few years apart; only the last has GPS (all in one building) */
const museums = () => [
  ...event(12, Date.UTC(2018, 6, 25, 10), (i) => artwork('Musée des Beaux-Arts, Agen', `Painting ${i}`)),
  ...event(12, Date.UTC(2022, 8, 27, 10), (i) => artwork('Indian Museum, Kolkata', `Sculpture ${i}`)),
  ...event(12, Date.UTC(2025, 7, 28, 10), (i) => ({
    ...artwork('Museu de Évora', `Panel ${i}`),
    lat: 38.5725 + (i % 3) * 0.0001,
    lon: -7.9072,
    city: 'Évora',
  })),
];

const food = (entry: string) => ({
  collection: { pack: 'food', place: 'Trattoria da Nino', kind: 'entry' as const, entry },
  city: 'Taormina',
});

const leg = (entry: string) => ({
  collection: { pack: 'travel', place: 'Crete, October 2016', kind: 'entry' as const, entry },
});

const plan = (photos: HighlightPhoto[], videos: HighlightVideo[] = [], options = {}) =>
  planHighlight(photos, videos, { title: 'Sicily', style, durationSeconds: 60, ...options });

const photoShots = (result: HighlightPlan) =>
  result.shots.filter((shot): shot is HighlightPhotoShot => shot.kind === 'photo');

const VERTICAL_ASPECT = 9 / 16;

/** a face (in photo coordinates) in the still of a shot (see `getPanRects`) */
const toStill = (
  face: NormalizedRect,
  shot: Pick<HighlightPhotoShot, 'frame' | 'crop'>,
  aspect: number,
  frameAspect = HIGHLIGHT_ASPECT,
) => {
  if (shot.frame === 'contain') {
    const box = getContainBox({ width: aspect * 1000, height: 1000 }, frameAspect);
    return {
      x: box.x + face.x * box.width,
      y: box.y + face.y * box.height,
      width: face.width * box.width,
      height: face.height * box.height,
    };
  }
  return {
    x: (face.x - shot.crop.x) / shot.crop.width,
    y: (face.y - shot.crop.y) / shot.crop.height,
    width: face.width / shot.crop.width,
    height: face.height / shot.crop.height,
  };
};

const contains = (rect: HighlightRect, face: NormalizedRect) =>
  face.x >= rect.x - 1e-3 &&
  face.y >= rect.y - 1e-3 &&
  face.x + face.width <= rect.x + rect.size + 1e-3 &&
  face.y + face.height <= rect.y + rect.size + 1e-3;

const inside = (rect: HighlightRect) =>
  rect.x >= 0 && rect.y >= 0 && rect.size > 0 && rect.x + rect.size <= 1 + 1e-9 && rect.y + rect.size <= 1 + 1e-9;

beforeEach(() => {
  counter = 0;
});

describe('fitDurations', () => {
  it('should split the total in proportion to the weights', () => {
    const result = fitDurations([1, 1, 2], 16, 1, 10);
    expect(result).toEqual([4, 4, 8]);
  });

  it('should keep every duration within the limits and still add up', () => {
    const result = fitDurations([1, 1, 10], 12, 2.5, 6);
    expect(result.every((value) => value >= 2.5 && value <= 6)).toBe(true);
    expect(result.reduce((sum, value) => sum + value, 0)).toBeCloseTo(12);
  });

  it('should stop at the maximum when the total is out of reach', () => {
    expect(fitDurations([1, 1], 100, 1, 6)).toEqual([6, 6]);
  });
});

describe('allocateShots', () => {
  it('should give every group a shot, then share in proportion', () => {
    expect(allocateShots([10, 2, 4], 8)).toEqual([5, 1, 2]);
  });

  it('should never give a group more than it has', () => {
    expect(allocateShots([1, 2], 10)).toEqual([1, 2]);
  });

  it('should favour the largest groups when there are fewer shots than groups', () => {
    expect(allocateShots([2, 8, 3], 2)).toEqual([0, 1, 1]);
  });
});

describe('getClipStart', () => {
  it('should start at the best part when it was measured', () => {
    expect(getClipStart({ duration: 20, bestStart: 7 }, 4)).toBe(7);
  });

  it('should keep the clip inside the video', () => {
    expect(getClipStart({ duration: 10, bestStart: 9 }, 4)).toBe(6);
  });

  it('should skip the shaky start of an unmeasured video', () => {
    expect(getClipStart({ duration: 20 }, 4)).toBe(5);
    expect(getClipStart({ duration: 3 }, 4)).toBe(0);
  });
});

describe('getPanRects', () => {
  const crop = { x: 0, y: 0.0417, width: 1, height: 0.9167 };

  it('should zoom towards the faces and keep them in the frame', () => {
    const faces = [{ x: 0.7, y: 0.3, width: 0.08, height: 0.1 }];
    const { from, to } = getPanRects({ width: 4000, height: 3000, faces, crop, duration: 4 }, 'cover', 0);
    expect(from).toEqual({ x: 0, y: 0, size: 1 });
    expect(to.size).toBeLessThan(1);
    const face = toStill(faces[0], { frame: 'cover', crop }, 4 / 3);
    expect(contains(to, face)).toBe(true);
    expect(to.x + to.size / 2).toBeGreaterThan(0.5);
  });

  it('should zoom out from the faces on odd shots', () => {
    const faces = [{ x: 0.2, y: 0.3, width: 0.08, height: 0.1 }];
    const { from, to } = getPanRects({ width: 4000, height: 3000, faces, crop, duration: 4 }, 'cover', 1);
    expect(to).toEqual({ x: 0, y: 0, size: 1 });
    expect(contains(from, toStill(faces[0], { frame: 'cover', crop }, 4 / 3))).toBe(true);
  });

  it('should widen the tight frame to keep faces far apart', () => {
    const faces = [
      { x: 0.02, y: 0.3, width: 0.1, height: 0.12 },
      { x: 0.86, y: 0.35, width: 0.1, height: 0.12 },
    ];
    const { to } = getPanRects({ width: 4000, height: 3000, faces, crop, duration: 5 }, 'cover', 0);
    for (const face of faces) {
      expect(contains(to, toStill(face, { frame: 'cover', crop }, 4 / 3))).toBe(true);
    }
  });

  it('should move towards the focus point of a photo without faces', () => {
    const { to } = getPanRects(
      { width: 4000, height: 3000, faces: [], focus: { x: 0.2, y: 0.5 }, crop, duration: 4 },
      'cover',
      0,
    );
    expect(to.x + to.size / 2).toBeLessThan(0.5);
  });

  it('should pan across a photo without a subject', () => {
    const { from, to } = getPanRects({ width: 4000, height: 3000, faces: [], crop, duration: 4 }, 'cover', 0);
    expect(from.size).toBe(to.size);
    expect(to.x).toBeGreaterThan(from.x);
  });

  it('should keep the faces of a portrait shown whole', () => {
    const faces = [{ x: 0.4, y: 0.1, width: 0.2, height: 0.12 }];
    const { from, to } = getPanRects(
      { width: 3000, height: 4000, faces, crop: { x: 0, y: 0, width: 1, height: 1 }, duration: 4 },
      'contain',
      0,
    );
    const face = toStill(faces[0], { frame: 'contain', crop: { x: 0, y: 0, width: 1, height: 1 } }, 3 / 4);
    expect(contains(from, face)).toBe(true);
    expect(contains(to, face)).toBe(true);
  });
});

describe('getHighlightFrame', () => {
  it('should be 1920×1080 in landscape and 1080×1920 in vertical', () => {
    expect(getHighlightFrame()).toEqual({ width: 1920, height: 1080 });
    expect(getHighlightFrame('landscape')).toEqual({ width: 1920, height: 1080 });
    expect(getHighlightFrame('vertical')).toEqual({ width: 1080, height: 1920 });
  });

  it('should keep the top and bottom of a vertical frame free for the apps of phones', () => {
    expect(getSafeArea({ width: 1920, height: 1080 })).toEqual({ top: 0, bottom: 0 });
    expect(getSafeArea({ width: 1080, height: 1920 })).toEqual({ top: 0.14, bottom: 0.2 });
  });
});

describe('getContainBox', () => {
  it('should fit a portrait to the height of a landscape still, and a landscape photo to the width of a vertical one', () => {
    expect(getContainBox({ width: 3000, height: 4000 })).toEqual({ x: 0.2890625, y: 0, width: 0.421875, height: 1 });
    const box = getContainBox({ width: 4000, height: 3000 }, VERTICAL_ASPECT);
    expect(box.x).toBe(0);
    expect(box.width).toBe(1);
    expect(box.height).toBeCloseTo(0.421875, 6);
    expect(box.y).toBeCloseTo((1 - 0.421875) / 2, 6);
  });
});

const faceInCrop = (face: NormalizedRect, crop: NormalizedRect) =>
  face.x >= crop.x - 1e-3 &&
  face.y >= crop.y - 1e-3 &&
  face.x + face.width <= crop.x + crop.width + 1e-3 &&
  face.y + face.height <= crop.y + crop.height + 1e-3;

describe('getPhotoFraming', () => {
  it('should crop in landscape as before: portraits whole, other photos to 16:9', () => {
    expect(getPhotoFraming({ width: 3000, height: 4000, faces: [] }).frame).toBe('contain');
    const { frame, crop } = getPhotoFraming({ width: 4000, height: 3000, faces: [] });
    expect(frame).toBe('cover');
    expect((crop.width * 4000) / (crop.height * 3000)).toBeCloseTo(16 / 9, 2);
  });

  it('should fill a vertical frame with a portrait photo', () => {
    const faces = [{ x: 0.3, y: 0.2, width: 0.2, height: 0.15 }];
    const { frame, crop } = getPhotoFraming({ width: 3000, height: 4000, faces }, 'vertical');
    expect(frame).toBe('cover');
    expect((crop.width * 3000) / (crop.height * 4000)).toBeCloseTo(VERTICAL_ASPECT, 2);
    expect(faceInCrop(faces[0], crop)).toBe(true);
  });

  it('should crop a landscape photo tightly around its face', () => {
    const faces = [{ x: 0.7, y: 0.3, width: 0.08, height: 0.1 }];
    const { frame, crop } = getPhotoFraming({ width: 4000, height: 3000, faces }, 'vertical');
    expect(frame).toBe('cover');
    expect((crop.width * 4000) / (crop.height * 3000)).toBeCloseTo(VERTICAL_ASPECT, 2);
    expect(crop.width).toBeCloseTo(0.4219, 3);
    expect(faceInCrop(faces[0], crop)).toBe(true);
    // the crop is on the right, where the face is
    expect(crop.x).toBeGreaterThan(0.4);
  });

  it('should crop a landscape photo without faces around its focus point', () => {
    const { frame, crop } = getPhotoFraming(
      { width: 4000, height: 3000, faces: [], focus: { x: 0.2, y: 0.5 } },
      'vertical',
    );
    expect(frame).toBe('cover');
    expect(crop.x + crop.width / 2).toBeCloseTo(0.2, 1);
  });

  it('should show a landscape photo whole when the crop would cut faces', () => {
    const faces = [
      { x: 0.05, y: 0.3, width: 0.1, height: 0.13 },
      { x: 0.45, y: 0.3, width: 0.1, height: 0.13 },
      { x: 0.85, y: 0.3, width: 0.1, height: 0.13 },
    ];
    expect(getPhotoFraming({ width: 4000, height: 3000, faces }, 'vertical')).toEqual({
      frame: 'contain',
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
  });

  it('should show a wide photo whole, as the crop would lose most of it', () => {
    const faces = [{ x: 0.5, y: 0.3, width: 0.05, height: 0.1 }];
    expect(getPhotoFraming({ width: 4000, height: 2250, faces }, 'vertical').frame).toBe('contain');
    expect(getPhotoFraming({ width: 6000, height: 2000, faces: [], focus: { x: 0.5, y: 0.5 } }, 'vertical').frame).toBe(
      'contain',
    );
  });

  it('should show a landscape photo whole when it has no subject to crop around', () => {
    expect(getPhotoFraming({ width: 4000, height: 3000, faces: [] }, 'vertical').frame).toBe('contain');
  });

  it('should show a small photo whole rather than enlarge a soft crop', () => {
    expect(getPhotoFraming({ width: 1200, height: 900, faces: [], focus: { x: 0.5, y: 0.5 } }, 'vertical').frame).toBe(
      'contain',
    );
  });
});

describe('getPanRects in a vertical frame', () => {
  it('should zoom towards the face of a portrait crop and keep it in the frame', () => {
    const faces = [{ x: 0.55, y: 0.25, width: 0.15, height: 0.12 }];
    const { crop } = getPhotoFraming({ width: 3000, height: 4000, faces }, 'vertical');
    for (const index of [0, 1]) {
      const { from, to } = getPanRects(
        { width: 3000, height: 4000, faces, crop, duration: 4, frameAspect: VERTICAL_ASPECT },
        'cover',
        index,
      );
      const face = toStill(faces[0], { frame: 'cover', crop }, 3 / 4, VERTICAL_ASPECT);
      expect(inside(from) && inside(to)).toBe(true);
      expect(contains(from, face)).toBe(true);
      expect(contains(to, face)).toBe(true);
    }
  });

  it('should keep the faces of a landscape photo shown whole over its blurred copy', () => {
    const faces = [
      { x: 0.02, y: 0.3, width: 0.1, height: 0.13 },
      { x: 0.88, y: 0.35, width: 0.1, height: 0.13 },
    ];
    const crop = { x: 0, y: 0, width: 1, height: 1 };
    const { from, to } = getPanRects(
      { width: 4000, height: 3000, faces, crop, duration: 5, frameAspect: VERTICAL_ASPECT },
      'contain',
      0,
    );
    for (const face of faces) {
      const still = toStill(face, { frame: 'contain', crop }, 4 / 3, VERTICAL_ASPECT);
      // the photo sits in the middle band of the still
      expect(still.y).toBeGreaterThan(0.25);
      expect(contains(from, still)).toBe(true);
      expect(contains(to, still)).toBe(true);
    }
  });

  it('should pan down a portrait without a subject', () => {
    const { from, to } = getPanRects(
      {
        width: 3000,
        height: 4000,
        faces: [],
        crop: { x: 0, y: 0, width: 1, height: 1 },
        duration: 4,
        frameAspect: VERTICAL_ASPECT,
      },
      'cover',
      0,
    );
    expect(from.size).toBe(to.size);
    expect(from.x).toBe(to.x);
    expect(to.y).toBeGreaterThan(from.y);
  });
});

describe('planHighlight', () => {
  it.each([30, 60, 90, 120])('should make a %i second film to the frame', (durationSeconds) => {
    const result = plan(trip(), [], { durationSeconds });
    expect(result.durationSeconds).toBeCloseTo(durationSeconds, 5);
    expect(getHighlightLength(result.shots, HIGHLIGHT_FADE)).toBeCloseTo(durationSeconds, 5);
    for (const shot of result.shots) {
      expect(Math.abs(shot.duration * 30 - Math.round(shot.duration * 30))).toBeLessThan(1e-6);
    }
  });

  it('should open with a title card and open each chapter with its map', () => {
    const result = plan(trip());
    expect(result.shots[0]).toMatchObject({ kind: 'title', title: 'Sicily', subtitle: '12–14 June 2024' });
    const maps = result.shots.filter((shot) => shot.kind === 'map');
    expect(maps.map((shot) => shot.title)).toEqual(['Taormina', 'Catania', 'Palermo']);
    expect(maps.every((shot) => shot.kind === 'map' && shot.points.length > 0)).toBe(true);
    expect(result.chapters).toHaveLength(3);
  });

  it('should use a title card instead of the map of a chapter at a single place', () => {
    const result = plan(museums(), [], {
      durationSeconds: 60,
      title: 'Museum visits',
      style: bookStylePresets.museum.style,
    });

    expect(result.shots.filter((shot) => shot.kind === 'map')).toHaveLength(0);
    expect(result.shots.filter((shot) => shot.kind === 'chapter')).toEqual([
      expect.objectContaining({ title: 'Musée des Beaux-Arts, Agen', subtitle: '25 July 2018' }),
      expect.objectContaining({ title: 'Indian Museum, Kolkata', subtitle: '27 September 2022' }),
      expect.objectContaining({ title: 'Museu de Évora', subtitle: 'Évora, 28 August 2025' }),
    ]);
  });

  it('should not name the place of one chapter under the dates of the whole film', () => {
    const result = plan(museums(), [], {
      durationSeconds: 30,
      title: 'Museum visits',
      style: bookStylePresets.museum.style,
    });

    expect(result.shots[0]).toEqual({
      kind: 'title',
      duration: expect.any(Number),
      title: 'Museum visits',
      subtitle: '25 July 2018 – 28 August 2025',
    });
    // a trip whose chapters all have their places lists them
    expect(plan(trip()).shots[0]).toMatchObject({ kind: 'title', detail: 'Taormina, Catania & Palermo' });
  });

  it('should measure how far apart the photos were taken', () => {
    expect(getLocationSpreadKm([])).toBe(0);
    expect(
      getLocationSpreadKm([
        { lat: 38.57, lon: -7.9 },
        { lat: null, lon: null },
      ]),
    ).toBe(0);
    expect(
      getLocationSpreadKm([
        { lat: 38.5725, lon: -7.9072 },
        { lat: 38.5727, lon: -7.9072 },
      ]),
    ).toBeLessThan(0.1);
    expect(
      getLocationSpreadKm([
        { lat: 37.85, lon: 15.28 },
        { lat: 37.5, lon: 15.09 },
      ]),
    ).toBeCloseTo(42.4, 0);
  });

  it('should use title cards instead of maps without GPS or when maps are off', () => {
    const result = plan(trip(), [], { includeMaps: false });
    expect(result.shots.filter((shot) => shot.kind === 'map')).toHaveLength(0);
    expect(
      result.shots.filter((shot) => shot.kind === 'chapter').map((shot) => shot.kind === 'chapter' && shot.title),
    ).toEqual(['Taormina', 'Catania', 'Palermo']);
  });

  it('should keep the shots in time order within the chapters', () => {
    const result = plan(trip());
    const times = new Map(trip().map((item) => [item.id, item.takenAt]));
    const shown = photoShots(result).map((shot) => times.get(shot.assetId)!);
    expect(shown).toEqual(shown.toSorted((a, b) => a - b));
  });

  it('should pick the best photos and show them longer', () => {
    const photos = event(40, start, (i) => ({ score: i === 7 ? 0.95 : 0.3 }));
    photos[20].isFavorite = true;
    const result = plan(photos, [], { durationSeconds: 30 });
    const shots = photoShots(result);
    const ids = shots.map((shot) => shot.assetId);
    expect(ids).toContain(photos[7].id);
    expect(ids).toContain(photos[20].id);
    const best = shots.find((shot) => shot.assetId === photos[7].id)!;
    expect(best.duration).toBeGreaterThanOrEqual(Math.max(...shots.map((shot) => shot.duration)) - 0.1);
  });

  it('should show one photo of a near-duplicate burst and one per stack', () => {
    const burst = event(6, start, (i) => ({ clusterId: 1, score: i === 3 ? 0.9 : 0.5 }));
    const stack = [
      photo({ stackId: 'stack', kind: 'original', score: 0.6 }),
      photo({ stackId: 'stack', kind: 'crop', score: 0.61 }),
    ];
    const result = plan([...burst, ...stack], [], { durationSeconds: 60 });
    const ids = result.usedIds;
    expect(ids.filter((id) => burst.some((item) => item.id === id))).toEqual([burst[3].id]);
    expect(ids.filter((id) => stack.some((item) => item.id === id))).toHaveLength(1);
  });

  it('should never show a source photo, such as a ticket', () => {
    const ticket = photo({ collection: { pack: 'travel', place: 'Crete, October 2016', kind: 'source' } });
    const result = plan([...event(10, start), ticket]);
    expect(result.usedIds).not.toContain(ticket.id);
  });

  it('should leave out photos too small for 1080p', () => {
    const tiny = photo({ width: 640, height: 480, score: 1, isFavorite: true });
    const result = plan([...event(10, start), tiny]);
    expect(result.usedIds).not.toContain(tiny.id);
    expect(result.warnings).toContain('1 photos are too small for a 1080p video and were left out');
  });

  it('should keep the faces in every frame of every shot', () => {
    const photos = event(20, start, (i) => ({
      width: i % 3 === 0 ? 3000 : 4000,
      height: i % 3 === 0 ? 4000 : 3000,
      faces: [{ x: 0.1 + (i % 5) * 0.15, y: 0.1 + (i % 4) * 0.15, width: 0.1, height: 0.12 }],
    }));
    const byId = new Map(photos.map((item) => [item.id, item]));
    const result = plan(photos, [], { durationSeconds: 60 });
    const shots = photoShots(result);
    expect(shots.some((shot) => shot.frame === 'contain')).toBe(true);
    for (const shot of shots) {
      const source = byId.get(shot.assetId)!;
      expect(inside(shot.from) && inside(shot.to)).toBe(true);
      for (const face of source.faces) {
        const still = toStill(face, shot, source.width / source.height);
        // the move is linear between the two squares, which are convex: both ends hold the face, so every frame does
        expect(contains(shot.from, still)).toBe(true);
        expect(contains(shot.to, still)).toBe(true);
      }
    }
  });

  it('should plan a vertical film at 9:16 with the same shots and length', () => {
    const landscape = plan(trip(), [], { durationSeconds: 60 });
    counter = 0;
    const vertical = plan(trip(), [], { durationSeconds: 60, format: 'vertical' });
    expect(landscape).toMatchObject({ format: 'landscape', width: 1920, height: 1080 });
    expect(vertical).toMatchObject({ format: 'vertical', width: 1080, height: 1920 });
    expect(vertical.durationSeconds).toBeCloseTo(60, 5);
    expect(vertical.usedIds).toEqual(landscape.usedIds);
    expect(vertical.shots.map((shot) => shot.kind)).toEqual(landscape.shots.map((shot) => shot.kind));
  });

  it('should keep the faces in every frame of every shot of a vertical film', () => {
    const photos = event(24, start, (i) => ({
      width: i % 3 === 0 ? 3000 : i % 3 === 1 ? 4000 : 4000,
      height: i % 3 === 0 ? 4000 : i % 3 === 1 ? 3000 : 2250,
      faces:
        i % 4 === 3
          ? [
              { x: 0.05, y: 0.3, width: 0.1, height: 0.12 },
              { x: 0.8, y: 0.35, width: 0.1, height: 0.12 },
            ]
          : [{ x: 0.1 + (i % 5) * 0.15, y: 0.1 + (i % 4) * 0.15, width: 0.1, height: 0.12 }],
    }));
    const byId = new Map(photos.map((item) => [item.id, item]));
    const result = plan(photos, [], { durationSeconds: 60, format: 'vertical' });
    const shots = photoShots(result);
    expect(shots.some((shot) => shot.frame === 'contain')).toBe(true);
    expect(shots.some((shot) => shot.frame === 'cover')).toBe(true);
    for (const shot of shots) {
      const source = byId.get(shot.assetId)!;
      const aspect = source.width / source.height;
      if (shot.frame === 'cover') {
        // the crop is 9:16
        expect((shot.crop.width * source.width) / (shot.crop.height * source.height)).toBeCloseTo(VERTICAL_ASPECT, 2);
      }
      expect(inside(shot.from) && inside(shot.to)).toBe(true);
      for (const face of source.faces) {
        const still = toStill(face, shot, aspect, VERTICAL_ASPECT);
        expect(contains(shot.from, still)).toBe(true);
        expect(contains(shot.to, still)).toBe(true);
      }
    }
  });

  it('should fill a vertical frame with the portraits and show the wide photos whole', () => {
    const portrait = photo({ width: 3000, height: 4000, faces: [{ x: 0.4, y: 0.2, width: 0.2, height: 0.15 }] });
    const wide = photo({ width: 4000, height: 2250, faces: [{ x: 0.45, y: 0.3, width: 0.1, height: 0.15 }] });
    const result = plan([portrait, wide, ...event(6, start + HOUR)], [], { durationSeconds: 30, format: 'vertical' });
    const shots = photoShots(result);
    expect(shots.find((shot) => shot.assetId === portrait.id)?.frame).toBe('cover');
    expect(shots.find((shot) => shot.assetId === wide.id)?.frame).toBe('contain');
  });

  it('should cut clips of 3 to 5 seconds from the videos', () => {
    const photos = event(30, start);
    const clips = [
      video({ takenAt: start + 30 * 60_000, duration: 20, score: 0.8 }),
      video({ takenAt: start + HOUR, duration: 1 }),
    ];
    const result = plan(photos, clips, { durationSeconds: 60 });
    const shots = result.shots.filter((shot) => shot.kind === 'clip');
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ assetId: clips[0].id, start: 5 });
    expect(shots[0].duration).toBeGreaterThanOrEqual(3);
    expect(shots[0].duration).toBeLessThanOrEqual(5);
    expect(result.durationSeconds).toBeCloseTo(60, 5);
  });

  it('should caption the dishes of a food visit and title the chapter with the restaurant', () => {
    const photos = [
      photo({ ...food('Caponata'), score: 0.8 }),
      photo({ ...food('Pasta alla Norma'), score: 0.8 }),
      photo({ ...food('Cannoli'), score: 0.8 }),
      ...event(12, start + DAY, () => ({ city: 'Catania' })),
    ];
    const result = plan(photos, [], { style: bookStylePresets.food.style, durationSeconds: 60 });
    const chapter = result.shots.find((shot) => shot.kind === 'chapter');
    expect(chapter).toMatchObject({ title: 'Trattoria da Nino', subtitle: 'Taormina, 12 June 2024' });
    const captions = photoShots(result)
      .map((shot) => shot.caption)
      .filter(Boolean);
    expect(captions).toEqual(expect.arrayContaining(['Caponata', 'Pasta alla Norma', 'Cannoli']));
  });

  it('should title the legs of a trip and never show the tickets', () => {
    const photos = [
      ...event(8, start, () => leg('Bus Chania → Sougia · 4 Oct 2016')),
      photo({
        takenAt: start + 2 * HOUR,
        collection: { pack: 'travel', place: 'Crete, October 2016', kind: 'source' },
      }),
      ...event(8, start + DAY, () => leg('Ferry Sougia → Agia Roumeli · 5 Oct 2016')),
    ];
    const result = plan(photos, [], { includeMaps: false });
    const titles = result.shots
      .filter((shot) => shot.kind === 'chapter')
      .map((shot) => shot.kind === 'chapter' && shot.title);
    expect(titles).toHaveLength(2);
    expect(titles.join(' ')).toMatch(/Sougia/);
    expect(result.usedIds).not.toContain(photos[8].id);
  });

  it('should show the street before a dinner in the chapter of the dinner, not in one of its own', () => {
    const outside = photo({ takenAt: start, city: 'Yountville' });
    const dinner = Array.from({ length: 6 }, (_, i) =>
      photo({ takenAt: start + 2 * HOUR + i * 10 * 60_000, ...food(`Dish ${i + 1}`) }),
    );
    const result = plan([outside, ...dinner], [], { style: bookStylePresets.food.style, includeMaps: false });
    // a single chapter: the title card opens it
    expect(result.shots.filter((shot) => shot.kind === 'chapter')).toHaveLength(0);
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe('Trattoria da Nino');
    expect(result.chapters[0].assetIds).toContain(outside.id);
  });

  it('should title a chapter that returns to earlier places with its dates', () => {
    const photos = [
      ...event(10, start, () => ({ city: 'Taormina' })),
      ...event(10, start + 3 * DAY, () => ({ city: 'Catania' })),
      ...event(10, start + 6 * DAY, () => ({ city: 'Taormina' })),
    ];
    const titles = plan(photos, [], { includeMaps: false })
      .shots.filter((shot) => shot.kind === 'chapter')
      .map((shot) => shot.kind === 'chapter' && [shot.title, shot.subtitle]);
    expect(titles).toEqual([
      ['Taormina', '12 June 2024'],
      ['Catania', '15 June 2024'],
      ['18 June 2024', 'Taormina'],
    ]);
  });

  it('should leave out the captions when asked', () => {
    const photos = [
      photo({ collection: { pack: 'food', place: 'Nino', kind: 'entry', entry: 'Caponata' } }),
      ...event(10, start + HOUR),
    ];
    const result = plan(photos, [], { captions: false });
    expect(photoShots(result).every((shot) => !shot.caption)).toBe(true);
  });

  it('should make a shorter film when there are too few photos', () => {
    const result = plan(event(5, start), [], { durationSeconds: 120 });
    expect(result.durationSeconds).toBeLessThan(120);
    expect(result.warnings.join(' ')).toMatch(/only enough photos/);
    expect(photoShots(result)).toHaveLength(5);
  });

  it('should return an empty plan without photos', () => {
    const result = plan([]);
    expect(result.shots).toEqual([]);
    expect(result.warnings).toContain('There are no photos or videos to show');
  });

  it('should be deterministic', () => {
    const first = plan(trip());
    counter = 0;
    expect(plan(trip())).toEqual(first);
  });

  it('should keep the cards to a share of a short film with many chapters', () => {
    const photos = Array.from({ length: 12 }, (_, day) =>
      event(6, start + day * DAY, () => ({ city: `Town ${day}` })),
    ).flat();
    const result = plan(photos, [], { durationSeconds: 30, includeMaps: false });
    const cards = result.shots.filter((shot) => shot.kind !== 'photo' && shot.kind !== 'clip');
    const cardTime = cards.reduce((sum, shot) => sum + shot.duration - HIGHLIGHT_FADE, 0);
    expect(cardTime).toBeLessThanOrEqual(0.3 * 30 + HIGHLIGHT_FADE);
  });
});
