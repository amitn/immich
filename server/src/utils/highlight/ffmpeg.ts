import { TranscodeHardwareAcceleration } from 'src/enum.js';
import { HIGHLIGHT_HEIGHT, HIGHLIGHT_WIDTH, HighlightFrameSize, HighlightRect } from 'src/utils/highlight/plan.js';

/**
 * The ffmpeg commands of a highlight video. Each shot is rendered on its own as a short segment (in parallel): a still
 * (a photo, a title card or a map) moved with `zoompan`, or a clip cut from a video, with its lower third faded in and
 * out and its sound (or silence). The segments are then joined with `xfade` crossfades (and `acrossfade`), the music is
 * mixed in and faded out, and the film is encoded once as H.264/AAC, on the GPU when hardware acceleration is enabled.
 */

export type FfmpegInput = { path: string; options: string[] };

export type FfmpegCommand = {
  inputs: FfmpegInput[];
  filterComplex: string;
  outputOptions: string[];
  output: string;
  /** the frames the command writes, for its progress */
  frames: number;
};

/** the still of a shot is this much larger than the frame, so that its slow zoom stays sharp and smooth */
export const STILL_SCALE = 1.5;
export const STILL_WIDTH = Math.round(HIGHLIGHT_WIDTH * STILL_SCALE);
export const STILL_HEIGHT = Math.round(HIGHLIGHT_HEIGHT * STILL_SCALE);

const LANDSCAPE: HighlightFrameSize = { width: HIGHLIGHT_WIDTH, height: HIGHLIGHT_HEIGHT };

/** the size of the stills of a film whose frame has the given size, see `STILL_SCALE` */
export const getStillSize = (frame: HighlightFrameSize = LANDSCAPE): HighlightFrameSize => ({
  width: Math.round(frame.width * STILL_SCALE),
  height: Math.round(frame.height * STILL_SCALE),
});

const SAMPLE_RATE = 48_000;
/** the lower third fades in after the crossfade into its shot, and out before the one out of it */
const CAPTION_FADE = 0.4;

export type ToneMapper = 'tonemapx' | 'zscale' | null;

export type StillSegment = {
  kind: 'still';
  /** an image with the aspect ratio of the frame */
  input: string;
  frames: number;
  fps: number;
  /** the move, as squares of the still; the same square for a card that doesn't move */
  from: HighlightRect;
  to: HighlightRect;
  /** a transparent PNG laid over the frame, e.g. a lower third */
  overlay?: string;
  fade: number;
  output: string;
  /** the size of the frame, default 1920×1080 */
  size?: HighlightFrameSize;
};

export type ClipSegment = {
  kind: 'clip';
  input: string;
  /** seconds */
  start: number;
  frames: number;
  fps: number;
  /** the size of the video as displayed */
  width: number;
  height: number;
  hasAudio: boolean;
  /** an HDR video is tone mapped to SDR with this filter */
  toneMap?: ToneMapper;
  overlay?: string;
  fade: number;
  output: string;
  /** the size of the frame, default 1920×1080 */
  size?: HighlightFrameSize;
};

export type SegmentSpec = StillSegment | ClipSegment;

const num = (value: number) => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

/** `a + b * on`, the linear move of a value over the frames of a shot */
const lerp = (start: number, end: number, frames: number) => {
  const step = frames > 1 ? (end - start) / (frames - 1) : 0;
  return step === 0 ? num(start) : `(${num(start)}+${num(step)}*on)`;
};

/** the zoompan filter of a move from one square of the still to another, one output frame per frame of the shot */
export const getZoompanFilter = (
  from: HighlightRect,
  to: HighlightRect,
  frames: number,
  fps: number,
  frame: HighlightFrameSize = LANDSCAPE,
) => {
  const size = lerp(from.size, to.size, frames);
  const zoom = size.startsWith('(') ? `1/${size}` : num(1 / from.size);
  return (
    `zoompan=z='${zoom}':x='iw*${lerp(from.x, to.x, frames)}':y='ih*${lerp(from.y, to.y, frames)}'` +
    `:d=${frames}:s=${frame.width}x${frame.height}:fps=${fps}`
  );
};

