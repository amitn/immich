import { AssetType } from 'src/enum.js';
import { AssetService } from 'src/services/asset.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { TagService } from 'src/services/tag.service.js';
import { CollectionKind, getPromptList } from 'src/utils/collections/classify.js';
import { cookbookPack } from 'src/utils/collections/packs/cookbook/pack.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

/** CLIP similarities with the prompts of the cookbook pack, every prompt of a kind at the given value */
const similarities = (values: Partial<Record<CollectionKind, number>>) =>
  getPromptList(cookbookPack.prompts).map(({ kind }) => values[kind] ?? 0.15);

const cooking = similarities({ subject: 0.3, other: 0.2 });
const page = similarities({ source: 0.28, subject: 0.22, other: 0.2 });

const box = (text: string, left: number, top: number, height = 0.02) => {
  const right = left + text.length * height * 0.42;
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.95 };
};

/** a cookbook page with the quiche and, beside it, a spinach quiche */
const recipeBoxes = [
  box('Quiche', 0.05, 0.1, 0.04),
  box('Prep: 25 minutes Bake: 52 minutes', 0.05, 0.16),
  box('4 beaten eggs', 0.07, 0.24),
  box('11/2 cups half-and-half', 0.07, 0.27),
  box('1 cup chopped cooked ham', 0.07, 0.3),
  box('1. Preheat the oven to 450 degrees.', 0.05, 0.38),
  box('2. Whisk the eggs and half-and-half.', 0.05, 0.41),
  box('3. Pour into the pastry shell and bake.', 0.05, 0.44),
  box('Spinach Quiche', 0.55, 0.1, 0.04),
  box('8 beaten eggs', 0.57, 0.18),
  box('6 slices bacon, chopped', 0.57, 0.21),
  box('1. Cook the bacon in a skillet.', 0.55, 0.28),
];

const eventRow = (id: string, iso: string) => ({
  id,
  localDateTime: new Date(`${iso}Z`),
  latitude: null,
  longitude: null,
  city: null,
  country: null,
  people: [],
});

const agentRow = (id: string, iso: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: AssetType.Image,
    localDateTime: new Date(`${iso}Z`),
    latitude: null,
    longitude: null,
    city: null,
    country: null,
    description: '',
    previewPath: `/data/thumbs/${id}.jpeg`,
    faces: [],
    ...extra,
  }) as never;

