/**
 * styled: the real map data of Immich's own Map page, drawn in the look of the book; sketch: drawn offline;
 * watercolor, toner and terrain: Stadia Maps tiles
 */
export const bookMapStyles = ['styled', 'sketch', 'watercolor', 'toner', 'terrain'] as const;

export type BookMapStyle = (typeof bookMapStyles)[number];

export type BookMapStyleOption = BookMapStyle | 'auto';

/** the looks of styled maps (see map-looks.ts) */
export const bookMapLooks = ['wash', 'engraved', 'minimal', 'vintage'] as const;

export type BookMapLook = (typeof bookMapLooks)[number];

export type BookMapLookOption = BookMapLook | 'auto';

export type TileStyle = { id: string; extension: 'jpg' | 'png'; maxZoom: number };

type StadiaStyle = Exclude<BookMapStyle, 'sketch' | 'styled'>;

/** Stadia Maps raster styles; `sketch` is drawn offline, and `styled` from the vector tiles of the Map page */
export const tileStyles: Record<StadiaStyle, TileStyle> = {
  watercolor: { id: 'stamen_watercolor', extension: 'jpg', maxZoom: 16 },
  toner: { id: 'stamen_toner', extension: 'png', maxZoom: 20 },
  terrain: { id: 'stamen_terrain', extension: 'png', maxZoom: 18 },
};

export const isStadiaMapStyle = (style: BookMapStyle): style is StadiaStyle => style in tileStyles;

export const getTileStyle = (style: BookMapStyle): TileStyle | undefined =>
  isStadiaMapStyle(style) ? tileStyles[style] : undefined;

export type MapStyleConfig = {
  stadiaApiKey?: string;
  /** whether the Map feature is enabled (Administration → Settings → Map), whose tiles styled maps draw */
  mapEnabled?: boolean;
};

/**
 * Whether a map of this style is drawn as the offline sketch instead: a Stadia style without an API key, or a styled
 * map with the Map feature disabled
 */
export const isMapStyleFallback = (style: BookMapStyle, config: MapStyleConfig) => {
  if (style === 'styled') {
    return config.mapEnabled === false;
  }
  return style !== 'sketch' && !config.stadiaApiKey?.trim();
};

export const getMapStyleWarning = (style: BookMapStyle) =>
  style === 'styled'
    ? 'Styled maps use the map data of the Map page, which is disabled (Administration → Settings → Map); using the ' +
      'offline sketch style'
    : `${style[0].toUpperCase()}${style.slice(1)} maps need a Stadia Maps API key (Administration → Settings → Photo ` +
      'books); using the offline sketch style';

/**
 * `auto` is the configured default. A style that cannot be drawn for now (a Stadia style without an API key, a
 * styled map with the Map feature disabled) is kept, whether asked for explicitly or as the default (it is drawn once
 * the server allows it), with a warning that it is drawn as a sketch for now; the review of the book reports it too.
 */
export const resolveMapStyle = (
  style: BookMapStyleOption | undefined,
  config: { defaultStyle: BookMapStyle; stadiaApiKey: string; mapEnabled?: boolean },
): { style: BookMapStyle; warning?: string } => {
  const resolved = !style || style === 'auto' ? config.defaultStyle : style;
  return isMapStyleFallback(resolved, config)
    ? { style: resolved, warning: getMapStyleWarning(resolved) }
    : { style: resolved };
};