/** the lower third, faded in after the crossfade into the shot and out before the one out of it */
const getOverlayFilter = (frames: number, fps: number, fade: number) => {
  const duration = frames / fps;
  const fadeIn = Math.min(fade, duration / 4);
  const fadeOut = Math.max(fadeIn + CAPTION_FADE, duration - fade - CAPTION_FADE);
  return (
    `format=rgba,loop=loop=${frames - 1}:size=1,setpts=N/(${fps}*TB),` +
    `fade=t=in:st=${num(fadeIn)}:d=${CAPTION_FADE}:alpha=1,fade=t=out:st=${num(fadeOut)}:d=${CAPTION_FADE}:alpha=1`
  );
};

/** from the RGB frames to the video: BT.709, limited range, 4:2:0 */
const TO_VIDEO = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';

const getToneMapFilter = (toneMap: ToneMapper) => {
  switch (toneMap) {
    case 'tonemapx': {
      return 'tonemapx=tonemap=hable:desat=0:p=bt709:t=bt709:m=bt709:r=tv:peak=100:format=yuv420p,';
    }
    case 'zscale': {
      return 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,';
    }
    default: {
      return '';
    }
  }
};

/**
 * How a clip fills the frame: `cover` when it has the aspect ratio of the frame, or when it is a portrait video in a
 * vertical film (cropped at the sides, like the portrait photos); `contain` (whole, over a blurred copy of itself)
 * otherwise, e.g. a landscape video in a vertical film, whose subject may be anywhere across it
 */
export const getClipFrame = (clip: { width: number; height: number }, frame: HighlightFrameSize = LANDSCAPE) => {
  const frameAspect = frame.width / frame.height;
  const aspect = clip.width > 0 && clip.height > 0 ? clip.width / clip.height : frameAspect;
  if (Math.abs(aspect / frameAspect - 1) < 0.04) {
    return 'cover';
  }
  return frameAspect < 1 && aspect < 1 ? 'cover' : 'contain';
};

/** a clip that covers the frame is cropped to it, centred; any other is shown whole over a blurred copy of itself */
const getClipFitFilter = (width: number, height: number, frame: HighlightFrameSize = LANDSCAPE) => {
  const { width: w, height: h } = frame;
  if (getClipFrame({ width, height }, frame) === 'cover') {
    return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  }
  const small = { width: w / 4, height: h / 4 };
  return (
    `split=2[bg][fg];` +
    `[bg]scale=${small.width}:${small.height}:force_original_aspect_ratio=increase,crop=${small.width}:${small.height},` +
    `boxblur=10:2,scale=${w}:${h},eq=brightness=-0.08[blurred];` +
    `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[whole];` +
    `[blurred][whole]overlay=(W-w)/2:(H-h)/2`
  );
};

/** the encoding of the segments, which are encoded again when they are joined: fast, and close to lossless */
const SEGMENT_OUTPUT = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '16',
  '-pix_fmt',
  'yuv420p',
  '-threads',
  '4',
  '-c:a',
  'pcm_s16le',
  '-ar',
  String(SAMPLE_RATE),
  '-ac',
  '2',
];

/** the command that renders one shot as a segment (Matroska, H.264 and PCM) of exactly `frames` frames */
export const getSegmentCommand = (spec: SegmentSpec): FfmpegCommand => {
  const duration = num(spec.frames / spec.fps);
  const inputs: FfmpegInput[] = [];
  const filters: string[] = [];

  if (spec.kind === 'still') {
    inputs.push({ path: spec.input, options: [] });
    filters.push(
      `[0:v]${getZoompanFilter(spec.from, spec.to, spec.frames, spec.fps, spec.size)},setsar=1,format=gbrp[base]`,
    );
  } else {
    inputs.push({ path: spec.input, options: ['-ss', num(spec.start), '-t', num(spec.frames / spec.fps + 0.5)] });
    filters.push(
      `[0:v]${getToneMapFilter(spec.toneMap ?? null)}${getClipFitFilter(spec.width, spec.height, spec.size)},` +
        `fps=${spec.fps},setsar=1,format=gbrp[base]`,
    );
  }

  if (spec.overlay) {
    inputs.push({ path: spec.overlay, options: [] });
    filters.push(
      `[1:v]${getOverlayFilter(spec.frames, spec.fps, spec.fade)}[caption]`,
      `[base][caption]overlay=0:0:format=gbrp:eof_action=pass,${TO_VIDEO}[v]`,
    );
  } else {
    filters.push(`[base]${TO_VIDEO}[v]`);
  }

  if (spec.kind === 'clip' && spec.hasAudio) {
    const fadeOut = num(Math.max(0, spec.frames / spec.fps - 0.3));
    filters.push(
      `[0:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,apad,atrim=duration=${duration},` +
        `afade=t=in:d=0.25,afade=t=out:st=${fadeOut}:d=0.3[a]`,
    );
  } else {
    filters.push(`anullsrc=r=${SAMPLE_RATE}:cl=stereo,atrim=duration=${duration}[a]`);
  }

  return {
    inputs,
    filterComplex: filters.join(';'),
    outputOptions: ['-map', '[v]', '-map', '[a]', '-frames:v', String(spec.frames), ...SEGMENT_OUTPUT, '-t', duration],
    output: spec.output,
    frames: spec.frames,
  };
};

