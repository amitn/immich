import { AssignOptions, DEFAULT_MATCH_OPTIONS } from 'src/utils/collections/match.js';
import {
  PLANT_PROMPTS,
  assignPlants,
  getGrowthStage,
  isWholePlant,
} from 'src/utils/collections/packs/garden/plants.js';

const second = 1000;
const day = 24 * 60 * 60 * second;

/** one-hot similarities: the photo is like the prompt at `index` only */
const like = (index: number) => PLANT_PROMPTS.map((_, other) => (other === index ? 0.3 : 0.2));

/** prompt embeddings, and photo embeddings that are like one prompt */
const prompts = PLANT_PROMPTS.map((_, index) =>
  Float32Array.from(PLANT_PROMPTS, (__, other) => (other === index ? 1 : 0)),
);
const WHOLE_TREE = 0;
const BLOSSOM = 2;
const photo = (id: string, time: number, prompt: number) => ({ id, time, embedding: prompts[prompt] });
const source = (id: string, time: number) => ({ id, time, embedding: new Float32Array(0) });

const options = (sources: ReturnType<typeof source>[]): AssignOptions => ({
  ...DEFAULT_MATCH_OPTIONS,
  baselines: [],
  suggestions: 3,
  sources,
  prompts,
});

describe('garden plants', () => {
  it('should tell a whole plant from a close-up, and a stage only when CLIP can tell it', () => {
    expect(isWholePlant(like(WHOLE_TREE))).toBe(true);
    expect(isWholePlant(like(BLOSSOM))).toBe(false);
    expect(getGrowthStage(like(BLOSSOM))).toBe('flowering');
    expect(getGrowthStage(like(WHOLE_TREE))).toBeUndefined();
    // two stages as alike: none
    expect(getGrowthStage(PLANT_PROMPTS.map((_, index) => (index === 2 || index === 8 ? 0.3 : 0.2)))).toBeUndefined();
  });

  it('should put each photo with the tag it follows, and start a plant at a whole tree after a close-up', () => {
    const { matches } = assignPlants(
      [
        photo('prince tree', 20 * second, WHOLE_TREE),
        photo('prince blossom', 50 * second, BLOSSOM),
        photo('untagged tree', 90 * second, WHOLE_TREE),
        photo('snow blossom', 160 * second, BLOSSOM),
      ],
      [{ name: "Peach 'Tropic Prince'" }, { name: "Peach 'Tropic Snow'" }],
      options([source('prince tag', 0), source('snow tag', 140 * second)]),
    );
    expect(matches.map(({ ids, item, unsure }) => ({ ids, item, unsure }))).toEqual([
      { ids: ['prince tree', 'prince blossom'], item: 0, unsure: false },
      { ids: ['untagged tree'], item: undefined, unsure: true },
      { ids: ['snow blossom'], item: 1, unsure: false },
    ]);
  });

  it('should join the photos of a variety over the years, and leave a plant nothing names unnamed', () => {
    const { matches } = assignPlants(
      [
        photo('2013', 20 * second, BLOSSOM),
        photo('2014', 365 * day + 20 * second, BLOSSOM),
        photo('2015', 730 * day, BLOSSOM),
      ],
      [
        { name: "Peach 'Tropic Prince'", sourceId: 'tag 2013' },
        { name: "Peach 'Tropic Prince'", sourceId: 'tag 2014' },
      ],
      options([source('tag 2013', 0), source('tag 2014', 365 * day)]),
    );
    expect(matches.map(({ ids, item }) => ({ ids, item }))).toEqual([
      { ids: ['2013', '2014'], item: 0 },
      { ids: ['2015'], item: undefined },
    ]);
    expect(matches[1].suggestions[0]).toMatchObject({ item: 0 });
  });
});
