import { AssetMediaSize, HighlightFormat, type HighlightJobResponseDto } from '@immich/sdk';
import { downloadBlob, downloadUrl, getAssetMediaUrl } from '$lib/utils';

/** the lengths offered for a highlight video, in seconds */
export const HIGHLIGHT_DURATIONS = [30, 60, 90, 120] as const;

/** the shapes offered for a highlight video */
export const HIGHLIGHT_FORMATS = [HighlightFormat.Landscape, HighlightFormat.Vertical] as const;

/** the music picker's value for a silent video */
export const NO_MUSIC = 'none';

/** the audio files the server accepts as music */
export const HIGHLIGHT_MUSIC_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus';

/** the name of the file of a highlight video, like the server names it: `<title>-vertical.mp4` for a vertical one */
export const getHighlightFileName = (job: Pick<HighlightJobResponseDto, 'title' | 'format'>) =>
  `${job.title.replaceAll(/[\\/:*?"<>|]/g, '_').trim() || 'Highlights'}${job.format === HighlightFormat.Vertical ? '-vertical' : ''}.mp4`;

const getVideoUrl = (assetId: string) => getAssetMediaUrl({ id: assetId, size: AssetMediaSize.Original });

/** saves the video to the device */
export const downloadHighlightVideo = (assetId: string, fileName: string) =>
  downloadUrl(getVideoUrl(assetId), fileName);

/** the videos already fetched to be shared, so that a second tap shares at once */
const files = new Map<string, File>();

export type HighlightShareResult = 'shared' | 'downloaded' | 'cancelled' | 'again';

/**
 * Shares the video file (e.g. to a messaging or social app) with the Web Share API where the browser can share files,
 * as on phones; downloads it elsewhere. The file is fetched first: when that took so long that the browser no longer
 * allows sharing (sharing needs a recent tap), the file is kept and `again` asks for another tap.
 */
export const shareHighlightVideo = async (
  assetId: string,
  fileName: string,
  title: string,
): Promise<HighlightShareResult> => {
  // feature detected: browsers without the Web Share API download the file
  // eslint-disable-next-line tscompat/tscompat
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    downloadHighlightVideo(assetId, fileName);
    return 'downloaded';
  }

  let file = files.get(assetId);
  if (!file) {
    const response = await fetch(getVideoUrl(assetId));
    if (!response.ok) {
      throw new Error(`The video could not be loaded (${response.status})`);
    }
    const blob = await response.blob();
    file = new File([blob], fileName, { type: blob.type || 'video/mp4' });
    files.set(assetId, file);
  }

  // eslint-disable-next-line tscompat/tscompat
  if (!navigator.canShare({ files: [file] })) {
    downloadBlob(file, fileName);
    return 'downloaded';
  }

  try {
    // eslint-disable-next-line tscompat/tscompat
    await navigator.share({ files: [file], title });
    files.delete(assetId);
    return 'shared';
  } catch (error) {
    const name = (error as Error)?.name;
    if (name === 'AbortError') {
      return 'cancelled';
    }
    if (name === 'NotAllowedError') {
      return 'again';
    }
    throw error;
  }
};

/** forgets the videos fetched to be shared (for tests) */
export const clearHighlightShareCache = () => files.clear();
