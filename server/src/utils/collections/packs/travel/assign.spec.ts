import { AssignEntry, AssignPhoto } from 'src/utils/collections/match.js';
import { assignByTime, readLegWhen } from 'src/utils/collections/packs/travel/assign.js';

const at = (iso: string) => new Date(`${iso}Z`).getTime();

const photo = (id: string, iso: string, extra: Partial<AssignPhoto> = {}): AssignPhoto => ({
  id,
  time: at(iso),
  embedding: new Float32Array(0),
  ...extra,
});

const legsOf = (photos: AssignPhoto[], entries: AssignEntry[]) => {
  const { matches, ordered } = assignByTime(photos, entries);
  expect(ordered).toBe(false);
  return Object.fromEntries(
    matches.map((match) => [match.ids[0], match.item === undefined ? null : entries[match.item].name]),
  );
};

describe(readLegWhen.name, () => {
  const near = at('2016-10-04T12:00:00');

  it('should read when a leg starts from its name and description', () => {
    expect(readLegWhen({ name: 'Bus Chania → Sougia, 4 Oct 2016', description: 'KTEL · departs 05:00' }, near)).toEqual(
      {
        time: at('2016-10-04T05:00:00'),
        day: at('2016-10-04T00:00:00'),
        kind: 'departure',
      },
    );
    expect(
      readLegWhen(
        { name: 'Flight BR186 Taipei → Okinawa, 9 Nov', description: 'boarding 16:20' },
        at('2019-11-10T00:00:00'),
      ),
    ).toMatchObject({ time: at('2019-11-09T16:20:00'), kind: 'boarding' });
  });

  it('should keep only the day of a leg whose time is uncertain, or whose date comes from its photo', () => {
    expect(readLegWhen({ name: 'Ferry Sougia → Sfakia, 4 Oct 2016', description: 'departs 09:20?' }, near)).toEqual({
      day: at('2016-10-04T00:00:00'),
      uncertain: true,
      kind: 'departure',
    });
    expect(readLegWhen({ name: 'Samaria National Park', sourceTime: at('2016-10-04T20:45:55') }, near)).toEqual({
      day: at('2016-10-04T00:00:00'),
      fromPhoto: true,
    });
    expect(readLegWhen({ name: 'Monorail → 旭橋' }, near)).toEqual({});
  });
});

describe(assignByTime.name, () => {
  const bus: AssignEntry = { name: 'Bus Chania → Sougia, 4 Oct 2016', description: 'KTEL · departs 05:00' };
  const back: AssignEntry = { name: 'Bus Sfakia → Chania, 4 Oct 2016', description: 'KTEL · departs 18:30' };

  it('should give a leg the photos from just before its departure until the next leg', () => {
    expect(
      legsOf(
        [
          photo('station', '2016-10-04T03:50:00'),
          photo('harbour', '2016-10-04T06:50:00'),
          photo('gorge', '2016-10-04T12:38:00'),
          photo('square', '2016-10-04T17:20:00'),
          photo('evening', '2016-10-04T21:10:00'),
          photo('night', '2016-10-05T01:30:00'),
        ],
        [bus, back],
      ),
    ).toEqual({
      station: bus.name,
      harbour: bus.name,
      gorge: bus.name,
      square: back.name,
      evening: back.name,
      // until 4 in the morning, the evening belongs to the leg of the day
      night: back.name,
    });
  });

  it('should leave the days without documents, and the time long before the first leg, unassigned', () => {
    expect(
      legsOf(
        [
          photo('before', '2016-10-03T10:00:00'),
          photo('early', '2016-10-04T01:00:00'),
          photo('after', '2016-10-06T11:00:00'),
        ],
        [bus],
      ),
    ).toEqual({ before: null, early: null, after: null });
  });

  it('should give a leg with only a date the photos of its day that no timed leg covers', () => {
    const park: AssignEntry = { name: 'Okinawa World', sourceTime: at('2019-11-10T22:57:00') };
    const flight: AssignEntry = { name: 'Flight IT231 Okinawa → Taipei, 12 Nov 2019', description: 'departs 09:45' };
    expect(
      legsOf(
        [
          photo('shrine', '2019-11-10T07:23:00'),
          photo('cave', '2019-11-10T12:13:00'),
          photo('gate', '2019-11-12T08:40:00'),
        ],
        [park, flight],
      ),
    ).toEqual({ shrine: park.name, cave: park.name, gate: flight.name });
  });

  it('should move a photo to the leg whose places it shows', () => {
    const ferry: AssignEntry = {
      name: 'Ferry Sougia → Sfakia, 4 Oct 2016',
      description: 'departs 09:20? · vessel Samaria I',
    };
    const legs = legsOf(
      [
        photo('beach', '2016-10-04T13:11:00'),
        photo('boat', '2016-10-04T13:18:00', { text: 'ANENAYK SAMARIAI FERRIES' }),
        photo('path', '2016-10-04T06:53:00', { text: 'E4 Path Sougia-Paleochora' }),
      ],
      [bus, ferry, back],
    );
    expect(legs).toMatchObject({ boat: ferry.name, path: bus.name });
  });

  it('should keep runs of photos on one leg, and mark what it is not sure of', () => {
    const { matches } = assignByTime(
      [photo('a', '2016-10-04T05:10:00'), photo('b', '2016-10-04T05:12:00'), photo('c', '2016-10-06T10:00:00')],
      [bus],
    );
    expect(matches.map(({ ids, item, unsure }) => ({ id: ids[0], item, unsure }))).toEqual([
      { id: 'a', item: 0, unsure: false },
      { id: 'b', item: 0, unsure: false },
      { id: 'c', unsure: true },
    ]);
    expect(matches[2].offList).toBe(1);
    expect(matches[0].suggestions[0]).toMatchObject({ item: 0 });
  });
});
