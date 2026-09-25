import type { BookLayoutRect, BookLayoutResponseDto, BookSlotResponseDto, NormalizedRect } from '@immich/sdk';

/**
 * Page geometry for the photo book editor. It mirrors the server's layout geometry (`getLayoutBox` and `placeRect`
 * in server/src/utils/book/layouts.ts, used by `planPage` and `planGeometry`), so that the editing overlay lines up
 * with the page the server rendered.
 */

export type BookPageSize = { pageWidthMm: number; pageHeightMm: number };
export type BookSpacing = { marginMm: number; gutterMm: number };
type LayoutGeometry = Pick<BookLayoutResponseDto, 'fullBleed' | 'slots'> & { mapArea?: BookLayoutRect };

/** A rect as fractions (0..1) of the page width and height */
export type PageFrame = { left: number; top: number; width: number; height: number };

const EPSILON = 1e-6;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** The area the layout is placed in, in millimeters: the page inside the margins, or the whole page (full bleed) */
export const getLayoutBox = (layout: Pick<LayoutGeometry, 'fullBleed'>, size: BookPageSize, style: BookSpacing) => {
  if (layout.fullBleed) {
    return { x: 0, y: 0, width: size.pageWidthMm, height: size.pageHeightMm };
  }
  const margin = style.marginMm;
  return { x: margin, y: margin, width: size.pageWidthMm - 2 * margin, height: size.pageHeightMm - 2 * margin };
};

/** Maps a normalized layout rect into the box, leaving half a gutter on every edge that borders another area */
export const placeRect = (rect: BookLayoutRect, box: BookLayoutRect, gutterMm: number): BookLayoutRect => {
  const half = gutterMm / 2;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  const x1 = box.x + rect.x * box.width + (rect.x > EPSILON ? half : 0);
  const y1 = box.y + rect.y * box.height + (rect.y > EPSILON ? half : 0);
  const x2 = box.x + right * box.width - (right < 1 - EPSILON ? half : 0);
  const y2 = box.y + bottom * box.height - (bottom < 1 - EPSILON ? half : 0);

  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
};

const toFrame = (rect: BookLayoutRect, size: BookPageSize): PageFrame => ({
  left: rect.x / size.pageWidthMm,
  top: rect.y / size.pageHeightMm,
  width: rect.width / size.pageWidthMm,
  height: rect.height / size.pageHeightMm,
});

/** The slots of a layout in millimeters, with the margins and gutters applied */
export const getSlotRectsMm = (layout: LayoutGeometry, size: BookPageSize, style: BookSpacing) => {
  const box = getLayoutBox(layout, size, style);
  return layout.slots.map((slot) => placeRect(slot, box, style.gutterMm));
};

/** Where the slots of a layout are on the page, as fractions of the page size */
export const getSlotFrames = (layout: LayoutGeometry, size: BookPageSize, style: BookSpacing): PageFrame[] =>
  size.pageWidthMm > 0 && size.pageHeightMm > 0
    ? getSlotRectsMm(layout, size, style).map((rect) => toFrame(rect, size))
    : [];

/** Where the map of a map layout is on the page, as fractions of the page size */
export const getMapFrame = (layout: LayoutGeometry, size: BookPageSize, style: BookSpacing): PageFrame | null => {
  if (!layout.mapArea || size.pageWidthMm <= 0 || size.pageHeightMm <= 0) {
    return null;
  }
  return toFrame(placeRect(layout.mapArea, getLayoutBox(layout, size, style), style.gutterMm), size);
};

/** CSS for absolutely positioning a frame inside the page */
export const toFrameStyle = (frame: PageFrame) =>
  `left:${frame.left * 100}%;top:${frame.top * 100}%;width:${frame.width * 100}%;height:${frame.height * 100}%`;

/** The number of photos placed on a page */
export const countPhotos = (slots: Pick<BookSlotResponseDto, 'assetId'>[]) =>
  slots.filter((slot) => slot.assetId).length;

export const isMapLayout = (layout: Pick<LayoutGeometry, 'mapArea'>) => !!layout.mapArea;

/**
 * The layouts a page can switch to: `fitting` keeps every photo of the page, `others` has too few slots (photos are
 * removed). Map layouts are only offered to map pages, since a map needs map data that is set elsewhere.
 */
export const getLayoutChoices = <T extends BookLayoutResponseDto>(
  layouts: T[],
  page: { photoCount: number; isMap?: boolean },
) => {
  const usable = layouts.filter((layout) => page.isMap || !isMapLayout(layout));
  const fitting = usable.filter((layout) => layout.slots.length >= page.photoCount);
  const others = usable.filter((layout) => layout.slots.length < page.photoCount);
  return { fitting, others };
};

