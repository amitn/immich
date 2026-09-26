import { AssetType } from 'src/enum.js';
import { CollectionAgentTools } from 'src/services/agent-tools/collection.tools.js';
import { AssetService } from 'src/services/asset.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { TagService } from 'src/services/tag.service.js';
import { CollectionKind, getPromptList } from 'src/utils/collections/classify.js';
import { validateCollectionPack } from 'src/utils/collections/pack.js';
import { travelPack } from 'src/utils/collections/packs/travel/pack.js';
import { BUILT_IN_COLLECTION_PACKS, getCollectionPack } from 'src/utils/collections/registry.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

/** CLIP similarities with the prompts of the travel pack, every prompt of a kind at the given value */
const similarities = (values: Partial<Record<CollectionKind, number>>) =>
  getPromptList(travelPack.prompts).map(({ kind }) => values[kind] ?? 0.15);

const tripPhoto = similarities({ subject: 0.3, source: 0.2, other: 0.18 });
const ticketPhoto = similarities({ subject: 0.2, source: 0.3, other: 0.18 });

const box = (text: string, left: number, top: number, height = 0.04) => {
  const right = Math.min(1, left + text.length * height * 0.45);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.95 };
};

/** a boarding pass with a name, a booking reference, a sequence and a ticket number on it */
const boardingPass = [
  box('tigerair', 0.04, 0.25),
  box('Name: DOE/JANE MS', 0.03, 0.33),
  box('Flt: IT 231', 0.46, 0.36),
  box('Depart: OKINAWA 0945', 0.03, 0.4),
  box('Seat: 17B', 0.47, 0.44),
  box('Arrive: TAIPEI 1020', 0.03, 0.48),
  box('Date: 12NOV19', 0.46, 0.52),
  box('PNR: Q7XK2M', 0.03, 0.62),
  box('Seq Nbr: 100', 0.46, 0.62),
  box('ETKT 6952448946707', 0.03, 0.7),
];
const PERSONAL = /DOE|JANE|Q7XK2M|6952448946707|Seq Nbr: 100/;

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

