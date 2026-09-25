import { defaultBookStyle } from 'src/dtos/book.dto.js';
import { BookReviewInput, BookReviewPage, BookReviewPhoto, reviewBook } from 'src/utils/book/review.js';

const size = { pageWidthMm: 210, pageHeightMm: 210 };
const start = Date.UTC(2025, 2, 15, 9);

let counter = 0;
const photo = (dto: Partial<BookReviewPhoto> = {}): BookReviewPhoto => {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    width: 3000,
    height: 2000,
    takenAt: start + counter * 60_000,
    score: 0.5,
    ...dto,
  };
};

const page = (layout: string, photos: BookReviewPhoto[], extra: Partial<BookReviewPage> = {}): BookReviewPage => ({
  layout,
  caption: 'Westcott · 2:15 pm',
  assets: photos.map((item, slot) => ({ slot, assetId: item.id, crop: null })),
  ...extra,
});

const embedding = (axis: number) => {
  const vector = new Float32Array(8);
  vector[axis] = 1;
  return vector;
};

const review = (pages: BookReviewPage[], photos: BookReviewPhoto[], extra: Partial<BookReviewInput> = {}) =>
  reviewBook({ size, style: defaultBookStyle, pages, photos, stadiaApiKey: 'key', ...extra });

const types = (result: ReturnType<typeof reviewBook>) => result.issues.map((issue) => issue.type);

beforeEach(() => {
  counter = 0;
});

