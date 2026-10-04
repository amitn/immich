export const enhanceStrengths = ['subtle', 'normal', 'strong'] as const;
export type EnhanceStrength = (typeof enhanceStrengths)[number];

/** in the order they are applied */
export const enhanceCorrectionTypes = [
  'denoise',
  'whiteBalance',
  'levels',
  'exposure',
  'localContrast',
  'saturation',
  'sharpen',
] as const;
export type EnhanceCorrectionType = (typeof enhanceCorrectionTypes)[number];

type Rgb = { r: number; g: number; b: number };

/** Statistics of an 8-bit sRGB image, usually a downscaled sample of the photo */
export type ImageStats = {
  width: number;
  height: number;
  /** 256-bin histograms (pixel counts) of each channel and of the luma */
  histogram: { r: number[]; g: number[]; b: number[]; luma: number[] };
  /** mean of each channel, 0..255 */
  mean: Rgb;
  /** standard deviation of each channel, 0..255 */
  std: Rgb;
  lumaMean: number;
  lumaStd: number;
  /** mean colour of the pixels that are not strongly coloured, which a neutral scene averages to grey */
  neutralMean: Rgb;
  /** fraction of the pixels that went into `neutralMean` */
  neutralFraction: number;
  /** mean colour of the brightest unclipped, not strongly coloured pixels (white patch), if there are enough */
  highlightMean: Rgb | null;
  /** mean HSV saturation, 0..1 */
  saturation: number;
  /** fraction of all pixels that are strongly coloured (and not too dark), in 12 hue bins of 30° starting at red */
  hueHistogram: number[];
  /** fraction of the pixels that look like skin */
  skinFraction: number;
  /** variance of the 3x3 Laplacian of the luma; low values mean a soft image */
  sharpness: number;
  /** Immerkær's estimate of the noise standard deviation of the luma, 0..255 */
  noise: number;
};

export type EnhancePlan = {
  /** stretch of the tonal range: `black` becomes 0 and `white` becomes 255 (after white balance) */
  levels?: { black: number; white: number };
  /** per-channel multipliers */
  whiteBalance?: Rgb;
  /** gamma correction, `out = in ^ (1 / gamma)`: above 1 brightens the midtones, below 1 darkens them */
  exposure?: { gamma: number };
  /** contrast-limited adaptive histogram equalization of the luma, blended in by `amount` */
  localContrast?: { grid: number; clipLimit: number; amount: number };
  /** chroma multiplier */
  saturation?: { factor: number };
  /** unsharp mask, see sharp's `sharpen()` */
  sharpen?: { sigma: number; m1: number; m2: number };
  /** median filter size */
  denoise?: { size: number };
};

export type EnhanceCorrection = {
  type: EnhanceCorrectionType;
  /** how strong the correction is, 0..1 */
  amount: number;
  /** what the correction does, e.g. "Brighter midtones (gamma 1.3)" */
  description: string;
  /** why it is applied */
  reason: string;
};

export type EnhanceAnalysis = {
  strength: EnhanceStrength;
  plan: EnhancePlan;
  corrections: EnhanceCorrection[];
  /** the descriptions of the corrections */
  adjustments: string[];
  /** corrections that were considered and skipped, and why */
  notes: string[];
};

export type EnhanceOptions = {
  strength?: EnhanceStrength;
  /** only consider these corrections */
  only?: EnhanceCorrectionType[];
  /** long edge of the image the plan is applied to, which scales the sharpening radius */
  outputSize?: number;
  /** ISO speed of the photo, from EXIF */
  iso?: number | null;
};

const STRENGTHS = {
  subtle: {
    mix: 0.5,
    maxStretch: 1.3,
    maxCast: 0.06,
    maxGamma: 1.2,
    minGamma: 0.93,
    clipLimit: 2,
    localContrast: 0.35,
    maxSaturation: 1.05,
    sharpen: 0.8,
    denoiseIso: 6400,
  },
  normal: {
    mix: 0.8,
    maxStretch: 1.6,
    maxCast: 0.12,
    maxGamma: 1.4,
    minGamma: 0.87,
    clipLimit: 2.5,
    localContrast: 0.55,
    maxSaturation: 1.1,
    sharpen: 1.2,
    denoiseIso: 3200,
  },
  strong: {
    mix: 1,
    maxStretch: 2,
    maxCast: 0.2,
    maxGamma: 1.65,
    minGamma: 0.8,
    clipLimit: 3,
    localContrast: 0.75,
    maxSaturation: 1.18,
    sharpen: 1.8,
    denoiseIso: 1600,
  },
} satisfies Record<EnhanceStrength, unknown>;

