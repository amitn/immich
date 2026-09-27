import request from 'supertest';
import { BookStyleController } from 'src/controllers/book-style.controller.js';
import { BookStyleService } from 'src/services/book-style.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { errorDto } from 'test/medium/responses.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(BookStyleController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(BookStyleService);

  beforeAll(async () => {
    ctx = await controllerSetup(BookStyleController, [{ provide: BookStyleService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /book-styles', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/book-styles');
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });

  describe('POST /book-styles', () => {
    it('should require a name and a style', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/book-styles').send({});
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['name'], message: expect.any(String) },
          { path: ['style'], message: expect.any(String) },
        ]),
      );
    });

    it('should validate the colours', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/book-styles')
        .send({ name: 'Mine', style: { background: 'red' } });
      expect(status).toBe(400);
    });

    it('should create a style', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/book-styles')
        .send({ name: ' Mine ', style: { background: '#ffffff' } });
      expect(status).toBe(201);
      expect(service.create).toHaveBeenCalledWith(
        undefined,
        { name: 'Mine', style: { background: '#ffffff' } },
        expect.any(ActivityRecorder),
      );
    });
  });

  describe('PUT /book-styles/:id', () => {
    it('should require a UUID', async () => {
      const { status } = await request(ctx.getHttpServer()).put('/book-styles/123').send({ name: 'New' });
      expect(status).toBe(400);
    });

    it('should rename a style', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).put(`/book-styles/${id}`).send({ name: 'New' });
      expect(status).toBe(200);
      expect(service.update).toHaveBeenCalledWith(undefined, id, { name: 'New' });
    });
  });

  describe('DELETE /book-styles/:id', () => {
    it('should delete a style', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).delete(`/book-styles/${id}`);
      expect(status).toBe(204);
      expect(service.delete).toHaveBeenCalledWith(undefined, id);
    });
  });
});
