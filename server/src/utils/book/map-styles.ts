export const bookMapStyles = ['sketch', 'watercolor', 'toner', 'terrain'] as const;

export type BookMapStyle = (typeof bookMapStyles)[number];

export type BookMapStyleOption = BookMapStyle | 'auto';

export type TileStyle = { id: string; extension: 'jpg' | 'png'; maxZoom: number };

/** Stadia Maps raster styles; `sketch` is drawn offline */
export const tileStyles: Record<Exclude<BookMapStyle, 'sketch'>, TileStyle> = {
  watercolor: { id: 'stamen_watercolor', extension: 'jpg', maxZoom: 16 },
  toner: { id: 'stamen_toner', extension: 'png', maxZoom: 20 },
  terrain: { id: 'stamen_terrain', extension: 'png', maxZoom: 18 },
};

export const getTileStyle = (style: BookMapStyle): TileStyle | undefined =>
  style === 'sketch' ? undefined : tileStyles[style];

/** `auto` is the configured default; styles that need tiles fall back to `sketch` without an API key */
export const resolveMapStyle = (
  style: BookMapStyleOption | undefined,
  config: { defaultStyle: BookMapStyle; stadiaApiKey: string },
): { style: BookMapStyle; fallback: boolean } => {
  const requested = !style || style === 'auto' ? config.defaultStyle : style;
  if (requested !== 'sketch' && !config.stadiaApiKey) {
    return { style: 'sketch', fallback: true };
  }
  return { style: requested, fallback: false };
};