type Settings = (typeof STRENGTHS)['normal'];

/** clipped at each end of the histogram by auto levels */
const LEVELS_CLIP = 0.005;
const TARGET_MEDIAN = 0.45;
const UNDEREXPOSED_MEDIAN = 0.32;
const OVEREXPOSED_MEDIAN = 0.68;
const HIGH_KEY_MEDIAN = 0.6;
const FLAT_STD = 0.13;
const MIN_CAST = 0.03;
const DOMINANT_COLOR = 0.3;
const SOFT_SHARPNESS = 100;
const NOISY = 8;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
const percent = (value: number) => `${Math.round(value * 100)}%`;

export const toLuma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Computes the statistics of an 8-bit image with 1 to 4 channels (alpha is ignored). */
export const computeImageStats = (data: Uint8Array, width: number, height: number, channels: number): ImageStats => {
  const pixels = width * height;
  const histogram = {
    r: Array.from({ length: 256 }, () => 0),
    g: Array.from({ length: 256 }, () => 0),
    b: Array.from({ length: 256 }, () => 0),
    luma: Array.from({ length: 256 }, () => 0),
  };
  const hueHistogram = Array.from({ length: 12 }, () => 0);
  const sum = { r: 0, g: 0, b: 0 };
  const squares = { r: 0, g: 0, b: 0 };
  const neutral = { r: 0, g: 0, b: 0 };
  let neutralCount = 0;
  let lumaSum = 0;
  let lumaSquares = 0;
  let saturationSum = 0;
  let skin = 0;
  const luma = new Float32Array(pixels);
  const color = channels >= 3;

  for (let i = 0, offset = 0; i < pixels; i++, offset += channels) {
    const r = data[offset];
    const g = color ? data[offset + 1] : r;
    const b = color ? data[offset + 2] : r;
    const y = toLuma(r, g, b);
    luma[i] = y;

    histogram.r[r]++;
    histogram.g[g]++;
    histogram.b[b]++;
    histogram.luma[Math.round(y)]++;
    sum.r += r;
    sum.g += g;
    sum.b += b;
    squares.r += r * r;
    squares.g += g * g;
    squares.b += b * b;
    lumaSum += y;
    lumaSquares += y * y;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    saturationSum += saturation;

    if (y >= 25 && y <= 245 && saturation < 0.35) {
      neutral.r += r;
      neutral.g += g;
      neutral.b += b;
      neutralCount++;
    }

    if (saturation >= 0.4 && max >= 40) {
      hueHistogram[Math.floor(hueOf(r, g, b) / 30) % 12]++;
    }

    // Kovač et al. skin rule for daylight
    if (r > 95 && g > 40 && b > 20 && max - min > 15 && r - g > 15 && r > b) {
      skin++;
    }
  }

  const mean = { r: sum.r / pixels, g: sum.g / pixels, b: sum.b / pixels };
  const lumaMean = lumaSum / pixels;

  const bright = Math.max(percentile(histogram.luma, 0.95), 64);
  const highlight = { r: 0, g: 0, b: 0 };
  let highlightCount = 0;
  for (let i = 0, offset = 0; i < pixels; i++, offset += channels) {
    const r = data[offset];
    const g = color ? data[offset + 1] : r;
    const b = color ? data[offset + 2] : r;
    const max = Math.max(r, g, b);
    if (!(luma[i] >= bright && max < 250 && (max - Math.min(r, g, b)) / max < 0.35)) {
      continue;
    }

    highlight.r += r;
    highlight.g += g;
    highlight.b += b;
    highlightCount++;
  }

  return {
    width,
    height,
    histogram,
    mean,
    std: {
      r: Math.sqrt(Math.max(0, squares.r / pixels - mean.r ** 2)),
      g: Math.sqrt(Math.max(0, squares.g / pixels - mean.g ** 2)),
      b: Math.sqrt(Math.max(0, squares.b / pixels - mean.b ** 2)),
    },
    lumaMean,
    lumaStd: Math.sqrt(Math.max(0, lumaSquares / pixels - lumaMean ** 2)),
    neutralMean:
      neutralCount > 0
        ? { r: neutral.r / neutralCount, g: neutral.g / neutralCount, b: neutral.b / neutralCount }
        : { ...mean },
    neutralFraction: neutralCount / pixels,
    highlightMean:
      highlightCount >= pixels * 0.005
        ? { r: highlight.r / highlightCount, g: highlight.g / highlightCount, b: highlight.b / highlightCount }
        : null,
    saturation: saturationSum / pixels,
    hueHistogram: hueHistogram.map((count) => count / pixels),
    skinFraction: skin / pixels,
    ...measureDetail(luma, width, height),
  };
};

