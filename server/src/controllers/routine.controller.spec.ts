import request from 'supertest';
import { RoutineController } from 'src/controllers/routine.controller.js';
import { RoutineApprovalMode, RoutineEvent, RoutineTriggerType } from 'src/enum.js';
import { RoutineService } from 'src/services/routine.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

/** the status of a response, awaited */
const statusOf = async (response: PromiseLike<{ status: number }>) => {
  const { status } = await response;
  return status;
};

describe(RoutineController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(RoutineService);

  beforeAll(async () => {
    ctx = await controllerSetup(RoutineController, [{ provide: RoutineService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  it('should be an authenticated route', async () => {
    await request(ctx.getHttpServer()).get('/routines');
    expect(ctx.authenticate).toHaveBeenCalled();
  });

  it.each([
    ['a manual routine', { type: RoutineTriggerType.Manual }],
    ['a nightly schedule', { type: RoutineTriggerType.Schedule, cron: '0 2 * * *', timezone: 'Europe/London' }],
    ['an upload event', { type: RoutineTriggerType.Event, event: RoutineEvent.Upload }],
    ['a tag event', { type: RoutineTriggerType.Event, event: RoutineEvent.Tag, tag: 'print' }],
  ])('should create %s', async (_, trigger) => {
    service.create.mockResolvedValue({ id: factory.uuid() } as never);
    const dto = { name: 'Name dishes', instruction: 'Name the dishes', trigger };
    const { status } = await request(ctx.getHttpServer()).post('/routines').send(dto);
    expect(status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(undefined, dto);
  });

  it.each([
    ['a schedule without a cron expression', { type: RoutineTriggerType.Schedule }],
    ['a bad cron expression', { type: RoutineTriggerType.Schedule, cron: 'every night' }],
    ['a cron expression with seconds', { type: RoutineTriggerType.Schedule, cron: '* * * * * *' }],
    ['an unknown time zone', { type: RoutineTriggerType.Schedule, cron: '0 2 * * *', timezone: 'Mars/Olympus' }],
    ['an event trigger without its event', { type: RoutineTriggerType.Event }],
    ['an unknown event', { type: RoutineTriggerType.Event, event: 'moon' }],
  ])('should refuse %s', async (_, trigger) => {
    const { status } = await request(ctx.getHttpServer())
      .post('/routines')
      .send({ name: 'Name dishes', instruction: 'Name the dishes', trigger });
    expect(status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('should refuse an unknown approval mode and limits over the bounds', async () => {
    const base = { name: 'x', instruction: 'y', trigger: { type: RoutineTriggerType.Manual } };
    for (const dto of [
      { ...base, approvalMode: 'yolo' },
      { ...base, limits: { minutes: 0 } },
      { ...base, limits: { toolCalls: 100_000 } },
      { ...base, name: '' },
    ]) {
      const { status } = await request(ctx.getHttpServer()).post('/routines').send(dto);
      expect(status).toBe(400);
    }
    const { status } = await request(ctx.getHttpServer())
      .post('/routines')
      .send({ ...base, approvalMode: RoutineApprovalMode.AutoSafe });
    expect(status).toBe(201);
  });

  it('should route the inbox and the settings before the routine ids', async () => {
    service.getInbox.mockResolvedValue([]);
    service.getRoutineConfig.mockResolvedValue({ enabled: true } as never);
    expect(await statusOf(request(ctx.getHttpServer()).get('/routines/inbox'))).toBe(200);
    expect(await statusOf(request(ctx.getHttpServer()).get('/routines/config'))).toBe(200);
    expect(service.getInbox).toHaveBeenCalled();
    expect(service.getRoutineConfig).toHaveBeenCalled();
  });

  it('should run a routine now, or as a dry run', async () => {
    const id = factory.uuid();
    service.run.mockResolvedValue({ id: factory.uuid() } as never);
    const { status } = await request(ctx.getHttpServer()).post(`/routines/${id}/run`).send({ dryRun: true });
    expect(status).toBe(201);
    expect(service.run).toHaveBeenCalledWith(undefined, id, { dryRun: true });
  });

  it('should decide changes one by one or per run', async () => {
    service.decide.mockResolvedValue({ results: [], applied: 0, denied: 0, failed: 0, skipped: 0 });
    const runId = factory.uuid();
    expect(
      await statusOf(request(ctx.getHttpServer()).post('/routines/approvals').send({ runId, approve: true })),
    ).toBe(201);
    expect(service.decide).toHaveBeenCalledWith(undefined, { runId, approve: true });
    expect(await statusOf(request(ctx.getHttpServer()).post('/routines/approvals').send({ approve: true }))).toBe(400);
  });

  it('should resume a paused routine, but not pause one by hand', async () => {
    const id = factory.uuid();
    service.update.mockResolvedValue({ id } as never);
    expect(await statusOf(request(ctx.getHttpServer()).patch(`/routines/${id}`).send({ paused: false }))).toBe(200);
    expect(await statusOf(request(ctx.getHttpServer()).patch(`/routines/${id}`).send({ paused: true }))).toBe(400);
  });

  it('should open, stop and undo a run', async () => {
    const id = factory.uuid();
    service.getRun.mockResolvedValue({ id } as never);
    service.cancelRun.mockResolvedValue({ id } as never);
    service.undoRun.mockResolvedValue({ results: [], undone: 0, refused: 0 });
    expect(await statusOf(request(ctx.getHttpServer()).get(`/routines/runs/${id}`))).toBe(200);
    expect(await statusOf(request(ctx.getHttpServer()).post(`/routines/runs/${id}/cancel`))).toBe(200);
    expect(await statusOf(request(ctx.getHttpServer()).post(`/routines/runs/${id}/undo`))).toBe(200);
    expect(service.undoRun).toHaveBeenCalledWith(undefined, id);
  });
});
