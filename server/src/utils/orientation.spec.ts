import {
  DEFAULT_ORIENTATION_OPTIONS,
  ORIENTATION_PROMPTS,
  OrientationFace,
  OrientationPrompts,
  OrientationSource,
  OrientationText,
  Rotation,
  addRotation,
  detectOrientation,
  getClipPosterior,
  getFaceScore,
  getOrientationPromptTexts,
  getOrientationPrompts,
  getTextScore,
  getVerticalText,
} from 'src/utils/orientation.js';

/** unit vectors along the axes of a 4-dimensional space: upright, sideways, upside down, and anything else */
const axis = (index: number, length = 4) => Float32Array.from({ length }, (_, i) => (i === index ? 1 : 0));
const mix = (...parts: Array<[Float32Array, number]>) => {
  const vector = new Float32Array(parts[0][0].length);
  for (const [part, weight] of parts) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] += part[i] * weight;
    }
  }
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
};

const prompts: OrientationPrompts = { upright: axis(0), sideways: axis(1), upsideDown: axis(2) };
const UPRIGHT = mix([axis(0), 0.5], [axis(3), 1]);
const SIDEWAYS = mix([axis(1), 0.5], [axis(3), 1]);
const UPSIDE_DOWN = mix([axis(2), 0.5], [axis(3), 1]);
/** a photo that looks the same every way, e.g. a dish seen from above */
const ANY = mix([axis(0), 0.3], [axis(1), 0.3], [axis(2), 0.3], [axis(3), 1]);

/** a photo CLIP is only fairly sure about */
const WEAK = [0, 1, 2, 1].map((index) => mix([axis(index), 0.012], [axis(3), 1]));

/** the views of a photo stored turned by `stored` from upright */
const views = (stored: Rotation, looks = [UPRIGHT, SIDEWAYS, UPSIDE_DOWN, SIDEWAYS]) =>
  [0, 90, 180, 270].map((rotation) => looks[((stored + rotation) / 90) % 4]);

const face = (overrides: Partial<OrientationFace> = {}): OrientationFace => ({
  x1: 0.4,
  y1: 0.3,
  x2: 0.5,
  y2: 0.5,
  score: 0.9,
  ...overrides,
});

const line = (overrides: Partial<OrientationText> = {}): OrientationText => ({
  x1: 0.1,
  y1: 0.1,
  x2: 0.6,
  y2: 0.1,
  x3: 0.6,
  y3: 0.15,
  x4: 0.1,
  y4: 0.15,
  textScore: 0.95,
  length: 20,
  ...overrides,
});

const source = (
  clip: Float32Array[],
  options: { faces?: OrientationFace[][] | null; text?: OrientationText[][] | null } = {},
): OrientationSource & { calls: string[] } => {
  const calls: string[] = [];
  return {
    width: 1440,
    height: 960,
    calls,
    getClip: (rotation) => {
      calls.push(`clip ${rotation}`);
      return Promise.resolve(clip[rotation / 90]);
    },
    getFaces: (rotation) => {
      calls.push(`faces ${rotation}`);
      return Promise.resolve(options.faces === null ? null : (options.faces?.[rotation / 90] ?? []));
    },
    getText: (rotation) => {
      calls.push(`text ${rotation}`);
      return Promise.resolve(options.text === null ? null : (options.text?.[rotation / 90] ?? []));
    },
  };
};

describe(getOrientationPrompts.name, () => {
  it('should average the prompts of each class', () => {
    const texts = new Map(getOrientationPromptTexts().map((text, i) => [text, axis(i, 6)]));
    const result = getOrientationPrompts(texts);
    expect(ORIENTATION_PROMPTS.upright).toEqual(['a photo']);
    expect(Math.hypot(...result.sideways)).toBeCloseTo(1, 5);
    for (const [i, value] of [0, 1, 1, 1, 0, 0].entries()) {
      expect(result.sideways[i]).toBeCloseTo(value / Math.sqrt(3), 6);
    }
  });

  it('should require every prompt', () => {
    expect(() => getOrientationPrompts({ 'a photo': axis(0) })).toThrow('Missing the text embedding');
  });
});

