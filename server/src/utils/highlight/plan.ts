import type { BookStyle, NormalizedRect } from 'src/dtos/book.dto.js';
import {
  AutoLayoutPhoto,
  PhotoChapter,
  RankedPhoto,
  formatDateRange,
  formatPlaces,
  formatTime,
  getFactualCaption,
  getPhotoSimilarity,
  getPlaces,
  getSectionTitle,
  getVisitTitle,
  pickClusterRepresentatives,
  rankPhotos,
  resolveStacks,
  splitChapters,
} from 'src/utils/book/auto-layout.js';
import { getEntryCaption, isCollectionTheme, isSourcePhoto } from 'src/utils/book/collections.js';
import { getSmartCrop } from 'src/utils/book/render.js';
import { redactText } from 'src/utils/collections/pack.js';
import { getCollectionPack } from 'src/utils/collections/registry.js';

/**
 * A highlight video is a photo book laid out in time: the same photos are picked (see `rankPhotos`, one per stack and
 * per near-duplicate cluster), grouped into the same chapters (an event, or a visit of a collection such as a
 * restaurant or a leg of a trip, see `splitChapters`), and each chapter is opened by a map (with GPS) or a title card.
 * Photos become Ken Burns shots that move towards or away from the faces (or the focus point), videos become short
 * clips, and the entries of the collections (dishes, artworks, wines, recipe steps) are named in lower thirds.
 *
 * A film is landscape (16:9, 1920×1080) or vertical (9:16, 1080×1920, for phones and social apps). A vertical film
 * fills the frame with portrait photos, crops landscape photos tightly around their subject (the faces, or the focus
 * point) or shows them whole over a blurred copy of themselves when the crop would cut a face or lose too much, and
 * keeps its text out of the top and bottom of the frame, where the apps draw their buttons (see `getSafeArea`).
 */

/** the landscape frame (the default) */
export const HIGHLIGHT_WIDTH = 1920;
export const HIGHLIGHT_HEIGHT = 1080;
export const HIGHLIGHT_ASPECT = HIGHLIGHT_WIDTH / HIGHLIGHT_HEIGHT;

export const HIGHLIGHT_FORMATS = ['landscape', 'vertical'] as const;
/** landscape: 16:9, 1920×1080; vertical: 9:16, 1080×1920, for phones and social apps */
export type HighlightFormat = (typeof HIGHLIGHT_FORMATS)[number];
export type HighlightFrameSize = { width: number; height: number };

/** the size of the frame of a film of the format */
export const getHighlightFrame = (format: HighlightFormat = 'landscape'): HighlightFrameSize =>
  format === 'vertical'
    ? { width: HIGHLIGHT_HEIGHT, height: HIGHLIGHT_WIDTH }
    : { width: HIGHLIGHT_WIDTH, height: HIGHLIGHT_HEIGHT };

/**
 * The share of a vertical frame at its top and bottom that the apps of phones cover (the status bar and the name of
 * the account at the top; the caption, the buttons and the progress bar at the bottom): no text is drawn there
 */
export const VERTICAL_SAFE_AREA = Object.freeze({ top: 0.14, bottom: 0.2 });

/** the share of the frame at its top and bottom kept free of text: the phone apps' in a vertical frame, none otherwise */
export const getSafeArea = (size: HighlightFrameSize): { top: number; bottom: number } =>
  size.height > size.width ? { ...VERTICAL_SAFE_AREA } : { top: 0, bottom: 0 };
export const HIGHLIGHT_FPS = 30;
/** the crossfade between two shots, in seconds */
export const HIGHLIGHT_FADE = 0.6;
export const HIGHLIGHT_DURATIONS = [30, 60, 90, 120] as const;
export const DEFAULT_HIGHLIGHT_DURATION = 60;
export const MIN_HIGHLIGHT_DURATION = 15;
export const MAX_HIGHLIGHT_DURATION = 180;

const TITLE_SECONDS = 3.6;
const CHAPTER_SECONDS = 2.6;
const MAP_SECONDS = 3.4;
/** the pace of the photos: a photo stays this long on average, with the fades */
const PHOTO_SECONDS = 3.2;
const MIN_PHOTO_SECONDS = 2.2;
const MAX_PHOTO_SECONDS = 6;
const MIN_CLIP_SECONDS = 3;
const MAX_CLIP_SECONDS = 5;
/** a video shorter than this is not worth a clip */
const MIN_VIDEO_SECONDS = 1.5;
/** the cards (title, chapters, maps) take at most this share of the film */
const MAX_CARD_SHARE = 0.3;
/** the clips take at most this share of the film */
const MAX_CLIP_SHARE = 0.3;
/**
 * photos narrower than this share of the frame's aspect ratio (portraits and squares; not 4:3 photos, which are cropped)
 * are shown whole, over a blurred copy of themselves
 */
const CONTAIN_BELOW = 0.68;
/**
 * a vertical film crops a landscape photo to 9:16 only when that keeps at least this share of it (a 4:3 photo keeps
 * 42%, a 3:2 one 38%); a wider photo (16:9, a panorama) is shown whole over a blurred copy of itself
 */
