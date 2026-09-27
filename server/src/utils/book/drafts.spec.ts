import { BookDraftKind } from 'src/enum.js';
import {
  DRAFT_THRESHOLDS,
  DraftCandidate,
  DraftPhoto,
  DraftTaggedPhoto,
  MAX_DRAFT_PAGES,
  findTrips,
  getBirthdayDraft,
  getBirthdayYear,
  getDaySpan,
  getDraftPageCount,
  getHome,
  getTaggedTripDrafts,
  getTimelineTripDrafts,
  getTripDrafts,
  getTripPlace,
  getYearlyDrafts,
  selectDrafts,
} from 'src/utils/book/drafts.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let nextId = 0;
const id = () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`;

/** a meal (or museum visit, tasting…): a source photo and `subjects` entry photos a few minutes apart */
const visit = (root: string, place: string, start: number, subjects: number, source = 'Menu'): DraftTaggedPhoto[] => [
  { id: id(), time: start, value: `${root}/${place}/${source}` },
  ...Array.from({ length: subjects }, (_, i) => ({
    id: id(),
    time: start + (i + 1) * 5 * 60_000,
    value: `${root}/${place}/Entry ${i + 1}`,
  })),
];

const at = (iso: string) => Date.parse(iso);

/** photos of a place, `perDay` a day an hour apart, from `from` for `days` days */
const photosAt = (
  place: { latitude: number; longitude: number; city?: string; country?: string },
  from: string,
  days: number,
  perDay: number,
): DraftPhoto[] =>
  Array.from({ length: days * perDay }, (_, i) => ({
    id: id(),
    time: at(from) + Math.floor(i / perDay) * DAY + (i % perDay) * HOUR,
    ...place,
  }));

const TEL_AVIV = { latitude: 32.08, longitude: 34.78, city: 'Tel Aviv', country: 'Israel' };
const ROME = { latitude: 41.9, longitude: 12.5, city: 'Rome', country: 'Italy' };

/** a year of photos at home: a few photos in the middle of every month */
const home = (year: number) =>
  Array.from({ length: 12 }, (_, month) =>
    photosAt(TEL_AVIV, `${year}-${String(month + 1).padStart(2, '0')}-15T10:00:00.000Z`, 1, 3),
  ).flat();

/** meals of `dishes` dishes each, one a month */
const meals = (year: number, count: number, dishes: number) =>
  Array.from({ length: count }, (_, i) =>
    visit('Food', `Restaurant ${i + 1}`, at(`${year}-0${i + 1}-10T20:00:00.000Z`), dishes),
  ).flat();

/** a trip to Rome tagged with its two flights, and its ticket photographed later */
const trip = (from: string, days: number, perDay: number) => {
  const timeline = photosAt(ROME, from, days, perDay);
  const tags = [
    { id: timeline[0].id, time: timeline[0].time, value: 'Travel/Rome, June 2025/Flight TLV → FCO, 1 Jun 2025' },
    {
      id: timeline.at(-1)!.id,
      time: timeline.at(-1)!.time,
      value: 'Travel/Rome, June 2025/Flight FCO → TLV, 3 Jun 2025',
    },
    { id: id(), time: at('2025-06-20T10:00:00.000Z'), value: 'Travel/Rome, June 2025/Tickets' },
  ];
  return { timeline, tags };
};

/** photos a day apart */
const photosFrom = (count: number, from = '2025-04-01T10:00:00.000Z') =>
  Array.from({ length: count }, (_, i) => ({ id: id(), time: at(from) + i * DAY }));

describe('book drafts', () => {
  describe('getYearlyDrafts', () => {
    it('should suggest a year in food with enough meals and dishes', () => {
      const [draft, ...others] = getYearlyDrafts(meals(2025, 3, 5), NOW);
      expect(others).toEqual([]);
      expect(draft).toEqual(
        expect.objectContaining({
          key: 'food:2025',
          kind: BookDraftKind.Yearly,
          title: '2025 in food',
          reason: 'You visited 3 restaurants in 2025 and photographed 15 dishes',
          stylePreset: 'food',
          includeMaps: false,
        }),
      );
      // the menus too
      expect(draft.assetIds).toHaveLength(18);
    });

    it('should need at least 3 visits', () => {
      expect(getYearlyDrafts(meals(2025, DRAFT_THRESHOLDS.yearlyVisits - 1, 10), NOW)).toEqual([]);
    });

    it('should need at least 15 subject photos', () => {
      const tags = meals(2025, 3, 5).slice(0, -1);
      expect(getYearlyDrafts(tags, NOW)).toEqual([]);
    });

    it('should count two meals at the same restaurant as two visits', () => {
      const tags = [
        ...visit('Food', 'Da Enzo', at('2024-03-01T20:00:00.000Z'), 5),
        ...visit('Food', 'Da Enzo', at('2024-04-01T20:00:00.000Z'), 5),
        ...visit('Food', 'Roscioli', at('2024-05-01T20:00:00.000Z'), 5),
      ];
      expect(getYearlyDrafts(tags, NOW)).toEqual([
        expect.objectContaining({ reason: 'You visited 2 restaurants in 2024 and photographed 15 dishes' }),
      ]);
    });

    it('should wait for the year to be over', () => {
      expect(getYearlyDrafts(meals(2026, 5, 5), NOW)).toEqual([]);
    });

    it('should suggest a book per pack and year', () => {
      const tags = [
        ...meals(2024, 3, 5),
        ...meals(2025, 3, 5),
        ...[1, 2, 3].flatMap((i) => visit('Art', `Museum ${i}`, at(`2025-0${i}-02T11:00:00.000Z`), 5, 'Label')),
        ...[1, 2, 3].flatMap((i) => visit('Wine', `Tasting ${i}`, at(`2025-0${i}-03T19:00:00.000Z`), 5, 'Wine list')),
        ...[1, 2, 3].flatMap((i) => visit('Recipes', `Recipe ${i}`, at(`2025-0${i}-05T18:00:00.000Z`), 5, 'Recipe')),
      ];
      const drafts = getYearlyDrafts(tags, NOW);
      expect(
        drafts.map((draft) => [draft.key, draft.title, draft.stylePreset]).toSorted((a, b) => a[0].localeCompare(b[0])),
      ).toEqual([
        ['cookbook:2025', '2025 in the kitchen', 'cookbook'],
        ['food:2024', '2024 in food', 'food'],
        ['food:2025', '2025 in food', 'food'],
        ['museum:2025', 'Museums we visited in 2025', 'museum'],
        ['wine:2025', 'Cellar notes 2025', 'wine'],
      ]);
      expect(drafts.find((draft) => draft.key === 'wine:2025')?.reason).toBe(
        'You tasted 15 wines at 3 tastings in 2025',
      );
    });

    it('should ignore travel tags and other tags', () => {
      const tags = [
        ...visit('Travel', 'Crete, October 2016', at('2016-10-01T10:00:00.000Z'), 30, 'Tickets'),
        { id: id(), time: at('2016-10-01T10:00:00.000Z'), value: 'Food/Only a place' },
      ];
      expect(getYearlyDrafts(tags, NOW)).toEqual([]);
    });
  });

  describe('getDaySpan', () => {
    it('should count the calendar days', () => {
      expect(getDaySpan(at('2025-06-01T23:00:00.000Z'), at('2025-06-02T01:00:00.000Z'))).toBe(2);
      expect(getDaySpan(at('2025-06-01T08:00:00.000Z'), at('2025-06-01T20:00:00.000Z'))).toBe(1);
    });
  });

  describe('getTaggedTripDrafts', () => {
    it('should suggest a book of a trip with the photos of its days', () => {
      const { timeline, tags } = trip('2025-06-01T08:00:00.000Z', 3, 14);
      const [draft] = getTaggedTripDrafts(tags, [...home(2025), ...timeline], NOW);
      expect(draft).toEqual(
        expect.objectContaining({
          key: 'trip:Travel/Rome, June 2025',
          kind: BookDraftKind.Trip,
          title: 'Rome, June 2025',
          subtitle: '1–3 June 2025',
          stylePreset: 'travel',
          includeMaps: true,
          reason: 'Your trip Rome, June 2025: 3 days and 43 photos',
        }),
      );
      // the photos of the days, and the ticket photographed later
      expect(draft.assetIds).toHaveLength(43);
    });

    it('should need at least 40 photos', () => {
      const { timeline, tags } = trip('2025-06-01T08:00:00.000Z', 3, 12);
      expect(timeline.length + 1).toBeLessThan(DRAFT_THRESHOLDS.tripPhotos);
      expect(getTaggedTripDrafts(tags, timeline, NOW)).toEqual([]);
    });

    it('should need at least two days', () => {
      const { timeline, tags } = trip('2025-06-01T06:00:00.000Z', 1, 16);
      expect(
        getTaggedTripDrafts(tags, [...timeline, ...timeline.map((photo) => ({ ...photo, id: id() }))], NOW),
      ).toEqual([]);
    });

    it('should wait for the trip to be over', () => {
      const { timeline, tags } = trip('2026-09-24T08:00:00.000Z', 3, 14);
      expect(getTaggedTripDrafts(tags, timeline, NOW)).toEqual([]);
    });
  });

  describe('getHome', () => {
    it('should find the place photographed on the most days', () => {
      expect(getHome([...home(2025), ...photosAt(ROME, '2025-06-01T08:00:00.000Z', 3, 30)])).toEqual({
        latitude: TEL_AVIV.latitude,
        longitude: TEL_AVIV.longitude,
      });
    });

    it('should need photos in several months', () => {
      expect(getHome(photosAt(ROME, '2025-06-01T08:00:00.000Z', 20, 3))).toBeUndefined();
    });
  });

  describe('getTripPlace', () => {
    it('should name the city, the region or the country the photos share', () => {
      expect(getTripPlace(photosAt(ROME, '2025-06-01T08:00:00.000Z', 1, 3))).toBe('Rome');
      const mixed = [
        { id: id(), time: 0, city: 'Chania', state: 'Crete', country: 'Greece' },
        { id: id(), time: 1, city: 'Sougia', state: 'Crete', country: 'Greece' },
        { id: id(), time: 2, city: 'Rethymno', state: 'Crete', country: 'Greece' },
      ];
      expect(getTripPlace(mixed)).toBe('Crete');
      expect(getTripPlace([{ id: id(), time: 0 }])).toBeUndefined();
    });
  });

  describe('findTrips', () => {
    it('should split the photos away from home into trips', () => {
      const trips = findTrips([
        ...home(2025),
        ...photosAt(ROME, '2025-06-01T08:00:00.000Z', 3, 15),
        ...photosAt(ROME, '2025-09-01T08:00:00.000Z', 2, 5),
      ]);
      expect(trips.map((trip) => [new Date(trip.start).toISOString().slice(0, 10), trip.photos.length])).toEqual([
        ['2025-06-01', 45],
        ['2025-09-01', 10],
      ]);
    });

    it('should end a trip at a photo taken at home', () => {
      const trips = findTrips([
        ...home(2025),
        ...photosAt(ROME, '2025-06-01T08:00:00.000Z', 1, 5),
        ...photosAt(TEL_AVIV, '2025-06-02T08:00:00.000Z', 1, 1),
        ...photosAt(ROME, '2025-06-03T08:00:00.000Z', 1, 5),
      ]);
      expect(trips).toHaveLength(2);
    });

    it('should add the photos without a location taken during a trip', () => {
      const away = photosAt(ROME, '2025-06-01T08:00:00.000Z', 3, 10);
      const unlocated = { id: id(), time: at('2025-06-02T20:00:00.000Z') };
      const [trip] = findTrips([...home(2025), ...away, unlocated]);
      expect(trip.photos).toContainEqual(unlocated);
    });
  });

  describe('getTimelineTripDrafts', () => {
    it('should suggest a book of a trip away from home', () => {
      const drafts = getTimelineTripDrafts([...home(2025), ...photosAt(ROME, '2025-06-01T08:00:00.000Z', 3, 15)], NOW);
      expect(drafts).toEqual([
        expect.objectContaining({
          key: 'trip:2025-06-01',
          kind: BookDraftKind.Trip,
          title: 'Our trip to Rome',
          subtitle: '1–3 June 2025',
          stylePreset: 'classic',
          includeMaps: true,
          reason: 'You spent 3 days in Rome and took 45 photos',
        }),
      ]);
    });

    it('should skip day trips and short trips', () => {
      const dayTrip = Array.from({ length: 45 }, (_, i) => ({
        id: id(),
        time: at('2025-06-01T08:00:00.000Z') + i * 10 * 60_000,
        ...ROME,
      }));
      expect(getTimelineTripDrafts([...home(2025), ...dayTrip], NOW)).toEqual([]);
      expect(getTimelineTripDrafts([...home(2025), ...photosAt(ROME, '2025-06-01T08:00:00.000Z', 3, 13)], NOW)).toEqual(
        [],
      );
    });
  });

  describe('getTripDrafts', () => {
    it('should use the travel tags when there are any', () => {
      const timeline = [...home(2025), ...photosAt(ROME, '2025-06-01T08:00:00.000Z', 3, 15)];
      const tags = [{ id: id(), time: at('2024-01-01T10:00:00.000Z'), value: 'Travel/Short/Bus A → B, 1 Jan 2024' }];
      expect(getTripDrafts(tags, timeline, NOW)).toEqual([]);
      expect(getTripDrafts([], timeline, NOW)).toEqual([expect.objectContaining({ key: 'trip:2025-06-01' })]);
    });
  });

  describe('getBirthdayYear', () => {
    it('should end on the latest birthday', () => {
      expect(getBirthdayYear('2019-03-10', NOW)).toEqual({
        age: 7,
        birthday: at('2026-03-10T00:00:00.000Z'),
        from: at('2025-03-10T00:00:00.000Z'),
        to: at('2026-03-11T00:00:00.000Z') - 1,
      });
      expect(getBirthdayYear('2019-12-10', NOW)?.age).toBe(6);
      expect(getBirthdayYear('2019-09-27', NOW)?.age).toBe(7);
    });

    it('should celebrate 29 February on 28 February in other years', () => {
      expect(getBirthdayYear('2020-02-29', NOW)).toEqual(
        expect.objectContaining({ age: 6, birthday: at('2026-02-28T00:00:00.000Z') }),
      );
    });

    it('should wait for the first birthday', () => {
      expect(getBirthdayYear('2026-01-01', NOW)).toBeUndefined();
    });
  });

  describe('getBirthdayDraft', () => {
    const person = { id: '11111111-1111-4111-8111-111111111111', name: 'Maya', birthDate: '2019-03-10' };

    it('should suggest the year before the birthday', () => {
      expect(getBirthdayDraft(person, photosFrom(30), NOW)).toEqual(
        expect.objectContaining({
          key: `birthday:${person.id}:7`,
          kind: BookDraftKind.Birthday,
          title: 'Maya turns 7',
          subtitle: '10 March 2025 – 10 March 2026',
          stylePreset: 'soft',
          reason: '30 photos of Maya from the year before they turned 7',
        }),
      );
    });

    it('should need at least 30 photos in the year', () => {
      expect(getBirthdayDraft(person, photosFrom(DRAFT_THRESHOLDS.birthdayPhotos - 1), NOW)).toBeUndefined();
      // photos from after the birthday don't count
      expect(getBirthdayDraft(person, photosFrom(40, '2026-03-01T10:00:00.000Z'), NOW)).toBeUndefined();
    });

    it('should need a name', () => {
      expect(getBirthdayDraft({ ...person, name: ' ' }, photosFrom(40), NOW)).toBeUndefined();
    });
  });

  describe('selectDrafts', () => {
    const candidate = (key: string, kind: BookDraftKind, endsAt: number): DraftCandidate => ({
      key,
      kind,
      title: key,
      reason: '',
      stylePreset: 'classic',
      includeMaps: false,
      assetIds: [id()],
      endsAt,
    });
    const candidates = [
      candidate('food:2024', BookDraftKind.Yearly, at('2024-12-31T00:00:00.000Z')),
      candidate('food:2025', BookDraftKind.Yearly, at('2025-12-31T00:00:00.000Z')),
      candidate('trip:2026-06-01', BookDraftKind.Trip, at('2026-06-03T00:00:00.000Z')),
      candidate('birthday:x:7', BookDraftKind.Birthday, at('2026-03-10T00:00:00.000Z')),
    ];
    const kinds = { yearly: true, trips: true, birthdays: true };

    it('should draft the newest first, up to the limit', () => {
      expect(selectDrafts(candidates, { existingKeys: new Set(), kinds, limit: 3 }).map(({ key }) => key)).toEqual([
        'trip:2026-06-01',
        'birthday:x:7',
        'food:2025',
      ]);
    });

    it('should never suggest a key again', () => {
      const existingKeys = new Set(['trip:2026-06-01', 'food:2025']);
      expect(selectDrafts(candidates, { existingKeys, kinds, limit: 5 }).map(({ key }) => key)).toEqual([
        'birthday:x:7',
        'food:2024',
      ]);
    });

    it('should leave out the kinds that are disabled', () => {
      expect(
        selectDrafts(candidates, {
          existingKeys: new Set(),
          kinds: { yearly: false, trips: true, birthdays: false },
          limit: 5,
        }).map(({ key }) => key),
      ).toEqual(['trip:2026-06-01']);
    });

    it('should suggest a key once per run', () => {
      expect(selectDrafts([...candidates, ...candidates], { existingKeys: new Set(), kinds, limit: 10 })).toHaveLength(
        4,
      );
    });
  });

  describe('getDraftPageCount', () => {
    it('should cap the pages of large drafts', () => {
      expect(getDraftPageCount(60)).toBeUndefined();
      expect(getDraftPageCount(1000)).toBe(MAX_DRAFT_PAGES);
    });
  });
});
