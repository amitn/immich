import { SequenceOptions, applySequencePrior, getSequenceCost, matchSubjects } from 'src/utils/collections/match.js';
import { MUSEUM_MATCH_OPTIONS } from 'src/utils/collections/packs/museum/pack.js';

const SECOND = 1000;
const options: SequenceOptions = { step: 2.5, before: 0.7, time: 2, seconds: 30, off: 2.5 };

/** a unit vector along one axis, with a little of another */
const vector = (axis: number, other = -1, amount = 0) => {
  const values = new Float32Array(8);
  values[axis] = 1;
  if (other >= 0) {
    values[other] = amount;
  }
  const norm = Math.hypot(...values);
  return values.map((value) => value / norm);
};

/** a photo whose cosine similarities with the texts of axes 4, 5 and 6 are `similarities`, on an axis of its own */
const seen = (axis: number, similarities: number[]) => {
  const values = new Float32Array(8);
  for (const [index, similarity] of similarities.entries()) {
    values[4 + index] = similarity;
  }
  values[axis] = Math.sqrt(1 - similarities.reduce((sum, value) => sum + value * value, 0));
  return values;
};

describe('pairing artworks with the labels photographed next to them', () => {
  it('should cost nothing for the next photo, a little for the one before, and more for every photo between', () => {
    // artwork 0 at 0 s, label A at 5 s, artwork 1 at 60 s, label B at 65 s
    const subjects = [[0], [60 * SECOND]];
    const sources = [5 * SECOND, 65 * SECOND];
    const others = { subjects, sources };
    expect(getSequenceCost(subjects[0], sources[0], others, options)).toBe(0);
    expect(getSequenceCost(subjects[1], sources[1], others, options)).toBe(0);
    // label A is right before artwork 1, but 55 s before it
    expect(getSequenceCost(subjects[1], sources[0], others, options)).toBeCloseTo(0.7 + 2 * Math.log2(1 + 25 / 30));
    // label B is two photos after artwork 0
    expect(getSequenceCost(subjects[0], sources[1], others, options)).toBeGreaterThan(2 * 2.5);
    // a label photographed between two detail shots of one artwork is next to both
    expect(
      getSequenceCost([0, 20 * SECOND], 10 * SECOND, { subjects: [[0, 20 * SECOND]], sources: [10 * SECOND] }, options),
    ).toBe(0);
  });

  it('should weigh what CLIP sees by the sequence, and "no label" by its own cost', () => {
    const [row] = applySequencePrior([[0]], [5 * SECOND, 600 * SECOND], [[0.4, 0.4, 0.2]], options);
    expect(row[0]).toBeGreaterThan(0.9);
    expect(row[1]).toBeLessThan(0.01);
    expect(row.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it('should pair each artwork with its label where CLIP prefers another, sharing a label between details', () => {
    // CLIP sees the photo taken after a label more like the label of the details
    const photos = [
      { id: 'painting', time: 0, embedding: seen(0, [0.3, 0.2, 0.2]) },
      { id: 'label-first', time: 70 * SECOND, embedding: seen(1, [0.2, 0.22, 0.25]) },
      { id: 'detail', time: 200 * SECOND, embedding: seen(2, [0.2, 0.2, 0.26]) },
      { id: 'detail-2', time: 240 * SECOND, embedding: seen(3, [0.2, 0.24, 0.25]) },
    ];
    const items = [
      // the label of the painting, 4 s after it
      { embedding: vector(4), sourceTime: 4 * SECOND },
      // a label photographed before its artwork
      { embedding: vector(5), sourceTime: 60 * SECOND },
      // a label between two details of one painting
      { embedding: vector(6), sourceTime: 220 * SECOND },
    ];
    const { matches, ordered } = matchSubjects(photos, items, MUSEUM_MATCH_OPTIONS);
    expect(ordered).toBe(false);
    expect(matches.map(({ ids, item }) => [ids, item])).toEqual([
      [['painting'], 0],
      [['label-first'], 1],
      [['detail'], 2],
      [['detail-2'], 2],
    ]);
    expect(matches.filter(({ shared }) => shared).map(({ ids }) => ids)).toEqual([['detail'], ['detail-2']]);
    expect(matchSubjects(photos, items, { order: 'none' }).matches[1].item).not.toBe(1);
  });

  it('should leave an artwork without a label when the nearest label belongs to another', () => {
    const photos = [
      { id: 'ephebos', time: 0, embedding: vector(0) },
      { id: 'bust', time: 130 * SECOND, embedding: vector(1) },
      { id: 'portrait', time: 1100 * SECOND, embedding: vector(2) },
    ];
    const items = [
      { embedding: vector(0, 3, 0.2), sourceTime: 3 * SECOND },
      { embedding: vector(2, 3, 0.2), sourceTime: 1102 * SECOND },
    ];
    const baselines = [vector(3)];
    const { matches } = matchSubjects(photos, items, { ...MUSEUM_MATCH_OPTIONS, baselines });
    expect(matches.map(({ ids, item }) => [ids[0], item])).toEqual([
      ['ephebos', 0],
      ['bust', undefined],
      ['portrait', 1],
    ]);
  });

  it('should leave the matcher as it was without times, or without a sequence', () => {
    const photos = [
      { id: 'a', time: 0, embedding: vector(0) },
      { id: 'b', time: 60 * SECOND, embedding: vector(1) },
    ];
    const items = [{ embedding: vector(1) }, { embedding: vector(0) }];
    const plain = matchSubjects(photos, items, { order: 'none' });
    // entries without the time of their source: the sequence can't apply
    expect(matchSubjects(photos, items, MUSEUM_MATCH_OPTIONS)).toEqual(plain);
    expect(plain.matches.map(({ item }) => item)).toEqual([1, 0]);
  });
});
