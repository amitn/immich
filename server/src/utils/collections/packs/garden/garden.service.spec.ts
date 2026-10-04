import { AssetType } from 'src/enum.js';
import { AssetService } from 'src/services/asset.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { TagService } from 'src/services/tag.service.js';
import { PLANT_PROMPTS } from 'src/utils/collections/packs/garden/plants.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const box = (text: string, top: number, height = 0.06, score = 0.98) => {
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

describe('garden pack', () => {
  let sut: CollectionService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();
  const [packet, tag, lettuce, tree] = Array.from({ length: 4 }, () => newUuid());
  const times: Record<string, string> = {
    [packet]: '2008-08-15T10:48:25',
    [lettuce]: '2008-08-15T10:48:31',
    [tag]: '2008-08-15T10:52:00',
    [tree]: '2008-08-15T10:52:20',
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(CollectionService));
    // the flowering prompt is the only one like the photos: they are flowering
    mocks.machineLearning.encodeText.mockImplementation((text: string) =>
      Promise.resolve(text === PLANT_PROMPTS[2] ? '[0,0,1,0]' : '[1,0,0,0]'),
    );
    mocks.tag.getAssetTagsByPrefix.mockResolvedValue([]);
    mocks.access.asset.checkOwnerAccess.mockImplementation((_userId: string, ids: Set<string>) =>
      Promise.resolve(new Set(ids)),
    );
    mocks.asset.getById.mockResolvedValue({ type: AssetType.Image, deletedAt: null, exifInfo: null } as never);
    mocks.asset.getByIds.mockImplementation((ids: string[]) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          type: AssetType.Image,
          deletedAt: null,
          localDateTime: new Date(`${times[id]}Z`),
        })) as never,
      ),
    );
    mocks.search.getEmbeddings.mockImplementation((ids: string[]) =>
      Promise.resolve(ids.map((assetId) => ({ assetId, embedding: '[0,0,1,0]' }))),
    );
    // the packet reads well; the embossed metal tag reads nothing
    mocks.ocr.getByAssetId.mockImplementation((id: string) =>
      Promise.resolve(
        (id === packet
          ? [box('UH SEED LAB', 0.1, 0.04), box('LETTUCE', 0.25, 0.066), box('ANUENUE', 0.31, 0.068)]
          : []) as never,
      ),
    );
    mocks.ocr.getByAssetIds.mockResolvedValue([]);
    mocks.assetJob.getForAgent.mockImplementation((ids: string[]) =>
      Promise.resolve(ids.map((id) => agentRow(id, times[id]))),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should name the photos after the packet they follow, and leave those of an unread tag unnamed', async () => {
    const result = await sut.matchVisit(auth, 'garden', { subjectIds: [lettuce, tree], sourceIds: [packet, tag] });

    expect(result.entries).toEqual([{ index: 0, name: "Lettuce 'Anuenue'", sourceId: packet }]);
    expect(result.subjects.map(({ assetIds, name, unsure }) => ({ assetIds, name, unsure }))).toEqual([
      { assetIds: [lettuce], name: "Lettuce 'Anuenue'", unsure: false },
      { assetIds: [tree], name: undefined, unsure: true },
    ]);
    expect(result.warnings).toEqual([expect.stringContaining('embossed metal tags read nothing')]);
  });

  it('should name the photos after the varieties the assistant read on the tags, in their order', async () => {
    const result = await sut.matchVisit(auth, 'garden', {
      subjectIds: [lettuce, tree],
      sourceIds: [packet, tag],
      entries: [{ name: "Lettuce 'Anuenue'" }, { name: "Peach 'Tropic Prince'" }],
    });

    expect(result.subjects.map(({ assetIds, name }) => ({ assetIds, name }))).toEqual([
      { assetIds: [lettuce], name: "Lettuce 'Anuenue'" },
      { assetIds: [tree], name: "Peach 'Tropic Prince'" },
    ]);
  });

  it('should tag the tags and the seed packets apart, and write the growth stage in the descriptions', async () => {
    mocks.tag.upsertValue.mockImplementation(({ value }: { value: string }) =>
      Promise.resolve({ id: `tag:${value}`, value } as never),
    );
    vi.spyOn(TagService.prototype, 'addAssets').mockImplementation((_, __, { ids }) =>
      Promise.resolve(ids.map((id) => ({ id, success: true }))),
    );
    const update = vi.spyOn(AssetService.prototype, 'update').mockResolvedValue({} as never);

    const result = await sut.saveEntries(auth, 'garden', {
      place: 'Makawao garden',
      photos: [
        { id: packet, entry: 'Seed packet' },
        { id: tag, source: true },
        { id: lettuce, entry: "Lettuce 'Anuenue'" },
      ],
    });

    expect(result.results.map(({ tag }) => tag)).toEqual([
      'Garden/Makawao garden/Seed packet',
      'Garden/Makawao garden/Tag',
      "Garden/Makawao garden/Lettuce 'Anuenue'",
    ]);
    expect(update.mock.calls).toEqual([[auth, lettuce, { description: "Lettuce 'Anuenue' · flowering" }]]);
  });
});