const MIN_VERTICAL_KEEP = 0.36;
/** a crop that would be enlarged more than this to fill the frame looks soft: the photo is shown whole instead */
const MAX_CROP_UPSCALE = 1.6;
/** photos this small (the long and short edge, in pixels) would look blurry in 1080p */
const MIN_LONG_EDGE = 1000;
const MIN_SHORT_EDGE = 560;
/** how similar (see `getPhotoSimilarity`) two photos of a chapter may be before the second is skipped */
const MAX_SIMILARITY = 0.6;
/** the share of the photos that may be artwork */
const ARTWORK_SHARE = 0.15;
/**
 * a chapter whose photos were all taken closer together than this (in km, across) was at a single place, e.g. a museum:
 * its map would be a single pin on empty paper (the sketch draws coasts and borders only on maps of 30 km or more), so
 * it gets a title card instead
 */
const MIN_MAP_SPREAD_KM = 1;

/** a video of the source, from which a clip is cut */
export type HighlightVideo = Omit<AutoLayoutPhoto, 'faces' | 'score'> & {
  faces?: NormalizedRect[];
  /** quality score, 0..1, default 0.5 */
  score?: number;
  /** seconds */
  duration: number;
  /** where the best part of the video starts, in seconds, when it was measured */
  bestStart?: number;
};

/** a photo of the source, with its focus point (as fractions of the upright image) when it has no faces */
export type HighlightPhoto = AutoLayoutPhoto & { focus?: { x: number; y: number } | null };

export type HighlightOptions = {
  /** the length of the film in seconds */
  durationSeconds?: number;
  /** landscape (16:9, the default) or vertical (9:16) */
  format?: HighlightFormat;
  title: string;
  style: Required<BookStyle>;
  /** a map card opens each chapter with GPS locations, default true */
  includeMaps?: boolean;
  /** lower thirds with the names of the entries (dishes, artworks, wines, steps) and the places, default true */
  captions?: boolean;
  /** photos that are always shown, and a little longer */
  heroIds?: string[];
  /** lay out the visits of the collections as chapters; default when the style has the theme of a pack or photos have its tags */
  collection?: boolean;
  fps?: number;
  fade?: number;
};

export type HighlightMapPoint = { lat: number; lon: number; time: number; city?: string | null };

/** a square in the coordinates of the still of a shot, which has the aspect ratio of the frame */
export type HighlightRect = { x: number; y: number; size: number };

type ShotBase = { duration: number };

export type HighlightTitleShot = ShotBase & { kind: 'title'; title: string; subtitle?: string; detail?: string };
export type HighlightChapterShot = ShotBase & { kind: 'chapter'; chapter: number; title: string; subtitle?: string };
export type HighlightMapShot = ShotBase & {
  kind: 'map';
  chapter: number | null;
  title: string;
  subtitle?: string;
  points: HighlightMapPoint[];
};
export type HighlightPhotoShot = ShotBase & {
  kind: 'photo';
  assetId: string;
  chapter: number;
  /**
   * how the still is made from the photo: `cover` crops the photo to the frame (the region `crop`, keeping the faces),
   * `contain` shows it whole over a blurred copy of itself
   */
  frame: 'cover' | 'contain';
  crop: NormalizedRect;
  from: HighlightRect;
  to: HighlightRect;
  caption?: string;
};
export type HighlightClipShot = ShotBase & {
  kind: 'clip';
  assetId: string;
  chapter: number;
  /** where the clip starts in the video, in seconds */
  start: number;
  caption?: string;
};

export type HighlightShot =
  HighlightTitleShot | HighlightChapterShot | HighlightMapShot | HighlightPhotoShot | HighlightClipShot;

export type HighlightChapter = {
  title: string;
  subtitle?: string;
  /** the photos and videos of the chapter that are shown */
  assetIds: string[];
  located: boolean;
  pack?: string;
};

export type HighlightPlan = {
  format: HighlightFormat;
  /** the size of the frame */
  width: number;
  height: number;
  shots: HighlightShot[];
  chapters: HighlightChapter[];
  fps: number;
  fade: number;
  /** the length of the film: the shots, less the crossfades */
  durationSeconds: number;
  /** the photos and videos shown, in their order */
  usedIds: string[];
  warnings: string[];
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const located = (items: RankedPhoto[]) => items.some((photo) => photo.located);
const byImportance = (a: RankedPhoto, b: RankedPhoto) =>
  b.importance - a.importance || a.takenAt - b.takenAt || a.id.localeCompare(b.id);
/** the day of a local time */
const day = (time: number) => new Date(time).toISOString().slice(0, 10);

/** the distance across the GPS locations of the photos, in km (the diagonal of their bounding box) */
export const getLocationSpreadKm = (photos: Array<Pick<AutoLayoutPhoto, 'lat' | 'lon'>>) => {
  const points = photos.filter(
    (photo): photo is typeof photo & { lat: number; lon: number } =>
      typeof photo.lat === 'number' && typeof photo.lon === 'number',
  );
  if (points.length < 2) {
    return 0;
  }
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const latitude = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180);
  const north = (Math.max(...lats) - Math.min(...lats)) * 110.574;
  const east = (Math.max(...lons) - Math.min(...lons)) * 111.32 * Math.cos(latitude);
  return Math.hypot(north, east);
};

