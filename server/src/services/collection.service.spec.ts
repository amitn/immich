import { BadRequestException } from '@nestjs/common';
import { AssetType } from 'src/enum.js';
import { AssetService } from 'src/services/asset.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { TagService } from 'src/services/tag.service.js';
import { CollectionKind, getPromptList } from 'src/utils/collections/classify.js';
import { registerCollectionPack, unregisterCollectionPack } from 'src/utils/collections/registry.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { labelsPack } from 'test/fixtures/collections/labels.pack.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

/** CLIP similarities with the prompts of the labels pack, every prompt of a kind at the given value */
const similarities = (values: Partial<Record<CollectionKind, number>>) =>
  getPromptList(labelsPack.prompts).map(({ kind }) => values[kind] ?? 0.15);

const plant = similarities({ subject: 0.3, other: 0.2 });
const board = similarities({ source: 0.27, other: 0.2 });
const gate = similarities({ sign: 0.28, other: 0.22 });
const people = similarities({ subject: 0.18, other: 0.3 });

const box = (text: string, left: number, top: number, height = 0.03) => {
  const right = left + text.length * height * 0.45;
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.95 };
};

const boardBoxes = [
  box('Asplenium nidus', 0.1, 0.1),
  box('Rosa canina', 0.1, 0.2),
  box('Inv. 19870412', 0.1, 0.3, 0.02),
];

const eventRow = (id: string, iso: string, extra: Record<string, unknown> = {}) => ({
  id,
  localDateTime: new Date(`${iso}Z`),
  latitude: null,
  longitude: null,
  city: null,
  country: null,
  people: [],
  ...extra,
});

const agentRow = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: AssetType.Image,
    localDateTime: new Date('2024-05-02T10:30:00Z'),
    latitude: null,
    longitude: null,
    city: null,
    country: null,
    description: '',
    previewPath: `/data/thumbs/${id}.jpeg`,
    faces: [],
    ...extra,
  }) as never;