/** hue in degrees, 0..360 */
const hueOf = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) {
    return 0;
  }
  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  return (hue * 60 + 360) % 360;
};

const measureDetail = (luma: Float32Array, width: number, height: number) => {
  if (width < 3 || height < 3) {
    return { sharpness: 0, noise: 0 };
  }

  let sum = 0;
  let squares = 0;
  let absolute = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const [n, s, w, e] = [luma[i - width], luma[i + width], luma[i - 1], luma[i + 1]];
      const laplacian = n + s + w + e - 4 * luma[i];
      sum += laplacian;
      squares += laplacian * laplacian;
      // Immerkær's noise mask [1 -2 1; -2 4 -2; 1 -2 1]
      const corners = luma[i - width - 1] + luma[i - width + 1] + luma[i + width - 1] + luma[i + width + 1];
      absolute += Math.abs(corners - 2 * (n + s + w + e) + 4 * luma[i]);
    }
  }

  const count = (width - 2) * (height - 2);
  return {
    sharpness: squares / count - (sum / count) ** 2,
    noise: (Math.sqrt(Math.PI / 2) * absolute) / (6 * count),
  };
};

/** the smallest value with at least `fraction` of the pixels at or below it */
export const percentile = (histogram: number[], fraction: number) => {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  const target = fraction * total;
  let cumulative = 0;
  for (const [value, count] of histogram.entries()) {
    cumulative += count;
    if (cumulative >= target && cumulative > 0) {
      return value;
    }
  }
  return histogram.length - 1;
};

const fractionAbove = (histogram: number[], value: number) => {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  const above = histogram.slice(value).reduce((sum, count) => sum + count, 0);
  return total > 0 ? above / total : 0;
};

const CAST_NAMES = [
  'red',
  'orange',
  'yellow',
  'green',
  'green',
  'cyan',
  'cyan',
  'blue',
  'blue',
  'purple',
  'magenta',
  'pink',
];

/** the most common colour of the colourful pixels, as the fraction of all pixels within 60° of hue */
const getDominantColor = (hueHistogram: number[]) => {
  let best = { fraction: 0, hue: 0 };
  for (let bin = 0; bin < hueHistogram.length; bin++) {
    const fraction = hueHistogram[bin] + hueHistogram[(bin + 1) % hueHistogram.length];
    if (fraction > best.fraction) {
      best = { fraction, hue: (bin + 1) * 30 };
    }
  }
  return best;
};

const hueDistance = (a: number, b: number) => {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
};

/** multipliers that turn a colour gray, normalized so that the luma is unchanged */
const getNeutralGains = (color: Rgb): Rgb => {
  const { r, g, b } = { r: Math.max(color.r, 1), g: Math.max(color.g, 1), b: Math.max(color.b, 1) };
  const gray = (r + g + b) / 3;
  const scale = toLuma(gray / r, gray / g, gray / b);
  return { r: gray / r / scale, g: gray / g / scale, b: gray / b / scale };
};

const getCast = ({ r, g, b }: Rgb) => Math.max(Math.abs(r - 1), Math.abs(g - 1), Math.abs(b - 1));

/** cosine similarity of the corrections of two sets of gains */
const getAgreement = (a: Rgb, b: Rgb) => {
  const [x, y] = [a, b].map(({ r, g, b }) => [r - 1, g - 1, b - 1]);
  const dot = x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  return dot / (Math.hypot(...x) * Math.hypot(...y) || 1);
};

