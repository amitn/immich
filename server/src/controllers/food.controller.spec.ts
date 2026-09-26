import request from 'supertest';
import { FoodController } from 'src/controllers/food.controller.js';
import { FoodService } from 'src/services/food.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(FoodController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(FoodService);

  beforeAll(async () => {
    ctx = await controllerSetup(FoodController, [{ provide: FoodService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /food/meals', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/food/meals').send({});
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should validate the asset ids', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/food/meals')
        .send({ assetIds: ['not-a-uuid'] });
      expect(status).toBe(400);
    });

    it('should find the meals of an album', async () => {
      const albumId = factory.uuid();
      service.findMeals.mockResolvedValue({ count: 0, truncated: false, foodPhotos: 0, meals: [], warnings: [] });

      const { status, body } = await request(ctx.getHttpServer())
        .post('/food/meals')
        .send({ albumId, maxGapMinutes: 30 });

      expect(status).toBe(200);
      expect(body).toEqual({ count: 0, truncated: false, foodPhotos: 0, meals: [], warnings: [] });
      expect(service.findMeals).toHaveBeenCalledWith(undefined, { albumId, maxGapMinutes: 30 });
    });
  });

  describe('POST /food/meals/match', () => {
    it('should require dish photos', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/food/meals/match').send({ dishIds: [] });
      expect(status).toBe(400);
    });

    it('should match the dishes', async () => {
      const [dish, menu] = [factory.uuid(), factory.uuid()];
      service.matchMeal.mockResolvedValue({ items: [], dishes: [], noEmbedding: [], warnings: [] });

      const { status } = await request(ctx.getHttpServer())
        .post('/food/meals/match')
        .send({ dishIds: [dish], menuIds: [menu], items: [{ name: 'Carbonara' }] });

      expect(status).toBe(200);
      expect(service.matchMeal).toHaveBeenCalledWith(undefined, {
        dishIds: [dish],
        menuIds: [menu],
        items: [{ name: 'Carbonara' }],
      });
    });
  });

  describe('PUT /food/dishes', () => {
    it('should require a restaurant', async () => {
      const { status } = await request(ctx.getHttpServer())
        .put('/food/dishes')
        .send({ restaurant: '', photos: [{ id: factory.uuid(), dish: 'Carbonara' }] });
      expect(status).toBe(400);
    });

    it('should name the dishes', async () => {
      const id = factory.uuid();
      service.setDishNames.mockResolvedValue({
        restaurant: 'Nino',
        results: [{ id, success: true, tag: 'Food/Nino/Carbonara' }],
      });

      const { status, body } = await request(ctx.getHttpServer())
        .put('/food/dishes')
        .send({ restaurant: 'Nino', photos: [{ id, dish: 'Carbonara' }] });

      expect(status).toBe(200);
      expect(body).toEqual({ restaurant: 'Nino', results: [{ id, success: true, tag: 'Food/Nino/Carbonara' }] });
      expect(service.setDishNames).toHaveBeenCalledWith(undefined, {
        restaurant: 'Nino',
        photos: [{ id, dish: 'Carbonara' }],
      });
    });
  });
});