/** whether a chapter's map shows more than a single place, see `MIN_MAP_SPREAD_KM` */
const isWorthAMap = (photos: RankedPhoto[]) => located(photos) && getLocationSpreadKm(photos) >= MIN_MAP_SPREAD_KM;

export const getHighlightLength = (shots: Array<{ duration: number }>, fade = HIGHLIGHT_FADE) =>
  shots.length === 0 ? 0 : shots.reduce((sum, shot) => sum + shot.duration, 0) - (shots.length - 1) * fade;

/**
 * Durations for the weights that add up to `total` (each between `min` and `max`), in proportion to the weights where
 * the limits allow; less than `total` when even `max` each is not enough
 */
export const fitDurations = (weights: number[], total: number, min: number, max: number) => {
  const result = weights.map(() => 0);
  const fixed = new Set<number>();
  for (let round = 0; round <= weights.length; round++) {
    const free = weights.map((_, index) => index).filter((index) => !fixed.has(index));
    if (free.length === 0) {
      break;
    }
    const left = total - [...fixed].reduce((sum, index) => sum + result[index], 0);
    const weight = free.reduce((sum, index) => sum + weights[index], 0);
    for (const index of free) {
      result[index] = (left * weights[index]) / weight;
    }
    // the longest over the maximum are fixed first, then the shortest under the minimum
    const over = free.filter((index) => result[index] > max);
    const under = over.length > 0 ? [] : free.filter((index) => result[index] < min);
    if (over.length === 0 && under.length === 0) {
      break;
    }
    for (const index of [...over, ...under]) {
      result[index] = clamp(result[index], min, max);
      fixed.add(index);
    }
  }
  return result;
};

/** splits `total` over groups of the given sizes in proportion, at least one each (when there are enough), at most the size */
export const allocateShots = (sizes: number[], total: number) => {
  const available = sizes.reduce((sum, size) => sum + size, 0);
  const count = Math.min(total, available);
  // one each, or one each for the largest groups when there are fewer shots than groups
  const firsts = new Set(
    sizes
      .map((size, index) => ({ size, index }))
      .filter(({ size }) => size > 0)
      .toSorted((a, b) => b.size - a.size || a.index - b.index)
      .slice(0, count)
      .map(({ index }) => index),
  );
  const result = sizes.map((_, index): number => (firsts.has(index) ? 1 : 0));
  let left = count - result.reduce((sum, value) => sum + value, 0);
  while (left > 0) {
    let best = -1;
    for (const [index, size] of sizes.entries()) {
      if (result[index] < size && (best === -1 || size / (result[index] + 1) > sizes[best] / (result[best] + 1))) {
        best = index;
      }
    }
    if (best === -1) {
      break;
    }
    result[best]++;
    left--;
  }
  return result;
};

/** the faces of a photo in the coordinates of a crop of it */
const toCropFaces = (faces: NormalizedRect[], crop: NormalizedRect) =>
  faces.map((face) => ({
    x: (face.x - crop.x) / crop.width,
    y: (face.y - crop.y) / crop.height,
    width: face.width / crop.width,
    height: face.height / crop.height,
  }));

/**
 * The square of the still (whose aspect ratio is the frame's) of `size` around the focus, moved to hold the faces
 * (with a margin) and enlarged when they need more room, within the still
 */
const fitSquare = (focus: { x: number; y: number }, size: number, faces: NormalizedRect[]): HighlightRect => {
  let s = size;
  if (faces.length > 0) {
    const margin = Math.max(...faces.map((face) => Math.max(face.width, face.height))) * 0.25;
    const left = Math.max(0, Math.min(...faces.map((face) => face.x)) - margin);
    const top = Math.max(0, Math.min(...faces.map((face) => face.y)) - margin);
    const right = Math.min(1, Math.max(...faces.map((face) => face.x + face.width)) + margin);
    const bottom = Math.min(1, Math.max(...faces.map((face) => face.y + face.height)) + margin);
    s = clamp(Math.max(s, right - left, bottom - top), 0, 1);
    const x = clamp(focus.x - s / 2, Math.max(0, right - s), Math.min(left, 1 - s));
    const y = clamp(focus.y - s / 2, Math.max(0, bottom - s), Math.min(top, 1 - s));
    return { x: round4(clamp(x, 0, 1 - s)), y: round4(clamp(y, 0, 1 - s)), size: round4(s) };
  }
  return {
    x: round4(clamp(focus.x - s / 2, 0, 1 - s)),
    y: round4(clamp(focus.y - s / 2, 0, 1 - s)),
    size: round4(s),
  };
};

