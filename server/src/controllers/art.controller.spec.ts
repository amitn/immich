import request from 'supertest';
import { ArtController } from 'src/controllers/art.controller.js';
import { ArtService } from 'src/services/art.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(ArtController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(ArtService);

  beforeAll(async () => {
    ctx = await controllerSetup(ArtController, [{ provide: ArtService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  const prompt = 'Transform the reference photograph into a linocut of the exact same scene, keeping it recognizable.';

  describe('GET /art/styles', () => {
    it("should list the styles with the user's own", async () => {
      service.getStyles.mockResolvedValue([]);
      const { status } = await request(ctx.getHttpServer()).get('/art/styles');
      expect(status).toBe(200);
      expect(service.getStyles).toHaveBeenCalled();
    });
  });

  describe('POST /art/styles', () => {
    it('should require a name and a prompt of some length', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/art/styles').send({ name: 'Mine', prompt: 'short' });
      expect(status).toBe(400);
      expect(service.createStyle).not.toHaveBeenCalled();
    });

    it('should create a style', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/art/styles')
        .send({ name: 'Linocut', prompt, usesCaption: false });
      expect(status).toBe(201);
      expect(service.createStyle).toHaveBeenCalledWith(
        undefined,
        { name: 'Linocut', prompt, usesCaption: false },
        expect.any(ActivityRecorder),
      );
    });
  });

  describe('PUT /art/styles/:id', () => {
    it('should rename a style', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).put(`/art/styles/${id}`).send({ name: 'Print' });
      expect(status).toBe(200);
      expect(service.updateStyle).toHaveBeenCalledWith(undefined, id, { name: 'Print' });
    });
  });

  describe('DELETE /art/styles/:id', () => {
    it('should require a UUID', async () => {
      const { status } = await request(ctx.getHttpServer()).delete('/art/styles/watercolor');
      expect(status).toBe(400);
    });

    it('should delete a style', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).delete(`/art/styles/${id}`);
      expect(status).toBe(204);
      expect(service.deleteStyle).toHaveBeenCalledWith(undefined, id);
    });
  });
});
