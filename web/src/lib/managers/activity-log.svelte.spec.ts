import { ActivityUndoStatus, type ActivityUndoResponseDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { ActivityLogState, getUndoMessage, toastUndoResult } from '$lib/managers/activity-log.svelte';
import { activityLogFactory } from '@test-data/factories/activity-log-factory';

const response = (...results: ActivityUndoResponseDto['results']): ActivityUndoResponseDto => ({
  results,
  undone: results.filter(({ status }) => status === ActivityUndoStatus.Undone || status === ActivityUndoStatus.Partial)
    .length,
  refused: results.filter(({ status }) => status === ActivityUndoStatus.Refused || status === ActivityUndoStatus.Failed)
    .length,
});

describe('activity log', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(toastManager, 'success').mockImplementation(() => {});
    vi.spyOn(toastManager, 'warning').mockImplementation(() => {});
    vi.spyOn(toastManager, 'info').mockImplementation(() => {});
  });

  describe('toastUndoResult', () => {
    it('should tell that a change was undone, with a redo button', () => {
      const onRedo = vi.fn();
      toastUndoResult(response({ id: 'a', summary: 'A', status: ActivityUndoStatus.Undone, warnings: [] }), onRedo);

      const [[toast, options]] = vi.mocked(toastManager.success).mock.calls;
      expect(toast).toMatchObject({ title: 'activity_log_undone_one' });
      expect(options).toEqual({ timeout: 8000 });
      const close = vi.fn();
      const button = (toast as { button: (close: () => void) => { label: string; onclick: () => void } }).button(close);
      expect(button.label).toBe('activity_log_redo');
      button.onclick();
      expect(close).toHaveBeenCalled();
      expect(onRedo).toHaveBeenCalled();
    });

    it('should warn with the reason when part of an undo was refused', () => {
      toastUndoResult(
        response(
          { id: 'b', summary: 'B', status: ActivityUndoStatus.Undone, warnings: [] },
          { id: 'a', summary: 'A', status: ActivityUndoStatus.Refused, message: 'In a book', warnings: [] },
        ),
      );

      expect(toastManager.warning).toHaveBeenCalledWith(
        { title: 'activity_log_undone_one', description: 'In a book' },
        { timeout: 8000 },
      );
    });

    it('should warn when nothing could be undone', () => {
      toastUndoResult(
        response({ id: 'a', summary: 'A', status: ActivityUndoStatus.Refused, message: 'Album changed', warnings: [] }),
      );

      expect(toastManager.warning).toHaveBeenCalledWith({
        title: 'activity_log_undo_refused',
        description: 'Album changed',
      });
    });

    it('should tell when it was undone already', () => {
      toastUndoResult(
        response({ id: 'a', summary: 'A', status: ActivityUndoStatus.AlreadyUndone, message: 'Undone', warnings: [] }),
      );

      expect(toastManager.info).toHaveBeenCalledWith('activity_log_already_undone');
    });
  });

  it('should find the first reason, skipping changes undone already', () => {
    expect(
      getUndoMessage(
        response(
          { id: 'a', summary: 'A', status: ActivityUndoStatus.AlreadyUndone, message: 'Already', warnings: [] },
          { id: 'b', summary: 'B', status: ActivityUndoStatus.Partial, message: '1 photo kept', warnings: [] },
        ),
      ),
    ).toBe('1 photo kept');
  });

  describe('ActivityLogState', () => {
    it('should keep the result of each change, and refresh another list after an undo', async () => {
      const change = activityLogFactory.build({ id: 'a' });
      sdkMock.getActivityLog.mockResolvedValue([change]);
      const onChange = vi.fn();
      const state = new ActivityLogState(() => ({ sessionId: 'chat' }), { onChange });
      await state.load();
      sdkMock.undoActivities.mockResolvedValue(
        response({ id: 'a', summary: 'A', status: ActivityUndoStatus.Refused, message: 'In a book', warnings: [] }),
      );

      await state.undo({ ids: ['a'] });

      expect(state.results.a).toMatchObject({ status: ActivityUndoStatus.Refused, message: 'In a book' });
      expect(state.busy).toEqual([]);
      expect(onChange).toHaveBeenCalled();
    });

    it('should find the changes of a group, and whether they are busy', async () => {
      sdkMock.getActivityLog.mockResolvedValue([
        activityLogFactory.build({ id: 'a', groupId: 'turn' }),
        activityLogFactory.build({ id: 'b', groupId: 'other' }),
      ]);
      const state = new ActivityLogState();
      await state.load();

      expect(state.group('turn').map(({ id }) => id)).toEqual(['a']);
      expect(state.isBusy(['a'])).toBe(false);
      expect(state.hasMore).toBe(false);
    });
  });
});