/** the centre of the faces, weighted by their size */
const getFaceCentre = (faces: NormalizedRect[]) => {
  const weights = faces.map((face) => face.width * face.height);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return {
    x: faces.reduce((sum, face, index) => sum + (face.x + face.width / 2) * weights[index], 0) / total,
    // the eyes rather than the chin
    y: faces.reduce((sum, face, index) => sum + (face.y + face.height * 0.4) * weights[index], 0) / total,
  };
};

export type PanInput = {
  width: number;
  height: number;
  faces: NormalizedRect[];
  focus?: { x: number; y: number } | null;
  /** the region of the photo the still shows when it covers the frame (see `getSmartCrop`) */
  crop: NormalizedRect;
  duration: number;
  /** the aspect ratio of the frame (and of the still), default 16:9 */
  frameAspect?: number;
};

/**
 * Where a photo shown whole (`contain`) sits in its still, as fractions of it: it fills the height of the still when
 * it is narrower than the frame (a portrait in a landscape film), else its width (a landscape photo in a vertical
 * film), centred
 */
export const getContainBox = (photo: { width: number; height: number }, frameAspect = HIGHLIGHT_ASPECT) => {
  const aspect = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : frameAspect;
  const width = aspect <= frameAspect ? aspect / frameAspect : 1;
  const height = aspect <= frameAspect ? 1 : frameAspect / aspect;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
};

/**
 * The start and end of the Ken Burns move of a photo, as squares of its still (which has the aspect ratio of the
 * frame, so that a square of it is a frame, landscape or portrait): a slow zoom towards the faces (or the focus point)
 * or away from them, alternating with `index`, that always keeps the faces in the frame; a pan across a photo without
 * a subject, along the long side of the frame. A photo shown whole (`contain`) zooms gently towards its subject.
 */
export const getPanRects = (
  photo: PanInput,
  frame: 'cover' | 'contain',
  index: number,
): { from: HighlightRect; to: HighlightRect } => {
  const zoomIn = index % 2 === 0;
  const frameAspect = photo.frameAspect ?? HIGHLIGHT_ASPECT;
  // longer shots move further
  const zoom = clamp(1 + 0.04 * photo.duration, 1.08, 1.22);
  const full: HighlightRect = { x: 0, y: 0, size: 1 };

  let faces: NormalizedRect[];
  let focus: { x: number; y: number } | undefined;
  if (frame === 'contain') {
    const box = getContainBox(photo, frameAspect);
    const toStill = (point: { x: number; y: number }) => ({
      x: box.x + point.x * box.width,
      y: box.y + point.y * box.height,
    });
    faces = photo.faces.map((face) => ({
      ...toStill(face),
      width: face.width * box.width,
      height: face.height * box.height,
    }));
    focus = faces.length > 0 ? getFaceCentre(faces) : photo.focus ? toStill(photo.focus) : { x: 0.5, y: 0.45 };
  } else {
    faces = toCropFaces(photo.faces, photo.crop).filter(
      (face) => face.x + face.width > 0 && face.y + face.height > 0 && face.x < 1 && face.y < 1,
    );
    const cropFocus = photo.focus
      ? {
          x: (photo.focus.x - photo.crop.x) / photo.crop.width,
          y: (photo.focus.y - photo.crop.y) / photo.crop.height,
        }
      : undefined;
    focus = faces.length > 0 ? getFaceCentre(faces) : cropFocus;
  }

  if (!focus) {
    // nothing to move towards: a slow pan across the photo, along the long side of the frame
    const size = round4(1 / zoom);
    const middle = round4((1 - size) / 2);
    const vertical = frameAspect < 1;
    const start = vertical ? { x: middle, y: 0, size } : { x: 0, y: middle, size };
    const end = vertical ? { x: middle, y: round4(1 - size), size } : { x: round4(1 - size), y: middle, size };
    return zoomIn ? { from: start, to: end } : { from: end, to: start };
  }

  const tight = fitSquare(
    { x: clamp(focus.x, 0, 1), y: clamp(focus.y, 0, 1) },
    frame === 'contain' ? 1 / Math.min(zoom, 1.1) : 1 / zoom,
    faces,
  );
  return zoomIn ? { from: full, to: tight } : { from: tight, to: full };
};

/** where a clip of `length` seconds starts in a video: its best part when it was measured, else a quarter in */
export const getClipStart = (video: Pick<HighlightVideo, 'duration' | 'bestStart'>, length: number) => {
  const latest = Math.max(0, video.duration - length);
  if (video.bestStart !== undefined) {
    return round4(clamp(video.bestStart, 0, latest));
  }
  return round4(clamp(video.duration * 0.25, 0, latest));
};

/** whether a photo is large enough for the film; the size is unknown for some photos, which are kept */
const isLargeEnough = (photo: Pick<AutoLayoutPhoto, 'width' | 'height'>) =>
  !photo.width ||
  !photo.height ||
  (Math.max(photo.width, photo.height) >= MIN_LONG_EDGE && Math.min(photo.width, photo.height) >= MIN_SHORT_EDGE);