/** gray world on the neutral tones, checked against the white patch of the highlights */
const planWhiteBalance = (stats: ImageStats, settings: Settings, notes: string[]) => {
  const reference = stats.neutralFraction >= 0.05 ? stats.neutralMean : stats.mean;
  let full = getNeutralGains(reference);
  const cast = getCast(full);

  if (cast < MIN_CAST) {
    notes.push('White balance: the colors are already neutral');
    return;
  }

  const { r, g, b } = reference;
  const castHue = hueOf(r, g, b);
  const castName = CAST_NAMES[Math.round(castHue / 30) % 12];
  const dominant = getDominantColor(stats.hueHistogram);
  let factor = settings.mix;
  let reason = `the neutral tones have a ${castName} cast`;

  if (dominant.fraction >= DOMINANT_COLOR) {
    if (hueDistance(dominant.hue, castHue) <= 45) {
      notes.push(
        `White balance: left alone, the ${castName} tint comes from the scene (${percent(dominant.fraction)} of the photo is ${castName}), such as a sunset or foliage`,
      );
      return;
    }
    factor *= 0.5;
    reason += `; reduced because one color dominates the scene`;
  }

  if (stats.neutralFraction < 0.05) {
    factor *= 0.5;
    reason += '; reduced because there are few neutral tones to judge by';
  }

  // cooling down a warm photo quickly makes skin look pale
  if (castHue < 60 && stats.skinFraction >= 0.1) {
    factor *= 0.5;
    reason += '; reduced to keep skin tones warm';
  }

  if (stats.highlightMean) {
    const patch = getNeutralGains(stats.highlightMean);
    if (getCast(patch) < MIN_CAST / 2 || getAgreement(full, patch) < 0.5) {
      notes.push(`White balance: left alone, the highlights do not share the ${castName} tint of the midtones`);
      return;
    }
    if (getCast(patch) < cast) {
      full = patch;
    }
    reason += ' and the highlights';
  } else {
    factor *= 0.5;
    reason += '; reduced because there are no neutral highlights to confirm it';
  }

  const limit = settings.maxCast;
  const adjust = (gain: number) => round(clamp(1 + (gain - 1) * factor, 1 - limit, 1 + limit));
  const whiteBalance = { r: adjust(full.r), g: adjust(full.g), b: adjust(full.b) };
  const applied = Math.max(...Object.values(whiteBalance).map((gain) => Math.abs(gain - 1)));
  if (applied < 0.01) {
    notes.push(`White balance: the ${castName} cast is too small to correct at this strength`);
    return;
  }

  return {
    whiteBalance,
    correction: {
      type: 'whiteBalance' as const,
      amount: round(clamp(applied / 0.2), 2),
      description: `Neutralized ${/^[aeiou]/.test(castName) ? 'an' : 'a'} ${castName} color cast (R ×${whiteBalance.r}, G ×${whiteBalance.g}, B ×${whiteBalance.b})`,
      reason,
    },
  };
};

const planLevels = (stats: ImageStats, gains: Rgb, settings: Settings, notes: string[]) => {
  const { histogram } = stats;
  const low = Math.min(
    percentile(histogram.r, LEVELS_CLIP) * gains.r,
    percentile(histogram.g, LEVELS_CLIP) * gains.g,
    percentile(histogram.b, LEVELS_CLIP) * gains.b,
  );
  const high = Math.max(
    percentile(histogram.r, 1 - LEVELS_CLIP) * gains.r,
    percentile(histogram.g, 1 - LEVELS_CLIP) * gains.g,
    percentile(histogram.b, 1 - LEVELS_CLIP) * gains.b,
  );
  const median = percentile(histogram.luma, 0.5) / 255;
  const highKey = median >= HIGH_KEY_MEDIAN;

  let black = low;
  // stretching the highlights of a bright scene would clip them
  let white = highKey ? Math.max(high, 255) : high;
  if ((black < 5 && white > 250) || white - black > 245) {
    notes.push('Levels: the photo already uses the full tonal range');
    return;
  }

  const stretch = 255 / Math.max(white - black, 1);
  let reason = `the tones span only ${Math.round(black)}–${Math.round(Math.min(white, 255))} of 0–255`;
  if (stretch > settings.maxStretch) {
    const range = 255 / settings.maxStretch;
    const center = (black + white) / 2;
    black = clamp(center - range / 2, 0, 255 - range);
    white = black + range;
    reason += '; the stretch is limited to avoid posterization';
  }
  if (highKey) {
    reason += '; the highlights of this bright photo are kept';
  }

  black = round(black * settings.mix, 1);
  white = round(white > 255 ? white : 255 - (255 - white) * settings.mix, 1);
  if (black < 2 && white > 253) {
    notes.push('Levels: the change would be too small at this strength');
    return;
  }

  return {
    levels: { black, white },
    correction: {
      type: 'levels' as const,
      amount: round(clamp(1 - (Math.min(white, 255) - black) / 255), 2),
      description: `Auto levels (black point ${Math.round(black)}, white point ${Math.round(Math.min(white, 255))})`,
      reason,
    },
  };
};

