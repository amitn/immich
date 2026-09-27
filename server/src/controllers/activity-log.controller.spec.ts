import request from 'supertest';
import { ActivityLogController } from 'src/controllers/activity-log.controller.js';
import { ActivityLogAction, ActivityLogSource } from 'src/enum.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(ActivityLogController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(ActivityLogService);

  beforeAll(async () => {
    ctx = await controllerSetup(ActivityLogController, [{ provide: ActivityLogService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /activity', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/activity');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should pass the filters, with the defaults', async () => {
      service.search.mockResolvedValue([]);
      const sessionId = factory.uuid();

      const { status } = await request(ctx.getHttpServer()).get('/activity').query({
        sessionId,
        source: ActivityLogSource.Assistant,
        action: ActivityLogAction.AlbumAddAssets,
        undone: 'false',
        from: '2026-09-01T00:00:00.000Z',
      });

      expect(status).toBe(200);
      expect(service.search).toHaveBeenCalledWith(undefined, {
        sessionId,
        source: ActivityLogSource.Assistant,
        action: ActivityLogAction.AlbumAddAssets,
        undone: false,
        from: new Date('2026-09-01T00:00:00.000Z'),
        limit: 100,
        offset: 0,
      });
    });

    it('should reject an unknown kind of change and a limit out of range', async () => {
      const unknown = await request(ctx.getHttpServer()).get('/activity').query({ action: 'album.explode' });
      expect(unknown.status).toBe(400);
      const limit = await request(ctx.getHttpServer()).get('/activity').query({ limit: 1000 });
      expect(limit.status).toBe(400);
      expect(service.search).not.toHaveBeenCalled();
    });
  });

  describe('POST /activity/:id/undo', () => {
    it('should undo the change', async () => {
      service.undo.mockResolvedValue({ results: [], undone: 1, refused: 0 });
      const id = factory.uuid();

      const { status } = await request(ctx.getHttpServer()).post(`/activity/${id}/undo`);

      expect(status).toBe(200);
      expect(service.undo).toHaveBeenCalledWith(undefined, id);
    });

    it('should require a UUID', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/activity/123/undo');
      expect(status).toBe(400);
    });
  });

  describe('POST /activity/undo', () => {
    it('should undo a group', async () => {
      service.undoAll.mockResolvedValue({ results: [], undone: 0, refused: 0 });
      const groupId = factory.uuid();

      const { status } = await request(ctx.getHttpServer()).post('/activity/undo').send({ groupId });

      expect(status).toBe(200);
      expect(service.undoAll).toHaveBeenCalledWith(undefined, { groupId });
    });

    it('should require ids or a group', async () => {
      const empty = await request(ctx.getHttpServer()).post('/activity/undo').send({ ids: [] });
      expect(empty.status).toBe(400);
      expect(service.undoAll).not.toHaveBeenCalled();
    });
  });

  describe('POST /activity/:id/redo', () => {
    it('should redo the change', async () => {
      service.redo.mockResolvedValue({} as never);
      const id = factory.uuid();

      await request(ctx.getHttpServer()).post(`/activity/${id}/redo`);

      expect(service.redo).toHaveBeenCalledWith(undefined, id);
    });
  });
});