/** "Trattoria da Nino · Taormina, 23 June 2009" as a title and its subtitle */
const splitTitle = (text: string): { title: string; subtitle?: string } => {
  const [title, ...rest] = text.split(' · ');
  return rest.length > 0 ? { title, subtitle: rest.join(' · ') } : { title };
};

const redact = (pack: string | undefined, text: string) => {
  const definition = pack ? getCollectionPack(pack) : undefined;
  return definition ? redactText(definition, text) : text;
};

/** a chapter of fewer photos than this is not worth a card of its own in a film */
const MIN_CHAPTER_PHOTOS = 3;

/**
 * Joins the few photos between two visits of a collection (the street outside the restaurant, taken an hour before the
 * dinner) to the closest chapter on the same day, which a film would otherwise open with a card for one photo
 */
export const absorbSmallChapters = (chapters: PhotoChapter[]): PhotoChapter[] => {
  const result = chapters.map((chapter) => ({ ...chapter, photos: [...chapter.photos] }));
  for (let index = 0; index < result.length; index++) {
    const chapter = result[index];
    if (chapter.visit || chapter.photos.length >= MIN_CHAPTER_PHOTOS || result.length === 1) {
      continue;
    }
    const start = Math.min(...chapter.photos.map((photo) => photo.takenAt));
    const end = Math.max(...chapter.photos.map((photo) => photo.takenAt));
    const gap = (other?: PhotoChapter) => {
      if (!other || other.photos.length === 0) {
        return Infinity;
      }
      const otherStart = Math.min(...other.photos.map((photo) => photo.takenAt));
      const otherEnd = Math.max(...other.photos.map((photo) => photo.takenAt));
      const distance = otherEnd < start ? start - otherEnd : otherStart - end;
      return day(start) === day(otherStart) || day(end) === day(otherEnd) ? Math.max(0, distance) : Infinity;
    };
    const before = gap(result[index - 1]);
    const after = gap(result[index + 1]);
    if (!Number.isFinite(Math.min(before, after))) {
      continue;
    }
    const target = result[before <= after ? index - 1 : index + 1];
    target.photos = [...target.photos, ...chapter.photos].toSorted(
      (a, b) => a.takenAt - b.takenAt || a.id.localeCompare(b.id),
    );
    result.splice(index, 1);
    index--;
  }
  return result;
};

/** frames of a duration */
const toFrames = (seconds: number, fps: number) => Math.max(1, Math.round(seconds * fps));

type Chosen = { photo: RankedPhoto; clip?: HighlightVideo };

/**
 * Plans a highlight video: a title card, then for each chapter a map card (with GPS) or a title card, then its best
 * photos as Ken Burns shots and its best videos as clips, in time order. The number of photos follows from the length:
 * the cards and clips first, then about one photo every `PHOTO_SECONDS`, and the photos' durations (longer for the
 * better ones) are fitted so that the film, less its crossfades, is `durationSeconds` long to the frame. A film with
 * too few photos is shorter. The result only depends on the input.
 */