describe('cookbook pack', () => {
  let sut: CollectionService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();

  beforeEach(() => {
    ({ sut, mocks } = newTestService(CollectionService));
    mocks.machineLearning.encodeText.mockImplementation((text: string) => Promise.resolve(`[${text.length},1,0,0]`));
    mocks.tag.getAssetTagsByPrefix.mockResolvedValue([]);
    mocks.ocr.getByAssetIds.mockResolvedValue([]);
    mocks.asset.getByIds.mockImplementation((ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ id, type: AssetType.Image, deletedAt: null })) as never),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should find a cooking session with the recipe photographed the next morning', async () => {
    const albumId = newUuid();
    const [shells, bowl, oven, done, recipe] = Array.from({ length: 5 }, () => newUuid());
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    mocks.assetJob.getForAgentEvents.mockResolvedValue([
      eventRow(shells, '2006-11-15T18:17:00'),
      eventRow(bowl, '2006-11-15T18:44:00'),
      eventRow(oven, '2006-11-15T19:09:00'),
      eventRow(done, '2006-11-15T19:46:00'),
      eventRow(recipe, '2006-11-16T11:40:00'),
    ] as never);
    mocks.search.getEmbeddingSimilarities.mockResolvedValue([
      { assetId: shells, similarities: cooking },
      { assetId: bowl, similarities: cooking },
      { assetId: oven, similarities: cooking },
      { assetId: done, similarities: cooking },
      { assetId: recipe, similarities: page },
    ]);
    mocks.ocr.getByAssetIds.mockResolvedValue([
      // the label of the oven door does not make a photo of the cooking a recipe
      { assetId: oven, ...box('FRIGIDAIRE', 0.4, 0.2, 0.05) },
      ...recipeBoxes.map((ocr) => ({ assetId: recipe, ...ocr })),
    ] as never);

    const result = await sut.findVisits(auth, 'cookbook', { albumId });

    expect(mocks.tag.getAssetTagsByPrefix).toHaveBeenCalledWith(expect.any(Array), 'Recipes/');
    expect(result.visits).toHaveLength(1);
    expect(result.visits[0]).toMatchObject({
      subjectIds: [shells, bowl, oven, done],
      sourceIds: [recipe],
      signIds: [],
      receiptIds: [],
      place: { name: 'Quiche', source: 'source' },
    });
  });

  it('should match the photos with the steps of the recipe that fits them, in order', async () => {
    const [recipe, shells, bowl, oven, done] = Array.from({ length: 5 }, () => newUuid());
    mocks.access.asset.checkOwnerAccess.mockImplementation((_userId: string, ids: Set<string>) =>
      Promise.resolve(new Set(ids)),
    );
    mocks.asset.getById.mockResolvedValue({
      id: recipe,
      type: AssetType.Image,
      deletedAt: null,
      exifInfo: null,
      files: [],
    } as never);
    mocks.ocr.getByAssetId.mockResolvedValue(recipeBoxes as never);
    // the photos look like a quiche (and each like its step), not like a spinach quiche
    const texts: Array<[RegExp, string]> = [
      [/^a photo of Quiche$/, '[1,0,0,0,0,0]'],
      [/^a photo of Spinach Quiche$/, '[0,0,0,0,0,1]'],
      [/Preheat/, '[0,1,0,0,0,0]'],
      [/Whisk/, '[0,0,1,0,0,0]'],
      [/Pour/, '[0,0,0,1,0,0]'],
      [/finished Quiche/, '[0,0,0,0,1,0]'],
    ];
    mocks.machineLearning.encodeText.mockImplementation((text: string) =>
      Promise.resolve(texts.find(([pattern]) => pattern.test(text))?.[1] ?? '[0.1,0.1,0.1,0.1,0.1,0.1]'),
    );
    mocks.assetJob.getForAgent.mockResolvedValue([
      agentRow(shells, '2006-11-15T18:17:00'),
      agentRow(bowl, '2006-11-15T18:44:00'),
      agentRow(oven, '2006-11-15T19:09:00'),
      agentRow(done, '2006-11-15T19:46:00'),
    ]);
    mocks.search.getEmbeddings.mockResolvedValue([
      { assetId: shells, embedding: '[0.3,0.9,0,0,0,0]' },
      { assetId: bowl, embedding: '[0.3,0,0.9,0,0,0]' },
      { assetId: oven, embedding: '[0.3,0,0,0.9,0,0]' },
      { assetId: done, embedding: '[0.5,0,0,0,0.8,0]' },
    ]);

    const reading = await sut.readSource(auth, 'cookbook', recipe);
    expect(reading.title).toBe('Quiche');
    expect(reading.alternatives?.map(({ title }) => title)).toEqual(['Spinach Quiche']);

    const result = await sut.matchVisit(auth, 'cookbook', {
      subjectIds: [shells, bowl, oven, done],
      sourceIds: [recipe],
    });

    expect(result.entries.map(({ name }) => name)).toEqual([
      'Step 1: Preheat the oven',
      'Step 2: Whisk the eggs and half-and-half',
      'Step 3: Pour into the pastry shell',
      'Result',
    ]);
    expect(result.warnings).toContain(
      'The recipe photo also shows Spinach Quiche: the steps of Quiche fit the photos best',
    );
    expect(result.ordered).toBe(true);
    expect(result.subjects.map(({ assetIds, name }) => [assetIds[0], name])).toEqual([
      [shells, 'Step 1: Preheat the oven'],
      [bowl, 'Step 2: Whisk the eggs and half-and-half'],
      [oven, 'Step 3: Pour into the pastry shell'],
      [done, 'Result'],
    ]);
  });

  it('should tag the steps, the finished dish and the recipe', async () => {
    const [recipe, bowl, done] = [newUuid(), newUuid(), newUuid()];
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([recipe, bowl, done]));
    mocks.tag.upsertValue.mockImplementation(({ value }: { value: string }) =>
      Promise.resolve({ id: `tag:${value}`, value } as never),
    );
    const addAssets = vi
      .spyOn(TagService.prototype, 'addAssets')
      .mockImplementation((_, __, { ids }) => Promise.resolve(ids.map((id) => ({ id, success: true }))));
    const update = vi.spyOn(AssetService.prototype, 'update').mockResolvedValue({} as never);
    mocks.assetJob.getForAgent.mockResolvedValue([
      agentRow(recipe, '2006-11-16T11:40:00'),
      agentRow(bowl, '2006-11-15T18:44:00'),
      agentRow(done, '2006-11-15T19:46:00'),
    ]);

    const result = await sut.saveEntries(auth, 'cookbook', {
      place: 'Quiche',
      photos: [
        { id: recipe, source: true },
        { id: bowl, entry: 'Step 2: Whisk the eggs' },
        { id: done, entry: 'Result' },
      ],
    });

    expect(result.results.map(({ tag }) => tag)).toEqual([
      'Recipes/Quiche/Recipe',
      'Recipes/Quiche/Step 2: Whisk the eggs',
      'Recipes/Quiche/Result',
    ]);
    expect(addAssets).toHaveBeenCalledWith(auth, 'tag:Recipes/Quiche/Recipe', { ids: [recipe] });
    expect(update.mock.calls).toEqual([
      [auth, bowl, { description: '2. Whisk the eggs · Quiche' }],
      [auth, done, { description: 'Finished dish · Quiche' }],
    ]);
  });
});
