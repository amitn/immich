import { AuthDto } from 'src/dtos/auth.dto.js';
import { HighlightJobStatus, JobName } from 'src/enum.js';
import { HighlightAgentTools } from 'src/services/agent-tools/highlight.tools.js';
import { HighlightService } from 'src/services/highlight.service.js';
import { ASSISTANT_INSTRUCTIONS } from 'src/utils/agent/instructions.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  return JSON.parse((result.content[0] as { text: string }).text);
};

describe(HighlightAgentTools.name, () => {
  let sut: HighlightAgentTools;
  let mocks: ServiceMocks;
  let auth: AuthDto;

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name)!;
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  const job = (overrides: Record<string, unknown> = {}) => ({
    id: newUuid(),
    ownerId: auth.user.id,
    albumId: null,
    bookId: null,
    musicAssetId: null,
    title: 'Sicily',
    options: { durationSeconds: 60, style: 'auto', includeMaps: true, captions: true, addToAlbum: true },
    status: HighlightJobStatus.Pending,
    progress: 0,
    error: null,
    warnings: null,
    resultAssetId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    updateId: newUuid(),
    ...overrides,
  });

  beforeEach(() => {
    ({ sut, mocks } = newTestService(HighlightAgentTools));
    auth = AuthFactory.create();
  });

  it('should make videos only with approval', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'make_highlight_video', mutating: true },
      { name: 'get_highlight_video', mutating: false },
      { name: 'list_highlight_music', mutating: false },
    ]);
  });

  it('should tell the assistant when to make a highlight video, and to use only the user’s music', () => {
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/make_highlight_video/);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/list_highlight_music/);
  });

  it('should start a video of a selection', async () => {
    const assetIds = [newUuid(), newUuid()];
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    mocks.highlightJob.create.mockImplementation((row) => Promise.resolve(job(row as never)) as never);

    const result = parse(await call('make_highlight_video', { assetIds, durationSeconds: 30, title: 'Sicily' }));

    expect(result).toMatchObject({ title: 'Sicily', status: 'pending', durationSeconds: 30 });
    expect(mocks.highlightJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sicily', options: expect.objectContaining({ assetIds, durationSeconds: 30 }) }),
    );
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.HighlightRender, data: { id: result.highlightId } });
  });

  it('should start a vertical video for a phone', async () => {
    const assetIds = [newUuid()];
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    mocks.highlightJob.create.mockImplementation((row) => Promise.resolve(job(row as never)) as never);

    const result = parse(await call('make_highlight_video', { assetIds, format: 'vertical' }));

    expect(result).toMatchObject({ format: 'vertical' });
    expect(mocks.highlightJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ format: 'vertical' }) }),
    );
    const tool = sut.getTools().find((tool) => tool.name === 'make_highlight_video')!;
    expect(tool.description).toMatch(/vertical/);
    expect(() => tool.input.parse({ assetIds, format: 'square' })).toThrow();
  });

  it('should start a video of a memory', async () => {
    const memoryId = newUuid();
    const create = vi.spyOn(HighlightService.prototype, 'create').mockResolvedValue({
      id: 'highlight-1',
      title: 'Recent trip to Athens',
      status: HighlightJobStatus.Pending,
      durationSeconds: 60,
      format: 'vertical',
    } as never);

    const result = parse(await call('make_highlight_video', { memoryId, format: 'vertical' }));

    expect(create).toHaveBeenCalledWith(auth, { memoryId, format: 'vertical', music: undefined }, undefined);
    expect(result).toMatchObject({ highlightId: 'highlight-1', title: 'Recent trip to Athens' });
    expect(await call('make_highlight_video', { memoryId, albumId: newUuid() })).toMatchObject({ isError: true });
    create.mockRestore();
  });

  it('should ask for exactly one source', async () => {
    const result = await call('make_highlight_video', { albumId: newUuid(), bookId: newUuid() });
    expect(result.isError).toBe(true);
    expect(mocks.highlightJob.create).not.toHaveBeenCalled();
  });

  it('should report an error of the service as a tool error', async () => {
    const result = await call('make_highlight_video', { albumId: newUuid() });
    expect(result.isError).toBe(true);
  });

  it('should return the video once it is ready', async () => {
    const done = job({ status: HighlightJobStatus.Completed, progress: 1, resultAssetId: newUuid() });
    mocks.access.highlightJob.checkOwnerAccess.mockResolvedValue(new Set([done.id]));
    mocks.highlightJob.get.mockResolvedValue(done as never);

    const result = parse(await call('get_highlight_video', { highlightId: done.id, wait: 0 }));

    expect(result).toEqual({ highlightId: done.id, status: 'completed', progress: 100, assetId: done.resultAssetId });
  });

  it('should list the music of the user', async () => {
    mocks.highlightJob.getMusic.mockResolvedValue([
      { id: 'song', originalFileName: 'Summer.mp3', originalPath: '/x', duration: 120_000, createdAt: new Date() },
    ] as never);
    expect(parse(await call('list_highlight_music', {}))).toEqual([
      { id: 'song', name: 'Summer.mp3', durationSeconds: 120 },
    ]);
  });
});