export const planHighlight = (
  inputPhotos: HighlightPhoto[],
  inputVideos: HighlightVideo[],
  options: HighlightOptions,
): HighlightPlan => {
  const fps = options.fps ?? HIGHLIGHT_FPS;
  const fade = options.fade ?? HIGHLIGHT_FADE;
  const format = options.format ?? 'landscape';
  const frameSize = getHighlightFrame(format);
  const target = clamp(
    options.durationSeconds ?? DEFAULT_HIGHLIGHT_DURATION,
    MIN_HIGHLIGHT_DURATION,
    MAX_HIGHLIGHT_DURATION,
  );
  const includeMaps = options.includeMaps ?? true;
  const captions = options.captions ?? true;
  const warnings: string[] = [];

  const videos = new Map(
    inputVideos.filter((video) => video.duration >= MIN_VIDEO_SECONDS).map((video) => [video.id, video]),
  );
  const focus = new Map(inputPhotos.map((photo) => [photo.id, photo.focus ?? null]));
  // a source (a menu, a wall label, a ticket) is read, not shown: a ticket is private
  const usable = inputPhotos.filter((photo) => !isSourcePhoto(photo) && isLargeEnough(photo));
  const small = inputPhotos.filter((photo) => !isSourcePhoto(photo) && !isLargeEnough(photo)).length;
  if (small > 0) {
    warnings.push(`${small} photos are too small for a 1080p video and were left out`);
  }
  const all: AutoLayoutPhoto[] = [
    ...usable,
    // the videos take part in the chapters like photos
    ...videos.values().map((video) => ({ ...video, faces: video.faces ?? [], score: video.score ?? 0.5 })),
  ];

  const { unique, photos } = rankPhotos(all, { heroIds: options.heroIds });
  const collection =
    options.collection ?? (isCollectionTheme(options.style.theme) || unique.some((photo) => photo.collection));
  const isClip = (photo: RankedPhoto) => videos.has(photo.id);

  const estimate = Math.max(3, Math.round((target - TITLE_SECONDS) / PHOTO_SECONDS));
  const artworkBudget = Math.round(estimate * ARTWORK_SHARE);
  const units = resolveStacks(photos, artworkBudget, 0, () => {});
  // a near-duplicate right after its twin looks like a mistake in a film: one photo per cluster, always
  const kept = pickClusterRepresentatives(units, 0);

  const empty: HighlightPlan = {
    format,
    ...frameSize,
    shots: [],
    chapters: [],
    fps,
    fade,
    durationSeconds: 0,
    usedIds: [],
    warnings: [...warnings, 'There are no photos or videos to show'],
  };
  if (kept.length === 0) {
    return empty;
  }

  // about one chapter every 15 seconds
  const maxChapters = Math.max(1, Math.round(target / 15));
  const chapters = absorbSmallChapters(splitChapters(kept, { collection, maxChapters }));

  // the cards: the title, then a map or a title for each chapter (a single chapter gets its map only); a chapter at a
  // single place gets a title card, as its map would be a single pin
  type Card = { kind: 'chapter' | 'map'; chapter: number; duration: number };
  let cards: Card[] = [];
  for (const [index, chapter] of chapters.entries()) {
    const map = includeMaps && isWorthAMap(chapter.photos);
    if (chapters.length > 1 || map) {
      cards.push({ kind: map ? 'map' : 'chapter', chapter: index, duration: map ? MAP_SECONDS : CHAPTER_SECONDS });
    }
  }
  // keep the cards to a share of the film: the cards of the smallest chapters go first
  const cardLength = () => TITLE_SECONDS - fade + cards.reduce((sum, card) => sum + card.duration - fade, 0);
  while (cards.length > 0 && cardLength() > MAX_CARD_SHARE * target) {
    const smallest = cards.toSorted(
      (a, b) =>
        chapters[a.chapter].photos.length - chapters[b.chapter].photos.length ||
        Number(a.kind === 'map') - Number(b.kind === 'map') ||
        b.chapter - a.chapter,
    )[0];
    cards = cards.filter((card) => card !== smallest);
  }

  // the clips: the best video of each chapter, then the best others, within a share of the film
  const clipSeconds = clamp(target / 20, MIN_CLIP_SECONDS, MAX_CLIP_SECONDS);
  const maxClips = Math.max(1, Math.floor((MAX_CLIP_SHARE * target) / (clipSeconds - fade)));
  const chapterClips = chapters.map((chapter) =>
    chapter.photos.filter((photo) => isClip(photo)).toSorted(byImportance),
  );
  const clips = new Set<string>();
  for (let rank = 0; clips.size < maxClips; rank++) {
    const round = chapterClips.map((list) => list[rank]).filter((clip): clip is RankedPhoto => !!clip);
    if (round.length === 0) {
      break;
    }
    for (const clip of round.toSorted(byImportance).slice(0, maxClips - clips.size)) {
      clips.add(clip.id);
    }
  }
  const clipLength = (id: string) => round4(Math.min(clipSeconds, videos.get(id)!.duration));

  // the photos: as many as the rest of the film holds at the pace of the photos
  const fixed = cardLength() + [...clips].reduce((sum, id) => sum + clipLength(id) - fade, 0);
  const photoTime = Math.max(0, target - fade - fixed);
  const photoPools = chapters.map((chapter) => chapter.photos.filter((photo) => !isClip(photo)).toSorted(byImportance));
  const wanted = Math.max(1, Math.round(photoTime / (PHOTO_SECONDS - fade)));
  const allocation = allocateShots(
    photoPools.map((pool) => pool.length),
    wanted,
  );

  const chosen: Chosen[][] = chapters.map((chapter, index) => {
    const picked: RankedPhoto[] = [];
    const pool = photoPools[index];
    const count = allocation[index];
    // the best photos, skipping one too similar to a photo already picked while there are others
    for (const photo of pool) {
      if (picked.length >= count) {
        break;
      }
      if (picked.some((other) => getPhotoSimilarity(photo, other) >= MAX_SIMILARITY)) {
        continue;
      }
      picked.push(photo);
    }
    for (const photo of pool) {
      if (picked.length >= count) {
        break;
      }
      if (!picked.includes(photo)) {
        picked.push(photo);
      }
    }
    const shown = [...picked, ...chapter.photos.filter((photo) => clips.has(photo.id))];
    return shown
      .toSorted((a, b) => a.takenAt - b.takenAt || a.id.localeCompare(b.id))
      .map((photo) => ({ photo, ...(isClip(photo) && { clip: videos.get(photo.id) }) }));
  });

  const photoCount = chosen.flat().filter((item) => !item.clip).length;
  const photoLength = photoTime + photoCount * fade;
  // the better photos stay longer
  const shownPhotos = chosen.flat().filter((item) => !item.clip);
  const importances = shownPhotos.map((item) => item.photo.importance);
  const low = Math.min(...importances);
  const high = Math.max(...importances);
  const weights = shownPhotos.map(
    (item) => 1 + 0.5 * (high > low ? (item.photo.importance - low) / (high - low) : 0.5) + (item.photo.hero ? 0.3 : 0),
  );
  const durations = new Map(
    fitDurations(weights, photoLength, MIN_PHOTO_SECONDS, MAX_PHOTO_SECONDS).map((duration, index) => [
      shownPhotos[index].photo.id,
      duration,
    ]),
  );

  // titles, from the photos shown, like the chapters of a book
  const visited = new Set<string>();
  const shownAll = chosen.flat().map((item) => item.photo);
  if (shownAll.length === 0) {
    return empty;
  }
  const allTimes = shownAll.map((photo) => photo.takenAt);
  // local times: the chapters of a single day are told apart by their time
  const singleDay = chapters.length > 1 && day(Math.min(...allTimes)) === day(Math.max(...allTimes));
  const chapterTitles = chapters.map((chapter, index) => {
    const shown = chosen[index].map((item) => item.photo);
    const photosOf = shown.length > 0 ? shown : chapter.photos;
    const times = photosOf.map((photo) => photo.takenAt);
    const dates = formatDateRange(Math.min(...times), Math.max(...times));
    if (chapter.visit) {
      const { pack, place, entry } = chapter.visit;
      const chapterTitle = entry ? getCollectionPack(pack)?.book.chapterTitle : undefined;
      const text = chapterTitle ? chapterTitle(entry!, place) : getVisitTitle(place, photosOf);
      const { title, subtitle } = splitTitle(redact(pack, text));
      for (const city of getPlaces(photosOf)) {
        visited.add(city);
      }
      return { title, subtitle };
    }
    const title = getSectionTitle(photosOf, visited);
    for (const city of getPlaces(photosOf)) {
      visited.add(city);
    }
    return { title, subtitle: singleDay ? `${dates} · ${formatTime(Math.min(...times))}` : dates };
  });
  // a chapter that returns to the places of an earlier one is titled with its dates instead
  for (const [index, chapter] of chapterTitles.entries()) {
    const repeated = chapterTitles.slice(0, index).some((earlier) => earlier.title === chapter.title);
    if (repeated && !chapters[index].visit && chapter.subtitle) {
      chapterTitles[index] = { title: chapter.subtitle, subtitle: chapter.title };
    }
  }

  // the title card names the places of the film only when every chapter has one: under the dates of the whole film,
  // the city of one visit (of three museums, only one with GPS) would read as the place of all of them
  const shownChapters = chosen.filter((items) => items.length > 0);
  const places = shownChapters.every((items) => getPlaces(items.map((item) => item.photo)).length > 0)
    ? formatPlaces(getPlaces(shownAll))
    : '';
  const shots: HighlightShot[] = [
    {
      kind: 'title',
      duration: TITLE_SECONDS,
      title: options.title,
      subtitle: formatDateRange(Math.min(...allTimes), Math.max(...allTimes)),
      ...(places && places !== options.title && { detail: places }),
    },
  ];

  let photoIndex = 0;
  for (const [index, chapter] of chapters.entries()) {
    if (chosen[index].length === 0) {
      continue;
    }
    const card = cards.find((item) => item.chapter === index);
    const { title, subtitle } = chapterTitles[index];
    if (card?.kind === 'map') {
      const points = chapter.photos
        .filter((photo) => photo.located)
        .toSorted((a, b) => a.takenAt - b.takenAt)
        .map((photo) => ({ lat: photo.lat!, lon: photo.lon!, time: photo.takenAt, city: photo.city }));
      // a single chapter is the whole film: its map is titled with the places, not the film again
      shots.push({
        kind: 'map',
        chapter: chapters.length > 1 ? index : null,
        duration: card.duration,
        title: chapters.length > 1 ? title : places || title,
        ...(chapters.length > 1 && subtitle && { subtitle }),
        points,
      });
    } else if (card) {
      shots.push({ kind: 'chapter', chapter: index, duration: card.duration, title, ...(subtitle && { subtitle }) });
    }

    let previousCaption: string | undefined;
    const sectionTitle = chapter.visit?.place ?? title;
    for (const { photo, clip } of chosen[index]) {
      let caption: string | undefined;
      if (captions) {
        const entry = getEntryCaption(photo);
        // a visit's card names its place and city: its photos are only named after their entries (the dishes)
        caption = entry
          ? redact(photo.collection?.pack, entry)
          : chapter.visit
            ? undefined
            : getFactualCaption([photo], 'place', { sectionTitle, previous: previousCaption });
        if (caption && caption === previousCaption) {
          caption = undefined;
        }
        if (caption) {
          previousCaption = caption;
        }
      }

      if (clip) {
        const length = clipLength(clip.id);
        shots.push({
          kind: 'clip',
          assetId: clip.id,
          chapter: index,
          duration: length,
          start: getClipStart(clip, length),
          ...(caption && { caption }),
        });
        continue;
      }

      const duration = durations.get(photo.id) ?? PHOTO_SECONDS;
      const { frame, crop } = getPhotoFraming({ ...photo, focus: focus.get(photo.id) }, format);
      const { from, to } = getPanRects(
        {
          width: photo.width,
          height: photo.height,
          faces: photo.faces,
          focus: focus.get(photo.id),
          crop,
          duration,
          frameAspect: frameSize.width / frameSize.height,
        },
        frame,
        photoIndex++,
      );
      shots.push({
        kind: 'photo',
        assetId: photo.id,
        chapter: index,
        duration,
        frame,
        crop,
        from,
        to,
        ...(caption && { caption }),
      });
    }
  }

  snapToFrames(shots, fps, fade, target);

  const usedIds = shots.flatMap((shot) => ('assetId' in shot ? [shot.assetId] : []));
  const length = getHighlightLength(shots, fade);
  if (length < target - 0.5) {
    warnings.push(`There are only enough photos for ${Math.round(length)} seconds`);
  }
  return {
    format,
    ...frameSize,
    shots,
    chapters: chapters
      .map((chapter, index) => ({
        title: chapterTitles[index].title,
        ...(chapterTitles[index].subtitle && { subtitle: chapterTitles[index].subtitle }),
        assetIds: chosen[index].map((item) => item.photo.id),
        located: located(chapter.photos),
        ...(chapter.visit && { pack: chapter.visit.pack }),
      }))
      .filter((chapter) => chapter.assetIds.length > 0),
    fps,
    fade,
    durationSeconds: round4(length),
    usedIds,
    warnings,
  };
};

