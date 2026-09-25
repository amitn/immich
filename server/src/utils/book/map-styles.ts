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

/** whether a map of this style is drawn as the offline sketch instead, for lack of an API key */
export const isMapStyleFallback = (style: BookMapStyle, stadiaApiKey: string | undefined) =>
  style !== 'sketch' && !stadiaApiKey;

export const getMapStyleWarning = (style: BookMapStyle) =>
  `${style[0].toUpperCase()}${style.slice(1)} maps need a Stadia Maps API key (Administration → Settings → Photo ` +
  'books); using the offline sketch style';

/**
 * `auto` is the configured default when it can be drawn, and the offline sketch otherwise. A style that needs tiles
 * is kept when asked for explicitly (it is drawn once a key is configured), with a warning that it is drawn as a
 * sketch for now.
 */
export const resolveMapStyle = (
  style: BookMapStyleOption | undefined,
  config: { defaultStyle: BookMapStyle; stadiaApiKey: string },
): { style: BookMapStyle; warning?: string } => {
  if (!style || style === 'auto') {
    return { style: isMapStyleFallback(config.defaultStyle, config.stadiaApiKey) ? 'sketch' : config.defaultStyle };
  }
  return isMapStyleFallback(style, config.stadiaApiKey) ? { style, warning: getMapStyleWarning(style) } : { style };
};
