import request from 'supertest';
import { OrientationController } from 'src/controllers/orientation.controller.js';
import { OrientationStatus } from 'src/enum.js';
import { OrientationService } from 'src/services/orientation.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(OrientationController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(OrientationService);

  beforeAll(async () => {
    ctx = await controllerSetup(OrientationController, [{ provide: OrientationService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /orientation/scan', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/orientation/scan').send({});
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should check a scope', async () => {
      const albumId = factory.uuid();
      const { status } = await request(ctx.getHttpServer())
        .post('/orientation/scan')
        .send({ albumId, takenAfter: '2025-01-01T00:00:00.000Z' });
      expect(status).toBe(204);
      expect(service.scan).toHaveBeenCalledWith(undefined, {
        albumId,
        takenAfter: new Date('2025-01-01T00:00:00.000Z'),
      });
    });

    it('should require a valid album id', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/orientation/scan').send({ albumId: 'album' });
      expect(status).toBe(400);
    });
  });

  describe('GET /orientation/suggestions', () => {
    it('should list the suggestions', async () => {
      service.getSuggestions.mockResolvedValue([]);
      const { status } = await request(ctx.getHttpServer()).get('/orientation/suggestions?status=fixed');
      expect(status).toBe(200);
      expect(service.getSuggestions).toHaveBeenCalledWith(undefined, OrientationStatus.Fixed);
    });

    it('should validate the status', async () => {
      const { status } = await request(ctx.getHttpServer()).get('/orientation/suggestions?status=maybe');
      expect(status).toBe(400);
    });
  });

  describe('POST /orientation/fix', () => {
    it('should fix photos', async () => {
      const assetIds = [factory.uuid()];
      service.fix.mockResolvedValue([{ id: assetIds[0], success: true }]);
      const { status, body } = await request(ctx.getHttpServer()).post('/orientation/fix').send({ assetIds });
      expect(status).toBe(200);
      expect(body).toEqual([{ id: assetIds[0], success: true }]);
      expect(service.fix).toHaveBeenCalledWith(undefined, { assetIds });
    });

    it.each([45, 0, 360])('should refuse a turn of %i°', async (rotate) => {
      const { status } = await request(ctx.getHttpServer())
        .post('/orientation/fix')
        .send({ assetIds: [factory.uuid()], rotate });
      expect(status).toBe(400);
    });

    it('should require photos', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/orientation/fix').send({ assetIds: [] });
      expect(status).toBe(400);
    });
  });

  describe('POST /orientation/reject and /orientation/undo', () => {
    it('should reject suggestions', async () => {
      const assetIds = [factory.uuid()];
      service.reject.mockResolvedValue([]);
      const { status } = await request(ctx.getHttpServer()).post('/orientation/reject').send({ assetIds });
      expect(status).toBe(200);
      expect(service.reject).toHaveBeenCalledWith(undefined, assetIds);
    });

    it('should undo fixes', async () => {
      const assetIds = [factory.uuid()];
      service.undo.mockResolvedValue([]);
      const { status } = await request(ctx.getHttpServer()).post('/orientation/undo').send({ assetIds });
      expect(status).toBe(200);
      expect(service.undo).toHaveBeenCalledWith(undefined, assetIds);
    });
  });
});