export type HighlightFraming = {
  /** `cover` crops the photo to the frame (the region `crop`), `contain` shows it whole over a blurred copy of itself */
  frame: 'cover' | 'contain';
  crop: NormalizedRect;
};

const whole = (): HighlightFraming => ({ frame: 'contain', crop: { x: 0, y: 0, width: 1, height: 1 } });

/**
 * How a photo fills the frame of a film. In a landscape film, a photo much narrower than the frame (a portrait) is
 * shown whole, any other is cropped to the frame keeping its faces. In a vertical film, a portrait photo fills the
 * frame; a landscape photo is cropped tightly around its subject (its faces, or its focus point, see `getSmartCrop`),
 * and shown whole instead when the crop would cut a face, keep less than `MIN_VERTICAL_KEEP` of it (16:9, panoramas),
 * be enlarged too much, or when it has no subject to crop around.
 */
export const getPhotoFraming = (
  photo: Pick<HighlightPhoto, 'width' | 'height' | 'faces' | 'focus'>,
  format: HighlightFormat = 'landscape',
): HighlightFraming => {
  const size = getHighlightFrame(format);
  const frameAspect = size.width / size.height;
  const known = photo.width > 0 && photo.height > 0;
  const aspect = known ? photo.width / photo.height : frameAspect;
  if (aspect < frameAspect * CONTAIN_BELOW) {
    return whole();
  }
  if (!known) {
    return { frame: 'cover', crop: { x: 0, y: 0, width: 1, height: 1 } };
  }
  if (format === 'landscape') {
    // the largest region of the photo with the frame's aspect ratio that keeps the faces
    return { frame: 'cover', crop: getSmartCrop(photo, photo.faces, frameAspect).crop };
  }

  const smart = getSmartCrop(photo, photo.faces, frameAspect, photo.faces.length === 0 ? photo.focus : undefined);
  const cropWidth = smart.crop.width * photo.width;
  if (!smart.feasible || smart.droppedFaces > 0 || size.width / cropWidth > MAX_CROP_UPSCALE) {
    return whole();
  }
  const landscape = aspect > 1;
  if (landscape && (smart.kept < MIN_VERTICAL_KEEP || (photo.faces.length === 0 && !photo.focus))) {
    return whole();
  }
  return { frame: 'cover', crop: smart.crop };
};

