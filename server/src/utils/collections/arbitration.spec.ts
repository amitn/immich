import { describe, expect, it } from 'vitest';
import {
  ArbitratedVisit,
  FOREIGN_SHARE,
  PackFit,
  arbitrateVisits,
  getForeignPhotos,
  getNamedPhotos,
  getPackShares,
  getVisitShare,
} from 'src/utils/collections/arbitration.js';

/** photos whose best prompts in each pack have these similarities */
const fits = (entries: Record<string, PackFit>) => new Map(Object.entries(entries));

// a stage shot: the concerts' prompts fit it far better than the travel prompts
const stage: PackFit = { concerts: { subject: 0.27, source: 0.2 }, travel: { subject: 0.2, source: 0.19 } };
// a peach tree: the garden's prompts fit it a little better than the nature walks', and better than a trip's
const tree: PackFit = {
  garden: { subject: 0.3, source: 0.25 },
  nature: { subject: 0.27, source: 0.25 },
  travel: { subject: 0.24, source: 0.2 },
  reading: { subject: 0.19, source: 0.18 },
};
// an embossed plant tag: a title page to the reading pack, and a plant tag, better, to the garden
const tag: PackFit = {
  garden: { subject: 0.21, source: 0.31 },
  nature: { subject: 0.24, source: 0.3 },
  travel: { subject: 0.24, source: 0.26 },
  reading: { subject: 0.25, source: 0.22 },
};

const visit = (pack: string, subjects: string[], others: Partial<ArbitratedVisit> = {}): ArbitratedVisit => ({
  pack,
  photos: subjects.map((id) => ({ id, kind: 'subject' })),
  minSubjects: 3,
  ...others,
});

describe('getPackShares', () => {
  it('should share a photo between the packs by how well their prompts fit it', () => {
    const shares = getPackShares(stage);
    expect(shares.concerts).toBeGreaterThan(0.99);
    expect(shares.concerts + shares.travel).toBeCloseTo(1);
    expect(getPackShares(tag, 'source').garden).toBeGreaterThan(getPackShares(tag, 'source').reading);
  });

  it('should leave out the packs without prompts of a kind', () => {
    expect(getPackShares({ food: { subject: 0.3 }, wine: { source: 0.3 } })).toEqual({ food: 1 });
    expect(getPackShares({})).toEqual({});
  });
});

describe('getVisitShare', () => {
  it('should average the share of the pack over the subjects that have a fit', () => {
    const photos = fits({ a: stage, b: stage });
    expect(getVisitShare('concerts', ['a', 'b', 'no-embedding'], photos)).toBeGreaterThan(0.99);
    expect(getVisitShare('travel', ['a', 'b'], photos)).toBeLessThan(0.01);
    expect(getVisitShare('concerts', ['no-embedding'], photos)).toBeUndefined();
  });
});

describe('getForeignPhotos', () => {
  it("should find the photos that are another pack's for sure, by kind", () => {
    const foreign = getForeignPhotos(['concerts', 'travel'], fits({ shot: stage }));
    expect(foreign.get('travel')!.get('subject')!.has('shot')).toBe(true);
    expect(foreign.get('concerts')!.get('subject')!.has('shot')).toBe(false);
    // as a source, the travel prompts are close enough
    expect(getPackShares(stage, 'source').travel).toBeGreaterThan(FOREIGN_SHARE);
    expect(foreign.get('travel')!.get('source')!.has('shot')).toBe(false);
  });
});

