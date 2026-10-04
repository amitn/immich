import request from 'supertest';
import { BurstController } from 'src/controllers/burst.controller.js';
import { ActivityLogSource } from 'src/enum.js';
import { BurstService } from 'src/services/burst.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(BurstController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(BurstService);

  beforeAll(async () => {
    ctx = await controllerSetup(BurstController, [{ provide: BurstService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /bursts/search', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/bursts/search').send({});
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should search a scope with rules', async () => {
      const albumId = factory.uuid();
      service.search.mockResolvedValue({
        groups: [],
        total: 0,
        totalToArchive: 0,
        scanned: 0,
        truncated: false,
        hasNextPage: false,
      });
      const { status, body } = await request(ctx.getHttpServer())
        .post('/bursts/search')
        .send({ albumId, takenAfter: '2025-01-01T00:00:00.000Z', rules: { preferRaw: true }, page: 2, size: 10 });
      expect(status).toBe(200);
      expect(body).toMatchObject({ total: 0, groups: [] });
      expect(service.search).toHaveBeenCalledWith(undefined, {
        albumId,
        takenAfter: new Date('2025-01-01T00:00:00.000Z'),
        rules: { preferRaw: true },
        page: 2,
        size: 10,
      });
    });

    it.each([{ albumId: 'album' }, { size: 500 }, { page: 0 }, { rules: { preferRaw: 'yes' } }])(
      'should refuse %j',
      async (dto) => {
        const { status } = await request(ctx.getHttpServer()).post('/bursts/search').send(dto);
        expect(status).toBe(400);
      },
    );
  });

  describe('POST /bursts/clean', () => {
    it('should clean up groups, recorded as a change of the web app', async () => {
      const [a, b] = [factory.uuid(), factory.uuid()];
      service.clean.mockResolvedValue({ dryRun: false, groups: [], archived: 1, activityId: factory.uuid() });
      const { status } = await request(ctx.getHttpServer())
        .post('/bursts/clean')
        .send({ groups: [{ assetIds: [a, b], keepAssetId: a }] });
      expect(status).toBe(200);
      expect(service.clean).toHaveBeenCalledWith(
        undefined,
        { groups: [{ assetIds: [a, b], keepAssetId: a }] },
        expect.any(ActivityRecorder),
      );
      const recorder = service.clean.mock.calls[0][2] as ActivityRecorder;
      expect(recorder.origin.source).toBe(ActivityLogSource.Web);
    });

    it('should need the photo to keep to be in its group', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/bursts/clean')
        .send({ groups: [{ assetIds: [factory.uuid(), factory.uuid()], keepAssetId: factory.uuid() }] });
      expect(status).toBe(400);
    });

    it('should need groups of two photos or more', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer())
        .post('/bursts/clean')
        .send({ groups: [{ assetIds: [id], keepAssetId: id }] });
      expect(status).toBe(400);
    });
  });
});
