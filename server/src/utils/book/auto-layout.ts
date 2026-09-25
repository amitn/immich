import type { BookMap, BookStyle, NormalizedRect } from 'src/dtos/book.dto.js';
import { DEFAULT_EVENT_OPTIONS, EventSplitOptions, splitEvents } from 'src/utils/agent/events.js';
import { BookLayout, PageSize, bookLayouts, getSlotAspectRatios } from 'src/utils/book/layouts.js';
import { BookMapStyle } from 'src/utils/book/map-styles.js';
import { getSmartCrop } from 'src/utils/book/render.js';

export type AutoLayoutPhoto = {
  id: string;
  /** size of the photo as displayed (orientation applied); 0 when unknown */
  width: number;
  height: number;
  /** local capture time in ms */
  takenAt: number;
  lat?: number | null;
  lon?: number | null;
  city?: string | null;
  country?: string | null;
  /** quality score, 0..1 */
  score: number;
  /** face boxes normalized to 0..1 */
  faces: NormalizedRect[];
  isFavorite: boolean;
  /** near-duplicate cluster; photos without one are unique */
  clusterId?: number | null;
  /** event the photo belongs to; events are computed when any photo lacks one */
  eventIndex?: number | null;
};

export type AutoLayoutOptions = {
  size: PageSize;
  style: BookStyle;
  /** default: about one page per 2.5 photos, 4 to 80 pages */
  targetPageCount?: number;
  /** open the sections with GPS locations with a map page, default true */
  includeMaps?: boolean;
  mapStyle?: BookMapStyle;
  /** photos that get a page of their own */
  heroIds?: string[];
  /** start with a cover page, default true */
  cover?: boolean;
  /** end with a text page */
  closing?: { title?: string; caption?: string };
  events?: EventSplitOptions;
  layouts?: readonly BookLayout[];
};

export type AutoLayoutSlot = { assetId: string; crop: NormalizedRect };

export type AutoLayoutPage = {
  layout: string;
  slots: AutoLayoutSlot[];
  sectionTitle?: string;
  caption?: string;
  map?: BookMap;
  /** index of the section the page belongs to */
  section?: number;
};

export type AutoLayoutSection = { title: string; dates: string; photoIds: string[]; located: boolean };

export type AutoLayoutPlan = {
  pages: AutoLayoutPage[];
  sections: AutoLayoutSection[];
  usedIds: string[];
  /** photos left out because of near-duplicates or the page budget */
  droppedIds: string[];
};

/** a crop that loses more than this share of the photo is not acceptable */
export const MAX_CROP_LOSS = 0.45;
export const PHOTOS_PER_PAGE = 2.5;
export const MIN_AUTO_PAGES = 4;
export const MAX_AUTO_PAGES = 80;
/** more photos per content page than this and the lowest ranked photos are dropped */
const MAX_DENSITY = 4;
const MIN_SECTION_SIZE = 3;
const PAGE_SIZES = [1, 2, 3, 4, 6] as const;
const SIZE_PENALTY: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0.05, 6: 0.35 };
const SIZE_REPEAT_PENALTY = 0.15;
const LAYOUT_REPEAT_PENALTY = 2;
const HERO_SHARED_PENALTY = 5;
const SAME_CLUSTER_PENALTY = 3;
const OPENER_LAYOUTS = new Set(['cover', 'section-opener', 'text', 'map', 'map-photo']);

type Candidate = AutoLayoutPhoto & { importance: number; hero: boolean; located: boolean };

type LayoutChoice = { layout: BookLayout; cost: number; order: Candidate[]; crops: NormalizedRect[] };

type Group = { photos: Candidate[]; choices: LayoutChoice[] };

type PlannedPage = LayoutChoice;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const byTime = (a: AutoLayoutPhoto, b: AutoLayoutPhoto) => a.takenAt - b.takenAt || a.id.localeCompare(b.id);

const byImportance = (a: Candidate, b: Candidate) => b.importance - a.importance || byTime(a, b);

