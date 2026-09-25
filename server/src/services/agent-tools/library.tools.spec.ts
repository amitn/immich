import { AssetOrder, AssetType, AssetVisibility } from 'src/enum.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { LibraryAgentTools } from 'src/services/agent-tools/library.tools.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { getForAsset } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

type AgentAsset = Awaited<ReturnType<AssetJobRepository['getForAgent']>>[number];
type AgentFace = AgentAsset['faces'][number];

const ann = newUuid();
const bob = newUuid();

const face = (personId: string | null, name: string | null, box = [100, 100, 300, 300]): AgentFace => ({
  personId,
  name,
  imageWidth: 1000,
  imageHeight: 1000,
  boundingBoxX1: box[0],
  boundingBoxY1: box[1],
  boundingBoxX2: box[2],
  boundingBoxY2: box[3],
});

const agentAsset = (overrides: Partial<AgentAsset> = {}): AgentAsset => {
  const time = overrides.localDateTime ?? new Date('2024-06-01T10:00:00.000Z');
  return {
    id: newUuid(),
    type: AssetType.Image,
    localDateTime: time,
    fileCreatedAt: time,
    isFavorite: false,
    width: 4000,
    height: 3000,
    checksum: Buffer.from('checksum'),
    updatedAt: new Date('2024-06-02T00:00:00.000Z'),
    exifImageWidth: 4000,
    exifImageHeight: 3000,
    make: null,
    model: null,
    lensModel: null,
    fNumber: null,
    exposureTime: null,
    iso: null,
    focalLength: null,
    latitude: null,
    longitude: null,
    city: null,
    state: null,
    country: null,
    description: null,
    rating: null,
    timeZone: null,
    previewPath: '/data/thumbs/preview.jpeg',
    faces: [],
    ...overrides,
  };
};

const eventRow = (iso: string, extra: Record<string, unknown> = {}) => ({
  id: newUuid(),
  localDateTime: new Date(`${iso}Z`),
  latitude: null,
  longitude: null,
  city: null,
  country: null,
  people: [],
  ...extra,
});

const analysis = { width: 512, height: 384, laplacianVariance: 1500, meanLuma: 0.5, shadowClip: 0, highlightClip: 0 };

const json = (result: AgentToolResult) => {
  const text = result.content.find((content) => content.type === 'text');
  return JSON.parse(text && 'text' in text ? text.text : 'null');
};

