import request from 'supertest';
import { CollectionController } from 'src/controllers/collection.controller.js';
import { CollectionService } from 'src/services/collection.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(CollectionController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(CollectionService);

  beforeAll(async () => {
    ctx = await controllerSetup(CollectionController, [{ provide: CollectionService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /collections', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/collections');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should list the packs', async () => {
      service.getPacks.mockReturnValue([]);
      const { status, body } = await request(ctx.getHttpServer()).get('/collections');
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });
  });

  describe('GET /collections/summary', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/collections/summary');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should summarize the collections', async () => {
      const summary = {
        packs: [
          {
            pack: 'food',
            title: 'Food',
            place: 'restaurant',
            entry: 'menu items',
            visit: 'meals',
            photos: 36,
            visits: 3,
            places: 3,
            entries: 32,
            sources: 4,
            years: [2013, 2014, 2016],
            first: '2013-06-15',
            last: '2016-03-23',
            recentPlaces: [{ name: 'Noma Australia', visits: 1, last: '2016-03-23' }],
          },
        ],
        truncated: false,
      };
      service.getSummary.mockResolvedValue(summary);
      const { status, body } = await request(ctx.getHttpServer()).get('/collections/summary');
      expect(status).toBe(200);
      expect(body).toEqual(summary);
      expect(service.getSummary).toHaveBeenCalledWith(undefined);
    });
  });

  describe('POST /collections/:pack/visits', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/collections/food/visits').send({});
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should validate the pack and the asset ids', async () => {
      const invalidPack = await request(ctx.getHttpServer()).post('/collections/Food!/visits').send({});
      expect(invalidPack.status).toBe(400);
      const invalidIds = await request(ctx.getHttpServer())
        .post('/collections/food/visits')
        .send({ assetIds: ['not-a-uuid'] });
      expect(invalidIds.status).toBe(400);
    });

    it('should find the visits of the pack', async () => {
      const albumId = factory.uuid();
      service.findVisits.mockResolvedValue({
        pack: 'food',
        count: 0,
        truncated: false,
        photos: 0,
        visits: [],
        warnings: [],
      });

      const { status, body } = await request(ctx.getHttpServer())
        .post('/collections/food/visits')
        .send({ albumId, maxGapMinutes: 30 });

      expect(status).toBe(200);
      expect(body).toEqual({ pack: 'food', count: 0, truncated: false, photos: 0, visits: [], warnings: [] });
      expect(service.findVisits).toHaveBeenCalledWith(undefined, 'food', { albumId, maxGapMinutes: 30 });
    });
  });

  describe('POST /collections/:pack/match', () => {
    it('should require subject photos', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/collections/food/match').send({ subjectIds: [] });
      expect(status).toBe(400);
    });

    it('should match the subjects', async () => {
      const [dish, menu] = [factory.uuid(), factory.uuid()];
      service.matchVisit.mockResolvedValue({ entries: [], subjects: [], noEmbedding: [], warnings: [] });

      const { status } = await request(ctx.getHttpServer())
        .post('/collections/food/match')
        .send({ subjectIds: [dish], sourceIds: [menu], entries: [{ name: 'Carbonara' }] });

      expect(status).toBe(200);
      expect(service.matchVisit).toHaveBeenCalledWith(undefined, 'food', {
        subjectIds: [dish],
        sourceIds: [menu],
        entries: [{ name: 'Carbonara' }],
      });
    });
  });

  describe('PUT /collections/:pack/entries', () => {
    it('should require a place', async () => {
      const { status } = await request(ctx.getHttpServer())
        .put('/collections/food/entries')
        .send({ place: '', photos: [{ id: factory.uuid(), entry: 'Carbonara' }] });
      expect(status).toBe(400);
    });

    it('should name the entries', async () => {
      const id = factory.uuid();
      service.saveEntries.mockResolvedValue({
        place: 'Nino',
        results: [{ id, success: true, tag: 'Food/Nino/Carbonara' }],
      });

      const { status, body } = await request(ctx.getHttpServer())
        .put('/collections/food/entries')
        .send({ place: 'Nino', photos: [{ id, entry: 'Carbonara' }] });

      expect(status).toBe(200);
      expect(body).toEqual({ place: 'Nino', results: [{ id, success: true, tag: 'Food/Nino/Carbonara' }] });
      expect(service.saveEntries).toHaveBeenCalledWith(undefined, 'food', {
        place: 'Nino',
        photos: [{ id, entry: 'Carbonara' }],
      });
    });
  });
});