export type HighlightEncoder = {
  /** e.g. `h264_vaapi`, or libx264 */
  codec: string;
  inputOptions: string[];
  /** appended to the video filters, e.g. to upload the frames to the GPU */
  filter?: string;
  outputOptions: string[];
};

/** the software encoder: fast, and good enough for a film of stills and cuts */
export const SOFTWARE_ENCODER: HighlightEncoder = {
  codec: 'libx264',
  inputOptions: [],
  outputOptions: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p'],
};

/** the render device of VAAPI and QSV, as Immich's transcoding picks it */
export const getRenderDevice = (preferred: string, devices: string[]) => {
  if (preferred !== 'auto') {
    const name = preferred.replace('/dev/dri/', '');
    return devices.includes(name) ? `/dev/dri/${name}` : undefined;
  }
  const render = devices.filter((device) => device.startsWith('renderD')).toSorted();
  return render.length > 0 ? `/dev/dri/${render.at(-1)}` : undefined;
};

/**
 * The H.264 encoder of the film: on the GPU when Immich's video transcoding uses hardware acceleration (NVENC, Quick
 * Sync, VAAPI or RKMPP), otherwise libx264 with the veryfast preset
 */
export const getHighlightEncoder = (
  config: { accel: TranscodeHardwareAcceleration; preferredHwDevice: string },
  devices: string[] = [],
): HighlightEncoder => {
  switch (config.accel) {
    case TranscodeHardwareAcceleration.Nvenc: {
      return {
        codec: 'h264_nvenc',
        inputOptions: [],
        outputOptions: [
          '-c:v',
          'h264_nvenc',
          '-preset',
          'p4',
          '-rc',
          'vbr',
          '-cq',
          '21',
          '-b:v',
          '0',
          '-pix_fmt',
          'yuv420p',
        ],
      };
    }
    case TranscodeHardwareAcceleration.Qsv: {
      const device = getRenderDevice(config.preferredHwDevice, devices);
      return {
        codec: 'h264_qsv',
        inputOptions: [
          '-init_hw_device',
          device ? `qsv=hw,child_device=${device}` : 'qsv=hw',
          '-filter_hw_device',
          'hw',
        ],
        filter: 'format=nv12,hwupload=extra_hw_frames=64',
        outputOptions: ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '21'],
      };
    }
    case TranscodeHardwareAcceleration.Vaapi: {
      const device = getRenderDevice(config.preferredHwDevice, devices);
      if (!device) {
        return SOFTWARE_ENCODER;
      }
      return {
        codec: 'h264_vaapi',
        inputOptions: ['-init_hw_device', `vaapi=accel:${device}`, '-filter_hw_device', 'accel'],
        filter: 'format=nv12,hwupload',
        outputOptions: ['-c:v', 'h264_vaapi', '-rc_mode', 'CQP', '-qp', '21'],
      };
    }
    case TranscodeHardwareAcceleration.Rkmpp: {
      return {
        codec: 'h264_rkmpp',
        inputOptions: [],
        filter: 'format=nv12',
        outputOptions: ['-c:v', 'h264_rkmpp', '-rc_mode', 'CQP', '-qp_init', '21'],
      };
    }
    default: {
      return SOFTWARE_ENCODER;
    }
  }
};

