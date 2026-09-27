import request from 'supertest';
import { CollageController } from 'src/controllers/collage.controller.js';
import { CollageService } from 'src/services/collage.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(CollageController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(CollageService);
  const assetIds = [factory.uuid(), factory.uuid(), factory.uuid()];

  beforeAll(async () => {
    ctx = await controllerSetup(CollageController, [{ provide: CollageService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /collages/layouts', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/collages/layouts').send({ assetIds });
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should list the layouts', async () => {
      service.getLayouts.mockResolvedValue({ layouts: [{ id: 'four-grid', name: 'Four grid', description: '' }] });
      const { status, body } = await request(ctx.getHttpServer())
        .post('/collages/layouts')
        .send({ assetIds, aspectRatio: '9:16' });
      expect(status).toBe(200);
      expect(body.layouts).toHaveLength(1);
      expect(service.getLayouts).toHaveBeenCalledWith(undefined, { assetIds, aspectRatio: '9:16' });
    });

    it.each([
      ['one photo', { assetIds: assetIds.slice(0, 1) }],
      ['ten photos', { assetIds: Array.from({ length: 10 }, () => factory.uuid()) }],
      ['the same photo twice', { assetIds: [assetIds[0], assetIds[0]] }],
      ['an invalid id', { assetIds: ['123', assetIds[0]] }],
      ['another aspect ratio', { assetIds, aspectRatio: '3:2' }],
      ['a preset and a style', { assetIds, stylePreset: 'soft', styleId: factory.uuid() }],
      ['an unknown preset', { assetIds, stylePreset: 'neon' }],
      ['a long title', { assetIds, title: 'x'.repeat(101) }],
    ])('should refuse %s', async (_, dto) => {
      const { status } = await request(ctx.getHttpServer()).post('/collages/layouts').send(dto);
      expect(status).toBe(400);
      expect(service.getLayouts).not.toHaveBeenCalled();
    });
  });

  describe('POST /collages/render', () => {
    it('should return a JPEG', async () => {
      service.render.mockResolvedValue(Buffer.from('jpeg'));
      const { status, headers } = await request(ctx.getHttpServer())
        .post('/collages/render')
        .send({ assetIds, layout: 'hero-left-two', title: ' Palermo ', full: true });
      expect(status).toBe(200);
      expect(headers['content-type']).toBe('image/jpeg');
      expect(service.render).toHaveBeenCalledWith(undefined, {
        assetIds,
        layout: 'hero-left-two',
        title: 'Palermo',
        full: true,
      });
    });
  });

  describe('POST /collages', () => {
    it('should save a collage', async () => {
      const albumId = factory.uuid();
      service.create.mockResolvedValue({
        assetId: factory.uuid(),
        duplicate: false,
        layout: 'hero-left-two',
        tag: 'Collages/Palermo',
      });
      const { status, body } = await request(ctx.getHttpServer())
        .post('/collages')
        .send({ assetIds, stylePreset: 'soft', albumId });
      expect(status).toBe(201);
      expect(body.tag).toBe('Collages/Palermo');
      expect(service.create).toHaveBeenCalledWith(undefined, { assetIds, stylePreset: 'soft', albumId });
    });

    it('should require a valid album id', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/collages').send({ assetIds, albumId: 'album' });
      expect(status).toBe(400);
    });
  });
});
