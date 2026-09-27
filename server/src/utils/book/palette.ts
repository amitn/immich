import { getContrast } from 'src/utils/book/render.js';

/** 8-bit pixels, `channels` bytes per pixel (only the first three, RGB, are read) */
export type PalettePixels = { data: Buffer | Uint8Array; channels: number };

export type PaletteColor = {
  hex: string;
  /** share of the pixels, 0..1 */
  share: number;
  /** HSL saturation and lightness, 0..1 */
  saturation: number;
  lightness: number;
};

export type Palette = {
  /** the main colours, largest first */
  colors: PaletteColor[];
  /** the colour that covers the most of the photos */
  dominant: PaletteColor;
  /** vivid colours that stand out, most striking first */
  accents: PaletteColor[];
  /** a book style drawn from the palette: a light page, dark text and an accent, all readable */
  suggestion: { background: string; textColor: string; accentColor: string };
};

type Rgb = [number, number, number];

const clamp = (value: number, min = 0, max = 1) => Math.min(Math.max(value, min), max);

export const toHex = ([r, g, b]: Rgb) =>
  '#' +
  [r, g, b]
    .map((value) =>
      Math.round(clamp(value, 0, 255))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

export const fromHex = (hex: string): Rgb => {
  const value = hex.replace('#', '');
  const full = value.length <= 4 ? [...value.slice(0, 3)].map((digit) => digit + digit).join('') : value.slice(0, 6);
  return [0, 2, 4].map((index) => Number.parseInt(full.slice(index, index + 2), 16)) as Rgb;
};

export const rgbToHsl = ([r, g, b]: Rgb): [number, number, number] => {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) {
    return [0, 0, lightness];
  }
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === red) {
    hue = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  return [hue / 6, saturation, lightness];
};

export const hslToRgb = ([hue, saturation, lightness]: [number, number, number]): Rgb => {
  if (saturation === 0) {
    return [lightness * 255, lightness * 255, lightness * 255];
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) {
      return p + (q - p) * 6 * x;
    }
    if (x < 1 / 2) {
      return q;
    }
    if (x < 2 / 3) {
      return p + (q - p) * (2 / 3 - x) * 6;
    }
    return p;
  };
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255];
};

/** the colour with its lightness (and at most `maxSaturation`) changed, e.g. a pale page tinted like a colour */
export const shiftColor = (hex: string, lightness: number, maxSaturation = 1) => {
  const [hue, saturation] = rgbToHsl(fromHex(hex));
  return toHex(hslToRgb([hue, Math.min(saturation, maxSaturation), clamp(lightness)]));
};

/** the colour, darkened (or lightened) step by step until it reaches `minContrast` on the background */
export const withContrast = (hex: string, background: string, minContrast: number) => {
  if (getContrast(hex, background) >= minContrast) {
    return hex;
  }
  const [hue, saturation, lightness] = rgbToHsl(fromHex(hex));
  const darker = rgbToHsl(fromHex(background))[2] > 0.5;
  for (let step = 1; step <= 20; step++) {
    const candidate = toHex(hslToRgb([hue, saturation, clamp(lightness + (darker ? -step : step) * 0.05)]));
    if (getContrast(candidate, background) >= minContrast) {
      return candidate;
    }
  }
  return darker ? '#000000' : '#ffffff';
};

const distance = (a: Rgb, b: Rgb) => {
  // a cheap perceptual weighting ("redmean")
  const meanRed = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return (2 + meanRed / 256) * dr * dr + 4 * dg * dg + (2 + (255 - meanRed) / 256) * db * db;
};

/**
 * The main colours of one or more images (e.g. small previews of photos), by k-means over a 4-bit histogram.
 * Deterministic: the clusters start from the most common, well separated colours. Every image counts the same,
 * whatever its size.
 */
export const extractPalette = (images: PalettePixels[], count = 6): Palette => {
  const bins = new Map<number, { weight: number; sum: Rgb }>();
  for (const { data, channels } of images) {
    const pixels = Math.floor(data.length / channels);
    if (pixels === 0) {
      continue;
    }
    const weight = 1 / pixels;
    for (let offset = 0; offset + 2 < data.length; offset += channels) {
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bin = bins.get(key) ?? { weight: 0, sum: [0, 0, 0] };
      bin.weight += weight;
      bin.sum[0] += r * weight;
      bin.sum[1] += g * weight;
      bin.sum[2] += b * weight;
      bins.set(key, bin);
    }
  }

  const points = bins
    .values()
    .map(({ weight, sum }) => ({ weight, color: sum.map((value) => value / weight) as Rgb }))
    .toArray()
    .toSorted((a, b) => b.weight - a.weight);
  if (points.length === 0) {
    throw new Error('No pixels to take colours from');
  }

  // start from the most common colours that are not too close to one another
  const minDistance = 3000;
  const centers: Rgb[] = [];
  for (const point of points) {
    if (centers.length >= count) {
      break;
    }
    if (centers.every((center) => distance(center, point.color) > minDistance)) {
      centers.push([...point.color]);
    }
  }

  let assignment: number[] = [];
  for (let iteration = 0; iteration < 12; iteration++) {
    assignment = points.map((point) => {
      let best = 0;
      for (let index = 1; index < centers.length; index++) {
        if (distance(point.color, centers[index]) < distance(point.color, centers[best])) {
          best = index;
        }
      }
      return best;
    });
    const sums = centers.map(() => ({ weight: 0, sum: [0, 0, 0] as Rgb }));
    for (const [index, point] of points.entries()) {
      const target = sums[assignment[index]];
      target.weight += point.weight;
      for (let channel = 0; channel < 3; channel++) {
        target.sum[channel] += point.color[channel] * point.weight;
      }
    }
    for (const [index, { weight, sum }] of sums.entries()) {
      if (weight > 0) {
        centers[index] = sum.map((value) => value / weight) as Rgb;
      }
    }
  }

  const total = points.reduce((sum, point) => sum + point.weight, 0);
  const shares = centers.map(() => 0);
  for (const [index, point] of points.entries()) {
    shares[assignment[index]] += point.weight / total;
  }

  const colors: PaletteColor[] = centers
    .map((center, index) => {
      const [, saturation, lightness] = rgbToHsl(center);
      return {
        hex: toHex(center),
        share: Math.round(shares[index] * 1000) / 1000,
        saturation: Math.round(saturation * 100) / 100,
        lightness: Math.round(lightness * 100) / 100,
      };
    })
    .filter((color) => color.share > 0)
    .toSorted((a, b) => b.share - a.share);

  const dominant = colors[0];
  // vivid, not too dark or pale, and covering enough of the photos to be theirs
  const accents = colors
    .filter(
      (color) => color.saturation >= 0.25 && color.lightness > 0.15 && color.lightness < 0.85 && color.share >= 0.02,
    )
    .toSorted((a, b) => b.saturation * Math.sqrt(b.share) - a.saturation * Math.sqrt(a.share));

  const background = shiftColor(dominant.hex, 0.95, 0.35);
  const textColor = withContrast(shiftColor(dominant.hex, 0.16, 0.3), background, 7);
  const accentColor = withContrast(accents[0]?.hex ?? shiftColor(dominant.hex, 0.4, 0.5), background, 3);

  return { colors, dominant, accents, suggestion: { background, textColor, accentColor } };
};