describe(CollectionService.name, () => {
  let sut: CollectionService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();

  beforeAll(() => {
    registerCollectionPack(labelsPack);
    return () => unregisterCollectionPack(labelsPack.id);
  });

  beforeEach(() => {
    ({ sut, mocks } = newTestService(CollectionService));
    mocks.machineLearning.encodeText.mockImplementation((text: string) => Promise.resolve(`[${text.length},1,0]`));
    mocks.tag.getAssetTagsByPrefix.mockResolvedValue([]);
    mocks.ocr.getByAssetIds.mockResolvedValue([]);
    mocks.asset.getByIds.mockImplementation((ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ id, type: AssetType.Image, deletedAt: null })) as never),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('packs', () => {
    it('should list the packs, food first', () => {
      const packs = sut.getPacks();
      expect(packs.map(({ id }) => id)).toEqual(['food', 'labels']);
      expect(packs[0]).toEqual({
        id: 'food',
        title: 'Food',
        description: expect.stringContaining('restaurant meals'),
        tagRoot: 'Food',
        sourceLeaf: 'Menu',
        names: expect.objectContaining({ subject: 'dish', source: 'menu', place: 'restaurant', visit: 'meal' }),
        bookStylePreset: 'food',
        placeLookup: true,
      });
      expect(packs[1]).toMatchObject({ id: 'labels', tagRoot: 'Labels', placeLookup: false });
    });

    it('should reject an unknown pack', async () => {
      await expect(sut.findVisits(auth, 'museum', { albumId: newUuid() })).rejects.toBeInstanceOf(BadRequestException);
      expect(() => sut.requirePack('museum')).toThrow('Unknown collection pack "museum". Packs: food, labels');
    });
  });

  describe('a second pack, end to end', () => {
    it('should find its visits with its own prompts, text and place names', async () => {
      const albumId = newUuid();
      const [gateId, boardId, fern, rose, friends, kew] = Array.from({ length: 6 }, () => newUuid());
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.assetJob.getForAgentEvents.mockResolvedValue([
        eventRow(gateId, '2024-05-02T10:00:00', { city: 'Palermo' }),
        eventRow(boardId, '2024-05-02T10:10:00', { city: 'Palermo' }),
        eventRow(fern, '2024-05-02T10:12:00', { city: 'Palermo' }),
        eventRow(rose, '2024-05-02T10:40:00', { city: 'Palermo' }),
        eventRow(friends, '2024-05-02T10:45:00', { city: 'Palermo' }),
        eventRow(kew, '2024-06-01T15:00:00', { city: 'Kew' }),
      ] as never);
      mocks.search.getEmbeddingSimilarities.mockResolvedValue([
        { assetId: gateId, similarities: gate },
        { assetId: boardId, similarities: board },
        { assetId: fern, similarities: plant },
        { assetId: rose, similarities: plant },
        { assetId: friends, similarities: people },
        { assetId: kew, similarities: plant },
      ]);
      mocks.ocr.getByAssetIds.mockResolvedValue([
        { assetId: gateId, ...box('ORTO BOTANICO GARDEN', 0.2, 0.3, 0.08) },
        ...boardBoxes.map((ocr) => ({ assetId: boardId, ...ocr })),
      ] as never);

      const result = await sut.findVisits(auth, 'labels', { albumId });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledTimes(getPromptList(labelsPack.prompts).length);
      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith('a photo of a plant', expect.anything());
      expect(mocks.tag.getAssetTagsByPrefix).toHaveBeenCalledWith(expect.any(Array), 'Labels/');
      expect(mocks.tag.getAssetTagsByPrefix).not.toHaveBeenCalledWith(expect.any(Array), 'Food/');
      expect(result).toMatchObject({ pack: 'labels', count: 6, photos: 5, warnings: [] });
      expect(result.visits).toHaveLength(2);
      expect(result.visits[0]).toMatchObject({
        subjectIds: [fern, rose],
        sourceIds: [boardId],
        signIds: [gateId],
        receiptIds: [],
        place: { name: 'Orto Botanico Garden', source: 'sign' },
      });
      // a pack without kinds of visits has no type, and names the unknown places after its visits
      expect(result.visits[0].type).toBeUndefined();
      expect(result.visits[1]).toMatchObject({
        subjectIds: [kew],
        place: { name: 'Garden walk in Kew', source: 'fallback', confidence: 0 },
      });
    });

    it('should read its sources with its parser, hide what its privacy hook hides, and match the subjects', async () => {
      const [boardId, fern, rose] = [newUuid(), newUuid(), newUuid()];
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { ocr: { enabled: false } } });
      mocks.access.asset.checkOwnerAccess.mockImplementation((_userId: string, ids: Set<string>) =>
        Promise.resolve(new Set([...ids].filter((id) => [boardId, fern, rose].includes(id)))),
      );
      mocks.asset.getById.mockResolvedValue({
        id: boardId,
        type: AssetType.Image,
        deletedAt: null,
        exifInfo: null,
        files: [],
      } as never);
      mocks.ocr.getByAssetId.mockResolvedValue(boardBoxes as never);
      const texts: Record<string, string> = {
        'a photo of the plant Asplenium nidus': '[1,0,0,0]',
        'a photo of the plant Rosa canina': '[0,1,0,0]',
      };
      mocks.machineLearning.encodeText.mockImplementation((text: string) =>
        Promise.resolve(texts[text] ?? '[0,0,1,0]'),
      );
      mocks.assetJob.getForAgent.mockResolvedValue([
        agentRow(fern, { localDateTime: new Date('2024-05-02T10:12:00Z') }),
        agentRow(rose, { localDateTime: new Date('2024-05-02T10:40:00Z') }),
      ]);
      mocks.search.getEmbeddings.mockResolvedValue([
        { assetId: fern, embedding: '[0.9,0.1,0.1,0.3]' },
        { assetId: rose, embedding: '[0.1,0.9,0.1,0.3]' },
      ]);

      const reading = await sut.readSource(auth, 'labels', boardId);
      expect(reading.items.map(({ name }) => name)).toEqual(['Asplenium nidus', 'Rosa canina', 'Inv. •••']);

      const result = await sut.matchVisit(auth, 'labels', { subjectIds: [fern, rose], sourceIds: [boardId] });

      expect(result.entries.map(({ name, sourceId }) => ({ name, sourceId }))).toEqual([
        { name: 'Asplenium nidus', sourceId: boardId },
        { name: 'Rosa canina', sourceId: boardId },
        { name: 'Inv. •••', sourceId: boardId },
      ]);
      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith('a photo of a garden path', expect.anything());
      expect(mocks.machineLearning.encodeText).not.toHaveBeenCalledWith(
        expect.stringContaining('19870412'),
        expect.anything(),
      );
      expect(result.subjects.map(({ assetIds, name }) => ({ assetIds, name }))).toEqual([
        { assetIds: [fern], name: 'Asplenium nidus' },
        { assetIds: [rose], name: 'Rosa canina' },
      ]);
      expect(result.ordered).toBeUndefined();
    });

    it('should never look up a place the pack has no lookup for', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ food: { openStreetMap: { enabled: true } } });
      const result = await sut.lookupPlaces(auth, 'labels', { latitude: 38.11, longitude: 13.37 });
      expect(result).toEqual({ enabled: false, message: expect.stringContaining('never looked up') });
      expect(mocks.map.queryOverpass).not.toHaveBeenCalled();
    });

    it('should write its own tags and descriptions, and leave the food tags alone', async () => {
      const [fern, boardId, rose] = [newUuid(), newUuid(), newUuid()];
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([fern, boardId, rose]));
      mocks.tag.upsertValue.mockImplementation(({ value }: { value: string }) =>
        Promise.resolve({ id: `tag:${value}`, value } as never),
      );
      const tags = [
        { assetId: fern, tagId: 'tag:food', value: 'Food/Nino/Carbonara' },
        { assetId: rose, tagId: 'tag:old', value: 'Labels/Kew Gardens/Rose' },
      ];
      mocks.tag.getAssetTagsByPrefix.mockImplementation((_ids: string[], prefix: string) =>
        Promise.resolve(tags.filter(({ value }) => value.startsWith(prefix))),
      );
      const addAssets = vi
        .spyOn(TagService.prototype, 'addAssets')
        .mockImplementation((_, __, { ids }) => Promise.resolve(ids.map((id) => ({ id, success: true }))));
      const removeAssets = vi
        .spyOn(TagService.prototype, 'removeAssets')
        .mockImplementation((_, __, { ids }) => Promise.resolve(ids.map((id) => ({ id, success: true }))));
      const update = vi.spyOn(AssetService.prototype, 'update').mockResolvedValue({} as never);
      mocks.assetJob.getForAgent.mockResolvedValue([
        agentRow(fern, { description: '' }),
        agentRow(boardId, { description: '' }),
        agentRow(rose, { description: 'Rose, Kew Gardens' }),
      ]);

      const result = await sut.saveEntries(auth, 'labels', {
        place: 'Orto Botanico',
        photos: [
          { id: fern, entry: 'Asplenium nidus 1234567' },
          { id: boardId, entry: 'board' },
          { id: rose, entry: 'Rosa canina' },
        ],
      });

      expect(mocks.tag.getAssetTagsByPrefix).toHaveBeenCalledTimes(1);
      expect(mocks.tag.getAssetTagsByPrefix).toHaveBeenCalledWith([fern, boardId, rose], 'Labels/');
      expect(removeAssets).toHaveBeenCalledTimes(1);
      expect(removeAssets).toHaveBeenCalledWith(auth, 'tag:old', { ids: [rose] });
      expect(addAssets).toHaveBeenCalledWith(auth, 'tag:Labels/Orto Botanico/Board', { ids: [boardId] });
      expect(update.mock.calls).toEqual([
        [auth, fern, { description: 'Asplenium nidus •••, Orto Botanico' }],
        [auth, rose, { description: 'Rosa canina, Orto Botanico' }],
      ]);
      expect(result).toEqual({
        place: 'Orto Botanico',
        results: [
          {
            id: fern,
            success: true,
            tag: 'Labels/Orto Botanico/Asplenium nidus •••',
            description: 'Asplenium nidus •••, Orto Botanico',
          },
          { id: boardId, success: true, tag: 'Labels/Orto Botanico/Board' },
          {
            id: rose,
            success: true,
            tag: 'Labels/Orto Botanico/Rosa canina',
            previousTags: ['Labels/Kew Gardens/Rose'],
            description: 'Rosa canina, Orto Botanico',
          },
        ],
      });
    });

    it('should need a place and an entry', async () => {
      await expect(
        sut.saveEntries(auth, 'labels', { place: ' / ', photos: [{ id: newUuid(), entry: 'Rosa' }] }),
      ).rejects.toThrow('The garden needs a name');
      await expect(sut.saveEntries(auth, 'labels', { place: 'Kew', photos: [{ id: newUuid() }] })).rejects.toThrow(
        'needs an entry, or source: true',
      );
    });
  });
});
