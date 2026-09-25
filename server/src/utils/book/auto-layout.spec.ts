import { defaultBookStyle } from 'src/dtos/book.dto.js';
import { DEFAULT_EVENT_OPTIONS, getAdaptiveEventOptions, splitEvents } from 'src/utils/agent/events.js';
import {
  AutoLayoutOptions,
  AutoLayoutPhoto,
  AutoLayoutPlan,
  MAX_CROP_LOSS,
  MAX_SINGLES_IN_A_ROW,
  allocatePages,
  formatDateRange,
  getFactualCaption,
  getPersonMinimums,
  getPhotoKind,
  getPhotoSimilarity,
  getPlacementDpi,
  getSectionTitle,
  getTargetPageCount,
  isSinglePhotoPage,
  mergeEvents,
  planAutoLayout,
} from 'src/utils/book/auto-layout.js';
import { getLayout, getSlotAspectRatios, getSlotRectsMm } from 'src/utils/book/layouts.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const start = Date.UTC(2024, 5, 12, 9);
const size = { pageWidthMm: 210, pageHeightMm: 210 };
const style = { ...defaultBookStyle };

let counter = 0;
const photo = (dto: Partial<AutoLayoutPhoto> = {}): AutoLayoutPhoto => {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    width: 3000,
    height: 2000,
    takenAt: start + counter * 60_000,
    score: 0.5,
    faces: [],
    isFavorite: false,
    ...dto,
  };
};

const portrait = (dto: Partial<AutoLayoutPhoto> = {}) => photo({ width: 2000, height: 3000, ...dto });

/** photos of one event, `minutes` apart */
const event = (count: number, at: number, dto: (i: number) => Partial<AutoLayoutPhoto> = () => ({})) =>
  Array.from({ length: count }, (_, i) => photo({ takenAt: at + i * 5 * 60_000, ...dto(i) }));

const plan = (photos: AutoLayoutPhoto[], options: Partial<AutoLayoutOptions> = {}) =>
  planAutoLayout(photos, { size, style, ...options });

const placedIds = (result: AutoLayoutPlan) => result.pages.flatMap((page) => page.slots.map((slot) => slot.assetId));

const slotAspect = (layout: string, slot: number) => getSlotAspectRatios(getLayout(layout)!, size, style)[slot];

beforeEach(() => {
  counter = 0;
});