describe(LibraryAgentTools.name, () => {
  let sut: LibraryAgentTools;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();
  const ctx = { auth, sessionId: null };

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name);
    if (!tool) {
      throw new Error(`Unknown tool ${name}`);
    }
    return tool.handler(ctx, tool.input.parse(input));
  };

  const allowAssets = (...ids: string[]) => mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(ids));

  beforeEach(() => {
    ({ sut, mocks } = newTestService(LibraryAgentTools));
    mocks.partner.getAll.mockResolvedValue([]);
  });

  it('should expose read-only tools with unique names', () => {
    const tools = sut.getTools();
    expect(tools.map(({ name }) => name)).toEqual([
      'search_photos',
      'list_tags',
      'find_people',
      'find_events',
      'get_photo_metadata',
      'view_photos',
      'cluster_similar',
      'score_photo',
      'select_best',
    ]);
    expect(tools.every(({ mutating }) => !mutating)).toBe(true);
    expect(tools.every(({ description }) => description.length > 50)).toBe(true);
  });

  describe('tags', () => {
    const tags = [
      { id: 'tag-art', value: 'AI Artwork', color: null, createdAt: new Date(), updatedAt: new Date(), parentId: null },
      {
        id: 'tag-wc',
        value: 'AI Artwork/Watercolor',
        color: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        parentId: 'tag-art',
      },
    ];

    it('should list tags with photo counts', async () => {
      mocks.tag.getAll.mockResolvedValue(tags as never);
      mocks.tag.getAssetCounts.mockResolvedValue(
        new Map([
          ['tag-art', 3],
          ['tag-wc', 2],
        ]),
      );

      expect(json(await call('list_tags', {}))).toEqual([
        { tag: 'AI Artwork', n: 3 },
        { tag: 'AI Artwork/Watercolor', n: 2 },
      ]);
    });

    it('should filter by tag names, case-insensitively', async () => {
      mocks.tag.getAll.mockResolvedValue(tags as never);
      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });

      await call('search_photos', { tags: ['ai artwork'] });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tagIds: ['tag-art'] }),
      );
    });

    it('should list the known tags for an unknown tag', async () => {
      mocks.tag.getAll.mockResolvedValue(tags as never);

      const result = await call('search_photos', { tags: ['Holiday'] });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain('Known tags: AI Artwork, AI Artwork/Watercolor');
      expect(mocks.search.searchMetadata).not.toHaveBeenCalled();
    });
  });

  describe('search_photos', () => {
    it('should run a metadata search without a query', async () => {
      const asset = agentAsset({ city: 'Rome', country: 'Italy', isFavorite: true, faces: [face(ann, 'Ann')] });
      mocks.search.searchMetadata.mockResolvedValue({
        hasNextPage: true,
        items: [getForAsset(AssetFactory.create({ id: asset.id })) as never],
      });
      allowAssets(asset.id);
      mocks.assetJob.getForAgent.mockResolvedValue([asset]);

      const result = await call('search_photos', { city: 'Rome', takenAfter: '2024-06-01', limit: 10 });

      expect(mocks.search.searchMetadata).toHaveBeenCalledWith(
        { page: 1, size: 10 },
        expect.objectContaining({
          city: 'Rome',
          takenAfter: new Date('2024-06-01'),
          visibility: AssetVisibility.Timeline,
          orderDirection: AssetOrder.Asc,
          userIds: [auth.user.id],
        }),
      );
      expect(json(result)).toEqual({
        items: [
          {
            id: asset.id,
            date: '2024-06-01T10:00:00',
            city: 'Rome',
            country: 'Italy',
            people: ['Ann'],
            w: 4000,
            h: 3000,
            fav: true,
          },
        ],
        next: 2,
      });
    });

    it('should run a smart search with a query', async () => {
      mocks.search.searchSmart.mockResolvedValue({ hasNextPage: false, items: [] });
      mocks.machineLearning.encodeText.mockResolvedValue('[1, 2, 3]');

      const result = await call('search_photos', { query: 'beach', type: 'video', page: 2 });

      expect(mocks.search.searchSmart).toHaveBeenCalledWith(
        { page: 2, size: 50 },
        expect.objectContaining({ type: AssetType.Video, embedding: '[1, 2, 3]' }),
      );
      expect(json(result)).toEqual({ items: [] });
    });

    it('should check album access', async () => {
      const result = await call('search_photos', { albumId: newUuid() });
      expect(result.isError).toBe(true);
      expect(mocks.search.searchMetadata).not.toHaveBeenCalled();
    });

    it('should reject invalid dates', async () => {
      const result = await call('search_photos', { takenAfter: 'yesterday' });
      expect(result).toEqual({ content: [{ type: 'text', text: 'Invalid date: yesterday' }], isError: true });
    });

    it('should enforce the limit', () => {
      expect(() => call('search_photos', { limit: 501 })).toThrow();
    });
  });

  describe('find_people', () => {
    it('should list the top people', async () => {
      mocks.assetJob.getPeopleForAgent.mockResolvedValue([{ id: ann, name: 'Ann', count: 12 }]);

      const result = await call('find_people', {});

      expect(mocks.assetJob.getPeopleForAgent).toHaveBeenCalledWith([auth.user.id], auth.user.id, { limit: 20 });
      expect(json(result)).toEqual([{ id: ann, name: 'Ann', n: 12 }]);
    });

    it('should search by name and add photo counts', async () => {
      mocks.person.getByName.mockResolvedValue([
        { personGroupId: ann, name: 'Ann', birthDate: null, updatedAt: new Date() },
        { personGroupId: bob, name: 'Anne', birthDate: null, updatedAt: new Date() },
      ] as never);
      mocks.assetJob.getPeopleForAgent.mockResolvedValue([{ id: ann, name: 'Ann', count: 3 }]);

      const result = await call('find_people', { name: 'ann' });

      expect(mocks.person.getByName).toHaveBeenCalledWith(auth.user.id, 'ann', { withHidden: false });
      expect(mocks.assetJob.getPeopleForAgent).toHaveBeenCalledWith([auth.user.id], auth.user.id, {
        personIds: [ann, bob],
        limit: 20,
      });
      expect(json(result)).toEqual([
        { id: ann, name: 'Ann', n: 3 },
        { id: bob, name: 'Anne', n: 0 },
      ]);
    });
  });

  describe('find_events', () => {
    it('should require a filter', async () => {
      const result = await call('find_events', {});
      expect(result.isError).toBe(true);
      expect(mocks.assetJob.getForAgentEvents).not.toHaveBeenCalled();
    });

    it('should split events and group days', async () => {
      const rows = [
        eventRow('2024-06-01T09:00:00', { city: 'Rome', country: 'Italy', people: [{ name: 'Ann' }, { name: 'Ann' }] }),
        eventRow('2024-06-01T10:00:00', { city: 'Rome', country: 'Italy' }),
        eventRow('2024-06-01T18:00:00'),
        eventRow('2024-06-02T09:00:00'),
      ];
      mocks.assetJob.getForAgentEvents.mockResolvedValue(rows);

      const result = await call('find_events', { takenAfter: '2024-06-01', takenBefore: '2024-06-03', expand: [0] });

      expect(mocks.assetJob.getForAgentEvents).toHaveBeenCalledWith({
        userIds: [auth.user.id],
        viewingUserId: auth.user.id,
        albumId: undefined,
        personIds: undefined,
        takenAfter: new Date('2024-06-01'),
        takenBefore: new Date('2024-06-03'),
        limit: 5001,
      });
      expect(json(result)).toEqual({
        count: 4,
        events: [
          {
            index: 0,
            start: '2024-06-01T09:00:00',
            end: '2024-06-01T10:00:00',
            day: '2024-06-01',
            city: 'Rome',
            country: 'Italy',
            count: 2,
            people: ['Ann'],
            sampleIds: [rows[0].id, rows[1].id],
            ids: [rows[0].id, rows[1].id],
          },
          expect.objectContaining({ index: 1, count: 1, day: '2024-06-01' }),
          expect.objectContaining({ index: 2, count: 1, day: '2024-06-02' }),
        ],
        days: [
          { day: '2024-06-01', count: 3, events: [0, 1] },
          { day: '2024-06-02', count: 1, events: [2] },
        ],
      });
    });

    it('should use calendar days and custom gaps', async () => {
      mocks.assetJob.getForAgentEvents.mockResolvedValue([
        eventRow('2024-06-01T09:00:00'),
        eventRow('2024-06-01T21:00:00'),
        eventRow('2024-06-02T09:00:00'),
      ]);

      const byDay = json(await call('find_events', { takenAfter: '2024-06-01', byDay: true }));
      expect(byDay.events.map(({ count }: { count: number }) => count)).toEqual([2, 1]);
      expect(byDay.days).toBeUndefined();

      const byGap = json(await call('find_events', { takenAfter: '2024-06-01', gapHours: 24 }));
      expect(byGap.events).toHaveLength(1);
    });

    it('should report truncation', async () => {
      mocks.assetJob.getForAgentEvents.mockResolvedValue(
        Array.from({ length: 5001 }, (_, i) =>
          eventRow(new Date(Date.UTC(2024, 0, 1) + i * 60_000).toISOString().slice(0, 19)),
        ),
      );
      const result = json(await call('find_events', { takenAfter: '2024-01-01' }));
      expect(result.count).toBe(5000);
      expect(result.truncated).toBe(true);
    });

    it('should check album access', async () => {
      const result = await call('find_events', { albumId: newUuid() });
      expect(result.isError).toBe(true);
      expect(mocks.assetJob.getForAgentEvents).not.toHaveBeenCalled();
    });

    it('should search an accessible album across owners', async () => {
      const albumId = newUuid();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.assetJob.getForAgentEvents.mockResolvedValue([]);

      const result = json(await call('find_events', { albumId }));

      expect(mocks.assetJob.getForAgentEvents).toHaveBeenCalledWith(
        expect.objectContaining({ albumId, userIds: undefined }),
      );
      expect(result).toEqual({ count: 0, events: [], days: [] });
    });
  });

  describe('get_photo_metadata', () => {
    it('should return compact metadata', async () => {
      const albumId = newUuid();
      const asset = agentAsset({
        make: 'Canon',
        model: 'EOS R6',
        lensModel: 'RF 35mm',
        fNumber: 1.8,
        exposureTime: '1/250',
        iso: 200,
        focalLength: 35,
        latitude: 41.90281234,
        longitude: 12.49641234,
        city: 'Rome',
        country: 'Italy',
        timeZone: 'Europe/Rome',
        description: 'Colosseum',
        rating: 4,
        faces: [face(ann, 'Ann', [100, 200, 300, 500]), face(null, null)],
      });
      const missing = newUuid();
      allowAssets(asset.id, missing);
      mocks.assetJob.getForAgent.mockResolvedValue([asset]);
      mocks.assetJob.getAlbumsForAgent.mockResolvedValue([{ assetId: asset.id, id: albumId, albumName: 'Italy' }]);

      const result = json(await call('get_photo_metadata', { ids: [asset.id, missing] }));

      expect(mocks.assetJob.getAlbumsForAgent).toHaveBeenCalledWith([asset.id], auth.user.id);
      expect(result).toEqual({
        items: [
          {
            id: asset.id,
            date: '2024-06-01T10:00:00',
            city: 'Rome',
            country: 'Italy',
            people: [{ id: ann, name: 'Ann', box: [0.1, 0.2, 0.3, 0.5] }, { box: [0.1, 0.1, 0.3, 0.3] }],
            w: 4000,
            h: 3000,
            tz: 'Europe/Rome',
            make: 'Canon',
            model: 'EOS R6',
            lens: 'RF 35mm',
            f: 1.8,
            exp: '1/250',
            iso: 200,
            fl: 35,
            gps: [41.90281, 12.49641],
            desc: 'Colosseum',
            rating: 4,
            albums: [{ id: albumId, name: 'Italy' }],
          },
        ],
        missing: [missing],
      });
    });

    it('should deny inaccessible photos', async () => {
      const result = await call('get_photo_metadata', { ids: [newUuid()] });
      expect(result.isError).toBe(true);
      expect(mocks.assetJob.getForAgent).not.toHaveBeenCalled();
    });

    it('should enforce the limit', () => {
      expect(() => call('get_photo_metadata', { ids: Array.from({ length: 101 }, () => newUuid()) })).toThrow();
    });
  });

  describe('view_photos', () => {
    it('should return a single preview', async () => {
      const asset = agentAsset();
      allowAssets(asset.id);
      mocks.assetJob.getForAgent.mockResolvedValue([asset]);
      mocks.media.resizeToJpeg.mockResolvedValue(Buffer.from('jpeg'));

      const result = await call('view_photos', { ids: [asset.id] });

      expect(mocks.media.resizeToJpeg).toHaveBeenCalledWith('/data/thumbs/preview.jpeg', 1024);
      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining(asset.id) },
        { type: 'image', data: Buffer.from('jpeg').toString('base64'), mimeType: 'image/jpeg' },
      ]);
    });

    it('should fail without a preview', async () => {
      const asset = agentAsset({ previewPath: null });
      allowAssets(asset.id);
      mocks.assetJob.getForAgent.mockResolvedValue([asset]);

      const result = await call('view_photos', { ids: [asset.id] });
      expect(result.isError).toBe(true);
    });

    it('should build a labelled contact sheet', async () => {
      const assets = [agentAsset({ previewPath: '/a.jpeg' }), agentAsset({ previewPath: null }), agentAsset()];
      allowAssets(...assets.map(({ id }) => id));
      mocks.assetJob.getForAgent.mockResolvedValue(assets.toReversed());
      mocks.media.createContactSheet.mockResolvedValue(Buffer.from('sheet'));

      const result = await call('view_photos', { ids: assets.map(({ id }) => id), size: 128 });

      expect(mocks.media.createContactSheet).toHaveBeenCalledWith(
        [
          { input: '/a.jpeg', label: '1' },
          { input: null, label: '2' },
          { input: '/data/thumbs/preview.jpeg', label: '3' },
        ],
        { tileSize: 128 },
      );
      expect(json(result)).toEqual({
        sheet: { 1: assets[0].id, 2: assets[1].id, 3: assets[2].id },
        noPreview: [assets[1].id],
      });
      expect(result.content[1]).toEqual({
        type: 'image',
        data: Buffer.from('sheet').toString('base64'),
        mimeType: 'image/jpeg',
      });
    });

    it('should deny inaccessible photos', async () => {
      const result = await call('view_photos', { ids: [newUuid(), newUuid()] });
      expect(result.isError).toBe(true);
      expect(mocks.media.createContactSheet).not.toHaveBeenCalled();
    });

    it('should enforce the limit', () => {
      expect(() => call('view_photos', { ids: Array.from({ length: 37 }, () => newUuid()) })).toThrow();
    });
  });

  describe('cluster_similar', () => {
    it('should group near-duplicates and bursts', async () => {
      const base = Date.UTC(2024, 5, 1, 10);
      const assets = [0, 2, 3600, 7200].map((seconds) =>
        agentAsset({ fileCreatedAt: new Date(base + seconds * 1000) }),
      );
      allowAssets(...assets.map(({ id }) => id));
      mocks.assetJob.getForAgent.mockResolvedValue(assets);
      mocks.search.getEmbeddings.mockResolvedValue([
        { assetId: assets[0].id, embedding: '[1,0,0]' },
        { assetId: assets[1].id, embedding: '[0.95,0.31,0]' },
        { assetId: assets[2].id, embedding: '[0,1,0]' },
      ]);

      const result = json(await call('cluster_similar', { ids: assets.map(({ id }) => id) }));

      expect(result).toEqual({
        clusters: [{ ids: [assets[0].id, assets[1].id], span: 2 }],
        singles: 1,
        noEmbedding: 1,
        maxDistance: 0.02,
        burstDistance: 0.1,
      });
    });

    it('should accept custom thresholds', async () => {
      const assets = [agentAsset(), agentAsset({ fileCreatedAt: new Date('2024-06-02T10:00:00.000Z') })];
      allowAssets(...assets.map(({ id }) => id));
      mocks.assetJob.getForAgent.mockResolvedValue(assets);
      mocks.search.getEmbeddings.mockResolvedValue([
        { assetId: assets[0].id, embedding: '[1,0]' },
        { assetId: assets[1].id, embedding: '[0.8,0.6]' },
      ]);

      const result = json(await call('cluster_similar', { ids: assets.map(({ id }) => id), maxDistance: 0.3 }));
      expect(result.clusters).toHaveLength(1);
      expect(result.burstDistance).toBe(0.3);
    });

    it('should deny inaccessible photos', async () => {
      const result = await call('cluster_similar', { ids: [newUuid()] });
      expect(result.isError).toBe(true);
      expect(mocks.search.getEmbeddings).not.toHaveBeenCalled();
    });

    it('should enforce the limit', () => {
      expect(() => call('cluster_similar', { ids: Array.from({ length: 2001 }, () => newUuid()) })).toThrow();
    });
  });

  describe('score_photo', () => {
    it('should score photos best first and cache the analysis', async () => {
      const good = agentAsset({ faces: [face(ann, 'Ann', [0, 0, 400, 400])], isFavorite: true });
      const blurry = agentAsset({ checksum: Buffer.from('blurry') });
      const noPreview = agentAsset({ previewPath: null });
      allowAssets(good.id, blurry.id, noPreview.id);
      mocks.assetJob.getForAgent.mockResolvedValue([blurry, good, noPreview]);
      mocks.media.analyzeImage
        .mockResolvedValueOnce({ ...analysis, laplacianVariance: 5 })
        .mockResolvedValueOnce(analysis);

      const ids = [blurry.id, good.id, noPreview.id];
      const result = json(await call('score_photo', { ids }));

      expect(result.items.map(({ id }: { id: string }) => id)).toEqual([good.id, noPreview.id, blurry.id]);
      expect(result.items[0]).toEqual({
        id: good.id,
        overall: 1,
        sharp: 1,
        expo: 1,
        faces: 1,
        face: 0.16,
        people: ['Ann'],
        fav: true,
      });
      expect(result.items[1]).toMatchObject({ id: noPreview.id, sharp: 0.5, noImage: true });
      expect(mocks.media.analyzeImage).toHaveBeenCalledTimes(2);

      await call('score_photo', { ids });
      expect(mocks.media.analyzeImage).toHaveBeenCalledTimes(2);
    });

    it('should survive unreadable previews', async () => {
      const asset = agentAsset({ checksum: Buffer.from('unreadable') });
      allowAssets(asset.id);
      mocks.assetJob.getForAgent.mockResolvedValue([asset]);
      mocks.media.analyzeImage.mockRejectedValue(new Error('corrupt'));

      const result = json(await call('score_photo', { ids: [asset.id] }));
      expect(result.items[0]).toMatchObject({ id: asset.id, sharp: 0.5, expo: 0.5 });
    });

    it('should deny inaccessible photos', async () => {
      const result = await call('score_photo', { ids: [newUuid()] });
      expect(result.isError).toBe(true);
    });

    it('should enforce the limit', () => {
      expect(() => call('score_photo', { ids: Array.from({ length: 201 }, () => newUuid()) })).toThrow();
    });
  });

  describe('select_best', () => {
    let assets: AgentAsset[];

    beforeEach(() => {
      const base = Date.UTC(2024, 5, 1, 10);
      const at = (hours: number) => new Date(base + hours * 3600 * 1000);
      assets = [
        // a burst of three near-identical photos
        agentAsset({ localDateTime: at(0), fileCreatedAt: at(0), checksum: Buffer.from('s1') }),
        agentAsset({ localDateTime: at(0.0003), fileCreatedAt: at(0.0003), checksum: Buffer.from('s2') }),
        agentAsset({ localDateTime: at(0.0006), fileCreatedAt: at(0.0006), checksum: Buffer.from('s3') }),
        // Ann, later that day
        agentAsset({
          localDateTime: at(6),
          fileCreatedAt: at(6),
          faces: [face(ann, 'Ann')],
          checksum: Buffer.from('s4'),
        }),
        // next day
        agentAsset({ localDateTime: at(24), fileCreatedAt: at(24), isFavorite: true, checksum: Buffer.from('s5') }),
      ];
      allowAssets(...assets.map(({ id }) => id));
      mocks.assetJob.getForAgent.mockResolvedValue(assets);
      mocks.search.getEmbeddings.mockResolvedValue(
        assets.map(({ id }, i) => ({
          assetId: id,
          embedding: ['[1,0,0]', '[1,0,0]', '[1,0,0]', '[0,1,0]', '[0,0,1]'][i],
        })),
      );
      mocks.media.analyzeImage.mockResolvedValue(analysis);
    });

    it('should select diverse photos with constraints', async () => {
      const result = json(
        await call('select_best', {
          ids: assets.map(({ id }) => id),
          count: 3,
          maxPerCluster: 1,
          requirePersonIds: [ann],
        }),
      );

      expect(result.ids).toHaveLength(3);
      expect(result.ids).toContain(assets[3].id);
      expect(result.ids).toContain(assets[4].id);
      expect(result.ids.filter((id: string) => assets.slice(0, 3).some((asset) => asset.id === id))).toHaveLength(1);
      expect(result).toMatchObject({
        count: 3,
        perPerson: [{ id: ann, name: 'Ann', n: 1 }],
        events: { covered: 3, total: 3 },
        clusters: { represented: 1, capped: 1 },
      });
      expect(result.unmet).toBeUndefined();
    });

    it('should honour exclude and mustInclude ids and report unmet constraints', async () => {
      const result = json(
        await call('select_best', {
          ids: assets.slice(0, 4).map(({ id }) => id),
          count: 2,
          excludeIds: [assets[3].id],
          mustIncludeIds: [assets[4].id],
          requirePersonIds: [bob],
          useImageScores: false,
        }),
      );

      expect(mocks.media.analyzeImage).not.toHaveBeenCalled();
      expect(result.ids).toContain(assets[4].id);
      expect(result.ids).not.toContain(assets[3].id);
      expect(result.unmet).toEqual([`minPerPerson ${bob}: 0/1 (0 candidates)`]);
      expect(result.missing).toBeUndefined();
    });

    it('should deny inaccessible photos', async () => {
      const result = await call('select_best', { ids: [newUuid()], count: 1 });
      expect(result.isError).toBe(true);
    });

    it('should enforce the limit', () => {
      expect(() => call('select_best', { ids: Array.from({ length: 1001 }, () => newUuid()), count: 1 })).toThrow();
    });
  });
});
