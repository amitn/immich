import { ActivityLogAction, ActivityLogSource, ActivityUndoStatus } from 'src/enum.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { ActivityAgentTools } from 'src/services/agent-tools/activity.tools.js';
import { AgentTool, AgentToolContext } from 'src/utils/agent/tools.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newTestService } from 'test/utils.js';

const text = (result: Awaited<ReturnType<AgentTool['handler']>>) =>
  result.content.find((item) => item.type === 'text')?.text ?? '';

describe(ActivityAgentTools.name, () => {
  let tools: Map<string, AgentTool>;
  const ctx: AgentToolContext = { auth: authStub.admin, sessionId: 'session-1' };

  const call = (name: string, input: Record<string, unknown> = {}, context = ctx) =>
    tools.get(name)!.handler(context, input as never);

  beforeEach(() => {
    const { sut } = newTestService(ActivityAgentTools);
    tools = new Map(sut.getTools().map((tool) => [tool.name, tool]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should list read-only, and undo with approval', () => {
    expect(tools.get('list_activity')?.mutating).toBe(false);
    expect(tools.get('undo_activity')?.mutating).toBe(true);
  });

  describe('list_activity', () => {
    it('should list the changes of this chat that were not undone', async () => {
      const createdAt = new Date('2026-09-27T10:00:00.000Z');
      const search = vi.spyOn(ActivityLogService.prototype, 'search').mockResolvedValue([
        {
          id: 'change-1',
          source: ActivityLogSource.Assistant,
          sessionId: 'session-1',
          toolName: 'add_to_album',
          action: ActivityLogAction.AlbumAddAssets,
          summary: 'Added 3 photos to “Trip”',
          targetId: 'album',
          assetIds: [],
          groupId: 'turn-1',
          createdAt,
          undoneAt: null,
          undoneBy: null,
          canUndo: true,
          canRedo: false,
        },
      ]);

      const result = await call('list_activity');

      expect(search).toHaveBeenCalledWith(ctx.auth, { sessionId: 'session-1', undone: false, limit: 30, offset: 0 });
      expect(JSON.parse(text(result))).toEqual({
        changes: [
          {
            id: 'change-1',
            at: createdAt.toISOString(),
            tool: 'add_to_album',
            summary: 'Added 3 photos to “Trip”',
            groupId: 'turn-1',
            canUndo: true,
          },
        ],
      });
    });

    it('should list every change, the undone ones too', async () => {
      const search = vi.spyOn(ActivityLogService.prototype, 'search').mockResolvedValue([]);

      const result = await call('list_activity', { scope: 'all', includeUndone: true, limit: 5 });

      expect(search).toHaveBeenCalledWith(ctx.auth, { limit: 5, offset: 0 });
      expect(JSON.parse(text(result))).toEqual({ changes: [], message: 'Nothing was changed yet' });
    });
  });

  describe('undo_activity', () => {
    it('should undo a turn as the assistant and report the refusals', async () => {
      const undoAll = vi.spyOn(ActivityLogService.prototype, 'undoAll').mockResolvedValue({
        undone: 1,
        refused: 1,
        results: [
          { id: 'b', summary: 'Placed a photo', status: ActivityUndoStatus.Undone, warnings: [] },
          {
            id: 'a',
            summary: 'Cropped a photo',
            status: ActivityUndoStatus.Refused,
            message: 'The photo is placed in “Sicily” (page 3)',
            warnings: [],
          },
        ],
      });

      const result = await call('undo_activity', { groupId: 'turn-1' });

      expect(undoAll).toHaveBeenCalledWith(ctx.auth, { groupId: 'turn-1' }, ActivityLogSource.Assistant);
      expect(JSON.parse(text(result))).toEqual({
        undone: 1,
        refused: 1,
        results: [
          { id: 'b', summary: 'Placed a photo', status: 'undone' },
          {
            id: 'a',
            summary: 'Cropped a photo',
            status: 'refused',
            message: 'The photo is placed in “Sicily” (page 3)',
          },
        ],
      });
    });

    it('should need ids or a group', async () => {
      const result = await call('undo_activity', {});
      expect(result.isError).toBe(true);
    });
  });
});