describe('reviewBook', () => {
  it('should find nothing wrong with a varied book', () => {
    const photos = Array.from({ length: 7 }, (_, i) => photo({ embedding: embedding(i) }));
    const result = review(
      [
        page('cover', [photos[0]], { caption: null }),
        page('two-vertical', photos.slice(1, 3)),
        page('hero-top-two', photos.slice(3, 6)),
        page('single', [photos[6]]),
      ],
      photos,
    );
    expect(result).toEqual({
      pageCount: 4,
      counts: { high: 0, medium: 0, low: 0 },
      issues: [],
      unusedPhotos: [],
      weakestPlaced: expect.any(Array),
      people: [],
    });
  });

  it('should report a stack on two pages, but not an intentional pair', () => {
    const [original, artwork, other, crop, cropOriginal] = [
      photo({ stackId: 'a' }),
      photo({ stackId: 'a', kind: 'artwork' }),
      photo(),
      photo({ stackId: 'b', kind: 'crop' }),
      photo({ stackId: 'b' }),
    ];
    const photos = [original, artwork, other, crop, cropOriginal];
    const result = review(
      [page('two-vertical', [original, artwork]), page('single', [crop]), page('two-vertical', [other, cropOriginal])],
      photos,
    );
    expect(result.issues.filter((issue) => issue.type === 'duplicate-stack')).toEqual([
      expect.objectContaining({ severity: 'high', pages: [2, 3], assetIds: [crop.id, cropOriginal.id] }),
    ]);
  });

  it('should report placements below 150 dpi with their page and slot', () => {
    const small = photo({ width: 1024, height: 1024, kind: 'artwork' });
    const result = review(
      [page('full-bleed', [small]), page('four-grid', [photo(), photo(), photo(), photo()])],
      [small],
    );
    expect(result.issues[0]).toEqual(
      expect.objectContaining({ severity: 'high', type: 'low-dpi', pages: [1], slot: 1, dpi: 124 }),
    );
  });

  it('should report empty slots', () => {
    const photos = [photo()];
    const result = review([page('two-vertical', photos)], photos);
    expect(result.issues).toEqual([expect.objectContaining({ type: 'empty-slot', pages: [1], slot: 2 })]);
  });

  it('should report too much artwork and artwork back to back', () => {
    const photos = Array.from({ length: 10 }, (_, i) =>
      photo({ kind: i < 3 ? 'artwork' : 'original', embedding: embedding(i % 8) }),
    );
    const pages = [
      page('single', [photos[0]]),
      page('single', [photos[1]]),
      page('two-vertical', [photos[3], photos[4]]),
      page('hero-top-two', [photos[5], photos[6], photos[7]]),
      page('two-vertical', [photos[2], photos[8]]),
    ];
    const result = review(pages, photos);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'medium', type: 'too-much-artwork', pages: [1, 2, 5] }),
        expect.objectContaining({ severity: 'medium', type: 'artwork-back-to-back', pages: [1, 2] }),
      ]),
    );
  });

  it('should report more than two single-photo pages in a row', () => {
    const photos = Array.from({ length: 5 }, (_, i) => photo({ embedding: embedding(i) }));
    const pages = [
      page('single', [photos[0]]),
      page('full-bleed', [photos[1]]),
      page('section-opener', [photos[2]], { sectionTitle: 'Westcott' }),
      page('two-vertical', [photos[3], photos[4]]),
    ];
    expect(review(pages, photos).issues).toEqual([
      expect.objectContaining({ severity: 'medium', type: 'singles-in-a-row', pages: [1, 2, 3] }),
    ]);
  });

  it('should report similar photos on neighbouring pages, most of all on facing pages', () => {
    const [a, b, c, d, e, f] = [0, 0, 1, 3, 3, 6].map((axis) => photo({ embedding: embedding(axis) }));
    const pages = [
      page('full-bleed', [c]),
      page('single', [a]),
      page('two-vertical', [b, d]),
      page('hero-top-two', [e, photo({ embedding: embedding(4) }), photo({ embedding: embedding(5) })]),
      page('single', [f]),
    ];
    const result = review(pages, [
      a,
      b,
      c,
      d,
      e,
      f,
      ...pages[3].assets.slice(1).map((asset) => photo({ id: asset.assetId })),
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: 'medium',
        type: 'similar-neighbours',
        pages: [2, 3],
        assetIds: [a.id, b.id],
      }),
      expect.objectContaining({ severity: 'low', type: 'similar-neighbours', pages: [3, 4], assetIds: [d.id, e.id] }),
    ]);
  });

  it('should report maps whose style falls back to a sketch', () => {
    const map = { style: 'watercolor' as const, showRoute: true, labels: true };
    const pages = [
      page('map', [], { map }),
      page('map', [], { map: { ...map, style: 'sketch' } }),
      page('map', [], { map: { ...map, artJobId: '00000000-0000-4000-8000-000000009999' } }),
    ];
    expect(review(pages, [], { stadiaApiKey: '' }).issues).toEqual([
      expect.objectContaining({ severity: 'medium', type: 'map-style-fallback', pages: [1] }),
    ]);
    expect(review(pages, []).issues).toEqual([]);
  });

  it('should report repeated layouts and pages without captions', () => {
    const photos = Array.from({ length: 4 }, (_, i) => photo({ embedding: embedding(i) }));
    const pages = [
      page('two-vertical', photos.slice(0, 2), { caption: null }),
      page('two-vertical', photos.slice(2, 4)),
    ];
    pages[0].assets[0].caption = null;
    expect(review(pages, photos).issues).toEqual([
      expect.objectContaining({ severity: 'low', type: 'missing-captions', pages: [1] }),
      expect.objectContaining({ severity: 'low', type: 'repeated-layout', pages: [1, 2] }),
    ]);

    pages[0].assets[1].caption = 'Amit on Box Hill';
    expect(types(review(pages, photos))).toEqual(['repeated-layout']);
  });

  it('should suggest the best unused photos, the main people first, one per stack and cluster', () => {
    const amit = { id: 'person-amit', name: 'Amit' };
    const placed = [photo({ score: 0.3 }), photo({ score: 0.4, stackId: 's1', clusterId: 1 })];
    const selfies = Array.from({ length: 6 }, (_, i) => photo({ score: 0.6 + i / 100, people: [amit] }));
    const others = [
      photo({ score: 0.9 }),
      photo({ score: 0.95, stackId: 's1', kind: 'crop' }),
      photo({ score: 0.92, clusterId: 1 }),
      photo({ score: 0.85, clusterId: 2 }),
      photo({ score: 0.84, clusterId: 2 }),
      photo({ score: 0.99, kind: 'artwork' }),
    ];
    const photos = [...placed, ...selfies, ...others];
    const result = review([page('two-vertical', placed)], photos, { candidateIds: photos.map(({ id }) => id) });

    expect(result.unusedPhotos.map(({ assetId }) => assetId)).toEqual([
      others[0].id,
      others[3].id,
      ...selfies.toReversed().map(({ id }) => id),
    ]);
    expect(result.unusedPhotos[2]).toEqual({ assetId: selfies[5].id, score: 0.65, people: ['Amit'] });
    expect(result.people).toEqual([{ personId: amit.id, name: 'Amit', photos: 6, placed: 0 }]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'person-underrepresented',
          assetIds: selfies
            .toReversed()
            .slice(0, 3)
            .map(({ id }) => id),
        }),
      ]),
    );
    expect(result.weakestPlaced).toEqual([
      { assetId: placed[0].id, score: 0.3, page: 1, slot: 1 },
      { assetId: placed[1].id, score: 0.4, page: 1, slot: 2 },
    ]);
  });

  it('should report placed photos that an improved copy would clearly help', () => {
    const [a, b, c, d] = [
      photo({ gain: 0.05 }),
      photo({ gain: 0.01 }),
      photo({ gain: 0.2, kind: 'improved' }),
      photo(),
    ];
    const result = review([page('two-vertical', [a, b]), page('two-horizontal', [c, d])], [a, b, c, d]);
    expect(result.issues.filter((issue) => issue.type === 'could-look-better')).toEqual([
      expect.objectContaining({ severity: 'low', pages: [1], assetIds: [a.id] }),
    ]);
    expect(result.issues.find((issue) => issue.type === 'could-look-better')!.message).toMatch(/apply_improvements/);

    const strong = photo({ gain: 0.1 });
    const medium = review([page('single', [strong])], [strong]);
    expect(medium.issues).toContainEqual(
      expect.objectContaining({ severity: 'medium', type: 'could-look-better', assetIds: [strong.id] }),
    );
  });

  it('should order the issues by severity', () => {
    const small = photo({ width: 800, height: 800 });
    const photos = [small, photo(), photo()];
    const pages = [page('two-vertical', photos.slice(1), { caption: null }), page('full-bleed', [small])];
    const result = review(pages, photos);
    expect(result.issues.map((issue) => issue.severity)).toEqual(['high', 'low']);
    expect(result.counts).toEqual({ high: 1, medium: 0, low: 1 });
  });
});