/**
 * The moves that keep the photos of a page when its layout changes to one with `slotCount` slots: the server drops
 * the photos in slots the new layout lacks, so photos in those slots move into free slots first.
 */
export const planLayoutChange = (
  slots: Pick<BookSlotResponseDto, 'slot' | 'assetId'>[],
  slotCount: number,
): { from: number; to: number }[] => {
  const free = slots
    .filter((slot) => slot.slot < slotCount && !slot.assetId)
    .map((slot) => slot.slot)
    .sort((a, b) => a - b);
  const moves: { from: number; to: number }[] = [];
  for (const slot of [...slots].sort((a, b) => a.slot - b.slot)) {
    if (slot.slot < slotCount || !slot.assetId) {
      continue;
    }
    const to = free.shift();
    if (to === undefined) {
      break;
    }
    moves.push({ from: slot.slot, to });
  }
  return moves;
};

/** Whether a crop made for one slot still fits another slot, e.g. when two photos swap places */
export const isSameAspect = (a: number, b: number, tolerance = 0.02) =>
  a > 0 && b > 0 && Math.abs(Math.log(a / b)) <= Math.log(1 + tolerance);

/** The crop editor's view of a photo: the zoom (1 shows as much as fits) and the centre of the crop */
export type CropView = { zoom: number; centerX: number; centerY: number };

export const MAX_CROP_ZOOM = 5;

/** The size of the largest crop with the slot's aspect ratio, as fractions of the image */
const getFullCropSize = (imageAspect: number, slotAspect: number) =>
  imageAspect > slotAspect
    ? { width: slotAspect / imageAspect, height: 1 }
    : { width: 1, height: imageAspect / slotAspect };

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** The normalized crop that shows the view: the slot's aspect ratio, inside the image */
export const cropFromView = (view: CropView, imageAspect: number, slotAspect: number): NormalizedRect => {
  if (!(imageAspect > 0) || !(slotAspect > 0)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const zoom = clamp(view.zoom, 1, MAX_CROP_ZOOM);
  const full = getFullCropSize(imageAspect, slotAspect);
  const width = full.width / zoom;
  const height = full.height / zoom;
  const x = clamp(view.centerX - width / 2, 0, 1 - width);
  const y = clamp(view.centerY - height / 2, 0, 1 - height);
  return { x: round4(x), y: round4(y), width: round4(width), height: round4(height) };
};

/** The view of an existing crop; a crop with another aspect ratio is shown the way the server trims it */
export const viewFromCrop = (crop: NormalizedRect | null, imageAspect: number, slotAspect: number): CropView => {
  if (!crop || !(imageAspect > 0) || !(slotAspect > 0)) {
    return { zoom: 1, centerX: 0.5, centerY: 0.5 };
  }
  const full = getFullCropSize(imageAspect, slotAspect);
  // the part of the crop the slot shows: its aspect ratio trimmed around the centre
  const cropAspect = (crop.width * imageAspect) / crop.height;
  const shown = cropAspect > slotAspect ? crop.height / full.height : crop.width / full.width;
  return {
    zoom: clamp(1 / shown, 1, MAX_CROP_ZOOM),
    centerX: crop.x + crop.width / 2,
    centerY: crop.y + crop.height / 2,
  };
};

/** Moves the view by a distance in crop frames (1 = the width or height of the visible area) */
export const panView = (
  view: CropView,
  delta: { x: number; y: number },
  imageAspect: number,
  slotAspect: number,
): CropView => {
  const crop = cropFromView(view, imageAspect, slotAspect);
  const centerX = crop.x + crop.width / 2 + delta.x * crop.width;
  const centerY = crop.y + crop.height / 2 + delta.y * crop.height;
  // keep the centre where the crop can still be, so that panning back responds at once
  return {
    zoom: view.zoom,
    centerX: clamp(centerX, crop.width / 2, 1 - crop.width / 2),
    centerY: clamp(centerY, crop.height / 2, 1 - crop.height / 2),
  };
};

/** CSS that places the image in a frame so that the crop fills the frame */
export const toCropImageStyle = (crop: NormalizedRect) =>
  `width:${100 / crop.width}%;height:${100 / crop.height}%;left:${(-crop.x / crop.width) * 100}%;top:${(-crop.y / crop.height) * 100}%`;