const planExposure = (
  stats: ImageStats,
  levels: { black: number; white: number },
  settings: Settings,
  notes: string[],
) => {
  const { histogram } = stats;
  const median = percentile(histogram.luma, 0.5);
  const adjusted = clamp((median - levels.black) / (levels.white - levels.black), 0.02, 0.98);

  if (adjusted < UNDEREXPOSED_MEDIAN) {
    let gamma = Math.log(adjusted) / Math.log(TARGET_MEDIAN);
    let reason = `the photo is underexposed (median brightness ${percent(adjusted)})`;
    // a dark scene with bright lights, e.g. at night, is meant to be dark
    if (adjusted < 0.25 && fractionAbove(histogram.luma, 180) >= 0.03) {
      gamma = 1 + (gamma - 1) * 0.5;
      reason += '; limited because the bright highlights suggest a night or low-key scene';
    } else if (fractionAbove(histogram.luma, 200) >= 0.08) {
      gamma = 1 + (gamma - 1) * 0.5;
      reason += '; limited because the bright areas are already well exposed';
    }
    gamma = round(clamp(1 + (gamma - 1) * settings.mix, 1, settings.maxGamma), 2);
    if (gamma >= 1.03) {
      return {
        exposure: { gamma },
        correction: {
          type: 'exposure' as const,
          amount: round(clamp((gamma - 1) / 0.8), 2),
          description: `Brighter midtones (gamma ${gamma})`,
          reason,
        },
      };
    }
  } else if (adjusted > OVEREXPOSED_MEDIAN) {
    let gamma = Math.log(adjusted) / Math.log(TARGET_MEDIAN + 0.1);
    let reason = `the photo is overexposed (median brightness ${percent(adjusted)})`;
    const highKey = median / 255 >= HIGH_KEY_MEDIAN && fractionAbove(histogram.luma, 250) < 0.02;
    if (highKey) {
      gamma = 1 - (1 - gamma) * 0.5;
      reason += '; limited because it looks like a bright, high-key scene';
    }
    // recover gently: darkening looks muddy quickly
    gamma = round(clamp(1 - (1 - gamma) * settings.mix * 0.6, settings.minGamma, 1), 2);
    if (gamma <= 0.97) {
      return {
        exposure: { gamma },
        correction: {
          type: 'exposure' as const,
          amount: round(clamp((1 - gamma) / 0.2), 2),
          description: `Darker midtones (gamma ${gamma})`,
          reason,
        },
      };
    }
  }

  notes.push(`Exposure: the brightness is fine (median ${percent(adjusted)})`);
};

const planLocalContrast = (
  stats: ImageStats,
  levels: { black: number; white: number },
  settings: Settings,
  notes: string[],
) => {
  if (stats.lumaStd < 2) {
    notes.push('Local contrast: the photo is almost uniform, equalizing it would only amplify noise');
    return;
  }

  const contrast = stats.lumaStd / Math.max(levels.white - levels.black, 1);
  if (contrast >= FLAT_STD) {
    notes.push(`Local contrast: the contrast is fine (${percent(contrast)})`);
    return;
  }

  const amount = round(clamp((FLAT_STD - contrast) / 0.06, 0.3, 1) * settings.localContrast, 2);
  return {
    localContrast: { grid: 8, clipLimit: settings.clipLimit, amount },
    correction: {
      type: 'localContrast' as const,
      amount,
      description: 'More local contrast (CLAHE)',
      reason: `the photo looks flat (contrast ${percent(contrast)})`,
    },
  };
};

