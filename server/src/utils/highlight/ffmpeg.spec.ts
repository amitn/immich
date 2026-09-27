import { TranscodeHardwareAcceleration } from 'src/enum.js';
import {
  SOFTWARE_ENCODER,
  getCrossfadeOffsets,
  getFilmCommand,
  getHighlightEncoder,
  getRenderDevice,
  getSegmentCommand,
  getZoompanFilter,
  toFfmpegArgs,
} from 'src/utils/highlight/ffmpeg.js';

describe('getZoompanFilter', () => {
  it('should move linearly from one square to the other over the frames', () => {
    const filter = getZoompanFilter({ x: 0, y: 0, size: 1 }, { x: 0.1, y: 0.05, size: 0.8 }, 101, 30);
    expect(filter).toBe(
      "zoompan=z='1/(1+-0.002*on)':x='iw*(0+0.001*on)':y='ih*(0+0.0005*on)':d=101:s=1920x1080:fps=30",
    );
  });

  it('should hold a square that does not move', () => {
    const filter = getZoompanFilter({ x: 0, y: 0, size: 1 }, { x: 0, y: 0, size: 1 }, 75, 30);
    expect(filter).toBe("zoompan=z='1':x='iw*0':y='ih*0':d=75:s=1920x1080:fps=30");
  });
});

describe('getSegmentCommand', () => {
  it('should render a still with its move and silence', () => {
    const command = getSegmentCommand({
      kind: 'still',
      input: '/tmp/still.png',
      frames: 96,
      fps: 30,
      from: { x: 0, y: 0, size: 1 },
      to: { x: 0.1, y: 0.1, size: 0.85 },
      fade: 0.6,
      output: '/tmp/0.mkv',
    });
    expect(command.inputs).toEqual([{ path: '/tmp/still.png', options: [] }]);
    expect(command.filterComplex).toContain('[0:v]zoompan=');
    expect(command.filterComplex).toContain('scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]');
    expect(command.filterComplex).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=3.2[a]');
    expect(command.outputOptions).toEqual(expect.arrayContaining(['-frames:v', '96', '-c:a', 'pcm_s16le']));
    expect(command.frames).toBe(96);
  });

  it('should fade a lower third in and out between the crossfades', () => {
    const command = getSegmentCommand({
      kind: 'still',
      input: '/tmp/still.png',
      frames: 120,
      fps: 30,
      from: { x: 0, y: 0, size: 1 },
      to: { x: 0, y: 0, size: 1 },
      overlay: '/tmp/caption.png',
      fade: 0.6,
      output: '/tmp/0.mkv',
    });
    expect(command.inputs[1]).toEqual({ path: '/tmp/caption.png', options: [] });
    expect(command.filterComplex).toContain('loop=loop=119:size=1');
    expect(command.filterComplex).toContain('fade=t=in:st=0.6:d=0.4:alpha=1,fade=t=out:st=3:d=0.4:alpha=1');
    expect(command.filterComplex).toContain('[base][caption]overlay=0:0:format=gbrp');
  });

  it('should cut a clip with its sound, and seek before decoding', () => {
    const command = getSegmentCommand({
      kind: 'clip',
      input: '/videos/a.mov',
      start: 4.5,
      frames: 120,
      fps: 30,
      width: 1920,
      height: 1080,
      hasAudio: true,
      fade: 0.6,
      output: '/tmp/1.mkv',
    });
    expect(command.inputs[0]).toEqual({ path: '/videos/a.mov', options: ['-ss', '4.5', '-t', '4.5'] });
    expect(command.filterComplex).toContain('crop=1920:1080');
    expect(command.filterComplex).not.toContain('boxblur');
    expect(command.filterComplex).toContain('[0:a]aresample=48000');
    expect(command.filterComplex).toContain('atrim=duration=4');
  });

  it('should show a portrait clip whole over a blurred copy, tone mapped when it is HDR', () => {
    const command = getSegmentCommand({
      kind: 'clip',
      input: '/videos/b.mov',
      start: 0,
      frames: 90,
      fps: 30,
      width: 1080,
      height: 1920,
      hasAudio: false,
      toneMap: 'zscale',
      fade: 0.6,
      output: '/tmp/2.mkv',
    });
    expect(command.filterComplex).toContain('boxblur');
    expect(command.filterComplex).toContain('force_original_aspect_ratio=decrease');
    expect(command.filterComplex).toContain('tonemap=tonemap=hable');
    expect(command.filterComplex).toContain('anullsrc');
  });
});

describe('getCrossfadeOffsets', () => {
  it('should start each crossfade before the end of the film so far', () => {
    expect(getCrossfadeOffsets([4, 3, 5], 0.5)).toEqual({ offsets: [3.5, 6], length: 11 });
  });
});

