import { join } from 'node:path';
import type { BookStyle } from 'src/dtos/book.dto.js';
import { getCardSvg, getLowerThirdSvg, renderCard, renderOverlay } from 'src/utils/highlight/cards.js';
import {
  FfmpegCommand,
  HighlightEncoder,
  SOFTWARE_ENCODER,
  SegmentSpec,
  ToneMapper,
  getFilmCommand,
  getSegmentCommand,
  getStillSize,
  toFfmpegArgs,
} from 'src/utils/highlight/ffmpeg.js';
import {
  HIGHLIGHT_HEIGHT,
  HIGHLIGHT_WIDTH,
  HighlightMapShot,
  HighlightPlan,
  HighlightShot,
  getSafeArea,
} from 'src/utils/highlight/plan.js';

/** the size of the image of a map card; a vertical map keeps its title, compass and scale in the safe band */
export type HighlightMapSize = {
  width: number;
  height: number;
  /** the pixels at the top and bottom of the map that phone apps cover, see `getSafeArea` */
  safeArea?: { top: number; bottom: number };
};

/** what the renderer needs of the media repository */
export type HighlightMedia = {
  composeHighlightStill: (spec: {
    input: string;
    output: string;
    frame: 'cover' | 'contain';
    crop: { x: number; y: number; width: number; height: number };
    width: number;
    height: number;
  }) => Promise<void>;
  runFfmpeg: (
    args: string[],
    options?: { signal?: AbortSignal; onProgress?: (frames: number) => void },
  ) => Promise<void>;
};

export type HighlightClipSource = {
  input: string;
  /** the size of the video as displayed */
  width: number;
  height: number;
  hasAudio: boolean;
  /** HDR (PQ or HLG), tone mapped to SDR */
  hdr: boolean;
};

export type HighlightRenderContext = {
  media: HighlightMedia;
  writeFile: (path: string, data: Buffer) => Promise<void>;
  /** a folder of its own for the stills, cards and segments, which the caller removes */
  workdir: string;
  style: Required<BookStyle>;
  /** the image each photo is drawn from, e.g. its original or its full-size preview */
  photos: Map<string, string>;
  clips: Map<string, HighlightClipSource>;
  /**
   * runs `fn` with a local copy of the image of a photo, e.g. one downloaded from S3 (see `BaseService.withLocalFile`);
   * by default the image is read where it is
   */
  withLocalFile?: <T>(path: string, fn: (localPath: string) => Promise<T>) => Promise<T>;
  /**
   * what ffmpeg reads a clip from, asked right before its segment is rendered: its path, or a short-lived URL of the
   * video in S3 (see `BaseService.getProbeInput`); by default the input of the clip
   */
  getReadableInput?: (input: string) => Promise<string>;
  /** the map of a map card, as an image of the given size */
  renderMap: (shot: HighlightMapShot, size: HighlightMapSize) => Promise<Buffer>;
  /** the filter that tone maps HDR clips, see `MediaRepository.getFfmpegFilters` */
  toneMap: ToneMapper;
  music?: string;
  encoder: HighlightEncoder;
  title?: string;
  output: string;
  signal?: AbortSignal;
  /** the share of the work done, 0..1 */
  onProgress?: (progress: number) => void;
  /** segments rendered at once */
  concurrency?: number;
  /** told when a shot could not be rendered and was left out, or the encoder fell back to the CPU */
  onWarning?: (message: string) => void;
};