const planSaturation = (stats: ImageStats, settings: Settings, notes: string[]) => {
  if (stats.saturation < 0.04) {
    notes.push('Saturation: left alone, the photo is (almost) black and white');
    return;
  }

  let boost = (settings.maxSaturation - 1) * clamp((0.42 - stats.saturation) / 0.22);
  let reason = `the colors are muted (saturation ${percent(stats.saturation)})`;
  if (stats.skinFraction >= 0.3) {
    boost *= 0.5;
    reason += '; halved to keep skin tones natural';
  }

  const factor = round(1 + boost, 2);
  if (factor < 1.02) {
    notes.push(`Saturation: the colors are already vivid enough (saturation ${percent(stats.saturation)})`);
    return;
  }

  return {
    saturation: { factor },
    correction: {
      type: 'saturation' as const,
      amount: round(clamp(boost / 0.18), 2),
      description: `More vivid colors (+${Math.round(boost * 100)}% saturation)`,
      reason,
    },
  };
};

const planDenoise = (iso: number | null | undefined, settings: Settings) => {
  // the noise estimate of a downscaled copy cannot tell noise from fine texture, so only trust the ISO
  if (!iso || iso < settings.denoiseIso) {
    return;
  }

  return {
    denoise: { size: 3 },
    correction: {
      type: 'denoise' as const,
      amount: 0.5,
      description: 'Light noise reduction (3×3 median)',
      reason: `the photo was taken at ISO ${iso}`,
    },
  };
};

const planSharpen = (
  stats: ImageStats,
  { outputSize, denoised, finishing }: { outputSize: number; denoised: boolean; finishing: boolean },
  settings: Settings,
  notes: string[],
) => {
  const soft = stats.sharpness < SOFT_SHARPNESS;
  if (!soft && !finishing) {
    notes.push('Sharpening: the photo is sharp enough');
    return;
  }

  const sigma = round(clamp(0.5 + outputSize / 8000, 0.5, 1.5), 2);
  const m2 = round(settings.sharpen * (soft ? 1.25 : 1), 2);
  // leave flat areas alone in noisy photos so that the noise is not amplified
  const m1 = denoised || stats.noise >= NOISY ? 0 : round(m2 * 0.25, 2);
  return {
    sharpen: { sigma, m1, m2 },
    correction: {
      type: 'sharpen' as const,
      amount: round(clamp(m2 / 2.25), 2),
      description: soft ? 'Sharpened soft details' : 'Light output sharpening',
      reason: soft ? 'the photo looks slightly soft' : 'to restore crispness after the tonal corrections',
    },
  };
};

/**
 * Decides which automatic corrections a photo needs, from the statistics of a downscaled copy.
 * Deterministic: the same statistics and options always give the same plan.
 */
export const planEnhancement = (stats: ImageStats, options: EnhanceOptions = {}): EnhanceAnalysis => {
  const strength = options.strength ?? 'normal';
  const settings = STRENGTHS[strength];
  const allowed = new Set<EnhanceCorrectionType>(options.only?.length ? options.only : enhanceCorrectionTypes);
  const plan: EnhancePlan = {};
  const corrections: EnhanceCorrection[] = [];
  const notes: string[] = [];

  const add = (result?: Partial<EnhancePlan> & { correction: EnhanceCorrection }) => {
    if (!result) {
      return;
    }

    const { correction, ...entry } = result;
    Object.assign(plan, entry);
    corrections.push(correction);
  };

  if (allowed.has('denoise')) {
    add(planDenoise(options.iso, settings));
  }

  if (allowed.has('whiteBalance')) {
    add(planWhiteBalance(stats, settings, notes));
  }

  if (allowed.has('levels')) {
    add(planLevels(stats, plan.whiteBalance ?? { r: 1, g: 1, b: 1 }, settings, notes));
  }

  const levels = plan.levels ?? { black: 0, white: 255 };
  if (allowed.has('exposure')) {
    add(planExposure(stats, levels, settings, notes));
  }

  if (allowed.has('localContrast')) {
    add(planLocalContrast(stats, levels, settings, notes));
  }

  if (allowed.has('saturation')) {
    add(planSaturation(stats, settings, notes));
  }

  if (allowed.has('sharpen')) {
    const outputSize = options.outputSize ?? Math.max(stats.width, stats.height);
    const finishing = corrections.some(({ type }) => type !== 'denoise');
    add(planSharpen(stats, { outputSize, denoised: !!plan.denoise, finishing }, settings, notes));
  }

  corrections.sort((a, b) => enhanceCorrectionTypes.indexOf(a.type) - enhanceCorrectionTypes.indexOf(b.type));

  return { strength, plan, corrections, adjustments: corrections.map(({ description }) => description), notes };
};

