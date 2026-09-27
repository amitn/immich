import { AssignEntry, AssignPhoto, DEFAULT_MATCH_OPTIONS } from 'src/utils/collections/match.js';
import {
  assignConcertPhotos,
  getStart,
  groupSetPhotos,
  readActs,
} from 'src/utils/collections/packs/concerts/assign.js';

const at = (iso: string) => new Date(`${iso}Z`).getTime();

const vector = (...values: number[]) => {
  const norm = Math.hypot(...values);
  return Float32Array.from(values, (value) => value / norm);
};

const photo = (id: string, time: string, extra: Partial<AssignPhoto> = {}): AssignPhoto => ({
  id,
  time: at(time),
  embedding: vector(1, 0.1 * Number(id.replaceAll(/\D/g, '') || 0), 0.3, 0.2),
  ...extra,
});

const options = { ...DEFAULT_MATCH_OPTIONS, baselines: [], suggestions: 3 };

const matchOf = (result: ReturnType<typeof assignConcertPhotos>, entries: AssignEntry[], id: string) => {
  const match = result.matches.find((candidate) => candidate.ids.includes(id))!;
  return { name: match.item === undefined ? null : entries[match.item].name, unsure: match.unsure };
};

describe('concert photos', () => {
  it('should date the start of an act by the day it is listed under, past midnight too', () => {
    // a banner photographed on Thursday 30 May 2019 lists the whole week
    const thursday = at('2019-05-30T20:56:08');
    expect(new Date(getStart(thursday, '19:30', 'Saturday')).toISOString()).toBe('2019-06-01T19:30:00.000Z');
    expect(new Date(getStart(thursday, '18:00', 'Wednesday')).toISOString()).toBe('2019-05-29T18:00:00.000Z');
    expect(new Date(getStart(thursday, '00:00', 'Saturday')).toISOString()).toBe('2019-06-02T00:00:00.000Z');
    // a board of the evening, and one photographed after midnight
    expect(new Date(getStart(at('2019-06-01T20:45:40'), '21:00')).toISOString()).toBe('2019-06-01T21:00:00.000Z');
    expect(new Date(getStart(at('2019-06-01T20:45:40'), '01:00')).toISOString()).toBe('2019-06-02T01:00:00.000Z');
    expect(new Date(getStart(at('2019-06-02T00:30:00'), '01:00')).toISOString()).toBe('2019-06-02T01:00:00.000Z');
  });

  it('should end a set at the next act of its stage, and give a setlist of no act to the act billed without one', () => {
    const entries: AssignEntry[] = [
      { name: 'Belau', description: 'Thursday 19:20 · Night Pro', sourceTime: at('2019-05-30T20:56:00') },
      { name: 'Malihini', description: 'Thursday 20:20 · Night Pro', sourceTime: at('2019-05-30T20:56:00') },
    ];
    const { acts } = readActs(entries, 0);
    expect(acts[0].end).toBe(at('2019-05-30T20:20:00'));
    expect(acts[1].end).toBe(at('2019-05-30T21:35:00'));

    const club: AssignEntry[] = [
      { name: 'Sidney Gish', description: 'setlist · 9 songs', sourceTime: at('2023-02-17T21:04:00') },
      { name: 'The Beths', description: 'with Sidney Gish', sourceTime: at('2023-02-17T21:04:00') },
      {
        name: '(setlist: Future Me, Knees Deep …)',
        description: 'setlist · 18 songs',
        sourceTime: at('2023-02-17T21:47:00'),
      },
    ];
    const { acts: bill, attributed } = readActs(club, 0);
    expect(bill[1].setlist).toBe(at('2023-02-17T21:47:00'));
    expect([...attributed].map(({ name }) => name)).toEqual(['(setlist: Future Me, Knees Deep …)']);
  });

  it('should group the photos of a set: minutes apart, or further apart when they look alike', () => {
    const groups = groupSetPhotos([
      photo('1', '2019-06-01T20:25:52', { embedding: vector(1, 0, 0) }),
      photo('2', '2019-06-01T20:27:11', { embedding: vector(0, 1, 0) }),
      photo('3', '2019-06-01T20:34:00', { embedding: vector(0, 1, 0.1) }),
      photo('4', '2019-06-01T20:50:00', { embedding: vector(0, 1, 0.1) }),
    ]);
    expect(groups.map(({ members }) => members.map(({ id }) => id))).toEqual([['1', '2', '3'], ['4']]);
  });

  it('should match festival photos with the act on stage, by the stage their photos read', () => {
    const board = at('2019-06-01T20:45:00');
    const entries: AssignEntry[] = [
      { name: 'Nathy Peluso', description: '19:40 · Pull&Bear', sourceTime: board },
      { name: 'Kali Uchis', description: '20:45 · Seat', sourceTime: board },
    ];
    const result = assignConcertPhotos(
      [
        photo('1', '2019-06-01T19:50:00'),
        photo('2', '2019-06-01T20:50:00', { text: 'PRIMAVERA SOUND\nSEAT', embedding: vector(0, 1, 0, 0) }),
        photo('3', '2019-06-01T23:30:00', { embedding: vector(0, 0, 1, 0) }),
      ],
      entries,
      options,
    );
    // Nathy Peluso is the only act listed at 19:50, but the act of the other stage then is on no source
    expect(matchOf(result, entries, '1')).toEqual({ name: null, unsure: true });
    expect(result.matches[0].suggestions[0]).toEqual(expect.objectContaining({ item: 0 }));
    expect(matchOf(result, entries, '2')).toEqual({ name: 'Kali Uchis', unsure: false });
    // after every listed set
    expect(matchOf(result, entries, '3').name).toBeNull();
  });

  it('should align the photos of a club gig with the bill, each near the setlist of its act', () => {
    const entries: AssignEntry[] = [
      { name: 'Cherry Glazerr', description: 'setlist · 18 songs', sourceTime: at('2019-03-07T23:18:00') },
    ];
    const result = assignConcertPhotos(
      [
        photo('1', '2019-03-07T21:29:00', { embedding: vector(1, 0, 0) }),
        photo('2', '2019-03-07T22:00:00', { embedding: vector(0, 1, 0) }),
        photo('3', '2019-03-07T22:51:00', { embedding: vector(0, 0, 1) }),
        photo('4', '2019-03-07T23:42:00', { embedding: vector(1, 1, 0) }),
      ],
      entries,
      options,
    );
    expect(result.ordered).toBe(true);
    // the opener no setlist names
    expect(['1', '2', '3', '4'].map((id) => matchOf(result, entries, id).name)).toEqual([
      null,
      null,
      'Cherry Glazerr',
      'Cherry Glazerr',
    ]);
  });

  it('should match acts without starts or setlists by what CLIP sees', () => {
    const entries: AssignEntry[] = [
      { name: 'A', embedding: vector(1, 0, 0) },
      { name: 'B', embedding: vector(0, 1, 0) },
    ];
    const result = assignConcertPhotos(
      [photo('1', '2019-03-07T21:00:00', { embedding: vector(0.1, 1, 0) })],
      entries,
      options,
    );
    expect(matchOf(result, entries, '1').name).toBe('B');
  });
});