describe(getClipPosterior.name, () => {
  it.each([0, 90, 180, 270] as Rotation[])('should find the upright view of a photo stored at %i°', (stored) => {
    const posterior = getClipPosterior(views(stored), prompts, 100);
    const best = posterior.indexOf(Math.max(...posterior));
    expect(best * 90).toBe((360 - stored) % 360);
    expect(posterior.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 6);
  });

  it('should not know which way up a photo is that looks the same every way', () => {
    const posterior = getClipPosterior([ANY, ANY, ANY, ANY], prompts, 100);
    for (const p of posterior) {
      expect(p).toBeCloseTo(0.25, 3);
    }
  });
});

describe(getFaceScore.name, () => {
  const size = { width: 1440, height: 960 };

  it('should count upright faces for, and faces on their side against', () => {
    // 144 × 192 px: taller than wide
    expect(getFaceScore([face()], size)).toBe(1);
    // 288 × 96 px: on its side
    expect(getFaceScore([face({ x2: 0.6, y2: 0.4 })], size)).toBe(-0.5);
    expect(getFaceScore([face(), face({ x2: 0.6, y2: 0.4 })], size)).toBe(0.5);
  });

  it('should ignore uncertain faces', () => {
    expect(getFaceScore([face({ score: 0.5 })], size)).toBe(0);
  });
});

describe('text direction', () => {
  const size = { width: 1000, height: 1000 };
  const vertical = line({ x1: 0.1, y1: 0.1, x2: 0.15, y2: 0.1, x3: 0.15, y3: 0.6, x4: 0.1, y4: 0.6 });

  it('should read only the lines that run left to right', () => {
    expect(getTextScore([line(), vertical], size)).toBeCloseTo(19);
  });

  it('should find text that runs up or down', () => {
    expect(getVerticalText([vertical, vertical, line()], size)).toEqual({ count: 3, share: 2 / 3 });
    expect(getVerticalText([], size)).toEqual({ count: 0, share: 0 });
  });
});

