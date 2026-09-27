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
  getHighlightLength,
  getPanRects,
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

const trip = () => [
  ...event(30, start, (i) => ({ lat: 37.85, lon: 15.28, city: 'Taormina', score: 0.3 + (i % 5) * 0.1 })),
  ...event(30, start + DAY, (i) => ({ lat: 37.5, lon: 15.09, city: 'Catania', score: 0.3 + (i % 4) * 0.1 })),
  ...event(30, start + 2 * DAY, (i) => ({ lat: 38.11, lon: 13.36, city: 'Palermo', score: 0.3 + (i % 3) * 0.1 })),
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

/** a face (in photo coordinates) in the still of a shot (see `getPanRects`) */
const toStill = (face: NormalizedRect, shot: Pick<HighlightPhotoShot, 'frame' | 'crop'>, aspect: number) => {
  if (shot.frame === 'contain') {
    const width = aspect / HIGHLIGHT_ASPECT;
    const offset = (1 - width) / 2;
    return { x: offset + face.x * width, y: face.y, width: face.width * width, height: face.height };
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
