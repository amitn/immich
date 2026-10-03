import request from 'supertest';
import { RedactionController } from 'src/controllers/redaction.controller.js';
import { ActivityLogSource } from 'src/enum.js';
import { RedactionService } from 'src/services/redaction.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(RedactionController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(RedactionService);
  const id = factory.uuid();
  const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };

  beforeAll(async () => {
    ctx = await controllerSetup(RedactionController, [{ provide: RedactionService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /assets/:id/redact/suggest', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post(`/assets/${id}/redact/suggest`).send({});
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should suggest with the people to keep', async () => {
      const personId = factory.uuid();
      service.suggest.mockResolvedValue({
        assetId: id,
        width: 100,
        height: 100,
        regions: [],
        hasFaces: false,
        hasText: false,
        scene: null,
      });
      const { status } = await request(ctx.getHttpServer())
        .post(`/assets/${id}/redact/suggest`)
        .send({ keepPersonIds: [personId], plates: false });
      expect(status).toBe(200);
      expect(service.suggest).toHaveBeenCalledWith(undefined, id, { keepPersonIds: [personId], plates: false });
    });

    it.each([{ keepPersonIds: ['nope'] }, { keepPersonIds: [id], onlyPersonIds: [id] }, { faces: 'yes' }])(
      'should refuse %j',
      async (dto) => {
        const { status } = await request(ctx.getHttpServer()).post(`/assets/${id}/redact/suggest`).send(dto);
        expect(status).toBe(400);
      },
    );
  });

  describe('POST /assets/:id/redact/preview', () => {
    it('should render a JPEG', async () => {
      service.renderPreview.mockResolvedValue(Buffer.from('jpeg'));
      const { status, headers } = await request(ctx.getHttpServer())
        .post(`/assets/${id}/redact/preview`)
        .send({ regions: [region], style: 'pixelate' });
      expect(status).toBe(200);
      expect(headers['content-type']).toBe('image/jpeg');
      expect(service.renderPreview).toHaveBeenCalledWith(undefined, id, { regions: [region], style: 'pixelate' });
    });

    it.each([
      { regions: [] },
      { regions: [{ ...region, x: 1.5 }] },
      { regions: [{ ...region, width: 0 }] },
      { regions: [region], style: 'smudge' },
    ])('should refuse %j', async (dto) => {
      const { status } = await request(ctx.getHttpServer()).post(`/assets/${id}/redact/preview`).send(dto);
      expect(status).toBe(400);
    });
  });

  describe('POST /assets/:id/redact', () => {
    it('should make a copy and record it in the activity log', async () => {
      service.createRedactedCopy.mockResolvedValue({
        id: factory.uuid(),
        sourceId: id,
        regionCount: 1,
        description: '1 face',
        duplicate: false,
      });
      const { status } = await request(ctx.getHttpServer())
        .post(`/assets/${id}/redact`)
        .send({ regions: [{ ...region, kind: 'face' }] });
      expect(status).toBe(201);
      expect(service.createRedactedCopy).toHaveBeenCalledWith(
        undefined,
        id,
        { regions: [{ ...region, kind: 'face' }] },
        expect.any(ActivityRecorder),
      );
      const activity = service.createRedactedCopy.mock.calls[0][3];
      expect((activity as ActivityRecorder).origin.source).toBe(ActivityLogSource.Web);
    });

    it('should refuse a region of an unknown kind', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/assets/${id}/redact`)
        .send({ regions: [{ ...region, kind: 'tattoo' }] });
      expect(status).toBe(400);
    });
  });
});