describe(detectOrientation.name, () => {
  it('should look no further at a photo that CLIP sees upright as stored', async () => {
    const input = source(views(0, [mix([axis(0), 2], [axis(3), 1]), SIDEWAYS, UPSIDE_DOWN, SIDEWAYS]));
    const result = await detectOrientation(input, prompts);
    expect(result).toMatchObject({ rotate: 0, flagged: false, stage: 'prefilter', requests: 0 });
    expect(input.calls).toEqual(['clip 0', 'faces 0', 'text 0']);
  });

  it('should suggest turning a sideways photo back, confirmed by its faces', async () => {
    const faces = [[], [face()], [], []];
    const input = source(views(270), { faces });
    const result = await detectOrientation(input, prompts);
    expect(result).toMatchObject({ rotate: 90, flagged: true, stage: 'evidence' });
    expect(result.reasons).toEqual([
      expect.stringContaining('CLIP: upright when turned 90°'),
      'faces: upright when turned',
    ]);
    // three views for CLIP, then the faces and text of the candidate
    expect(result.requests).toBe(5);
    expect(input.calls).toEqual([
      'clip 0',
      'faces 0',
      'text 0',
      'clip 90',
      'clip 180',
      'clip 270',
      'faces 90',
      'text 90',
    ]);
  });

  it('should suggest turning an upside-down photo whose text reads when turned', async () => {
    const text = [[], [], [line(), line()], []];
    const result = await detectOrientation(source(views(180), { text }), prompts);
    expect(result).toMatchObject({ rotate: 180, flagged: true });
    expect(result.reasons).toContainEqual(expect.stringContaining('text: reads when turned (38 vs 0 characters)'));
  });

  it('should keep a photo whose text reads as stored, whatever CLIP says', async () => {
    const text = [[line(), line(), line()], [], [], []];
    expect(await detectOrientation(source(views(90, WEAK)), prompts)).toMatchObject({ rotate: 270, flagged: true });

    const result = await detectOrientation(source(views(90, WEAK), { text }), prompts);
    expect(result.flagged).toBe(false);
    expect(result.rotate).toBe(270);
    expect(result.reasons).toContainEqual(expect.stringContaining('text: reads as stored'));
  });

  it('should keep a photo whose faces are upright as stored', async () => {
    const faces = [[face(), face()], [], [], []];
    const result = await detectOrientation(source(views(270, WEAK), { faces }), prompts);
    expect(result).toMatchObject({ rotate: 90, flagged: false });
    expect(result.reasons).toContain('faces: upright as stored');
  });

  it('should not suggest a turn for a photo that looks the same every way', async () => {
    const result = await detectOrientation(source([ANY, ANY, ANY, ANY]), prompts);
    expect(result).toMatchObject({ flagged: false, rotate: 0, stage: 'clip' });
  });

  it('should look closer at a photo whose faces lie on their side, even when CLIP sees it upright', async () => {
    const upright = mix([axis(0), 2], [axis(3), 1]);
    const sideways = face({ x2: 0.6, y2: 0.4 });
    const input = source([upright, SIDEWAYS, UPSIDE_DOWN, SIDEWAYS], { faces: [[sideways], [], [], []] });
    const result = await detectOrientation(input, prompts);
    expect(result.stage).not.toBe('prefilter');
  });

  it('should work without faces and text', async () => {
    const input = source(views(90), { faces: null, text: null });
    const result = await detectOrientation(input, prompts);
    expect(result).toMatchObject({ rotate: 270, flagged: true, requests: 3 });
    expect(input.calls).not.toContain('faces 270');
  });

  it('should suggest only confident turns', async () => {
    const result = await detectOrientation(source(views(90)), prompts, {
      ...DEFAULT_ORIENTATION_OPTIONS,
      confident: 1.01,
    });
    expect(result).toMatchObject({ rotate: 270, flagged: false });
  });
});

describe(addRotation.name, () => {
  const crop = { action: 'crop', parameters: { x: 0, y: 0, width: 10, height: 10 } };
  const mirror = { action: 'mirror', parameters: { axis: 'horizontal' } };

  it('should add a turn after the other edits', () => {
    expect(addRotation([], 90)).toEqual([{ action: 'rotate', parameters: { angle: 90 } }]);
    expect(addRotation([crop, mirror], 270)).toEqual([crop, mirror, { action: 'rotate', parameters: { angle: 270 } }]);
  });

  it('should fold the turn into the turn the photo already has', () => {
    expect(addRotation([crop, { action: 'rotate', parameters: { angle: 90 } }], 90)).toEqual([
      crop,
      { action: 'rotate', parameters: { angle: 180 } },
    ]);
  });

  it('should drop a turn that comes back to 0°', () => {
    expect(addRotation([crop, { action: 'rotate', parameters: { angle: 90 } }], 270)).toEqual([crop]);
  });

  it('should turn the other way when a mirror follows the turn', () => {
    expect(addRotation([{ action: 'rotate', parameters: { angle: 90 } }, mirror], 180)).toEqual([
      { action: 'rotate', parameters: { angle: 270 } },
      mirror,
    ]);
    expect(addRotation([{ action: 'rotate', parameters: { angle: 180 } }, mirror], 90)).toEqual([
      { action: 'rotate', parameters: { angle: 90 } },
      mirror,
    ]);
  });

  it('should undo a fix', () => {
    const fixed = addRotation([crop], 90);
    expect(addRotation(fixed, 270)).toEqual([crop]);
  });
});
