import { BadRequestException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { CollectionAgentTools } from 'src/services/agent-tools/collection.tools.js';
import { CollectionService, SourceReading } from 'src/services/collection.service.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { registerCollectionPack, unregisterCollectionPack } from 'src/utils/collections/registry.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { labelsPack } from 'test/fixtures/collections/labels.pack.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  expect(result.content[0].type).toBe('text');
  return JSON.parse((result.content[0] as { text: string }).text);
};

const reading = (items: SourceReading['items']): SourceReading => ({
  assetId: 'menu',
  items,
  title: 'Trattoria da Nino',
  sections: ['PRIMI'],
  columns: 1,
  lines: 5,
  ocr: 'tiles',
  place: [{ name: 'Trattoria da Nino', source: 'source', confidence: 0.8, assetIds: ['menu'] }],
  warnings: [],
  previewPath: '/p.jpeg',
  width: 4000,
  height: 3000,
});

describe(CollectionAgentTools.name, () => {
  let sut: CollectionAgentTools;
  let mocks: ServiceMocks;
  let auth: AuthDto;

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name);
    if (!tool) {
      throw new Error(`Unknown tool ${name}`);
    }
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(CollectionAgentTools));
    auth = AuthFactory.create();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should expose the collection tools, with approval for the lookup and the names', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'find_visits', mutating: false },
      { name: 'read_source', mutating: false },
      { name: 'match_subjects', mutating: false },
      { name: 'lookup_place', mutating: true },
      { name: 'save_entries', mutating: true },
    ]);
    const lookup = sut.getTools().find(({ name }) => name === 'lookup_place')!;
    expect(lookup.description).toMatch(/ask the user before/);
    expect(lookup.description).toMatch(/public service/);
  });

  it('should take the pack of every call, and describe the packs', () => {
    for (const tool of sut.getTools()) {
      expect(() => tool.input.parse({})).toThrow();
      expect(tool.input.shape.pack.description).toMatch(/^Collection pack: food \(restaurant meals/);
    }
    const find = sut.getTools().find(({ name }) => name === 'find_visits')!;
    expect(() => find.input.parse({ pack: 'unknown', albumId: newUuid() })).toThrow();
  });

  it('should offer every registered pack', async () => {
    registerCollectionPack(labelsPack);
    try {
      const find = sut.getTools().find(({ name }) => name === 'find_visits')!;
      expect(find.input.shape.pack.options).toEqual(['food', 'labels']);
      expect(find.input.shape.pack.description).toContain('labels (botanical garden walks');
      const lookup = sut.getTools().find(({ name }) => name === 'lookup_place')!;
      expect(lookup.description).toContain('(food)');

      const findVisits = vi.spyOn(CollectionService.prototype, 'findVisits').mockResolvedValue({
        pack: 'labels',
        count: 1,
        truncated: false,
        photos: 0,
        visits: [],
        warnings: [],
      });
      const albumId = newUuid();
      expect(parse(await call('find_visits', { pack: 'labels', albumId }))).toEqual({
        pack: 'labels',
        count: 1,
        photos: 0,
        visits: [],
      });
      expect(findVisits).toHaveBeenCalledWith(auth, 'labels', { albumId });
    } finally {
      unregisterCollectionPack(labelsPack.id);
    }
  });

  describe('find_visits', () => {
    it('should return compact visits', async () => {
      const [dish, menu] = [newUuid(), newUuid()];
      const findVisits = vi.spyOn(CollectionService.prototype, 'findVisits').mockResolvedValue({
        pack: 'food',
        count: 10,
        truncated: false,
        photos: 2,
        visits: [
          {
            index: 0,
            start: '2024-06-12T20:00:00',
            end: '2024-06-12T21:00:00',
            day: '2024-06-12',
            type: 'Dinner',
            city: 'Taormina',
            subjectIds: [dish],
            sourceIds: [menu],
            signIds: [],
            receiptIds: [],
            place: { name: 'Trattoria da Nino', source: 'source', confidence: 0.7, assetIds: [menu] },
            candidates: [],
            saved: [{ assetId: menu, place: 'Trattoria da Nino', source: true }],
          },
        ],
        warnings: [],
      });

      const result = parse(await call('find_visits', { pack: 'food', albumId: newUuid() }));

      expect(findVisits).toHaveBeenCalledWith(auth, 'food', expect.objectContaining({ albumId: expect.any(String) }));
      expect(result).toEqual({
        pack: 'food',
        count: 10,
        photos: 2,
        visits: [
          {
            index: 0,
            start: '2024-06-12T20:00:00',
            end: '2024-06-12T21:00:00',
            type: 'Dinner',
            city: 'Taormina',
            place: { name: 'Trattoria da Nino', source: 'source', confidence: 0.7 },
            subjectIds: [dish],
            sourceIds: [menu],
            saved: [{ assetId: menu, tag: 'Trattoria da Nino/Menu' }],
          },
        ],
      });
    });

    it('should turn client errors into tool errors', async () => {
      vi.spyOn(CollectionService.prototype, 'findVisits').mockRejectedValue(new BadRequestException('Give an album'));
      const result = await call('find_visits', { pack: 'food' });
      expect(result).toEqual({ content: [{ type: 'text', text: 'Give an album' }], isError: true });
    });
  });

  describe('read_source', () => {
    it('should return the entries and the source image', async () => {
      const id = newUuid();
      const readSource = vi.spyOn(CollectionService.prototype, 'readSource').mockResolvedValue(
        reading([
          { name: 'Carbonara', price: '12,00', section: 'PRIMI', column: 0, box: [0, 0, 1, 1] },
          { name: 'Norma', column: 0, box: [0, 0, 1, 1] },
          { name: 'Cannolo', column: 0, box: [0, 0, 1, 1] },
        ]),
      );
      const images = vi.spyOn(CollectionService.prototype, 'getSourceImages').mockResolvedValue([Buffer.from('menu')]);

      const result = await call('read_source', { pack: 'food', id });

      expect(readSource).toHaveBeenCalledWith(auth, 'food', id);
      expect(images).toHaveBeenCalledWith(auth, id, { zoom: false });
      expect(parse(result)).toEqual({
        id,
        title: 'Trattoria da Nino',
        place: [{ name: 'Trattoria da Nino', confidence: 0.8 }],
        sections: ['PRIMI'],
        entries: [
          { i: 0, name: 'Carbonara', price: '12,00', section: 'PRIMI' },
          { i: 1, name: 'Norma' },
          { i: 2, name: 'Cannolo' },
        ],
        ocr: 'tiles',
      });
      expect(result.content[1]).toEqual({
        type: 'image',
        data: Buffer.from('menu').toString('base64'),
        mimeType: 'image/jpeg',
      });
    });

    it('should zoom in when few entries were read', async () => {
      const id = newUuid();
      vi.spyOn(CollectionService.prototype, 'readSource').mockResolvedValue(reading([]));
      const images = vi
        .spyOn(CollectionService.prototype, 'getSourceImages')
        .mockResolvedValue([Buffer.from('whole'), Buffer.from('top'), Buffer.from('bottom')]);

      const result = await call('read_source', { pack: 'food', id });

      expect(images).toHaveBeenCalledWith(auth, id, { zoom: true });
      expect(result.content.filter(({ type }) => type === 'image')).toHaveLength(3);
    });
  });

  it('should keep the source photos of a private pack from the assistant', async () => {
    registerCollectionPack({ ...labelsPack, privacy: { ...labelsPack.privacy, sourceImages: false } });
    try {
      const id = newUuid();
      vi.spyOn(CollectionService.prototype, 'readSource').mockResolvedValue(reading([]));
      const images = vi.spyOn(CollectionService.prototype, 'getSourceImages');

      const result = await call('read_source', { pack: 'labels', id });

      expect(images).not.toHaveBeenCalled();
      expect(result.content.filter(({ type }) => type === 'image')).toEqual([]);
    } finally {
      unregisterCollectionPack(labelsPack.id);
    }
  });

  describe('match_subjects', () => {
    it('should return the suggestions and a captioned contact sheet', async () => {
      const [carbonara, bread] = [newUuid(), newUuid()];
      const matchVisit = vi.spyOn(CollectionService.prototype, 'matchVisit').mockResolvedValue({
        entries: [{ index: 0, name: 'Carbonara', price: '12,00' }],
        subjects: [
          {
            assetIds: [carbonara],
            index: 0,
            name: 'Carbonara',
            score: 0.9,
            unsure: false,
            offList: 0.05,
            suggestions: [{ index: 0, name: 'Carbonara', score: 0.9 }],
          },
          { assetIds: [bread], score: 0, unsure: true, offList: 0.8, suggestions: [] },
        ],
        noEmbedding: [],
        warnings: [],
      });
      mocks.assetJob.getForAgent.mockResolvedValue([
        { id: carbonara, previewPath: '/carbonara.jpeg' },
        { id: bread, previewPath: '/bread.jpeg' },
      ] as never);
      mocks.media.createContactSheet.mockResolvedValue(Buffer.from('sheet'));

      const result = await call('match_subjects', {
        pack: 'food',
        subjectIds: [carbonara, bread],
        entries: [{ name: 'Carbonara' }],
      });

      expect(matchVisit).toHaveBeenCalledWith(auth, 'food', {
        subjectIds: [carbonara, bread],
        entries: [{ name: 'Carbonara' }],
      });
      expect(parse(result)).toEqual({
        entries: [{ i: 0, name: 'Carbonara', price: '12,00' }],
        subjects: [
          {
            assetIds: [carbonara],
            match: 'Carbonara',
            i: 0,
            score: 0.9,
            suggestions: [{ i: 0, name: 'Carbonara', score: 0.9 }],
          },
          { assetIds: [bread], match: null, score: 0, unsure: true, offList: 0.8, suggestions: [] },
        ],
        sheet: { 1: carbonara, 2: bread },
      });
      expect(mocks.media.createContactSheet).toHaveBeenCalledWith(
        [
          { input: '/carbonara.jpeg', label: '1', caption: 'Carbonara 90%' },
          { input: '/bread.jpeg', label: '2', caption: 'no menu item' },
        ],
        { tileSize: 320 },
      );
      expect(result.content[1]).toMatchObject({ type: 'image' });
    });
  });

  describe('lookup_place', () => {
    it('should say when the lookup is disabled', async () => {
      const result = parse(await call('lookup_place', { pack: 'food', latitude: 37.85, longitude: 15.28 }));
      expect(result).toEqual({ enabled: false, message: expect.stringContaining('Ask the user') });
    });

    it('should list the places nearby', async () => {
      vi.spyOn(CollectionService.prototype, 'lookupPlaces').mockResolvedValue({
        enabled: true,
        latitude: 37.85,
        longitude: 15.28,
        radius: 75,
        places: [{ name: 'Trattoria da Nino', type: 'restaurant', distance: 14, osm: 'node/1' }],
      });

      const result = parse(await call('lookup_place', { pack: 'food', assetIds: [newUuid()] }));

      expect(result).toEqual({
        location: [37.85, 15.28],
        radius: 75,
        places: [{ name: 'Trattoria da Nino', type: 'restaurant', distance: 14 }],
      });
    });
  });

  describe('save_entries', () => {
    it('should report the named photos and the failures', async () => {
      const [dish, other] = [newUuid(), newUuid()];
      const saveEntries = vi.spyOn(CollectionService.prototype, 'saveEntries').mockResolvedValue({
        place: 'Nino',
        results: [
          { id: dish, success: true, tag: 'Food/Nino/Carbonara', description: 'Carbonara · Nino' },
          { id: other, success: false, error: 'no_permission' },
        ],
      });

      const result = parse(
        await call('save_entries', {
          pack: 'food',
          place: 'Nino',
          photos: [
            { id: dish, entry: 'Carbonara' },
            { id: other, source: true },
          ],
        }),
      );

      expect(saveEntries).toHaveBeenCalledWith(auth, 'food', {
        place: 'Nino',
        photos: [
          { id: dish, entry: 'Carbonara' },
          { id: other, source: true },
        ],
      });
      expect(result).toEqual({
        place: 'Nino',
        photos: [{ id: dish, tag: 'Food/Nino/Carbonara', description: 'Carbonara · Nino' }],
        failed: [{ id: other, error: 'no_permission' }],
      });
    });
  });
});
