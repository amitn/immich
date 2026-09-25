import request from 'supertest';
import { BookController } from 'src/controllers/book.controller.js';
import { BookService } from 'src/services/book.service.js';
import { errorDto } from 'test/medium/responses.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(BookController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(BookService);

  beforeAll(async () => {
    ctx = await controllerSetup(BookController, [{ provide: BookService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /books', () => {
    it('should require a title', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/books').send({});
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['title'], message: expect.any(String) }]));
    });

    it('should validate the style colors', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/books')
        .send({ title: 'Book', style: { background: 'url(javascript:alert(1))' } });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['style', 'background'], message: 'Must be a hex color such as #ffffff' }]),
      );
    });

    it('should validate the page size', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/books').send({ title: 'Book', pageWidthMm: 10 });
      expect(status).toBe(400);
    });

    it('should create a book', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/books')
        .send({ title: 'Book', pageWidthMm: 297, pageHeightMm: 210, style: { marginMm: 5 } });
      expect(status).toBe(201);
      expect(service.create).toHaveBeenCalledWith(undefined, {
        title: 'Book',
        pageWidthMm: 297,
        pageHeightMm: 210,
        style: { marginMm: 5 },
      });
    });
  });

  describe('GET /books/layouts', () => {
    it('should not be treated as a book id', async () => {
      service.getLayouts.mockReturnValue([]);
      const { status } = await request(ctx.getHttpServer()).get('/books/layouts');
      expect(status).toBe(200);
      expect(service.getLayouts).toHaveBeenCalled();
      expect(service.get).not.toHaveBeenCalled();
    });
  });

  describe('GET /books/:id', () => {
    it('should require a valid id', async () => {
      const { status, body } = await request(ctx.getHttpServer()).get('/books/123');
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });
  });

  describe('PUT /books/:id/pages/:pageId/slots/:slot', () => {
    it('should parse the slot index', async () => {
      const [id, pageId, assetId] = [factory.uuid(), factory.uuid(), factory.uuid()];
      await request(ctx.getHttpServer()).put(`/books/${id}/pages/${pageId}/slots/2`).send({ assetId });
      expect(service.setSlot).toHaveBeenCalledWith(undefined, id, pageId, 2, { assetId });
    });

    it('should reject an invalid slot', async () => {
      const { status } = await request(ctx.getHttpServer())
        .put(`/books/${factory.uuid()}/pages/${factory.uuid()}/slots/abc`)
        .send({ assetId: factory.uuid() });
      expect(status).toBe(400);
    });

    it('should reject a crop outside the image', async () => {
      const { status } = await request(ctx.getHttpServer())
        .put(`/books/${factory.uuid()}/pages/${factory.uuid()}/slots/0`)
        .send({ assetId: factory.uuid(), crop: { x: 0.5, y: 0, width: 0.8, height: 1 } });
      expect(status).toBe(400);
    });
  });

  describe('PUT /books/:id/pages/:pageId/position', () => {
    it('should require a position', async () => {
      const { status } = await request(ctx.getHttpServer())
        .put(`/books/${factory.uuid()}/pages/${factory.uuid()}/position`)
        .send({});
      expect(status).toBe(400);
    });
  });

  describe('GET /books/:id/pages/:pageId/render', () => {
    it('should return a JPEG', async () => {
      service.renderPage.mockResolvedValue({ data: Buffer.from('jpeg'), warnings: [] });
      const [id, pageId] = [factory.uuid(), factory.uuid()];

      const { status, headers } = await request(ctx.getHttpServer()).get(
        `/books/${id}/pages/${pageId}/render?size=800`,
      );

      expect(status).toBe(200);
      expect(headers['content-type']).toBe('image/jpeg');
      expect(service.renderPage).toHaveBeenCalledWith(undefined, id, pageId, { size: 800 });
    });

    it('should validate the size', async () => {
      const { status } = await request(ctx.getHttpServer()).get(
        `/books/${factory.uuid()}/pages/${factory.uuid()}/render?size=99999`,
      );
      expect(status).toBe(400);
    });
  });

  describe('POST /books/:id/export', () => {
    it('should return no content', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).post(`/books/${id}/export`);
      expect(status).toBe(204);
      expect(service.export).toHaveBeenCalledWith(undefined, id);
    });
  });
});