/** the share of the work of each step: the stills and cards, the segments, and the film */
const STEPS = { stills: 0.1, segments: 0.55, film: 0.35 };

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw signal.reason ?? new Error('Aborted');
  }
};

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) => {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/** reads a file where it is */
const readInPlace = <T>(path: string, fn: (localPath: string) => Promise<T>) => fn(path);

/** a card holds still: the same square at the start and the end */
const FULL = { x: 0, y: 0, size: 1 };
/** a map zooms in a little, keeping its title, compass and scale in the frame */
const MAP_END = { x: 0.01, y: 0.01, size: 0.98 };
/** the share of the height of a vertical map its lower third takes, above the covered bottom */
const MAP_CAPTION_ROOM = 0.08;

/**
 * Renders a planned highlight video: the stills of the photos, the cards and maps, then every shot as a segment (a few
 * at a time), then the film, joined with crossfades and encoded as MP4 at `output`. A shot that fails (a photo that
 * can't be read) is left out; the film fails when none is left. With a hardware encoder that fails, the film is encoded
 * on the CPU. Aborting `signal` kills ffmpeg and rejects.
 */
export const renderHighlight = async (plan: HighlightPlan, ctx: HighlightRenderContext) => {
  const { fps, fade } = plan;
  const frame = { width: plan.width ?? HIGHLIGHT_WIDTH, height: plan.height ?? HIGHLIGHT_HEIGHT };
  const still = getStillSize(frame);
  const safe = getSafeArea(frame);
  const portrait = safe.top > 0 || safe.bottom > 0;
  // in a vertical film, the route and the scale bar of a map also stay clear of its lower third (its dates)
  const getMapSize = (shot: HighlightMapShot): HighlightMapSize =>
    portrait
      ? {
          ...still,
          safeArea: {
            top: Math.round(safe.top * still.height),
            bottom: Math.round((safe.bottom + (shot.subtitle ? MAP_CAPTION_ROOM : 0)) * still.height),
          },
        }
      : still;
  const frames = (shot: HighlightShot) => Math.max(1, Math.round(shot.duration * fps));
  let progress = 0;
  const report = (value: number) => {
    progress = Math.max(progress, Math.min(1, value));
    ctx.onProgress?.(progress);
  };

  // 1. the stills: the photos, the title cards and the maps, and the lower thirds
  const specs = await mapLimit(plan.shots, 2, async (shot, index): Promise<SegmentSpec | null> => {
    throwIfAborted(ctx.signal);
    const output = join(ctx.workdir, `${String(index).padStart(3, '0')}.mkv`);
    const base = { frames: frames(shot), fps, fade, output, size: frame };
    try {
      let overlay: string | undefined;
      const caption = 'caption' in shot ? shot.caption : shot.kind === 'map' ? shot.subtitle : undefined;
      if (caption) {
        overlay = join(ctx.workdir, `${index}-caption.png`);
        await ctx.writeFile(overlay, await renderOverlay(getLowerThirdSvg(caption, ctx.style, frame)));
      }

      switch (shot.kind) {
        case 'title':
        case 'chapter': {
          const input = join(ctx.workdir, `${index}-card.jpg`);
          const svg = getCardSvg(shot, ctx.style, shot.kind, frame);
          await ctx.writeFile(input, await renderCard(svg));
          return { kind: 'still', input, from: FULL, to: FULL, overlay, ...base };
        }
        case 'map': {
          const input = join(ctx.workdir, `${index}-map.jpg`);
          await ctx.writeFile(input, await ctx.renderMap(shot, getMapSize(shot)));
          return { kind: 'still', input, from: FULL, to: MAP_END, overlay, ...base };
        }
        case 'photo': {
          const source = ctx.photos.get(shot.assetId);
          if (!source) {
            throw new Error('the photo has no image to draw from');
          }
          const input = join(ctx.workdir, `${index}-still.png`);
          await (ctx.withLocalFile ?? readInPlace)(source, (localPath) =>
            ctx.media.composeHighlightStill({
              input: localPath,
              output: input,
              frame: shot.frame,
              crop: shot.crop,
              ...still,
            }),
          );
          return { kind: 'still', input, from: shot.from, to: shot.to, overlay, ...base };
        }
        case 'clip': {
          const source = ctx.clips.get(shot.assetId);
          if (!source) {
            throw new Error('the video is not available');
          }
          return {
            kind: 'clip',
            input: source.input,
            start: shot.start,
            width: source.width,
            height: source.height,
            hasAudio: source.hasAudio,
            toneMap: source.hdr ? ctx.toneMap : null,
            overlay,
            ...base,
          };
        }
      }
    } catch (error: any) {
      if (ctx.signal?.aborted) {
        throw error;
      }
      const name = 'assetId' in shot ? `${shot.kind} ${shot.assetId}` : `${shot.kind} card`;
      ctx.onWarning?.(`The ${name} was left out (${error?.message ?? error})`);
      return null;
    } finally {
      report(progress + STEPS.stills / plan.shots.length);
    }
  });

  // 2. the segments, a few at a time; a shot that fails is left out
  const segmentProgress = new Map<number, number>();
  const segmentFrames = specs.reduce((sum, spec) => sum + (spec?.frames ?? 0), 0) || 1;
  const segmentsDone = () =>
    STEPS.stills + (STEPS.segments * segmentProgress.values().reduce((sum, value) => sum + value, 0)) / segmentFrames;
  const rendered = await mapLimit(specs, ctx.concurrency ?? 3, async (spec, index) => {
    if (!spec) {
      return null;
    }
    throwIfAborted(ctx.signal);
    try {
      const input =
        spec.kind === 'clip' && ctx.getReadableInput
          ? { ...spec, input: await ctx.getReadableInput(spec.input) }
          : spec;
      await ctx.media.runFfmpeg(toFfmpegArgs(getSegmentCommand(input)), {
        signal: ctx.signal,
        onProgress: (done) => {
          segmentProgress.set(index, Math.min(done, spec.frames));
          report(segmentsDone());
        },
      });
      segmentProgress.set(index, spec.frames);
      report(segmentsDone());
      return { path: spec.output, frames: spec.frames };
    } catch (error: any) {
      if (ctx.signal?.aborted) {
        throw error;
      }
      ctx.onWarning?.(`Shot ${index + 1} could not be rendered and was left out (${error?.message ?? error})`);
      return null;
    }
  });

  const segments = rendered.filter((segment): segment is { path: string; frames: number } => !!segment);
  if (segments.length === 0) {
    throw new Error('None of the shots could be rendered');
  }

  // 3. the film
  const film = (encoder: HighlightEncoder): FfmpegCommand =>
    getFilmCommand({ segments, fps, fade, music: ctx.music, encoder, title: ctx.title, output: ctx.output });
  const run = (command: FfmpegCommand) =>
    ctx.media.runFfmpeg(toFfmpegArgs(command), {
      signal: ctx.signal,
      onProgress: (done) => report(STEPS.stills + STEPS.segments + (STEPS.film * done) / command.frames),
    });

  let command = film(ctx.encoder);
  try {
    await run(command);
  } catch (error: any) {
    if (ctx.signal?.aborted || ctx.encoder === SOFTWARE_ENCODER) {
      throw error;
    }
    ctx.onWarning?.(
      `Encoding with ${ctx.encoder.codec} failed (${error?.message ?? error}), so the CPU encodes the film`,
    );
    command = film(SOFTWARE_ENCODER);
    await run(command);
  }
  report(1);

  return { frames: command.frames, durationSeconds: command.frames / fps, shots: segments.length };
};