/**
 * Rounds the shots to whole frames, and makes the film exactly `target` long (to the frame) by lengthening or
 * shortening the photos, the longest first, when they add up to it
 */
const snapToFrames = (shots: HighlightShot[], fps: number, fade: number, target: number) => {
  const fadeFrames = toFrames(fade, fps);
  for (const shot of shots) {
    shot.duration = toFrames(shot.duration, fps) / fps;
  }
  const photos = shots.filter((shot): shot is HighlightPhotoShot => shot.kind === 'photo');
  if (photos.length === 0) {
    return;
  }
  const frames =
    shots.reduce((sum, shot) => sum + Math.round(shot.duration * fps), 0) - (shots.length - 1) * fadeFrames;
  let diff = Math.round(target * fps) - frames;
  const min = Math.round(MIN_PHOTO_SECONDS * fps);
  const max = Math.round(MAX_PHOTO_SECONDS * fps);
  // a frame at a time, spread over the photos
  for (let guard = 0; diff !== 0 && guard < 10_000; guard++) {
    const candidates = photos
      .filter((shot) => {
        const count = Math.round(shot.duration * fps);
        return diff > 0 ? count < max : count > min;
      })
      .toSorted((a, b) => (diff > 0 ? a.duration - b.duration : b.duration - a.duration));
    const shot = candidates[0];
    if (!shot) {
      break;
    }
    const step = diff > 0 ? 1 : -1;
    shot.duration = (Math.round(shot.duration * fps) + step) / fps;
    diff -= step;
  }
};
