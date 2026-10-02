import request from 'supertest';
import { YearRecapController } from 'src/controllers/year-recap.controller.js';
import { YearRecapService } from 'src/services/year-recap.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(YearRecapController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(YearRecapService);

  beforeAll(async () => {
    ctx = await controllerSetup(YearRecapController, [{ provide: YearRecapService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  it('should be an authenticated route', async () => {
    await request(ctx.getHttpServer()).get('/year-recaps/2025');
    expect(ctx.authenticate).toHaveBeenCalled();
  });

  it('should read the year', async () => {
    service.get.mockResolvedValue({ year: 2025 } as never);
    const { status } = await request(ctx.getHttpServer()).get('/year-recaps/2025');
    expect(status).toBe(200);
    expect(service.get).toHaveBeenCalledWith(undefined, 2025);
  });

  it('should refuse a year that is not one', async () => {
    const { status } = await request(ctx.getHttpServer()).get('/year-recaps/twenty');
    expect(status).toBe(400);
  });

  it('should make a vertical video without someone', async () => {
    const personId = factory.uuid();
    service.createVideo.mockResolvedValue({ id: factory.uuid() } as never);
    const { status } = await request(ctx.getHttpServer())
      .post('/year-recaps/2025/video')
      .send({ format: 'vertical', excludePersonIds: [personId] });
    expect(status).toBe(201);
    expect(service.createVideo).toHaveBeenCalledWith(
      undefined,
      2025,
      { format: 'vertical', excludePersonIds: [personId] },
      expect.any(ActivityRecorder),
    );
  });

  it('should draft the book of the year', async () => {
    service.createBook.mockResolvedValue({ id: factory.uuid() } as never);
    const { status } = await request(ctx.getHttpServer()).post('/year-recaps/2025/book').send({});
    expect(status).toBe(201);
    expect(service.createBook).toHaveBeenCalledWith(undefined, 2025, {});
  });

  it('should refuse a date range that ends before it starts', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post('/year-recaps/2025/book')
      .send({ excludeDateRanges: [{ startDate: '2025-03-02', endDate: '2025-03-01' }] });
    expect(status).toBe(400);
    expect(service.createBook).not.toHaveBeenCalled();
  });
});
