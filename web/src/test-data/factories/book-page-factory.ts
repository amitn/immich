import type { BookLayoutResponseDto, BookPageResponseDto, BookSlotResponseDto } from '@immich/sdk';

type SlotInput = Partial<BookSlotResponseDto> & { assetId: string | null };

/** A page with one slot per entry; slots are square unless an aspect ratio is given */
export const bookPageFactory = (
  id: string,
  position: number,
  slots: SlotInput[] = [],
  page: Partial<BookPageResponseDto> = {},
): BookPageResponseDto => ({
  id,
  position,
  layout: 'single',
  background: null,
  caption: null,
  sectionTitle: null,
  map: null,
  updatedAt: '2026-09-25T10:00:00.000Z',
  ...page,
  slots: slots.map((slot, index) => ({ slot: index, aspectRatio: 1, crop: null, caption: null, ...slot })),
});

export const bookLayoutFactory = (
  id: string,
  slots: BookLayoutResponseDto['slots'],
  layout: Partial<BookLayoutResponseDto> = {},
) =>
  ({
    id,
    name: id,
    description: `The ${id} layout`,
    orientation: 'any',
    fullBleed: false,
    slots,
    textAreas: [],
    ...layout,
  }) as BookLayoutResponseDto;

export const bookLayouts = {
  single: bookLayoutFactory('single', [{ x: 0, y: 0, width: 1, height: 1 }]),
  twoHorizontal: bookLayoutFactory('two-horizontal', [
    { x: 0, y: 0, width: 0.5, height: 1 },
    { x: 0.5, y: 0, width: 0.5, height: 1 },
  ]),
  fourGrid: bookLayoutFactory('four-grid', [
    { x: 0, y: 0, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0.5, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  ]),
  map: bookLayoutFactory('map', [], { mapArea: { x: 0, y: 0, width: 1, height: 1 } }),
};
