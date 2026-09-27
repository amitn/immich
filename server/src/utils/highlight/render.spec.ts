import { Mock, vitest } from 'vitest';
import { bookStylePresets } from 'src/dtos/book.dto.js';
import { TranscodeHardwareAcceleration } from 'src/enum.js';
import { SOFTWARE_ENCODER, getHighlightEncoder } from 'src/utils/highlight/ffmpeg.js';
import { HighlightPlan } from 'src/utils/highlight/plan.js';
import { HighlightRenderContext, renderHighlight } from 'src/utils/highlight/render.js';

const style = bookStylePresets.classic.style;

const plan = (): HighlightPlan => ({
  fps: 30,
  fade: 0.6,
  durationSeconds: 10.2,
  usedIds: ['photo-1', 'clip-1'],
  chapters: [],
  warnings: [],
  shots: [
    { kind: 'title', duration: 3.6, title: 'Sicily', subtitle: '12 June 2024' },
    {
      kind: 'map',
      chapter: null,
      duration: 3.4,
      title: 'Taormina',
      subtitle: '12 June 2024',
      points: [{ lat: 37.85, lon: 15.28, time: 0 }],
    },
    {
      kind: 'photo',
      assetId: 'photo-1',
      chapter: 0,
      duration: 3,
      frame: 'cover',
      crop: { x: 0, y: 0, width: 1, height: 1 },
      from: { x: 0, y: 0, size: 1 },
      to: { x: 0.1, y: 0.1, size: 0.85 },
      caption: 'Caponata',
    },
    { kind: 'clip', assetId: 'clip-1', chapter: 0, duration: 4, start: 2 },
  ],
});

const context = (overrides: Partial<HighlightRenderContext> = {}) => {
  const media = {
    composeHighlightStill: vitest.fn().mockResolvedValue(undefined),
    runFfmpeg: vitest.fn().mockResolvedValue(undefined) as Mock,
  };
  const ctx: HighlightRenderContext = {
    media,
    writeFile: vitest.fn().mockResolvedValue(undefined),
    workdir: '/tmp/work',
    style,
    photos: new Map([['photo-1', '/photos/1.jpg']]),
    clips: new Map([['clip-1', { input: '/videos/1.mov', width: 1920, height: 1080, hasAudio: true, hdr: true }]]),
    renderMap: vitest.fn().mockResolvedValue(Buffer.from('map')),
    toneMap: 'zscale',
    encoder: SOFTWARE_ENCODER,
    output: '/tmp/film.mp4',
    onProgress: vitest.fn(),
    onWarning: vitest.fn(),
    ...overrides,
  };
  return { ctx, media };
};

const commandOf = (media: { runFfmpeg: Mock }, call: number) => media.runFfmpeg.mock.calls[call][0] as string[];

describe('renderHighlight', () => {
  it('should render every shot as a segment, then join them into the film', async () => {
    const { ctx, media } = context();
    const result = await renderHighlight(plan(), ctx);

    expect(media.composeHighlightStill).toHaveBeenCalledWith(
      expect.objectContaining({ input: '/photos/1.jpg', frame: 'cover', width: 2880, height: 1620 }),
    );
    expect(ctx.renderMap).toHaveBeenCalledWith(expect.objectContaining({ title: 'Taormina' }), {
      width: 2880,
      height: 1620,
    });
    // the title card, the map, the photo's lower third and the map's
    expect(ctx.writeFile).toHaveBeenCalledWith('/tmp/work/0-card.jpg', expect.any(Buffer));
    expect(ctx.writeFile).toHaveBeenCalledWith('/tmp/work/2-caption.png', expect.any(Buffer));
    expect(ctx.writeFile).toHaveBeenCalledWith('/tmp/work/1-caption.png', expect.any(Buffer));

    expect(media.runFfmpeg).toHaveBeenCalledTimes(5);
    const clip = commandOf(media, 3);
    expect(clip).toEqual(expect.arrayContaining(['-ss', '2', '-i', '/videos/1.mov']));
    expect(clip.join(' ')).toContain('tonemap=tonemap=hable');
    const film = commandOf(media, 4);
    expect(film.filter((arg) => arg.endsWith('.mkv'))).toEqual([
      '/tmp/work/000.mkv',
      '/tmp/work/001.mkv',
      '/tmp/work/002.mkv',
      '/tmp/work/003.mkv',
    ]);
    expect(film.at(-1)).toBe('/tmp/film.mp4');

    expect(result).toEqual({ frames: 108 + 102 + 90 + 120 - 3 * 18, durationSeconds: 12.2, shots: 4 });
    expect(ctx.onProgress).toHaveBeenLastCalledWith(1);
  });

  it('should leave out a shot that cannot be rendered', async () => {
    const { ctx, media } = context({ photos: new Map() });
    const result = await renderHighlight(plan(), ctx);
    expect(result.shots).toBe(3);
    expect(ctx.onWarning).toHaveBeenCalledWith(expect.stringContaining('photo photo-1 was left out'));
    expect(media.composeHighlightStill).not.toHaveBeenCalled();
  });

  it('should fail when no shot could be rendered', async () => {
    const { ctx, media } = context();
    media.runFfmpeg.mockRejectedValue(new Error('broken'));
    await expect(renderHighlight(plan(), ctx)).rejects.toThrow('None of the shots could be rendered');
  });

  it('should encode on the CPU when the hardware encoder fails', async () => {
    const encoder = getHighlightEncoder({ accel: TranscodeHardwareAcceleration.Nvenc, preferredHwDevice: 'auto' });
    const { ctx, media } = context({ encoder });
    media.runFfmpeg.mockImplementation((args: string[]) =>
      args.includes('h264_nvenc') ? Promise.reject(new Error('no GPU')) : Promise.resolve(),
    );
    await renderHighlight(plan(), ctx);
    expect(commandOf(media, 5)).toEqual(expect.arrayContaining(['-c:v', 'libx264']));
    expect(ctx.onWarning).toHaveBeenCalledWith(expect.stringContaining('Encoding with h264_nvenc failed'));
  });

  it('should stop when it is cancelled', async () => {
    const controller = new AbortController();
    const { ctx, media } = context({ signal: controller.signal });
    media.runFfmpeg.mockImplementation(() => {
      controller.abort(new Error('Cancelled'));
      return Promise.reject(new Error('killed'));
    });
    await expect(renderHighlight(plan(), ctx)).rejects.toThrow();
    expect(media.runFfmpeg.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