describe('planAutoLayout', () => {
  it('should return no pages without photos', () => {
    expect(plan([])).toEqual({ pages: [], sections: [], usedIds: [], droppedIds: [], dropReasons: {}, people: [] });
  });

  it('should be deterministic and independent of the input order', () => {
    const photos = [
      ...event(14, start, (i) => ({ score: ((i * 37) % 10) / 10, city: 'Rome', lat: 41.9, lon: 12.5 })),
      ...event(9, start + DAY, (i) => ({ score: ((i * 17) % 10) / 10, city: 'Florence', lat: 43.77, lon: 11.25 })),
      ...Array.from({ length: 6 }, (_, i) => portrait({ takenAt: start + 2 * DAY + i * 60_000 })),
    ];

    const first = plan(photos);
    expect(plan(photos)).toEqual(first);
    expect(plan(photos.toReversed())).toEqual(first);
  });

  it('should start with a cover of the best photo', () => {
    const photos = event(10, start);
    photos[6].score = 0.95;
    photos[6].isFavorite = true;

    const [cover] = plan(photos).pages;
    expect(cover).toEqual({ layout: 'cover', slots: [{ assetId: photos[6].id, crop: expect.any(Object) }] });
  });

  it('should place every photo at most once and report the rest as dropped', () => {
    const photos = event(40, start);
    const result = plan(photos, { targetPageCount: 6 });
    const placed = placedIds(result);

    expect(new Set(placed).size).toBe(placed.length);
    expect(result.usedIds.toSorted()).toEqual([...new Set(placed)].toSorted());
    expect([...result.usedIds, ...result.droppedIds].toSorted()).toEqual(photos.map(({ id }) => id).toSorted());
  });

  it('should put portrait photos in portrait slots and landscape photos in landscape slots', () => {
    const portraits = Array.from({ length: 8 }, (_, i) => portrait({ takenAt: start + i * 60_000 }));
    const landscapes = Array.from({ length: 8 }, (_, i) => photo({ takenAt: start + DAY + i * 60_000 }));

    for (const photos of [portraits, landscapes]) {
      const result = plan(photos, { cover: false, targetPageCount: 4, includeMaps: false });
      for (const page of result.pages) {
        for (const [i, slot] of page.slots.entries()) {
          const input = photos.find(({ id }) => id === slot.assetId)!;
          const photoAspect = input.width / input.height;
          const aspect = slotAspect(page.layout, i);
          const kept = Math.min(photoAspect / aspect, aspect / photoAspect);
          expect(1 - kept).toBeLessThanOrEqual(MAX_CROP_LOSS);
          expect(slot.crop.width * slot.crop.height).toBeCloseTo(kept, 2);
        }
      }
    }

    const portraitLayouts = plan(portraits, { cover: false, targetPageCount: 4 }).pages.map((page) => page.layout);
    expect(portraitLayouts).not.toContain('two-vertical');
    const landscapeLayouts = plan(landscapes, { cover: false, targetPageCount: 4 }).pages.map((page) => page.layout);
    expect(landscapeLayouts).not.toContain('two-horizontal');
  });

  it('should put the portrait in the portrait hero slot of a mixed page', () => {
    const photos = [portrait(), portrait({ score: 0.9 }), portrait()];
    const result = plan(photos, { cover: false, targetPageCount: 1 });
    expect(result.pages).toHaveLength(1);
    const [page] = result.pages;
    expect(page.layout).toBe('hero-left-two');
    expect(page.slots[0].assetId).toBe(photos[1].id);
  });

  it('should give the most important photos whole pages or hero slots', () => {
    const photos = event(18, start, () => ({ score: 0.3 }));
    photos[4].score = 1;
    photos[4].isFavorite = true;
    photos[12].score = 0.95;
    photos[12].faces = [{ x: 0.45, y: 0.3, width: 0.1, height: 0.15 }];

    const result = plan(photos, { cover: false, targetPageCount: 6, includeMaps: false });
    for (const important of [photos[4], photos[12]]) {
      const page = result.pages.find((page) => page.slots.some((slot) => slot.assetId === important.id))!;
      const slot = page.slots.findIndex((item) => item.assetId === important.id);
      const layout = getLayout(page.layout)!;
      const area = layout.slots[slot].width * layout.slots[slot].height;
      expect(area).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('should give hero photos a page of their own', () => {
    const photos = event(20, start);
    const heroIds = [photos[3].id, photos[15].id];
    const result = plan(photos, { cover: false, heroIds, targetPageCount: 7 });

    for (const id of heroIds) {
      const page = result.pages.find((page) => page.slots.some((slot) => slot.assetId === id))!;
      expect(page.slots).toHaveLength(1);
    }
  });

  it('should not repeat the layout of the previous page', () => {
    const photos = [
      ...event(30, start, (i) => ({ score: ((i * 7) % 10) / 10, width: i % 3 === 0 ? 2000 : 3000, height: 2000 })),
      ...event(30, start + DAY, (i) => ({ score: ((i * 3) % 10) / 10 })),
    ];
    const result = plan(photos, { targetPageCount: 20 });
    for (const [i, page] of result.pages.slice(1).entries()) {
      expect(page.layout).not.toBe(result.pages[i].layout);
    }
  });

  it('should use one photo of each near-duplicate cluster', () => {
    const photos = event(30, start, (i) => ({ clusterId: i < 24 ? Math.floor(i / 3) : null, score: (i % 3) / 3 }));
    const result = plan(photos, { targetPageCount: 6, includeMaps: false });
    const placed = new Set(placedIds(result));

    for (let cluster = 0; cluster < 8; cluster++) {
      const members = photos.filter((item) => item.clusterId === cluster);
      expect(members.filter((item) => placed.has(item.id))).toHaveLength(1);
      // the best of the cluster
      expect(placed.has(members[2].id)).toBe(true);
    }
  });

  it('should keep near-duplicates apart when photos are scarce', () => {
    const photos = event(12, start, (i) => ({ clusterId: Math.floor(i / 2) }));
    const result = plan(photos, { targetPageCount: 6, includeMaps: false });
    expect(placedIds(result).length).toBeGreaterThan(6);

    for (const page of result.pages) {
      const clusters = page.slots.map((slot) => photos.find(({ id }) => id === slot.assetId)!.clusterId);
      expect(new Set(clusters).size).toBe(clusters.length);
    }
  });

  it('should respect the page budget', () => {
    const photos = [...event(30, start), ...event(30, start + DAY)];
    const result = plan(photos, { targetPageCount: 20 });
    expect(result.pages.length).toBeGreaterThanOrEqual(18);
    expect(result.pages.length).toBeLessThanOrEqual(22);
    expect(result.droppedIds).toHaveLength(0);
  });

  it('should drop the least important photos when there are too many for the pages', () => {
    const photos = event(120, start, (i) => ({ score: i < 20 ? 0.9 : 0.2 }));
    const result = plan(photos, { targetPageCount: 10 });
    expect(result.pages.length).toBeLessThanOrEqual(11);
    expect(result.droppedIds.length).toBeGreaterThan(0);

    const placed = new Set(placedIds(result));
    expect(photos.slice(0, 20).every((item) => placed.has(item.id))).toBe(true);
    expect(Math.max(...result.pages.map((page) => page.slots.length))).toBeLessThanOrEqual(6);
  });

  it('should default to about one page per 2.5 photos', () => {
    expect(getTargetPageCount(5)).toBe(4);
    expect(getTargetPageCount(100)).toBe(40);
    expect(getTargetPageCount(1000)).toBe(80);

    const result = plan(event(50, start));
    expect(result.pages.length).toBeGreaterThanOrEqual(18);
    expect(result.pages.length).toBeLessThanOrEqual(22);
  });

  it('should open every event with GPS with a map', () => {
    const rome = event(12, start, () => ({ city: 'Rome', country: 'Italy', lat: 41.9, lon: 12.5 }));
    const florence = event(4, start + DAY, () => ({ city: 'Florence', country: 'Italy', lat: 43.77, lon: 11.25 }));
    const result = plan([...rome, ...florence], { mapStyle: 'watercolor', targetPageCount: 9 });

    const maps = result.pages.filter((page) => page.map);
    expect(maps).toEqual([
      expect.objectContaining({
        layout: 'map-photo',
        sectionTitle: 'Rome',
        caption: '12 June 2024',
        map: { style: 'watercolor', showRoute: true, labels: true },
      }),
      expect.objectContaining({
        layout: 'map',
        sectionTitle: 'Florence',
        map: { style: 'watercolor', showRoute: true, labels: true, title: 'Florence' },
      }),
    ]);

    // each map comes before the photos of its section
    const mapIndex = result.pages.findIndex((page) => page.sectionTitle === 'Florence');
    const florenceIds = new Set(florence.map(({ id }) => id));
    const firstFlorencePhoto = result.pages.findIndex(
      (page, i) => i > 0 && page.slots.some((slot) => florenceIds.has(slot.assetId)),
    );
    expect(firstFlorencePhoto).toBeGreaterThan(mapIndex);
    expect(result.sections.map((section) => section.title)).toEqual(['Rome', 'Florence']);
  });

  it('should use section openers instead of maps without GPS', () => {
    const photos = [...event(10, start), ...event(10, start + DAY)];
    const result = plan(photos, { targetPageCount: 10 });

    expect(result.pages.some((page) => page.map || page.layout.startsWith('map'))).toBe(false);
    expect(result.pages.filter((page) => page.layout === 'section-opener')).toEqual([
      expect.objectContaining({ sectionTitle: '12 June 2024' }),
      expect.objectContaining({ sectionTitle: '13 June 2024' }),
    ]);
  });

  it('should skip maps when they are turned off', () => {
    const photos = [
      ...event(10, start, () => ({ city: 'Rome', lat: 41.9, lon: 12.5 })),
      ...event(10, start + DAY, () => ({ city: 'Florence', lat: 43.77, lon: 11.25 })),
    ];
    const result = plan(photos, { includeMaps: false, targetPageCount: 10 });
    expect(result.pages.some((page) => page.map)).toBe(false);
    expect(result.pages.filter((page) => page.layout === 'section-opener').map((page) => page.sectionTitle)).toEqual([
      'Rome',
      'Florence',
    ]);
  });

  it('should add an overview map for a trip with several located sections', () => {
    const cities = [
      { city: 'Rome', lat: 41.9, lon: 12.5 },
      { city: 'Florence', lat: 43.77, lon: 11.25 },
      { city: 'Venice', lat: 45.44, lon: 12.33 },
    ];
    const photos = cities.flatMap((city, i) => event(12, start + i * DAY, () => city));
    const result = plan(photos, { targetPageCount: 16 });

    expect(result.pages[1]).toEqual(
      expect.objectContaining({ layout: 'map', map: expect.objectContaining({ assetIds: expect.any(Array) }) }),
    );
    expect(result.pages[1].map!.assetIds).toHaveLength(photos.length - 1);
  });

  it('should not cut faces', () => {
    const face = { x: 0.02, y: 0.3, width: 0.18, height: 0.3 };
    const photos = event(8, start, () => ({ faces: [face] }));
    const result = plan(photos, { cover: false, targetPageCount: 3 });
    for (const page of result.pages) {
      for (const slot of page.slots) {
        expect(slot.crop.x).toBeLessThanOrEqual(face.x + 1e-4);
        expect(slot.crop.x + slot.crop.width).toBeGreaterThanOrEqual(face.x + face.width - 1e-4);
      }
    }
  });

  it('should add a closing page', () => {
    const result = plan(event(8, start), { closing: { title: 'The end' } });
    expect(result.pages.at(-1)).toEqual({ layout: 'text', slots: [], sectionTitle: 'The end' });
  });

  it('should append without a cover', () => {
    const result = plan(event(8, start), { cover: false });
    expect(result.pages[0].layout).not.toBe('cover');
  });
});

const at = (...times: number[]) => times.map((takenAt) => ({ takenAt }));

describe('mergeEvents', () => {
  it('should merge small events into their closest neighbour', () => {
    const events = [at(0, 1, 2, 3), at(10), at(100, 101, 102)];
    expect(mergeEvents(events, 10, 3)).toEqual([at(0, 1, 2, 3, 10), at(100, 101, 102)]);
  });

  it('should merge until there are few enough sections', () => {
    const events = [at(0, 1, 2), at(10, 11, 12), at(100, 101, 102, 103)];
    expect(mergeEvents(events, 2, 1)).toEqual([at(0, 1, 2, 10, 11, 12), at(100, 101, 102, 103)]);
  });
});

describe('allocatePages', () => {
  it('should split the pages proportionally with at least one page per section', () => {
    expect(allocatePages([30, 10, 2], 10)).toEqual([7, 2, 1]);
    expect(allocatePages([3], 10)).toEqual([3]);
  });

  it('should give every section enough pages for six photos per page', () => {
    expect(allocatePages([30, 30], 4)).toEqual([5, 5]);
  });
});

describe('getSectionTitle', () => {
  it('should use the main city, or the two main cities', () => {
    expect(getSectionTitle([photo({ city: 'Rome' }), photo({ city: 'Rome' }), photo({ city: 'Ostia' })])).toBe('Rome');
    expect(
      getSectionTitle([
        photo({ city: 'Rome' }),
        photo({ city: 'Rome' }),
        photo({ city: 'Ostia' }),
        photo({ city: 'Ostia' }),
      ]),
    ).toBe('Rome & Ostia');
  });

  it('should fall back to the country and then the date', () => {
    expect(getSectionTitle([photo({ country: 'Italy' })])).toBe('Italy');
    expect(getSectionTitle([photo({ takenAt: start }), photo({ takenAt: start + 2 * DAY })])).toBe('12–14 June 2024');
  });
});

describe('formatDateRange', () => {
  it('should format days, months and years compactly', () => {
    expect(formatDateRange(start, start + HOUR)).toBe('12 June 2024');
    expect(formatDateRange(Date.UTC(2024, 5, 30), Date.UTC(2024, 6, 2))).toBe('30 June – 2 July 2024');
    expect(formatDateRange(Date.UTC(2024, 11, 30), Date.UTC(2025, 0, 2))).toBe('30 December 2024 – 2 January 2025');
  });
});

/** a unit vector along `axis`, tilted towards `towards` by `tilt` */
const embedding = (axis: number, tilt = 0, towards = axis + 1) => {
  const vector = new Float32Array(16);
  vector[axis % 16] = 1;
  vector[towards % 16] += tilt;
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
};

const pageOf = (result: AutoLayoutPlan, id: string) =>
  result.pages.findIndex((page) => page.slots.some((slot) => slot.assetId === id));

const isArtworkPage = (photos: AutoLayoutPhoto[]) => (page: AutoLayoutPlan['pages'][number]) =>
  page.slots.some((slot) => photos.find(({ id }) => id === slot.assetId)?.kind === 'artwork');

describe('planAutoLayout stacks and artwork', () => {
  it('should use one photo per stack and prefer the original', () => {
    const photos = event(12, start, (i) => ({ score: 0.5 + (i % 4) / 10 }));
    const original = photo({ takenAt: start + 30 * 60_000, stackId: 'a', score: 0.6 });
    const crop = photo({ takenAt: start + 30 * 60_000, stackId: 'a', kind: 'crop', score: 0.62 });
    const enhanced = photo({ takenAt: start + 30 * 60_000, stackId: 'a', kind: 'enhanced', score: 0.64 });
    const result = plan([...photos, original, crop, enhanced], { includeMaps: false });

    const placed = placedIds(result);
    expect(placed).toContain(original.id);
    expect(placed).not.toContain(crop.id);
    expect(placed).not.toContain(enhanced.id);
    expect(result.dropReasons).toMatchObject({ [crop.id]: 'stack', [enhanced.id]: 'stack' });
  });

  it('should use a crop that scores clearly better than its original', () => {
    const photos = event(12, start);
    const original = photo({ takenAt: start + 30 * 60_000, stackId: 'a', score: 0.5 });
    const crop = photo({ takenAt: start + 30 * 60_000, stackId: 'a', kind: 'crop', score: 0.7 });
    const placed = placedIds(plan([...photos, original, crop], { includeMaps: false }));
    expect(placed).toContain(crop.id);
    expect(placed).not.toContain(original.id);
  });

  it('should prefer an improved copy unless it scores clearly worse than its original', () => {
    const photos = event(12, start);
    const original = photo({ takenAt: start + 30 * 60_000, stackId: 'a', score: 0.6 });
    const improved = photo({ takenAt: start + 30 * 60_000, stackId: 'a', kind: 'improved', score: 0.59 });
    const placed = placedIds(plan([...photos, original, improved], { includeMaps: false }));
    expect(placed).toContain(improved.id);
    expect(placed).not.toContain(original.id);

    const worse = { ...improved, score: 0.5 };
    const again = placedIds(plan([...photos, original, worse], { includeMaps: false }));
    expect(again).toContain(original.id);
    expect(again).not.toContain(worse.id);
  });

  it('should show an artwork next to its original as an intentional pair, a few times per book', () => {
    const photos = event(30, start, (i) => ({ score: 0.4 + (i % 5) / 20 }));
    const stacks = [0, 1, 2, 3].map((i) => {
      const takenAt = start + (40 + i * 20) * 60_000;
      return [
        photo({ takenAt, stackId: `s${i}`, score: 0.8 }),
        photo({ takenAt, stackId: `s${i}`, kind: 'artwork', score: 0.7, width: 2400, height: 1600 }),
      ];
    });
    const result = plan([...photos, ...stacks.flat()], { includeMaps: false, targetPageCount: 16 });
    const placed = placedIds(result);

    const pairs = stacks.filter(([original, artwork]) => placed.includes(original.id) && placed.includes(artwork.id));
    expect(pairs).toHaveLength(2);
    for (const [original, artwork] of pairs) {
      const page = result.pages[pageOf(result, original.id)];
      expect(page.slots.map((slot) => slot.assetId).toSorted()).toEqual([original.id, artwork.id].toSorted());
    }
    // the other stacks show only their original
    const unpaired = stacks.filter((stack) => !pairs.includes(stack));
    expect(unpaired.map(([original]) => placed.includes(original.id))).toEqual([true, true]);
    expect(unpaired.map(([, artwork]) => placed.includes(artwork.id))).toEqual([false, false]);
  });

  it('should add a page for a pair in a small section', () => {
    const photos = event(6, start, (i) => ({ stackId: i === 2 || i === 3 ? 's' : null }));
    photos[3].kind = 'artwork';
    photos[3].takenAt = photos[2].takenAt;
    const result = plan(photos, { targetPageCount: 3, includeMaps: false });
    expect(result.dropReasons).toEqual({});
    expect(result.pages[pageOf(result, photos[2].id)].slots.map((slot) => slot.assetId)).toContain(photos[3].id);
  });

  it('should not pair artwork when pairs are turned off', () => {
    const photos = event(12, start);
    const original = photo({ takenAt: start + 30 * 60_000, stackId: 'a', score: 0.9 });
    const artwork = photo({ takenAt: start + 30 * 60_000, stackId: 'a', kind: 'artwork', score: 0.5 });
    const placed = placedIds(plan([...photos, original, artwork], { includeMaps: false, maxStackPairs: 0 }));
    expect(placed).toContain(original.id);
    expect(placed).not.toContain(artwork.id);
  });

  it('should limit the pages with artwork and never put them back to back', () => {
    const photos = event(40, start, (i) => ({ score: 0.3 + (i % 7) / 20 }));
    const artworks = Array.from({ length: 12 }, (_, i) =>
      photo({ takenAt: start + (i * 17 + 3) * 60_000, kind: 'artwork', score: 0.9, width: 2400, height: 1600 }),
    );
    for (const maxArtworkShare of [0.2, 0.1]) {
      const result = plan([...photos, ...artworks], { includeMaps: false, targetPageCount: 20, maxArtworkShare });
      const artworkPages = result.pages.map(isArtworkPage(artworks));
      expect(artworkPages.filter(Boolean).length).toBeGreaterThan(0);
      expect(artworkPages.filter(Boolean).length).toBeLessThanOrEqual(Math.floor(20 * maxArtworkShare));
      for (const [i, isArtwork] of artworkPages.entries()) {
        expect(isArtwork && artworkPages[i + 1]).toBeFalsy();
      }
      expect(artworkPages[0]).toBe(false);
      expect(artworks.some(({ id }) => result.dropReasons[id] === 'artwork')).toBe(true);
    }
  });
});

const dpiOf = (result: AutoLayoutPlan, photos: AutoLayoutPhoto[]) =>
  result.pages.flatMap((page) => {
    const rects = getSlotRectsMm(getLayout(page.layout)!, size, style);
    return page.slots.map((slot, i) => {
      const input = photos.find(({ id }) => id === slot.assetId)!;
      return { id: input.id, dpi: getPlacementDpi(input, slot.crop, rects[i]), page };
    });
  });

const rideAt = (hours: number, minutes: number) => Date.UTC(2025, 2, 15, hours, minutes);

const toPoints = (photos: AutoLayoutPhoto[]) =>
  photos.map((item) => ({ id: item.id, time: item.takenAt, latitude: item.lat, longitude: item.lon }));

/** a 30 km day ride in the Surrey Hills: photos at three stops and a few on the way */
const ride = () => [
  ...Array.from({ length: 12 }, (_, i) =>
    photo({ takenAt: rideAt(9, 40 + i * 2), lat: 51.2556 + i * 0.0003, lon: -0.3106, city: 'Box Hill' }),
  ),
  ...Array.from({ length: 2 }, (_, i) =>
    photo({ takenAt: rideAt(10, 45 + i * 9), lat: 51.24 - i * 0.004, lon: -0.33 - i * 0.008, city: 'Dorking' }),
  ),
  ...Array.from({ length: 10 }, (_, i) =>
    photo({ takenAt: rideAt(11, 30 + i * 4), lat: 51.2236, lon: -0.3697 + i * 0.0002, city: 'Westcott' }),
  ),
  ...Array.from({ length: 12 }, (_, i) =>
    photo({ takenAt: rideAt(13, 30 + i * 5), lat: 51.2442 + i * 0.0002, lon: -0.3327, city: 'Denbies' }),
  ),
];

describe('planAutoLayout print resolution', () => {
  it('should never place a photo in a slot it cannot fill at 150 dpi', () => {
    // 1024 px on a 186 mm slot is 140 dpi, so these go in smaller slots
    const small = [0, 1, 2].map((i) =>
      photo({ takenAt: start + (10 + i * 7) * 60_000, width: 1024, height: 683, score: 1, isFavorite: true }),
    );
    const photos = [...event(14, start, () => ({ score: 0.3 })), ...small];
    const result = plan(photos, { includeMaps: false, targetPageCount: 8 });

    const placements = dpiOf(result, photos);
    for (const placement of placements) {
      expect(placement.dpi).toBeGreaterThanOrEqual(150);
    }
    for (const item of small) {
      const placement = placements.find(({ id }) => id === item.id)!;
      expect(placement).toBeDefined();
      expect(placement.page.slots.length).toBeGreaterThan(1);
    }
  });

  it('should leave out photos too small for every slot', () => {
    const tiny = photo({ takenAt: start + 7 * 60_000, width: 320, height: 240, score: 1, isFavorite: true });
    const result = plan([...event(8, start), tiny], { includeMaps: false });
    expect(placedIds(result)).not.toContain(tiny.id);
    expect(result.dropReasons[tiny.id]).toBe('resolution');
  });

  it('should not use a photo too small for the cover', () => {
    const small = photo({ takenAt: start, width: 1024, height: 683, score: 1, isFavorite: true });
    const result = plan([small, ...event(8, start + HOUR)], { includeMaps: false });
    expect(result.pages[0].layout).toBe('cover');
    expect(result.pages[0].slots[0].assetId).not.toBe(small.id);
  });
});

describe('planAutoLayout pacing', () => {
  it('should not put more than two single-photo pages in a row', () => {
    const photos = event(24, start, (i) => ({ score: i % 2 === 0 ? 1 : 0.2, isFavorite: i % 2 === 0 }));
    const result = plan(photos, { includeMaps: false, targetPageCount: 18 });
    let run = 0;
    for (const page of result.pages) {
      run = isSinglePhotoPage(page.layout) ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(MAX_SINGLES_IN_A_ROW);
    }
    expect(result.pages.filter((page) => isSinglePhotoPage(page.layout)).length).toBeGreaterThan(2);
  });

  it('should keep similar photos off neighbouring pages', () => {
    // pairs of photos of the same view, e.g. two vineyard views
    const photos = event(24, start, (i) => ({
      score: 0.5 + ((i * 7) % 5) / 20,
      embedding: embedding(Math.floor(i / 2), 0.1),
    }));
    const neighbours = (result: AutoLayoutPlan) => {
      let count = 0;
      for (const [i, page] of result.pages.slice(1).entries()) {
        const before = result.pages[i].slots.map((slot) => photos.find(({ id }) => id === slot.assetId)!);
        const after = page.slots.map((slot) => photos.find(({ id }) => id === slot.assetId)!);
        count += before.some((a) => after.some((b) => getPhotoSimilarity(a, b) > 0.5)) ? 1 : 0;
      }
      return count;
    };

    const without = plan(
      photos.map(({ embedding: _, ...item }) => item),
      { includeMaps: false, targetPageCount: 10 },
    );
    const withSimilarity = plan(photos, { includeMaps: false, targetPageCount: 10 });
    expect(neighbours(without)).toBeGreaterThan(0);
    expect(neighbours(withSimilarity)).toBeLessThan(neighbours(without));
  });

  it('should rate similarity by the CLIP distance, ignoring stacks', () => {
    const a = photo({ embedding: embedding(0) });
    expect(getPhotoSimilarity(a, photo({ embedding: embedding(0, 0.05) }))).toBe(1);
    expect(getPhotoSimilarity(a, photo({ embedding: embedding(1) }))).toBe(0);
    expect(getPhotoSimilarity(a, photo())).toBe(0);
    expect(getPhotoSimilarity({ ...a, stackId: 's' }, photo({ embedding: embedding(0), stackId: 's' }))).toBe(0);
  });
});

describe('planAutoLayout chapters', () => {
  it('should split a day ride into chapters, each opened by a map with the place', () => {
    const result = plan(ride(), { targetPageCount: 16 });
    expect(result.sections.map((section) => section.title)).toEqual(['Box Hill', 'Westcott', 'Denbies']);
    const openers = result.pages.filter((page) => page.map && page.sectionTitle);
    expect(openers.map((page) => page.sectionTitle)).toEqual(['Box Hill', 'Westcott', 'Denbies']);
    // the photos on the way join the closest stop
    expect(openers.map((page) => page.caption)).toEqual([
      expect.stringMatching(/^15 March 2025 · 9:4\d am$/),
      '15 March 2025 · 10:45 am',
      '15 March 2025 · 1:30 pm',
    ]);
  });

  it('should scale the gaps to a single day and keep the defaults for longer trips', () => {
    const options = getAdaptiveEventOptions(toPoints(ride()));
    expect(options.maxGapMinutes).toBe(15);
    expect(options.maxDistanceKm).toBeGreaterThan(0.5);
    expect(options.maxDistanceKm).toBeLessThan(2);
    expect(splitEvents(toPoints(ride()), DEFAULT_EVENT_OPTIONS)).toHaveLength(1);

    const trip = [...event(10, start), ...event(10, start + 3 * DAY)];
    expect(getAdaptiveEventOptions(toPoints(trip))).toEqual(DEFAULT_EVENT_OPTIONS);
  });
});

describe('planAutoLayout people', () => {
  const amit = { id: 'person-amit', name: 'Amit' };
  const dana = { id: 'person-dana', name: null };

  it('should keep photos of the main people in every section and in the book', () => {
    const days = [0, 1, 2].map((day) =>
      event(30, start + day * DAY, (i) => ({
        score: i % 6 === 0 ? 0.1 : 0.9,
        people: i % 6 === 0 ? [amit] : i === 5 ? [dana] : [],
      })),
    );
    const photos = days.flat();
    const result = plan(photos, { includeMaps: false, targetPageCount: 8 });
    const placed = new Set(placedIds(result));

    expect(result.people.map(({ personId }) => personId)).toEqual([amit.id]);
    expect(result.sections.length).toBeGreaterThan(1);
    for (const section of result.sections) {
      const withAmit = section.photoIds.filter((id) => photos.find((item) => item.id === id)!.people?.includes(amit));
      expect(withAmit.filter((id) => placed.has(id)).length).toBeGreaterThanOrEqual(1);
    }
    expect(result.people[0]).toEqual({ personId: amit.id, name: 'Amit', photos: 15, placed: expect.any(Number) });
    expect(result.people[0].placed).toBeGreaterThanOrEqual(4);
  });

  it('should spread the per-book minimum over the sections', () => {
    const sections = [
      [0, 1, 2, 3].map((i) => ({ id: `a${i}`, importance: 1 - i / 10, takenAt: i, people: [amit] })),
      [0, 1].map((i) => ({ id: `b${i}`, importance: 0.5 - i / 10, takenAt: 10 + i, people: [amit] })),
      [{ id: 'c0', importance: 0.9, takenAt: 20, people: [] }],
    ];
    expect([...getPersonMinimums(sections, [amit.id], 1, 4)].toSorted()).toEqual(['a0', 'a1', 'b0', 'b1']);
    expect([...getPersonMinimums(sections, [amit.id], 0, 1)]).toEqual(['a0']);
  });
});

describe('planAutoLayout captions', () => {
  const factual = /^[\p{L}\s,&·:0-9]+$/u;

  it('should draft factual captions from places, times and names only', () => {
    const photos = event(8, Date.UTC(2025, 2, 15, 14, 15), (i) => ({
      city: 'Westcott',
      people: i < 3 ? [{ id: 'p1', name: 'Amit' }] : [],
    }));
    for (const captions of ['place-time', 'people'] as const) {
      const result = plan(photos, { includeMaps: false, captions, targetPageCount: 5 });
      const texts = result.pages.map((page) => page.caption).filter((caption): caption is string => !!caption);
      expect(texts.length).toBeGreaterThan(0);
      for (const text of texts) {
        expect(text).toMatch(factual);
        expect(text).not.toMatch(/light|sun|morning|evening|beautiful|golden|lane|view/i);
      }
    }
  });

  it('should format the captions', () => {
    const westcott = photo({ takenAt: Date.UTC(2025, 2, 15, 14, 15), city: 'Westcott' });
    const withPeople = photo({
      takenAt: Date.UTC(2025, 2, 15, 9, 5),
      city: 'Box Hill',
      people: [
        { id: 'a', name: 'Amit' },
        { id: 'b', name: null },
        { id: 'c', name: 'Dana' },
      ],
    });
    expect(getFactualCaption([westcott], 'place-time')).toBe('Westcott · 2:15 pm');
    expect(getFactualCaption([withPeople], 'people')).toBe('Box Hill with Amit and Dana');
    expect(getFactualCaption([photo({ people: [{ id: 'a', name: 'Amit' }] })], 'people')).toBe('With Amit');
    expect(getFactualCaption([westcott], 'place', { sectionTitle: 'Westcott' })).toBeUndefined();
    expect(getFactualCaption([westcott], 'place', { sectionTitle: 'Surrey' })).toBe('Westcott');
    expect(getFactualCaption([westcott], 'none')).toBeUndefined();
    expect(getFactualCaption([photo({ takenAt: Date.UTC(2025, 2, 15, 0, 30) })], 'place-time')).toBe('12:30 am');
  });

  it('should leave out captions and opener dates when turned off', () => {
    const photos = [...event(10, start), ...event(10, start + DAY)];
    const result = plan(photos, { captions: 'none', targetPageCount: 10 });
    expect(result.pages.every((page) => !page.caption)).toBe(true);
  });
});

describe('getPhotoKind', () => {
  it('should tell originals, artwork and copies apart', () => {
    expect(getPhotoKind({ stackId: null })).toBe('original');
    expect(getPhotoKind({ stackId: 's', isPrimary: true })).toBe('original');
    expect(getPhotoKind({ stackId: 's', isPrimary: false, isArtwork: true })).toBe('artwork');
    expect(getPhotoKind({ stackId: null, isArtwork: true })).toBe('artwork');
    expect(getPhotoKind({ stackId: 's', originalFileName: 'IMG_1-crop.jpg' })).toBe('crop');
    expect(getPhotoKind({ stackId: 's', originalFileName: 'IMG_1-enhanced.JPG' })).toBe('enhanced');
    expect(getPhotoKind({ stackId: 's', originalFileName: 'IMG_1-improved.jpg' })).toBe('improved');
    expect(getPhotoKind({ stackId: 's', originalFileName: 'IMG_2.jpg' })).toBe('copy');
  });
});