describe('getFilmCommand', () => {
  const segments = [
    { path: '/tmp/0.mkv', frames: 108 },
    { path: '/tmp/1.mkv', frames: 96 },
    { path: '/tmp/2.mkv', frames: 120 },
  ];

  it('should join the segments with crossfades and encode the film as MP4', () => {
    const command = getFilmCommand({
      segments,
      fps: 30,
      fade: 0.6,
      encoder: SOFTWARE_ENCODER,
      output: '/tmp/film.mp4',
    });
    expect(command.filterComplex).toContain('[0:v][1:v]xfade=transition=fade:duration=0.6:offset=3[v1]');
    expect(command.filterComplex).toContain('[v1][2:v]xfade=transition=fade:duration=0.6:offset=5.6[v2]');
    expect(command.filterComplex).toContain('[0:a][1:a]acrossfade=d=0.6');
    expect(command.frames).toBe(108 + 96 + 120 - 2 * 18);
    expect(command.outputOptions).toEqual(
      expect.arrayContaining(['-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-movflags', '+faststart']),
    );
    expect(command.outputOptions).toEqual(expect.arrayContaining(['-frames:v', '288']));
    expect(command.filterComplex).not.toContain('amix');
  });

  it('should loop the music, fade it out and mix it with the sound of the clips', () => {
    const command = getFilmCommand({
      segments,
      fps: 30,
      fade: 0.6,
      music: '/music/song.mp3',
      encoder: SOFTWARE_ENCODER,
      output: '/tmp/film.mp4',
    });
    expect(command.inputs.at(-1)).toEqual({ path: '/music/song.mp3', options: ['-stream_loop', '-1'] });
    expect(command.filterComplex).toContain('[3:a]aresample=48000');
    expect(command.filterComplex).toContain('afade=t=out:st=6.6:d=3');
    expect(command.filterComplex).toContain('amix=inputs=2:duration=first:normalize=0');
  });

  it('should upload the frames to the GPU for a hardware encoder', () => {
    const encoder = getHighlightEncoder({ accel: TranscodeHardwareAcceleration.Vaapi, preferredHwDevice: 'auto' }, [
      'card0',
      'renderD128',
    ]);
    const command = getFilmCommand({ segments, fps: 30, fade: 0.6, encoder, output: '/tmp/film.mp4' });
    expect(command.inputs[0].options).toEqual([
      '-init_hw_device',
      'vaapi=accel:/dev/dri/renderD128',
      '-filter_hw_device',
      'accel',
    ]);
    expect(command.filterComplex).toContain('format=nv12,hwupload[video]');
    expect(command.outputOptions).toEqual(expect.arrayContaining(['-c:v', 'h264_vaapi']));
  });

  it('should render a single segment without crossfades', () => {
    const command = getFilmCommand({
      segments: [segments[0]],
      fps: 30,
      fade: 0.6,
      encoder: SOFTWARE_ENCODER,
      output: '/tmp/film.mp4',
    });
    expect(command.filterComplex).not.toContain('xfade');
    expect(command.frames).toBe(108);
  });
});

describe('getHighlightEncoder', () => {
  it('should use libx264 without hardware acceleration', () => {
    expect(getHighlightEncoder({ accel: TranscodeHardwareAcceleration.Disabled, preferredHwDevice: 'auto' })).toBe(
      SOFTWARE_ENCODER,
    );
  });

  it.each([
    [TranscodeHardwareAcceleration.Nvenc, 'h264_nvenc'],
    [TranscodeHardwareAcceleration.Qsv, 'h264_qsv'],
    [TranscodeHardwareAcceleration.Rkmpp, 'h264_rkmpp'],
  ])('should encode with %s', (accel, codec) => {
    expect(getHighlightEncoder({ accel, preferredHwDevice: 'auto' }, ['renderD128']).codec).toBe(codec);
  });

  it('should fall back to libx264 when VAAPI has no device', () => {
    expect(getHighlightEncoder({ accel: TranscodeHardwareAcceleration.Vaapi, preferredHwDevice: 'auto' }, [])).toBe(
      SOFTWARE_ENCODER,
    );
  });
});

describe('getRenderDevice', () => {
  it('should pick the last render node, or the preferred one', () => {
    expect(getRenderDevice('auto', ['card0', 'renderD128', 'renderD129'])).toBe('/dev/dri/renderD129');
    expect(getRenderDevice('/dev/dri/renderD128', ['renderD128', 'renderD129'])).toBe('/dev/dri/renderD128');
    expect(getRenderDevice('renderD130', ['renderD128'])).toBeUndefined();
  });
});

describe('toFfmpegArgs', () => {
  it('should put the input options before each input and report progress on stdout', () => {
    const args = toFfmpegArgs({
      inputs: [{ path: 'a.mkv', options: ['-ss', '1'] }],
      filterComplex: '[0:v]null[v]',
      outputOptions: ['-map', '[v]', '-metadata', 'title=Two words'],
      output: 'out.mp4',
      frames: 1,
    });
    expect(args).toEqual([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-loglevel',
      'error',
      '-progress',
      'pipe:1',
      '-nostats',
      '-ss',
      '1',
      '-i',
      'a.mkv',
      '-filter_complex',
      '[0:v]null[v]',
      '-map',
      '[v]',
      '-metadata',
      'title=Two words',
      'out.mp4',
    ]);
  });
});
