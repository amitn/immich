import { RedactionKind, type RedactionRectDto, type RedactionRegionDto } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';

/** a region in the redaction editor (#14): a suggestion, or a box the user drew */
export type DraftRegion = RedactionRegionDto;

/** boxes smaller than this share of the photo on a side are taken for a click, not a box */
export const MIN_DRAWN_SIZE = 0.01;

type Point = { x: number; y: number };

/** the box between two points (fractions of the photo), or undefined when it is too small to be meant */
export const normalizeDrawnRect = (start: Point, end: Point) => {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < MIN_DRAWN_SIZE || height < MIN_DRAWN_SIZE) {
    return;
  }
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
};

export const toggleRegion = (regions: DraftRegion[], id: string): DraftRegion[] =>
  regions.map((region) => (region.id === id ? { ...region, selected: !region.selected } : region));

/** the selected regions, as the server takes them */
export const toRedactionRects = (regions: DraftRegion[]): RedactionRectDto[] =>
  regions.filter(({ selected }) => selected).map(({ x, y, width, height, kind }) => ({ x, y, width, height, kind }));

/** what a region covers, e.g. "Face · Alice" or "Text · EXIT" */
export const getRegionLabel = ($t: MessageFormatter, region: DraftRegion) => {
  const kinds: Record<RedactionKind, string> = {
    [RedactionKind.Face]: $t('redact_kind_face'),
    [RedactionKind.Text]: $t('redact_kind_text'),
    [RedactionKind.Plate]: $t('redact_kind_plate'),
    [RedactionKind.Screen]: $t('redact_kind_screen'),
    [RedactionKind.Manual]: $t('redact_kind_manual'),
  };
  const kind = kinds[region.kind] ?? region.kind;
  const detail = region.kind === RedactionKind.Face ? region.personName : region.text;
  return detail ? `${kind} · ${detail}` : kind;
};
