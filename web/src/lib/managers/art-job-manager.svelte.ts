import { ArtJobStatus, getArtStyles, type ArtJobResponseDto, type ArtStyleDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { Route } from '$lib/route';

const TOAST_TIMEOUT = 10_000;

/** Tells the user when an art job finishes, wherever they are, unless the art dialog already shows it */
class ArtJobManager {
  #watched = new Set<string>();
  #styles?: Promise<ArtStyleDto[]>;

  /** the art dialog shows the result of this job itself; returns a function to stop watching */
  watch(id: string) {
    this.#watched.add(id);
    return () => void this.#watched.delete(id);
  }

  async onUpdate(job: ArtJobResponseDto) {
    const isFinished = job.status === ArtJobStatus.Completed || job.status === ArtJobStatus.Failed;
    if (!isFinished || this.#watched.has(job.id)) {
      return;
    }

    const translate = get(t);
    const resultId = job.status === ArtJobStatus.Completed ? job.resultAssetId : null;
    if (!resultId) {
      toastManager.danger(
        { title: translate('art_failed'), description: job.error || translate('art_failed_no_output') },
        { timeout: TOAST_TIMEOUT },
      );
      return;
    }

    const style = await this.#getStyleName(job.style);
    toastManager.success(
      {
        title: style ? translate('art_ready', { values: { style } }) : translate('art_ready_custom'),
        description: translate('art_done_description'),
        button: (close) => ({
          label: translate('open'),
          onclick: async () => {
            close();
            await goto(Route.viewAsset({ id: resultId }));
          },
        }),
      },
      { timeout: TOAST_TIMEOUT },
    );
  }

  async #getStyleName(id: string | null) {
    if (!id) {
      return;
    }
    this.#styles ??= getArtStyles().catch(() => {
      this.#styles = undefined;
      return [];
    });
    const styles = await this.#styles;
    return styles.find((style) => style.id === id)?.name;
  }
}

export const artJobManager = new ArtJobManager();