describe('arbitrateVisits', () => {
  it('should give the stage shots of a gig to the concerts rather than to a trip', () => {
    const photos = fits(Object.fromEntries(['s1', 's2', 's3', 's4'].map((id) => [id, stage])));
    const trip = visit('travel', ['s1', 's2', 's3', 's4'], {
      photos: [
        ...['s1', 's2', 's3', 's4'].map((id) => ({ id, kind: 'subject' as const })),
        { id: 's4', kind: 'source' },
      ],
      requireSource: true,
    });
    const [travel, concerts] = arbitrateVisits([trip, visit('concerts', ['s1', 's2', 's3'])], photos);
    expect(travel.status).toBe('unsure');
    expect(concerts).toMatchObject({ status: 'new' });
    expect(concerts.share).toBeGreaterThan(0.99);
  });

  it('should find a visit unsure when another pack fits most of its photos better', () => {
    const photos = fits({ t1: tree, t2: tree, t3: tree });
    const [breakfast] = arbitrateVisits([visit('travel', ['t1', 't2', 't3'])], photos);
    expect(breakfast.status).toBe('unsure');
    expect(breakfast.share).toBeLessThan(0.5);
  });

  it('should keep one series together, in the pack that fits it best', () => {
    const trees = ['t1', 't2', 't3', 't4', 't5', 't6'];
    const photos = fits({ ...Object.fromEntries(trees.map((id) => [id, tree])), tag1: tag, tag2: tag });
    const garden = visit('garden', trees, {
      photos: [
        ...trees.map((id) => ({ id, kind: 'subject' as const })),
        { id: 'tag1', kind: 'source' },
        { id: 'tag2', kind: 'source' },
      ],
    });
    // a nature walk of one round of the garden, and the tags taken for the title pages of books
    const walk = visit('nature', ['t1', 't2', 't3']);
    const books = visit('reading', ['tag1', 'tag2', 't4']);
    const [gardenResult, walkResult, booksResult] = arbitrateVisits([garden, walk, books], photos);
    expect(gardenResult.status).toBe('new');
    expect(gardenResult.photos).toHaveLength(8);
    expect(walkResult.status).toBe('unsure');
    expect(booksResult.status).toBe('unsure');
  });

  it('should give the photos two visits share to the pack whose prompts of their kinds fit them better', () => {
    // the reading pack is sure of its books, and takes a plant tag for one
    const books: PackFit = { reading: { subject: 0.32 }, garden: { subject: 0.2, source: 0.24 } };
    const photos = fits({ b1: books, b2: books, b3: books, tag, t1: tree, t2: tree, t3: tree });
    const garden = visit('garden', ['t1', 't2', 't3'], {
      photos: [...['t1', 't2', 't3'].map((id) => ({ id, kind: 'subject' as const })), { id: 'tag', kind: 'source' }],
    });
    const [gardenResult, readingResult] = arbitrateVisits(
      [garden, visit('reading', ['b1', 'b2', 'b3', 'tag'])],
      photos,
    );
    // the tag is the garden's source: the garden's tag prompts fit it better than a title page
    expect(gardenResult).toMatchObject({ status: 'new' });
    expect(gardenResult.photos.map(({ id }) => id)).toContain('tag');
    expect(readingResult.status).toBe('new');
    expect(readingResult.photos.map(({ id }) => id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('should make a duplicate of a visit too small without the photos it lost', () => {
    const photos = fits({ s1: stage, s2: stage, s3: stage, x: stage });
    const gig = visit('concerts', ['s1', 's2', 's3', 'x']);
    // photos of a gig that another pack takes, with one of its own: fits of the other pack that are a tie
    const other = visit('museum', ['s1', 's2', 'm1']);
    const [concerts, museum] = arbitrateVisits([gig, other], photos);
    expect(concerts.status).toBe('new');
    expect(museum.status).toBe('duplicate');
    expect(museum.photos.map(({ id }) => id)).toEqual(['m1']);
  });

  it('should give the winner the whole occasion: the photos the loser took between the photos they share', () => {
    const walk: PackFit = { nature: { subject: 0.3 }, garden: { subject: 0.27 } };
    const photos = fits({ w1: walk, w2: walk, w3: walk, lone: tree, t1: tree, t2: tree, t3: tree });
    const at = (id: string, time: number) => ({ id, kind: 'subject' as const, time });
    // a garden over the years that took a nature walk for one of its rounds
    const garden = visit('garden', [], {
      photos: [at('w1', 10), at('lone', 11), at('w3', 12), at('t1', 100), at('t2', 200), at('t3', 300)],
    });
    const nature = visit('nature', [], { photos: [at('w1', 10), at('w2', 10.5), at('w3', 12)] });
    const [gardenResult, natureResult] = arbitrateVisits([garden, nature], photos);
    expect(natureResult).toMatchObject({ status: 'new', photos: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }] });
    // the plant photographed on the walk went with it
    expect(gardenResult).toMatchObject({ status: 'new', photos: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] });
  });

  it('should leave the photos of a named visit to its pack', () => {
    const photos = fits({ s1: stage, s2: stage, s3: stage, s4: stage });
    const [all, some] = arbitrateVisits(
      [visit('concerts', ['s1', 's2', 's3']), visit('concerts', ['s1', 's2', 's3', 's4'], { minSubjects: 1 })],
      photos,
      new Set(['s1', 's2']),
    );
    expect(all).toMatchObject({ status: 'named-elsewhere' });
    expect(some).toMatchObject({ status: 'new', photos: [{ id: 's3' }, { id: 's4' }] });
  });

  it('should need the source of a pack that needs one', () => {
    const photos = fits({ s1: stage, s2: stage, s3: stage, ticket: stage });
    const trip = visit('concerts', ['s1', 's2', 's3'], {
      photos: [...['s1', 's2', 's3'].map((id) => ({ id, kind: 'subject' as const })), { id: 'ticket', kind: 'source' }],
      requireSource: true,
    });
    const [result] = arbitrateVisits([trip], photos, new Set(['ticket']));
    expect(result.status).toBe('named-elsewhere');
  });

  it('should keep the old rule without smart search: the first of the largest gets the photos', () => {
    const [food, cookbook] = arbitrateVisits(
      [visit('food', ['d1', 'd2', 'd3', 'd4']), visit('cookbook', ['d1', 'd2', 'd3'])],
      new Map(),
    );
    expect(food).toEqual({ status: 'new', photos: expect.any(Array) });
    expect(cookbook.status).toBe('duplicate');
  });
});

describe('getNamedPhotos', () => {
  const hour = 60 * 60_000;

  it('should give a named visit the photos of its occasion that its pack fits better', () => {
    const winery: PackFit = { wine: { subject: 0.28 }, garden: { subject: 0.24 } };
    const photos = fits({ winery, tree: { wine: { subject: 0.2 }, garden: { subject: 0.3 } } });
    const named = [{ pack: 'wine', assetIds: ['bottle'], start: 10 * hour, end: 11 * hour }];
    const garden = {
      pack: 'garden',
      photos: [
        { id: 'winery', kind: 'subject' as const },
        { id: 'tree', kind: 'subject' as const },
        { id: 'later', kind: 'subject' as const },
      ],
    };
    const times = new Map([
      ['winery', 11.5 * hour],
      ['tree', 11.5 * hour],
      ['later', 20 * hour],
    ]);
    expect([...getNamedPhotos(named, [garden], times, photos, 60)]).toEqual(['bottle', 'winery']);
  });
});
