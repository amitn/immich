import { AssetType } from 'src/enum.js';
import { AssetService } from 'src/services/asset.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { TagService } from 'src/services/tag.service.js';
import { CollectionKind, getPromptList } from 'src/utils/collections/classify.js';
import { winePack } from 'src/utils/collections/packs/wine/pack.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

/** CLIP similarities with the prompts of the wine pack, every prompt of a kind at the given value */
const similarities = (values: Partial<Record<CollectionKind, number>>) =>
  getPromptList(winePack.prompts).map(({ kind }) => values[kind] ?? 0.15);

const bottle = similarities({ subject: 0.3, other: 0.2 });

const box = (text: string, top: number, height = 0.03, score = 0.98) => {
  const width = text.length * height * 0.45;
  const left = 0.5 - width / 2;
  return {
    x1: left,
    y1: top,
    x2: left + width,
    y2: top,
    x3: left + width,
    y3: top + height,
    x4: left,
    y4: top + height,
    text,
    textScore: score,
  };
};

const eventRow = (id: string, iso: string) => ({
  id,
  localDateTime: new Date(`${iso}Z`),
  latitude: null,
  longitude: null,
  city: null,
  country: null,
  people: [],
});

const agentRow = (id: string, iso: string) =>
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
  }) as never;

describe('wine pack', () => {
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

  it('should name the drinks of a lunch after the Food meal of the same time', async () => {
    const albumId = newUuid();
    const [aperitif, beer, dish, menu, elsewhere] = Array.from({ length: 5 }, () => newUuid());
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    mocks.assetJob.getForAgentEvents.mockImplementation((options: { albumId?: string }) =>
      Promise.resolve(
        (options.albumId
          ? [eventRow(aperitif, '2016-03-23T17:15:42'), eventRow(beer, '2016-03-23T20:33:23')]
          : [
              eventRow(aperitif, '2016-03-23T17:15:42'),
              eventRow(dish, '2016-03-23T17:41:16'),
              eventRow(menu, '2016-03-23T20:51:08'),
              eventRow(beer, '2016-03-23T20:33:23'),
              eventRow(elsewhere, '2016-03-25T13:00:00'),
            ]) as never,
      ),
    );
    mocks.search.getEmbeddingSimilarities.mockResolvedValue([
      { assetId: aperitif, similarities: bottle },
      { assetId: beer, similarities: bottle },
    ]);
    mocks.tag.getAssetTagsByPrefix.mockImplementation((_ids: string[], prefix: string) =>
      Promise.resolve(
        prefix === 'Food/'
          ? [
              { assetId: dish, tagId: 'd', value: 'Food/Noma Australia/Unripe macadamia and spanner crab' },
              { assetId: menu, tagId: 'm', value: 'Food/Noma Australia/Menu' },
              { assetId: elsewhere, tagId: 'k', value: "Food/Katz's Delicatessen/Pastrami on rye" },
            ]
          : [],
      ),
    );

    const result = await sut.findVisits(auth, 'wine', { albumId });

    expect(result.visits.map(({ subjectIds, place }) => ({ subjectIds, place }))).toEqual([
      {
        subjectIds: [aperitif],
        place: { name: 'Noma Australia', source: 'tag', confidence: 0.9, assetIds: [dish] },
      },
      {
        subjectIds: [beer],
        place: { name: 'Noma Australia', source: 'tag', confidence: 0.9, assetIds: [menu] },
      },
    ]);
  });

  it('should read the label of every bottle, group the photos of one bottle and name it', async () => {
    const [selbach, glass, kudos, blank] = Array.from({ length: 4 }, () => newUuid());
    mocks.access.asset.checkOwnerAccess.mockImplementation((_userId: string, ids: Set<string>) =>
      Promise.resolve(new Set(ids)),
    );
    // no original to read at full resolution: the stored OCR is read
    mocks.asset.getById.mockResolvedValue({ type: AssetType.Image, deletedAt: null, exifInfo: null } as never);
    mocks.ocr.getByAssetIds.mockResolvedValue([
      ...[
        box('SELBACH-OSTER', 0.66, 0.03),
        box('2008', 0.72, 0.017),
        box('ZELTINGER SCHLOSSBERG', 0.75, 0.022),
        box('RIESLING SPATLESE', 0.78, 0.021),
      ].map((ocr) => ({ assetId: selbach, ...ocr })),
      ...[box('KUDOS', 0.65, 0.12), box('2012', 0.83, 0.02, 0.86)].map((ocr) => ({ assetId: kudos, ...ocr })),
    ] as never);
    mocks.assetJob.getForAgent.mockResolvedValue([
      agentRow(selbach, '2010-09-26T19:27:21'),
      agentRow(glass, '2010-09-26T19:28:30'),
      agentRow(kudos, '2010-09-26T19:50:00'),
      agentRow(blank, '2010-09-26T20:30:00'),
    ]);
    mocks.search.getEmbeddings.mockResolvedValue([
      { assetId: selbach, embedding: '[1,0.1,0,0]' },
      { assetId: glass, embedding: '[1,0.15,0,0]' },
      { assetId: kudos, embedding: '[0,1,0,0]' },
      { assetId: blank, embedding: '[0,0,1,0]' },
    ]);

    const result = await sut.matchVisit(auth, 'wine', { subjectIds: [selbach, glass, kudos, blank] });

    expect(result.entries).toEqual([
      {
        index: 0,
        name: 'Selbach-Oster · Zeltinger Schlossberg Riesling Spätlese · 2008',
        description: 'Riesling',
        sourceId: selbach,
      },
      { index: 1, name: 'Kudos · 2012', sourceId: kudos },
    ]);
    expect(result.subjects.map(({ assetIds, name, unsure }) => ({ assetIds, name, unsure }))).toEqual([
      // the glass beside the bottle is the same bottle, by its look only: to check
      {
        assetIds: [selbach, glass],
        name: 'Selbach-Oster · Zeltinger Schlossberg Riesling Spätlese · 2008',
        unsure: true,
      },
      { assetIds: [kudos], name: 'Kudos · 2012', unsure: true },
      { assetIds: [blank], name: undefined, unsure: true },
    ]);
    // the labels are the source: no warning that there is none
    expect(result.warnings).toEqual([]);
  });

  it('should tag the bottles and the wine list', async () => {
    const [list, bottle] = [newUuid(), newUuid()];
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([list, bottle]));
    mocks.tag.upsertValue.mockImplementation(({ value }: { value: string }) =>
      Promise.resolve({ id: `tag:${value}`, value } as never),
    );
    vi.spyOn(TagService.prototype, 'addAssets').mockImplementation((_, __, { ids }) =>
      Promise.resolve(ids.map((id) => ({ id, success: true }))),
    );
    const update = vi.spyOn(AssetService.prototype, 'update').mockResolvedValue({} as never);
    mocks.assetJob.getForAgent.mockResolvedValue([
      agentRow(list, '2016-03-23T17:10:00'),
      agentRow(bottle, '2016-03-23T17:15:42'),
    ]);

    const result = await sut.saveEntries(auth, 'wine', {
      place: 'Noma Australia',
      photos: [
        { id: list, source: true },
        { id: bottle, entry: 'Two Metre Tall · Snakebite' },
      ],
    });

    expect(result.results.map(({ tag }) => tag)).toEqual([
      'Wine/Noma Australia/Wine list',
      'Wine/Noma Australia/Two Metre Tall · Snakebite',
    ]);
    expect(update.mock.calls).toEqual([[auth, bottle, { description: 'Two Metre Tall · Snakebite' }]]);
  });
});