const isLocated = (photo: AutoLayoutPhoto) =>
  typeof photo.lat === 'number' &&
  typeof photo.lon === 'number' &&
  Number.isFinite(photo.lat) &&
  Number.isFinite(photo.lon) &&
  !(photo.lat === 0 && photo.lon === 0);

export const getImportance = (photo: AutoLayoutPhoto, hero = false) =>
  clamp(photo.score, 0, 1) + (photo.isFavorite ? 0.2 : 0) + (photo.faces.length > 0 ? 0.05 : 0) + (hero ? 1 : 0);

export const getTargetPageCount = (photoCount: number) =>
  clamp(Math.round(photoCount / PHOTOS_PER_PAGE), MIN_AUTO_PAGES, MAX_AUTO_PAGES);

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayMonthFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** e.g. "12 June 2024", "12–14 June 2024" or "30 June – 2 July 2024" */
export const formatDateRange = (start: number, end: number) => {
  const a = new Date(start);
  const b = new Date(end);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  if (sameMonth && a.getUTCDate() === b.getUTCDate()) {
    return dateFormat.format(a);
  }
  if (sameMonth) {
    return `${a.getUTCDate()}–${dateFormat.format(b)}`;
  }
  return sameYear
    ? `${dayMonthFormat.format(a)} – ${dateFormat.format(b)}`
    : `${dateFormat.format(a)} – ${dateFormat.format(b)}`;
};

