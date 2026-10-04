import request from 'supertest';
import { EnhanceController } from 'src/controllers/enhance.controller.js';
import { EnhanceService } from 'src/services/enhance.service.js';
import { errorDto } from 'test/medium/responses.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(EnhanceController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(EnhanceService);

  beforeAll(async () => {
    ctx = await controllerSetup(EnhanceController, [{ provide: EnhanceService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /assets/:id/enhance/preview', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post(`/assets/${factory.uuid()}/enhance/preview`).send({});
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should require a valid id', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/assets/123/enhance/preview').send({});
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });

    it('should validate the strength', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/assets/${factory.uuid()}/enhance/preview`)
        .send({ strength: 'extreme' });
      expect(status).toBe(400);
    });

    it('should analyze a photo', async () => {
      const id = factory.uuid();
      service.analyze.mockResolvedValue({ assetId: id } as any);

      const { status } = await request(ctx.getHttpServer())
        .post(`/assets/${id}/enhance/preview`)
        .send({ strength: 'subtle', only: ['levels', 'exposure'] });

      expect(status).toBe(200);
      expect(service.analyze).toHaveBeenCalledWith(undefined, id, { strength: 'subtle', only: ['levels', 'exposure'] });
    });
  });

  describe('GET /assets/:id/enhance/preview.jpg', () => {
    it('should return a JPEG', async () => {
      service.renderEnhancePreview.mockResolvedValue(Buffer.from('jpeg'));
      const id = factory.uuid();

      const { status, headers } = await request(ctx.getHttpServer()).get(
        `/assets/${id}/enhance/preview.jpg?strength=strong`,
      );

      expect(status).toBe(200);
      expect(headers['content-type']).toBe('image/jpeg');
      expect(service.renderEnhancePreview).toHaveBeenCalledWith(undefined, id, { strength: 'strong' });
    });

    it('should validate the strength', async () => {
      const { status } = await request(ctx.getHttpServer()).get(
        `/assets/${factory.uuid()}/enhance/preview.jpg?strength=max`,
      );
      expect(status).toBe(400);
    });
  });

  describe('POST /assets/:id/enhance', () => {
    it('should validate the corrections', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/assets/${factory.uuid()}/enhance`)
        .send({ only: ['vignette'] });
      expect(status).toBe(400);
    });

    it('should create an enhanced copy', async () => {
      const id = factory.uuid();
      service.createEnhancedCopy.mockResolvedValue({
        id: factory.uuid(),
        sourceId: id,
        adjustments: [],
        duplicate: false,
      });

      const { status, body } = await request(ctx.getHttpServer()).post(`/assets/${id}/enhance`).send({});

      expect(status).toBe(201);
      expect(body).toMatchObject({ sourceId: id, duplicate: false });
      expect(service.createEnhancedCopy).toHaveBeenCalledWith(undefined, id, {});
    });
  });
});
