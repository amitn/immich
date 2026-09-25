import { defaultBookStyle } from 'src/dtos/book.dto.js';
import {
  AutoLayoutOptions,
  AutoLayoutPhoto,
  AutoLayoutPlan,
  MAX_CROP_LOSS,
  allocatePages,
  formatDateRange,
  getSectionTitle,
  getTargetPageCount,
  mergeEvents,
  planAutoLayout,
} from 'src/utils/book/auto-layout.js';
import { getLayout, getSlotAspectRatios } from 'src/utils/book/layouts.js';

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
    expect(plan([])).toEqual({ pages: [], sections: [], usedIds: [], droppedIds: [] });
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