const countValues = (values: Array<string | null | undefined>) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
  }
  return [...counts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

/** the main place (or two) of a section, falling back to the date */
export const getSectionTitle = (photos: AutoLayoutPhoto[]) => {
  const cities = countValues(photos.map((photo) => photo.city));
  if (cities.length > 0) {
    const [[first, firstCount], second] = cities;
    if (!second || second[1] < Math.max(2, 0.25 * (firstCount + second[1]))) {
      return first;
    }
    const order = photos.map((photo) => photo.city?.trim());
    return order.indexOf(first) <= order.indexOf(second[0]) ? `${first} & ${second[0]}` : `${second[0]} & ${first}`;
  }

  const [country] = countValues(photos.map((photo) => photo.country));
  if (country) {
    return country[0];
  }

  const times = photos.map((photo) => photo.takenAt);
  return formatDateRange(Math.min(...times), Math.max(...times));
};

const getEvents = (photos: Candidate[], options?: EventSplitOptions): Candidate[][] => {
  if (photos.every((photo) => typeof photo.eventIndex === 'number')) {
    return Map.groupBy(photos, (photo) => photo.eventIndex!)
      .values()
      .map((event) => event.toSorted(byTime))
      .toArray()
      .toSorted((a, b) => byTime(a[0], b[0]));
  }

  const points = photos.map((photo) => ({
    ...photo,
    time: photo.takenAt,
    latitude: photo.lat,
    longitude: photo.lon,
  }));
  return splitEvents(points, options ?? DEFAULT_EVENT_OPTIONS).map((event) =>
    event.map(({ time: _, ...photo }) => photo),
  );
};

/** merges the smallest events into their closest neighbour until there are few enough and none is tiny */
export const mergeEvents = <T extends { takenAt: number }>(events: T[][], maxSections: number, minSize: number) => {
  const sections = events.filter((event) => event.length > 0).map((event) => [...event]);
  const gap = (a: T[], b: T[]) => b[0].takenAt - a.at(-1)!.takenAt;

  while (sections.length > 1) {
    let index = -1;
    for (const [i, section] of sections.entries()) {
      if (index === -1 || section.length < sections[index].length) {
        index = i;
      }
    }

    if (sections.length <= maxSections && sections[index].length >= minSize) {
      break;
    }

    const before = index > 0 ? gap(sections[index - 1], sections[index]) : Infinity;
    const after = index < sections.length - 1 ? gap(sections[index], sections[index + 1]) : Infinity;
    const target = before <= after ? index - 1 : index + 1;
    const [first, second] = target < index ? [target, index] : [index, target];
    sections.splice(first, 2, [...sections[first], ...sections[second]]);
  }

  return sections;
};

const permutations = <T>(items: T[]): T[][] => {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
};

type SlotShape = { aspect: number; area: number };

class LayoutPlanner {
  private crops = new Map<string, ReturnType<typeof getSmartCrop>>();
  private shapes = new Map<string, SlotShape[]>();
  readonly contentLayouts: Map<number, BookLayout[]>;
  readonly layoutList: BookLayout[] = [];
  readonly layoutIndex = new Map<string, number>();

  constructor(
    private size: PageSize,
    private style: BookStyle,
    layouts: readonly BookLayout[],
  ) {
    this.contentLayouts = new Map();
    for (const layout of layouts) {
      if (OPENER_LAYOUTS.has(layout.id) || layout.slots.length === 0 || layout.map) {
        continue;
      }
      const list = this.contentLayouts.get(layout.slots.length) ?? [];
      list.push(layout);
      this.contentLayouts.set(layout.slots.length, list);
      this.layoutIndex.set(layout.id, this.layoutList.length);
      this.layoutList.push(layout);
    }
  }

  getShapes(layout: BookLayout) {
    let shapes = this.shapes.get(layout.id);
    if (!shapes) {
      const aspects = getSlotAspectRatios(layout, this.size, this.style);
      shapes = layout.slots.map((slot, i) => ({ aspect: aspects[i], area: slot.width * slot.height }));
      this.shapes.set(layout.id, shapes);
    }
    return shapes;
  }

  getCrop(photo: AutoLayoutPhoto, aspect: number) {
    const key = `${photo.id}:${aspect.toFixed(4)}`;
    let crop = this.crops.get(key);
    if (!crop) {
      crop = getSmartCrop(photo, photo.faces, aspect);
      this.crops.set(key, crop);
    }
    return crop;
  }

  /** cost of the photo in a slot, Infinity when the crop cuts a face or loses too much of the photo */
  slotCost(photo: Candidate, shape: SlotShape, ideal: number, strict: boolean) {
    const crop = this.getCrop(photo, shape.aspect);
    const loss = 1 - crop.kept;
    if (strict && (!crop.feasible || loss > MAX_CROP_LOSS)) {
      return Infinity;
    }
    return 3 * loss + 0.5 * crop.droppedFaces + (crop.feasible ? 0 : 2) + 0.5 * Math.log(shape.area / ideal) ** 2;
  }

  /** the best order of the photos in the slots of a layout */
  fit(layout: BookLayout, photos: Candidate[], ideals: Map<string, number>, strict: boolean): LayoutChoice | null {
    const shapes = this.getShapes(layout);
    const uniform = shapes.every(
      (shape) => Math.abs(shape.aspect - shapes[0].aspect) < 1e-3 && Math.abs(shape.area - shapes[0].area) < 1e-3,
    );
    const orders = uniform || photos.length > 4 ? [photos] : permutations(photos);

    let best: { cost: number; order: Candidate[] } | null = null;
    for (const order of orders) {
      let cost = 0;
      for (const [i, photo] of order.entries()) {
        cost += this.slotCost(photo, shapes[i], ideals.get(photo.id)!, strict);
        if (cost === Infinity) {
          break;
        }
      }
      if (cost < Infinity && (!best || cost < best.cost - 1e-9)) {
        best = { cost, order };
      }
    }

    if (!best) {
      return null;
    }

    return {
      layout,
      cost: best.cost,
      order: best.order,
      crops: best.order.map((photo, i) => this.getCrop(photo, shapes[i].aspect).crop),
    };
  }

  group(photos: Candidate[], ideals: Map<string, number>, strict: boolean): Group | null {
    const layouts = this.contentLayouts.get(photos.length) ?? [];
    const sharedHero = photos.length > 1 && photos.some((photo) => photo.hero);
    if (sharedHero && strict) {
      return null;
    }
    let clusterPenalty = sharedHero ? HERO_SHARED_PENALTY : 0;
    for (const [i, a] of photos.entries()) {
      for (const b of photos.slice(i + 1)) {
        if (a.clusterId !== null && a.clusterId !== undefined && a.clusterId === b.clusterId) {
          clusterPenalty += SAME_CLUSTER_PENALTY;
        }
      }
    }

    const choices = layouts
      .map((layout) => this.fit(layout, photos, ideals, strict))
      .filter((choice): choice is LayoutChoice => !!choice)
      .map((choice) => ({ ...choice, cost: choice.cost + clusterPenalty + SIZE_PENALTY[photos.length] }))
      .toSorted((a, b) => a.cost - b.cost);

    return choices.length > 0 ? { photos, choices } : null;
  }

  /**
   * Splits the time-ordered photos of a section into `pages` pages and picks their layouts, choosing page sizes by
   * importance and fit, and avoiding the layout (and preferably the size) of the previous page.
   */
  partition(photos: Candidate[], pages: number, strict: boolean, previous?: string): PlannedPage[] | null {
    const n = photos.length;
    const ideals = getIdealAreas(photos, pages);

    const groups = new Map<string, Group | null>();
    const getGroup = (start: number, size: number) => {
      const key = `${start}:${size}`;
      if (!groups.has(key)) {
        groups.set(key, this.group(photos.slice(start, start + size), ideals, strict));
      }
      return groups.get(key)!;
    };

    // cost[j][i][l]: the first i photos on j pages, the last page having layout l (none = the page before the section)
    const none = this.layoutList.length;
    const states = none + 1;
    const cost: Float64Array[][] = [];
    const from: Int32Array[][] = [];
    for (let j = 0; j <= pages; j++) {
      cost.push(Array.from({ length: n + 1 }, () => new Float64Array(states).fill(Infinity)));
      from.push(Array.from({ length: n + 1 }, () => new Int32Array(states).fill(-1)));
    }
    const initial = previous === undefined ? none : (this.layoutIndex.get(previous) ?? none);
    cost[0][0][initial] = 0;

    for (let j = 0; j < pages; j++) {
      for (let i = 0; i < n; i++) {
        for (let last = 0; last < states; last++) {
          const current = cost[j][i][last];
          if (current === Infinity) {
            continue;
          }
          const lastSize = last === none ? 0 : this.layoutList[last].slots.length;
          for (const size of PAGE_SIZES) {
            if (i + size > n) {
              break;
            }
            const group = getGroup(i, size);
            if (!group) {
              continue;
            }
            const sizeRepeat = lastSize === size ? SIZE_REPEAT_PENALTY * (size === 6 ? 4 : 1) : 0;
            for (const choice of group.choices) {
              const state = this.layoutIndex.get(choice.layout.id)!;
              const next = current + choice.cost + sizeRepeat + (state === last ? LAYOUT_REPEAT_PENALTY : 0);
              if (next >= cost[j + 1][i + size][state] - 1e-9) {
                continue;
              }
              cost[j + 1][i + size][state] = next;
              from[j + 1][i + size][state] = last;
            }
          }
        }
      }
    }

    let best = -1;
    for (let state = 0; state < none; state++) {
      if (cost[pages][n][state] < Infinity && (best === -1 || cost[pages][n][state] < cost[pages][n][best] - 1e-9)) {
        best = state;
      }
    }
    if (best === -1) {
      return null;
    }

    const result: PlannedPage[] = [];
    let i = n;
    let state = best;
    for (let j = pages; j > 0; j--) {
      const layout = this.layoutList[state];
      const size = layout.slots.length;
      const group = getGroup(i - size, size)!;
      result.unshift(group.choices.find((choice) => choice.layout.id === layout.id)!);
      state = from[j][i][state];
      i -= size;
    }
    return result;
  }
}

/**
 * The share of a page each photo deserves: proportional to exp(4 × importance), with a bonus for the best two photos
 * of the section, so that the sum over all photos matches the number of pages. Heroes get a whole page.
 */
export const getIdealAreas = (photos: Candidate[], pages: number) => {
  const heroes = photos.filter((photo) => photo.hero);
  const others = photos.filter((photo) => !photo.hero);
  const featured = new Map(
    photos.length >= 4
      ? others
          .toSorted(byImportance)
          .slice(0, 2)
          .map((photo, rank) => [photo.id, rank === 0 ? 0.35 : 0.15])
      : [],
  );
  const weights = others.map((photo) => Math.exp(4 * (photo.importance + (featured.get(photo.id) ?? 0))));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const available = Math.max(pages - heroes.length, others.length / 6);

  return new Map([
    ...heroes.map((photo) => [photo.id, 1] as const),
    ...others.map((photo, i) => [photo.id, clamp((available * weights[i]) / total, 0.12, 1)] as const),
  ]);
};

/** splits `total` pages over sections proportional to their photos: at least one page each, at most six photos per page */
export const allocatePages = (sizes: number[], total: number) => {
  const pages = sizes.map((size) => Math.max(1, Math.ceil(size / 6)));
  let remaining = total - pages.reduce((sum, count) => sum + count, 0);
  while (remaining > 0) {
    let best = -1;
    for (const [i, size] of sizes.entries()) {
      if (pages[i] < size && (best === -1 || size / pages[i] > sizes[best] / pages[best] + 1e-9)) {
        best = i;
      }
    }
    if (best === -1) {
      break;
    }
    pages[best]++;
    remaining--;
  }
  return pages;
};

/**
 * Lays out photos as a photo book: a cover, then one section per event (merged when events are small or too many),
 * each opened by a map (with GPS) or a section opener, followed by content pages. Important photos (heroes,
 * favourites, high scores, faces) get whole pages or hero slots, the others fill denser layouts. Page sizes, layouts
 * and the order of photos in them minimize crop loss, never cut faces and avoid repeating the previous layout.
 * The result only depends on the input.
 */
export const planAutoLayout = (input: AutoLayoutPhoto[], options: AutoLayoutOptions): AutoLayoutPlan => {
  const layouts = options.layouts ?? bookLayouts;
  const planner = new LayoutPlanner(options.size, options.style, layouts);
  const heroes = new Set(options.heroIds);
  const includeMaps = options.includeMaps ?? true;
  const mapStyle = options.mapStyle ?? 'sketch';
  const withCover = options.cover ?? true;
  const layoutIds = new Set(layouts.map((layout) => layout.id));
  const hasLayout = (id: string) => layoutIds.has(id);

  const seen = new Set<string>();
  const photos: Candidate[] = input
    .filter((photo) => !seen.has(photo.id) && !!seen.add(photo.id))
    .map((photo) => ({
      ...photo,
      hero: heroes.has(photo.id),
      importance: getImportance(photo, heroes.has(photo.id)),
      located: isLocated(photo),
    }))
    .toSorted(byTime);

  const empty: AutoLayoutPlan = { pages: [], sections: [], usedIds: [], droppedIds: [] };
  if (photos.length === 0) {
    return empty;
  }

  const target = Math.max(1, Math.round(options.targetPageCount ?? getTargetPageCount(photos.length)));
  const pages: AutoLayoutPage[] = [];
  const used = new Set<string>();
  const place = (photo: Candidate, layout: BookLayout, slot = 0): AutoLayoutSlot => {
    used.add(photo.id);
    const aspect = planner.getShapes(layout)[slot].aspect;
    return { assetId: photo.id, crop: planner.getCrop(photo, aspect).crop };
  };

  const fitsSlot = (photo: Candidate, layout: BookLayout, slot = 0) => {
    const crop = planner.getCrop(photo, planner.getShapes(layout)[slot].aspect);
    return crop.feasible && 1 - crop.kept <= MAX_CROP_LOSS;
  };

  /** the best of the top candidates that fits the slot well, or the best candidate */
  const pickFor = (candidates: Candidate[], layout: BookLayout, top = 3) => {
    const ranked = candidates.toSorted(byImportance);
    return ranked.slice(0, top).find((photo) => fitsSlot(photo, layout)) ?? ranked[0];
  };

  let pool = photos;
  const coverLayout = layouts.find((layout) => layout.id === 'cover');
  if (withCover && coverLayout && photos.length > 1) {
    const cover = pickFor(photos, coverLayout, 5);
    pages.push({ layout: 'cover', slots: [place(cover, coverLayout)] });
    pool = photos.filter((photo) => photo.id !== cover.id);
  }

  // one photo per near-duplicate cluster, unless that leaves too few photos for the pages
  const contentEstimate = Math.max(1, target - pages.length);
  const clusterRanks = new Map<string, number>();
  const byCluster = new Map<number, Candidate[]>();
  for (const photo of pool) {
    if (photo.clusterId !== null && photo.clusterId !== undefined) {
      byCluster.set(photo.clusterId, [...(byCluster.get(photo.clusterId) ?? []), photo]);
    }
  }
  for (const [clusterId, members] of byCluster) {
    // a cluster already represented on the cover counts as used
    const offset = used.size > 0 && photos.some((p) => used.has(p.id) && p.clusterId === clusterId) ? 1 : 0;
    for (const [rank, photo] of members.toSorted(byImportance).entries()) {
      clusterRanks.set(photo.id, rank + offset);
    }
  }

  let kept = pool.filter((photo) => photo.hero || (clusterRanks.get(photo.id) ?? 0) === 0);
  const wanted = Math.ceil(contentEstimate * 1.5);
  if (kept.length < wanted) {
    const extras = pool
      .filter((photo) => !kept.includes(photo) && (clusterRanks.get(photo.id) ?? 0) === 1)
      .toSorted(byImportance)
      .slice(0, wanted - kept.length);
    kept = [...kept, ...extras].toSorted(byTime);
  }

  // sections
  const maxSections = Math.max(1, Math.round(contentEstimate / 4.5));
  const sections = mergeEvents(getEvents(kept, options.events), maxSections, MIN_SECTION_SIZE);

  type SectionPlan = {
    photos: Candidate[];
    all: Candidate[];
    title: string;
    dates: string;
    opener: 'map' | 'map-photo' | 'section-opener' | null;
    openerPhoto?: Candidate;
  };

  const sectionPlans: SectionPlan[] = sections.map((section) => {
    const ids = new Set(section.map((photo) => photo.id));
    const all = photos.filter((photo) => ids.has(photo.id));
    const located = section.some((photo) => photo.located);
    let opener: SectionPlan['opener'] = null;
    if (includeMaps && located && hasLayout('map')) {
      opener = section.length >= 5 && hasLayout('map-photo') ? 'map-photo' : 'map';
    } else if (sections.length > 1 && section.length >= 4 && hasLayout('section-opener')) {
      opener = 'section-opener';
    }
    return {
      photos: section,
      all,
      title: getSectionTitle(section),
      dates: formatDateRange(section[0].takenAt, section.at(-1)!.takenAt),
      opener,
    };
  });

  const locatedSections = sectionPlans.filter((section) => section.photos.some((photo) => photo.located)).length;
  let overview = includeMaps && locatedSections >= 3 && target >= 12 && hasLayout('map');

  // keep enough content pages: drop the overview, then the openers of the smallest sections
  const closingPages = options.closing ? 1 : 0;
  const openerCount = () => sectionPlans.filter((section) => section.opener).length + (overview ? 1 : 0);
  const contentPages = () => target - pages.length - closingPages - openerCount();
  const minContent = () => Math.max(sectionPlans.length, Math.ceil((target - pages.length - closingPages) * 0.6));
  while (contentPages() < minContent() && openerCount() > 0) {
    if (overview) {
      overview = false;
      continue;
    }
    const smallest = sectionPlans
      .filter((section) => section.opener)
      .toSorted((a, b) => a.photos.length - b.photos.length || a.photos[0].takenAt - b.photos[0].takenAt)[0];
    smallest.opener = null;
  }

  for (const section of sectionPlans) {
    const layout = section.opener === 'map' ? undefined : layouts.find((item) => item.id === section.opener);
    if (layout && section.photos.length > 1) {
      section.openerPhoto = pickFor(section.photos, layout);
      section.photos = section.photos.filter((photo) => photo.id !== section.openerPhoto!.id);
    } else if (section.opener === 'section-opener' || section.opener === 'map-photo') {
      section.opener = includeMaps && section.opener === 'map-photo' ? 'map' : null;
    }
  }

  // page budget: drop the least important photos when the pages would get too dense
  let content = Math.max(sectionPlans.length, contentPages());
  const totalPhotos = sectionPlans.reduce((sum, section) => sum + section.photos.length, 0);
  const maxPhotos = Math.floor(content * MAX_DENSITY);
  if (totalPhotos > maxPhotos) {
    const droppable = sectionPlans
      .flatMap((section) => section.photos.filter((photo) => !photo.hero))
      .toSorted((a, b) => a.importance - b.importance || byTime(b, a));
    const remaining = new Map(sectionPlans.map((section, i) => [i, section.photos.length]));
    const sectionOf = new Map(sectionPlans.flatMap((section, i) => section.photos.map((photo) => [photo.id, i])));
    const drop = new Set<string>();
    for (const photo of droppable) {
      if (totalPhotos - drop.size <= maxPhotos) {
        break;
      }
      const index = sectionOf.get(photo.id)!;
      if (remaining.get(index)! <= 1) {
        continue;
      }
      drop.add(photo.id);
      remaining.set(index, remaining.get(index)! - 1);
    }
    for (const section of sectionPlans) {
      section.photos = section.photos.filter((photo) => !drop.has(photo.id));
    }
  }

  const sizes = sectionPlans.map((section) => section.photos.length);
  content = Math.min(
    content,
    sizes.reduce((sum, size) => sum + size, 0),
  );
  const allocation = allocatePages(sizes, content);

  const lastLayout = () => pages.at(-1)?.layout;
  const newMap = (extra: Partial<BookMap> = {}): BookMap => ({
    style: mapStyle,
    showRoute: true,
    labels: true,
    ...extra,
  });

  if (overview) {
    const located = kept.filter((photo) => photo.located).map((photo) => photo.id);
    pages.push({
      layout: 'map',
      slots: [],
      caption: formatDateRange(kept[0].takenAt, kept.at(-1)!.takenAt),
      map: newMap({ assetIds: located }),
    });
  }

  for (const [index, section] of sectionPlans.entries()) {
    if (section.photos.length === 0 && !section.openerPhoto) {
      continue;
    }

    switch (section.opener) {
      case 'map': {
        pages.push({
          layout: 'map',
          slots: [],
          sectionTitle: section.title,
          caption: section.dates,
          map: newMap({ title: section.title }),
          section: index,
        });
        break;
      }
      case 'map-photo':
      case 'section-opener': {
        const layout = layouts.find((item) => item.id === section.opener)!;
        pages.push({
          layout: layout.id,
          slots: [place(section.openerPhoto!, layout)],
          sectionTitle: section.title,
          ...(section.title !== section.dates && { caption: section.dates }),
          ...(section.opener === 'map-photo' && { map: newMap() }),
          section: index,
        });
        break;
      }
      case null: {
        break;
      }
    }

    if (section.photos.length === 0) {
      continue;
    }

    const count = clamp(allocation[index], Math.ceil(section.photos.length / 6), section.photos.length);
    const previous = lastLayout();
    const planned =
      planner.partition(section.photos, count, true, previous) ??
      planner.partition(section.photos, count, false, previous) ??
      planner.partition(section.photos, Math.ceil(section.photos.length / 6), false, previous) ??
      [];
    for (const choice of planned) {
      pages.push({
        layout: choice.layout.id,
        slots: choice.order.map((photo, i) => {
          used.add(photo.id);
          return { assetId: photo.id, crop: choice.crops[i] };
        }),
        section: index,
      });
    }
  }

  if (options.closing && hasLayout('text')) {
    pages.push({
      layout: 'text',
      slots: [],
      ...(options.closing.title && { sectionTitle: options.closing.title }),
      ...(options.closing.caption && { caption: options.closing.caption }),
    });
  }

  return {
    pages,
    sections: sectionPlans.map((section) => ({
      title: section.title,
      dates: section.dates,
      photoIds: section.all.map((photo) => photo.id),
      located: section.all.some((photo) => photo.located),
    })),
    usedIds: photos.filter((photo) => used.has(photo.id)).map((photo) => photo.id),
    droppedIds: photos.filter((photo) => !used.has(photo.id)).map((photo) => photo.id),
  };
};
