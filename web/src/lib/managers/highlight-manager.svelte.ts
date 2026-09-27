import { cancelHighlight, getHighlight, HighlightJobStatus, type HighlightJobResponseDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { Route } from '$lib/route';
import { handleError } from '$lib/utils/handle-error';

const TOAST_TIMEOUT = 10_000;
/** the status is polled as well, in case a websocket message is missed */
const POLL_INTERVAL = 3000;

export const isHighlightRunning = (job: Pick<HighlightJobResponseDto, 'status'>) =>
  job.status === HighlightJobStatus.Pending || job.status === HighlightJobStatus.Running;

/**
 * The highlight videos being rendered: their progress (see `HighlightProgress`), and when one is done, the video
 * opens in the asset viewer if it was made from this tab, or a toast offers to open it
 */
class HighlightManager {
  jobs = $state<HighlightJobResponseDto[]>([]);
  #openWhenDone = new Set<string>();
  #finished = new Set<string>();
  #timer?: ReturnType<typeof setInterval>;

  /** follows a video started from this tab; it opens once it is ready */
  track(job: HighlightJobResponseDto) {
    this.#openWhenDone.add(job.id);
    this.onUpdate(job);
  }

  onUpdate(job: HighlightJobResponseDto) {
    if (this.#finished.has(job.id)) {
      return;
    }

    if (isHighlightRunning(job)) {
      const index = this.jobs.findIndex((item) => item.id === job.id);
      if (index === -1) {
        this.jobs.push(job);
      } else {
        this.jobs[index] = job;
      }
      this.#startPolling();
      return;
    }

    this.#finish(job);
  }

  async cancel(id: string) {
    try {
      this.onUpdate(await cancelHighlight({ id }));
    } catch (error) {
      handleError(error, get(t)('errors.unable_to_cancel_highlight_video'));
    }
  }

  #finish(job: HighlightJobResponseDto) {
    const wasShown = this.jobs.some((item) => item.id === job.id) || this.#openWhenDone.has(job.id);
    this.#finished.add(job.id);
    this.jobs = this.jobs.filter((item) => item.id !== job.id);
    const openWhenDone = this.#openWhenDone.delete(job.id);
    if (this.jobs.length === 0) {
      this.#stopPolling();
    }
    if (!wasShown) {
      return;
    }

    const translate = get(t);
    switch (job.status) {
      case HighlightJobStatus.Completed: {
        const assetId = job.resultAssetId;
        if (!assetId) {
          return;
        }
        toastManager.success(
          {
            title: translate('highlight_video_ready'),
            description: job.title,
            button: (close) => ({
              label: translate('open'),
              onclick: async () => {
                close();
                await goto(Route.viewAsset({ id: assetId }));
              },
            }),
          },
          { timeout: TOAST_TIMEOUT },
        );
        if (openWhenDone) {
          void goto(Route.viewAsset({ id: assetId }));
        }
        return;
      }
      case HighlightJobStatus.Failed: {
        toastManager.danger(
          { title: translate('highlight_video_failed'), description: job.error || job.title },
          { timeout: TOAST_TIMEOUT },
        );
        return;
      }
      case HighlightJobStatus.Cancelled:
      case HighlightJobStatus.Pending:
      case HighlightJobStatus.Running: {
        // cancelled by the user, who knows
        return;
      }
    }
  }

  #startPolling() {
    this.#timer ??= setInterval(() => void this.#poll(), POLL_INTERVAL);
  }

  #stopPolling() {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #poll() {
    for (const job of this.jobs) {
      try {
        this.onUpdate(await getHighlight({ id: job.id }));
      } catch {
        // the websocket may still tell
      }
    }
  }
}

export const highlightManager = new HighlightManager();