/** the `a * x + b` coefficients per channel that apply the white balance and levels of a plan to 8-bit values */
export const getLinearCoefficients = ({ levels, whiteBalance }: EnhancePlan) => {
  const { black, white } = levels ?? { black: 0, white: 255 };
  const gains = whiteBalance ?? { r: 1, g: 1, b: 1 };
  const scale = 255 / Math.max(white - black, 1);
  return {
    a: [gains.r * scale, gains.g * scale, gains.b * scale],
    b: [-black * scale, -black * scale, -black * scale],
  };
};

export type ClaheLuts = { columns: number; rows: number; luts: Uint8Array };

/** Contrast-limited histogram equalization lookup tables for a grid of tiles over an 8-bit luma image */
export const computeClaheLuts = (
  luma: Uint8Array,
  width: number,
  height: number,
  { grid, clipLimit }: { grid: number; clipLimit: number },
): ClaheLuts => {
  const columns = Math.max(1, Math.min(grid, width));
  const rows = Math.max(1, Math.min(grid, height));
  const luts = new Uint8Array(columns * rows * 256);
  const histogram = new Float64Array(256);

  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor((row * height) / rows);
    const y1 = Math.floor(((row + 1) * height) / rows);
    for (let column = 0; column < columns; column++) {
      const x0 = Math.floor((column * width) / columns);
      const x1 = Math.floor(((column + 1) * width) / columns);
      histogram.fill(0);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          histogram[luma[y * width + x]]++;
        }
      }

      const count = (x1 - x0) * (y1 - y0);
      const limit = Math.max(1, (clipLimit * count) / 256);
      let excess = 0;
      for (let value = 0; value < 256; value++) {
        if (!(histogram[value] > limit)) {
          continue;
        }

        excess += histogram[value] - limit;
        histogram[value] = limit;
      }

      const offset = (row * columns + column) * 256;
      const bonus = excess / 256;
      let cumulative = 0;
      for (let value = 0; value < 256; value++) {
        cumulative += histogram[value] + bonus;
        luts[offset + value] = Math.round((cumulative / Math.max(count, 1)) * 255);
      }
    }
  }

  return { columns, rows, luts };
};

/** interpolation weights between the tile centres of a grid, for each coordinate along one axis */
const getGridWeights = (length: number, tiles: number) => {
  const first = new Uint16Array(length);
  const weight = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = clamp(((i + 0.5) / length) * tiles - 0.5, 0, tiles - 1);
    const index = Math.min(Math.floor(position), Math.max(tiles - 2, 0));
    first[i] = index;
    weight[i] = tiles > 1 ? position - index : 0;
  }
  return { first, weight };
};

/**
 * Applies CLAHE lookup tables (computed on any downscaled copy) to the luma of an 8-bit RGB image in place,
 * blended by `amount`. The colour channels are scaled together to keep the hue.
 */
export const applyLocalContrast = (
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
  { columns, rows, luts }: ClaheLuts,
  amount: number,
) => {
  const xs = getGridWeights(width, columns);
  const ys = getGridWeights(height, rows);
  const nextColumn = columns > 1 ? 1 : 0;
  const nextRow = rows > 1 ? columns : 0;

  for (let y = 0; y < height; y++) {
    const rowOffset = ys.first[y] * columns;
    const wy = ys.weight[y];
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const value = Math.round(toLuma(r, g, b));

      const tile = (rowOffset + xs.first[x]) * 256 + value;
      const wx = xs.weight[x];
      const top = luts[tile] + (luts[tile + nextColumn * 256] - luts[tile]) * wx;
      const bottomTile = tile + nextRow * 256;
      const bottom = luts[bottomTile] + (luts[bottomTile + nextColumn * 256] - luts[bottomTile]) * wx;
      const equalized = top + (bottom - top) * wy;

      const target = value + (equalized - value) * amount;
      let gain = (target + 1) / (value + 1);
      const max = Math.max(r, g, b);
      if (max * gain > 255) {
        gain = 255 / max;
      }
      data[offset] = Math.round(r * gain);
      data[offset + 1] = Math.round(g * gain);
      data[offset + 2] = Math.round(b * gain);
    }
  }
};
