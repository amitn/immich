import {
  ActivityUndoStatus,
  getActivityLog,
  redoActivity,
  undoActivities,
  type ActivityLogResponseDto,
  type ActivityUndoResponseDto,
  type ActivityUndoResultDto,
} from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { handleError } from '$lib/utils/handle-error';

export type ActivityLogFilter = Omit<Parameters<typeof getActivityLog>[0], 'limit' | 'offset'>;

export const ACTIVITY_PAGE_SIZE = 100;

const isUndone = ({ status }: ActivityUndoResultDto) =>
  status === ActivityUndoStatus.Undone || status === ActivityUndoStatus.Partial;

/** the first reason a change was not undone, or not all of it */
export const getUndoMessage = (response: ActivityUndoResponseDto) =>
  response.results.find(({ status, message }) => message && status !== ActivityUndoStatus.AlreadyUndone)?.message;

/**
 * Tells the user how an undo went: done, partly done (with the first reason), or refused (with the reason). A single
 * undone change that can be redone gets a Redo button.
 */
export const toastUndoResult = (response: ActivityUndoResponseDto, onRedo?: () => unknown) => {
  const translate = get(t);
  const undone = response.results.filter((result) => isUndone(result)).length;
  const message = getUndoMessage(response);

  if (undone === 0) {
    const already = response.results.every(({ status }) => status === ActivityUndoStatus.AlreadyUndone);
    if (already) {
      toastManager.info(translate('activity_log_already_undone'));
      return;
    }
    toastManager.warning({ title: translate('activity_log_undo_refused'), description: message });
    return;
  }

  const title =
    undone === 1
      ? translate('activity_log_undone_one')
      : translate('activity_log_undone_count', { values: { count: undone } });
  const partial = response.refused > 0 || response.results.some(({ status }) => status === ActivityUndoStatus.Partial);
  if (partial) {
    toastManager.warning({ title, description: message }, { timeout: 8000 });
    return;
  }
  toastManager.success(
    {
      title,
      ...(onRedo && {
        button: (close) => ({
          label: translate('activity_log_redo'),
          onclick: () => {
            close();
            return onRedo();
          },
        }),
      }),
    },
    { timeout: onRedo ? 8000 : 3000 },
  );
};

/**
 * The changes of the activity log for a filter (a chat, a group, or all of them), with undo and redo, and the last
 * undo result of each change, e.g. why it was refused.
 */
export class ActivityLogState {
  items = $state<ActivityLogResponseDto[]>([]);
  results = $state<Record<string, ActivityUndoResultDto>>({});
  loading = $state(false);
  hasMore = $state(false);
  /** changes being undone or redone */
  busy = $state<string[]>([]);

  #filter: () => ActivityLogFilter;
  #onChange?: () => unknown;
  #request = 0;

  /** `onChange` runs after an undo or a redo, e.g. to refresh another list of the same changes */
  constructor(filter: () => ActivityLogFilter = () => ({}), options: { onChange?: () => unknown } = {}) {
    this.#filter = filter;
    this.#onChange = options.onChange;
  }

  /** a lookup, rebuilt whenever the changes are */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  readonly byId = $derived(new Map(this.items.map((item) => [item.id, item])));

  /** the changes of a group (a chat turn) */
  group(groupId: string) {
    return this.items.filter((item) => item.groupId === groupId);
  }

  isBusy(ids: string[]) {
    return ids.some((id) => this.busy.includes(id));
  }

  async load() {
    const request = ++this.#request;
    this.loading = true;
    try {
      const items = await getActivityLog({ ...this.#filter(), limit: ACTIVITY_PAGE_SIZE });
      if (request === this.#request) {
        this.items = items;
        this.hasMore = items.length === ACTIVITY_PAGE_SIZE;
      }
    } catch (error) {
      handleError(error, get(t)('errors.unable_to_load_activity_log'), { notify: false });
    } finally {
      if (request === this.#request) {
        this.loading = false;
      }
    }
  }

  async loadMore() {
    const request = ++this.#request;
    this.loading = true;
    try {
      const items = await getActivityLog({
        ...this.#filter(),
        limit: ACTIVITY_PAGE_SIZE,
        offset: this.items.length,
      });
      if (request === this.#request) {
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const known = new Set(this.items.map(({ id }) => id));
        this.items = [...this.items, ...items.filter(({ id }) => !known.has(id))];
        this.hasMore = items.length === ACTIVITY_PAGE_SIZE;
      }
    } catch (error) {
      handleError(error, get(t)('errors.unable_to_load_activity_log'));
    } finally {
      if (request === this.#request) {
        this.loading = false;
      }
    }
  }

  /** Undoes changes (newest first), or every change of a group; returns the response, or nothing on an error */
  async undo(request: { ids?: string[]; groupId?: string }) {
    const ids = request.ids ?? (request.groupId ? this.group(request.groupId).map(({ id }) => id) : []);
    this.busy = [...this.busy, ...ids];
    try {
      const response = await undoActivities({ activityUndoDto: request });
      const results = { ...this.results };
      for (const result of response.results) {
        results[result.id] = result;
      }
      this.results = results;

      await this.load();
      // one undone change that is simple to apply again gets a Redo button
      const [single] = response.results;
      const canRedo = response.results.length === 1 && isUndone(single) && this.byId.get(single.id)?.canRedo;
      toastUndoResult(response, canRedo ? () => this.redo(single.id) : undefined);
      void this.#onChange?.();
      return response;
    } catch (error) {
      handleError(error, get(t)('errors.unable_to_undo_changes'));
    } finally {
      this.busy = this.busy.filter((id) => !ids.includes(id));
    }
  }

  async redo(id: string) {
    this.busy = [...this.busy, id];
    try {
      const item = await redoActivity({ id });
      this.items = this.items.map((existing) => (existing.id === id ? item : existing));
      const { [id]: _, ...results } = this.results;
      this.results = results;
      toastManager.success(get(t)('activity_log_redone'));
      void this.#onChange?.();
    } catch (error) {
      handleError(error, get(t)('errors.unable_to_redo_change'));
    } finally {
      this.busy = this.busy.filter((existing) => existing !== id);
    }
  }
}
