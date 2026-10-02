import request from 'supertest';
import { MemoryExclusionController } from 'src/controllers/memory-exclusion.controller.js';
import { MemoryExclusionType } from 'src/enum.js';
import { MemoryExclusionService } from 'src/services/memory-exclusion.service.js';
import { ActivityRecorder } from 'src/utils/activity-log.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(MemoryExclusionController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(MemoryExclusionService);

  beforeAll(async () => {
    ctx = await controllerSetup(MemoryExclusionController, [{ provide: MemoryExclusionService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  it('should be an authenticated route', async () => {
    await request(ctx.getHttpServer()).get('/memory-exclusions');
    expect(ctx.authenticate).toHaveBeenCalled();
  });

  it.each([
    ['a person', { type: MemoryExclusionType.Person, personId: factory.uuid() }],
    ['an album', { type: MemoryExclusionType.Album, albumId: factory.uuid() }],
    ['a day', { type: MemoryExclusionType.DateRange, startDate: '2026-03-01', endDate: '2026-03-01' }],
  ])('should add %s', async (_, dto) => {
    service.create.mockResolvedValue({ id: factory.uuid() } as never);
    const { status } = await request(ctx.getHttpServer()).post('/memory-exclusions').send(dto);
    expect(status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(undefined, dto, expect.any(ActivityRecorder));
  });

  it.each([
    ['a person without its id', { type: MemoryExclusionType.Person }],
    ['a person with an album', { type: MemoryExclusionType.Person, personId: factory.uuid(), albumId: factory.uuid() }],
    ['an album without its id', { type: MemoryExclusionType.Album }],
    ['a date range without its end', { type: MemoryExclusionType.DateRange, startDate: '2026-03-01' }],
    [
      'a date range that ends before it starts',
      { type: MemoryExclusionType.DateRange, startDate: '2026-03-02', endDate: '2026-03-01' },
    ],
    ['a malformed day', { type: MemoryExclusionType.DateRange, startDate: '2026-3-1', endDate: '2026-03-02' }],
    ['an unknown type', { type: 'mood', personId: factory.uuid() }],
  ])('should refuse %s', async (_, dto) => {
    const { status } = await request(ctx.getHttpServer()).post('/memory-exclusions').send(dto);
    expect(status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('should remove an exclusion', async () => {
    const id = factory.uuid();
    const { status } = await request(ctx.getHttpServer()).delete(`/memory-exclusions/${id}`);
    expect(status).toBe(204);
    expect(service.remove).toHaveBeenCalledWith(undefined, id, expect.any(ActivityRecorder));
  });
});