export type FilmSpec = {
  /** the segments, in order, with their frames */
  segments: Array<{ path: string; frames: number }>;
  fps: number;
  /** the crossfade, in seconds */
  fade: number;
  /** the music, looped and cut to the film, faded in and out */
  music?: string;
  encoder: HighlightEncoder;
  title?: string;
  output: string;
};

/** where each crossfade starts: the length of the film so far, less the crossfade */
export const getCrossfadeOffsets = (durations: number[], fade: number) => {
  const offsets: number[] = [];
  let length = durations[0] ?? 0;
  for (const duration of durations.slice(1)) {
    offsets.push(length - fade);
    length += duration - fade;
  }
  return { offsets, length };
};

/** the command that joins the segments with crossfades into the film, with the music, and encodes it as MP4 */
export const getFilmCommand = (spec: FilmSpec): FfmpegCommand => {
  const durations = spec.segments.map((segment) => segment.frames / spec.fps);
  const fadeFrames = Math.round(spec.fade * spec.fps);
  const fade = fadeFrames / spec.fps;
  const { offsets, length } = getCrossfadeOffsets(durations, fade);
  const frames =
    spec.segments.reduce((sum, segment) => sum + segment.frames, 0) - (spec.segments.length - 1) * fadeFrames;
  const total = frames / spec.fps;
  const filters: string[] = [];

  let video = '[0:v]';
  let audio = '[0:a]';
  for (const [index, offset] of offsets.entries()) {
    const next = index + 1;
    filters.push(
      `${video}[${next}:v]xfade=transition=fade:duration=${num(fade)}:offset=${num(offset)}[v${next}]`,
      `${audio}[${next}:a]acrossfade=d=${num(fade)}:c1=tri:c2=tri[a${next}]`,
    );
    video = `[v${next}]`;
    audio = `[a${next}]`;
  }

  // in from black, and out to black at the end
  const fadeOut = Math.min(1.2, total / 4);
  filters.push(
    `${video}fade=t=in:st=0:d=0.5,fade=t=out:st=${num(total - fadeOut)}:d=${num(fadeOut)},` +
      'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv,format=yuv420p' +
      `${spec.encoder.filter ? `,${spec.encoder.filter}` : ''}[video]`,
  );

  const inputs: FfmpegInput[] = spec.segments.map((segment) => ({ path: segment.path, options: [] }));
  inputs[0].options.push(...spec.encoder.inputOptions);
  const audioFadeOut = num(Math.max(0, total - Math.min(3, total / 3)));
  const audioFadeLength = num(Math.min(3, total / 3));
  if (spec.music) {
    const music = inputs.length;
    inputs.push({ path: spec.music, options: ['-stream_loop', '-1'] });
    filters.push(
      `[${music}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,atrim=duration=${num(total)},` +
        `afade=t=in:d=1,afade=t=out:st=${audioFadeOut}:d=${audioFadeLength},volume=0.8[music]`,
      // the sound of the clips stays audible under the music
      `${audio}volume=0.6[sound]`,
      `[sound][music]amix=inputs=2:duration=first:normalize=0,atrim=duration=${num(total)}[audio]`,
    );
  } else {
    filters.push(`${audio}atrim=duration=${num(total)},afade=t=out:st=${audioFadeOut}:d=${audioFadeLength}[audio]`);
  }

  return {
    inputs,
    filterComplex: filters.join(';'),
    outputOptions: [
      '-map',
      '[video]',
      '-map',
      '[audio]',
      ...spec.encoder.outputOptions,
      '-r',
      String(spec.fps),
      '-frames:v',
      String(frames),
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      String(SAMPLE_RATE),
      '-movflags',
      '+faststart',
      ...(spec.title ? ['-metadata', `title=${spec.title}`] : []),
      '-t',
      num(Math.max(total, length)),
    ],
    output: spec.output,
    frames,
  };
};

/** the arguments of an ffmpeg command, e.g. for `spawn`; progress goes to stdout as key=value lines */
export const toFfmpegArgs = (command: FfmpegCommand) => [
  '-hide_banner',
  '-nostdin',
  '-y',
  '-loglevel',
  'error',
  '-progress',
  'pipe:1',
  '-nostats',
  ...command.inputs.flatMap((input) => [...input.options, '-i', input.path]),
  '-filter_complex',
  command.filterComplex,
  ...command.outputOptions,
  command.output,
];
