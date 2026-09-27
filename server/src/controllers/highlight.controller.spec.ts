import request from 'supertest';
import { HighlightController } from 'src/controllers/highlight.controller.js';
import { HighlightService } from 'src/services/highlight.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(HighlightController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(HighlightService);

  beforeAll(async () => {
    ctx = await controllerSetup(HighlightController, [{ provide: HighlightService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /highlights', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/highlights').send({ albumId: factory.uuid() });
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should require exactly one source', async () => {
      const none = await request(ctx.getHttpServer()).post('/highlights').send({});
      expect(none.status).toBe(400);
      const both = await request(ctx.getHttpServer())
        .post('/highlights')
        .send({ albumId: factory.uuid(), bookId: factory.uuid() });
      expect(both.status).toBe(400);
      expect(service.create).not.toHaveBeenCalled();
    });

    it('should reject a length out of range and an unknown style', async () => {
      const long = await request(ctx.getHttpServer())
        .post('/highlights')
        .send({ albumId: factory.uuid(), durationSeconds: 600 });
      expect(long.status).toBe(400);
      const style = await request(ctx.getHttpServer())
        .post('/highlights')
        .send({ albumId: factory.uuid(), style: 'neon' });
      expect(style.status).toBe(400);
    });

    it('should start a highlight video', async () => {
      const albumId = factory.uuid();
      const music = factory.uuid();
      const { status } = await request(ctx.getHttpServer())
        .post('/highlights')
        .send({ albumId, title: 'Sicily', durationSeconds: 90, style: 'food', music, includeMaps: false });
      expect(status).toBe(201);
      expect(service.create).toHaveBeenCalledWith(undefined, {
        albumId,
        title: 'Sicily',
        durationSeconds: 90,
        style: 'food',
        music,
        includeMaps: false,
      });
    });

    it('should accept a selection of assets', async () => {
      const assetIds = [factory.uuid(), factory.uuid()];
      const { status } = await request(ctx.getHttpServer()).post('/highlights').send({ assetIds, style: 'auto' });
      expect(status).toBe(201);
      expect(service.create).toHaveBeenCalledWith(undefined, { assetIds, style: 'auto' });
    });
  });

  describe('GET /highlights/:id', () => {
    it('should require a valid id', async () => {
      const { status } = await request(ctx.getHttpServer()).get('/highlights/123');
      expect(status).toBe(400);
    });

    it('should get the status of a highlight video', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).get(`/highlights/${id}`);
      expect(status).toBe(200);
      expect(service.get).toHaveBeenCalledWith(undefined, id);
    });
  });

  describe('GET /highlights', () => {
    it('should list the highlight videos', async () => {
      const { status } = await request(ctx.getHttpServer()).get('/highlights');
      expect(status).toBe(200);
      expect(service.getAll).toHaveBeenCalled();
    });
  });

  describe('POST /highlights/:id/cancel', () => {
    it('should cancel a highlight video', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).post(`/highlights/${id}/cancel`);
      expect(status).toBe(201);
      expect(service.cancel).toHaveBeenCalledWith(undefined, id);
    });
  });

  describe('music', () => {
    it('should list the music', async () => {
      const { status } = await request(ctx.getHttpServer()).get('/highlights/music');
      expect(status).toBe(200);
      expect(service.getMusic).toHaveBeenCalled();
      expect(service.get).not.toHaveBeenCalled();
    });

    it('should upload an audio file', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/highlights/music')
        .attach('file', Buffer.from('ID3'), 'song.mp3');
      expect(status).toBe(201);
      expect(service.uploadMusic).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ originalname: 'song.mp3', buffer: Buffer.from('ID3') }),
      );
    });

    it('should delete an audio file', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).delete(`/highlights/music/${id}`);
      expect(status).toBe(204);
      expect(service.deleteMusic).toHaveBeenCalledWith(undefined, id);
    });
  });
});
