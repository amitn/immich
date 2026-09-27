import {
  cancelHighlight,
  getAssetInfo,
  getHighlight,
  HighlightJobStatus,
  type HighlightJobResponseDto,
} from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { Route } from '$lib/route';
import { handleError } from '$lib/utils/handle-error';

const TOAST_TIMEOUT = 10_000;
/** the status is polled as well, in case a websocket message is missed */
const POLL_INTERVAL = 3000;
/** a new video is announced once its thumbnail is made, so that its tile shows it, or after this long anyway */
const THUMBNAIL_TIMEOUT = 60_000;
const THUMBNAIL_POLL_INTERVAL = 1500;

export const isHighlightRunning = (job: Pick<HighlightJobResponseDto, 'status'>) =>
  job.status === HighlightJobStatus.Pending || job.status === HighlightJobStatus.Running;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Where the video opens over the page the user is on: in the album it was made from, while its page is open (the
 * video is added to it), or in the Photos timeline, while it is open; undefined on any other page, which is left alone
 */
export const getHighlightViewerRoute = (
  job: Pick<HighlightJobResponseDto, 'albumId'>,
  assetId: string,
  pathname: string,
) => {
  const isOn = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (job.albumId && isOn(Route.viewAlbum({ id: job.albumId }))) {
    return Route.viewAlbumAsset({ albumId: job.albumId, assetId });
  }
  if (isOn(Route.photos())) {
    return Route.viewAsset({ id: assetId });
  }
};

/**
 * The highlight videos being rendered: their progress (see `HighlightProgress`), and when one is done and its thumbnail
 * is made, a toast offers to open it; a video made from this tab opens in the asset viewer over the page the user is
 * on, when that page shows it (its album, or the timeline)
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
      this.#show(job);
      this.#startPolling();
      return;
    }

    void this.#finish(job);
  }

  async cancel(id: string) {
    try {
      this.onUpdate(await cancelHighlight({ id }));
    } catch (error) {
      handleError(error, get(t)('errors.unable_to_cancel_highlight_video'));
    }
  }

  #show(job: HighlightJobResponseDto) {
    const index = this.jobs.findIndex((item) => item.id === job.id);
    if (index === -1) {
      this.jobs.push(job);
    } else {
      this.jobs[index] = job;
    }
  }

  #remove(id: string) {
    this.jobs = this.jobs.filter((item) => item.id !== id);
  }

  async #finish(job: HighlightJobResponseDto) {
    const wasShown = this.jobs.some((item) => item.id === job.id) || this.#openWhenDone.has(job.id);
    this.#finished.add(job.id);
    const openWhenDone = this.#openWhenDone.delete(job.id);
    this.#stopPollingWhenIdle();
    if (!wasShown) {
      this.#remove(job.id);
      return;
    }

    const translate = get(t);
    switch (job.status) {
      case HighlightJobStatus.Completed: {
        const assetId = job.resultAssetId;
        if (!assetId) {
          this.#remove(job.id);
          return;
        }
        // the card stays, as "Preparing the video…", until the tile of the video can show it
        this.#show(job);
        await this.#waitForThumbnail(assetId);
        this.#remove(job.id);

        toastManager.success(
          {
            title: translate('highlight_video_ready'),
            description: job.title,
            button: (close) => ({
              label: translate('open'),
              onclick: async () => {
                close();
                await goto(
                  getHighlightViewerRoute(job, assetId, page.url.pathname) ??
                    (job.albumId
                      ? Route.viewAlbumAsset({ albumId: job.albumId, assetId })
                      : Route.viewAsset({ id: assetId })),
                );
              },
            }),
          },
          { timeout: TOAST_TIMEOUT },
        );
        const route = openWhenDone ? getHighlightViewerRoute(job, assetId, page.url.pathname) : undefined;
        if (route) {
          await goto(route);
        }
        return;
      }
      case HighlightJobStatus.Failed: {
        this.#remove(job.id);
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
        this.#remove(job.id);
        return;
      }
    }
  }

  /** waits until the video has its thumbnail (and a thumbhash), which the server makes right after the video */
  async #waitForThumbnail(assetId: string) {
    const deadline = Date.now() + THUMBNAIL_TIMEOUT;
    while (Date.now() < deadline) {
      try {
        const asset = await getAssetInfo({ id: assetId });
        if (asset.thumbhash) {
          return;
        }
      } catch {
        // not readable yet
      }
      await sleep(THUMBNAIL_POLL_INTERVAL);
    }
  }

  #startPolling() {
    this.#timer ??= setInterval(() => void this.#poll(), POLL_INTERVAL);
  }

  #stopPollingWhenIdle() {
    if (this.jobs.some((job) => !this.#finished.has(job.id))) {
      return;
    }
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #poll() {
    for (const job of this.jobs) {
      // a finished video only waits for its thumbnail
      if (this.#finished.has(job.id)) {
        continue;
      }
      try {
        this.onUpdate(await getHighlight({ id: job.id }));
      } catch {
        // the websocket may still tell
      }
    }
  }
}

export const highlightManager = new HighlightManager();