describe('the travel pack', () => {
  let sut: CollectionService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();

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

  it('should be a valid built-in pack that keeps its documents to itself', () => {
    expect(validateCollectionPack(travelPack, BUILT_IN_COLLECTION_PACKS)).toEqual([]);
    expect(getCollectionPack('travel')).toBe(travelPack);
    expect(travelPack.privacy?.sourceImages).toBe(false);
    expect(travelPack.place.lookup).toBeUndefined();
    expect(sut.getPacks().find(({ id }) => id === 'travel')).toEqual({
      id: 'travel',
      title: 'Travel',
      description: expect.stringContaining('trips'),
      tagRoot: 'Travel',
      sourceLeaf: 'Tickets',
      names: expect.objectContaining({ subject: 'trip photo', source: 'travel document', place: 'trip', entry: 'leg' }),
      bookStylePreset: 'travel',
      placeLookup: false,
    });
    expect(travelPack.agent.instructions).toMatch(/^Travel \(pack "travel"/);
  });

  it('should find a trip, its documents and photos, and name it after its month', async () => {
    const albumId = newUuid();
    const [pass, beach, museum, later] = [newUuid(), newUuid(), newUuid(), newUuid()];
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    mocks.assetJob.getForAgentEvents.mockResolvedValue([
      eventRow(beach, '2019-11-10T10:00:00'),
      eventRow(museum, '2019-11-11T15:00:00'),
      eventRow(pass, '2019-11-12T08:18:00'),
      eventRow(later, '2019-12-24T18:00:00'),
    ] as never);
    mocks.search.getEmbeddingSimilarities.mockResolvedValue([
      { assetId: pass, similarities: ticketPhoto },
      { assetId: beach, similarities: tripPhoto },
      { assetId: museum, similarities: tripPhoto },
      { assetId: later, similarities: tripPhoto },
    ]);
    mocks.ocr.getByAssetIds.mockResolvedValue(boardingPass.map((ocr) => ({ assetId: pass, ...ocr })) as never);

    const result = await sut.findVisits(auth, 'travel', { albumId });

    expect(mocks.tag.getAssetTagsByPrefix).toHaveBeenCalledWith(expect.any(Array), 'Travel/');
    expect(result.visits).toHaveLength(2);
    expect(result.visits[0]).toMatchObject({
      subjectIds: [beach, museum],
      sourceIds: [pass],
      // a line of a document never names the trip
      place: { name: 'Trip, November 2019', source: 'fallback' },
      candidates: [],
    });
    expect(result.visits[1]).toMatchObject({ subjectIds: [later], place: { name: 'Trip, December 2019' } });
    expect(JSON.stringify(result)).not.toMatch(PERSONAL);
  });

  it('should read a document into its leg, and let out nothing personal', async () => {
    const pass = newUuid();
    mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { ocr: { enabled: false } } });
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([pass]));
    mocks.asset.getById.mockResolvedValue({
      id: pass,
      type: AssetType.Image,
      deletedAt: null,
      exifInfo: null,
      files: [],
    } as never);
    mocks.ocr.getByAssetId.mockResolvedValue(boardingPass as never);

    const reading = await sut.readSource(auth, 'travel', pass);

    expect(reading.items.map(({ name, description }) => ({ name, description }))).toEqual([
      {
        name: 'Flight IT231 Okinawa → Taipei, 12 Nov 2019',
        description: 'Tigerair · departs 09:45 · arrives 10:20 · seat 17B',
      },
    ]);
    expect(reading.title).toBe('Tigerair');
    expect(reading.place).toEqual([]);
    expect(JSON.stringify(reading)).not.toMatch(PERSONAL);
  });

  it('should never show the documents to the assistant', async () => {
    const { sut: tools } = newTestService(CollectionAgentTools);
    const pass = newUuid();
    vi.spyOn(CollectionService.prototype, 'readSource').mockResolvedValue({
      assetId: pass,
      items: [{ name: 'Flight IT231 Okinawa → Taipei, 12 Nov 2019', column: 0, box: [0, 0, 1, 1] }],
      sections: [],
      columns: 1,
      lines: 10,
      ocr: 'tiles',
      place: [],
      warnings: [],
      previewPath: '/p.jpeg',
      width: 2800,
      height: 2100,
    });
    const images = vi.spyOn(CollectionService.prototype, 'getSourceImages');
    const tool = tools.getTools().find(({ name }) => name === 'read_source')!;

    const result = await tool.handler(
      { auth, sessionId: null },
      tool.input.parse({ pack: 'travel', id: pass, zoom: true }),
    );

    expect(images).not.toHaveBeenCalled();
    expect(result.content.map(({ type }) => type)).toEqual(['text']);
  });

  it('should assign the trip photos to the legs by time, and by what they show', async () => {
    const [pass, receipt, beach, station, ramen, dayOff] = Array.from({ length: 6 }, () => newUuid());
    mocks.access.asset.checkOwnerAccess.mockImplementation((_userId: string, ids: Set<string>) =>
      Promise.resolve(new Set(ids)),
    );
    const entries = [
      { name: 'Monorail from おもろまち, 11 Nov 2019', description: 'bought 12:37 · 230円 · receipt' },
      { name: 'Flight IT231 Okinawa → Taipei, 12 Nov 2019', description: 'Tigerair · departs 09:45' },
      // the assistant copied a booking reference into a name: it is hidden
      { name: 'Okinawa World PNR Q7XK2M' },
    ];
    mocks.assetJob.getForAgent.mockResolvedValue([
      agentRow(beach, '2019-11-10T10:00:00'),
      agentRow(station, '2019-11-11T12:05:00'),
      agentRow(ramen, '2019-11-11T13:28:00'),
      agentRow(dayOff, '2019-11-14T10:00:00'),
    ]);
    mocks.search.getEmbeddings.mockResolvedValue([]);
    mocks.ocr.getByAssetIds.mockResolvedValue([{ assetId: beach, ...box('OKINAWA WORLD EXIT', 0.2, 0.2) }] as never);

    const result = await sut.matchVisit(auth, 'travel', {
      subjectIds: [beach, station, ramen, dayOff],
      sourceIds: [pass, receipt],
      entries,
    });

    expect(result.entries.map(({ name }) => name)).toEqual([entries[0].name, entries[1].name, 'Okinawa World PNR •••']);
    expect(result.ordered).toBeUndefined();
    expect(Object.fromEntries(result.subjects.map(({ assetIds, name }) => [assetIds[0], name ?? null]))).toEqual({
      [beach]: 'Okinawa World PNR •••',
      [station]: entries[0].name,
      [ramen]: entries[0].name,
      [dayOff]: null,
    });
    expect(mocks.ocr.getByAssetIds).toHaveBeenCalledWith([beach, station, ramen, dayOff]);
    // photos without an embedding are assigned by time
    expect(result.noEmbedding).toEqual([beach, station, ramen, dayOff]);
  });

  it('should save the legs as tags and descriptions, redacted', async () => {
    const [photo, pass] = [newUuid(), newUuid()];
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([photo, pass]));
    mocks.tag.upsertValue.mockImplementation(({ value }: { value: string }) =>
      Promise.resolve({ id: `tag:${value}`, value } as never),
    );
    const addAssets = vi
      .spyOn(TagService.prototype, 'addAssets')
      .mockImplementation((_, __, { ids }) => Promise.resolve(ids.map((id) => ({ id, success: true }))));
    const update = vi.spyOn(AssetService.prototype, 'update').mockResolvedValue({} as never);
    mocks.assetJob.getForAgent.mockResolvedValue([
      agentRow(photo, '2019-11-12T08:00:00'),
      agentRow(pass, '2019-11-12T08:18:00'),
    ]);

    const result = await sut.saveEntries(auth, 'travel', {
      place: 'Okinawa, November 2019',
      photos: [
        { id: photo, entry: 'Flight IT231 Okinawa → Taipei, 12 Nov 2019 (DOE/JANE MS, PNR Q7XK2M)' },
        { id: pass, source: true },
      ],
    });

    expect(addAssets).toHaveBeenCalledWith(auth, 'tag:Travel/Okinawa, November 2019/Tickets', { ids: [pass] });
    expect(result.results[0]).toEqual({
      id: photo,
      success: true,
      tag: 'Travel/Okinawa, November 2019/Flight IT231 Okinawa → Taipei, 12 Nov 2019 (•••, PNR •••)',
      description: 'Flight IT231 Okinawa → Taipei, 12 Nov 2019 (•••, PNR •••) · Okinawa, November 2019',
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(PERSONAL);
  });
});
