import { AssetType } from 'src/enum.js';
import {
  YearRecapAsset,
  describeYearRecap,
  getJournalStats,
  getYearRecapStats,
  getYearTrips,
} from 'src/utils/year-recap.js';

const DAY = 24 * 60 * 60 * 1000;

const asset = (id: string, time: number, place: Partial<YearRecapAsset> = {}): YearRecapAsset => ({
  id,
  type: AssetType.Image,
  isFavorite: false,
  time,
  latitude: null,
  longitude: null,
  city: null,
  state: null,
  country: null,
  ...place,
});

const home = { latitude: 32.08, longitude: 34.78, city: 'Tel Aviv', country: 'Israel' };
const athens = { latitude: 37.98, longitude: 23.73, city: 'Athens', country: 'Greece' };

/** photos at home every few days of the year, and a 4-day trip to Athens in June */
const yearWithATrip = () => [
  ...Array.from({ length: 61 }, (_, index) =>
    asset(`home-${index}`, Date.UTC(2025, 0, 1) + index * 6 * DAY, home),
  ).filter(
    // none during the trip
    ({ time }) => time < Date.UTC(2025, 5, 5) || time > Date.UTC(2025, 5, 20),
  ),
  ...Array.from({ length: 24 }, (_, index) =>
    asset(`trip-${index}`, Date.UTC(2025, 5, 10, 9) + Math.floor(index / 6) * DAY + (index % 6) * 3_600_000, athens),
  ),
];

describe('year recap stats', () => {
  it('counts the places of each journal once, and its distinct entries', () => {
    expect(
      getJournalStats([
        { id: '1', value: 'Food/Da Enzo/Cacio e pepe' },
        { id: '2', value: 'Food/Da Enzo/Cacio e pepe' },
        { id: '3', value: 'Food/da enzo/Carbonara' },
        { id: '4', value: 'Food/Noma/Menu' },
        { id: '5', value: 'Art/Louvre/Mona Lisa' },
        { id: '6', value: 'Holidays/Rome' },
      ]),
    ).toEqual({
      food: { places: 2, entries: 2, topPlaces: ['Da Enzo', 'Noma'] },
      museum: { places: 1, entries: 1, topPlaces: ['Louvre'] },
    });
  });

  it('takes the trips from the travel journal when there is one', () => {
    expect(getYearTrips([], { travel: { places: 2, entries: 9, topPlaces: ['Crete', 'Rome'] } })).toEqual({
      trips: 2,
      topTrips: ['Crete', 'Rome'],
    });
  });

  it('finds the trips away from home otherwise', () => {
    expect(getYearTrips(yearWithATrip(), {})).toEqual({ trips: 1, topTrips: ['Athens'] });
  });

  it('puts the stats of a year together', () => {
    const assets = [...yearWithATrip(), { ...asset('video', Date.UTC(2025, 6, 1), home), type: AssetType.Video }];
    const stats = getYearRecapStats(
      2025,
      assets,
      [
        { id: 'p2', name: 'Eli', type: 'person', count: 12 },
        { id: 'p1', name: 'Dana', type: 'person', count: 30 },
        { id: 'p3', name: '', type: 'person', count: 99 },
        { id: 'rex', name: 'Rex', type: 'pet', count: 8 },
      ],
      [
        { id: 'trip-1', value: 'Food/Taverna/Moussaka' },
        { id: 'trip-2', value: 'Food/Taverna/Menu' },
      ],
    );

    expect(stats).toEqual({
      year: 2025,
      count: 83,
      photoCount: 82,
      videoCount: 1,
      places: 2,
      countries: 2,
      topPlaces: ['Tel Aviv', 'Athens'],
      people: 2,
      topPeople: [
        { id: 'p1', name: 'Dana' },
        { id: 'p2', name: 'Eli' },
      ],
      pets: 1,
      topPets: [{ id: 'rex', name: 'Rex' }],
      trips: 1,
      topTrips: ['Athens'],
      journals: { food: { places: 1, entries: 1, topPlaces: ['Taverna'] } },
    });
    expect(describeYearRecap(stats)).toBe('83 photos, 2 places, 2 people, 1 trip, 1 dish');
  });

  it('keeps the trips of the travel journal out of the journals', () => {
    const stats = getYearRecapStats(2025, [], [], [{ id: '1', value: 'Travel/Crete/Knossos' }]);
    expect(stats).toMatchObject({ trips: 1, topTrips: ['Crete'], journals: {} });
  });
});
