import { RedactionKind, RedactionReason } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';
import {
  type DraftRegion,
  getRegionLabel,
  normalizeDrawnRect,
  toRedactionRects,
  toggleRegion,
} from '$lib/utils/redaction';

const $t = ((key: string) => key) as unknown as MessageFormatter;

const region = (overrides: Partial<DraftRegion> = {}): DraftRegion => ({
  id: 'face:1',
  kind: RedactionKind.Face,
  reason: RedactionReason.Unknown,
  selected: true,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  ...overrides,
});

describe('redaction utils', () => {
  describe(normalizeDrawnRect.name, () => {
    it('should make a box of two points in any order, kept inside the photo', () => {
      expect(normalizeDrawnRect({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({
        x: 0.2,
        y: 0.1,
        width: 0.3,
        height: 0.5,
      });
      expect(normalizeDrawnRect({ x: 0.9, y: 0.9 }, { x: 1, y: 1 })).toMatchObject({ x: 0.9, y: 0.9 });
    });

    it('should take a tiny box for a click', () => {
      expect(normalizeDrawnRect({ x: 0.5, y: 0.5 }, { x: 0.503, y: 0.6 })).toBeUndefined();
    });
  });

  it('should toggle a region and send only the selected ones', () => {
    const regions = toggleRegion([region(), region({ id: 'text:2', kind: RedactionKind.Text })], 'face:1');
    expect(regions.map(({ selected }) => selected)).toEqual([false, true]);
    expect(toRedactionRects(regions)).toEqual([{ x: 0.1, y: 0.2, width: 0.3, height: 0.4, kind: RedactionKind.Text }]);
  });

  it('should name a region by its kind, its person or its text', () => {
    expect(getRegionLabel($t, region({ personName: 'Alice' }))).toBe('redact_kind_face · Alice');
    expect(getRegionLabel($t, region({ kind: RedactionKind.Plate, text: 'AB12 CDE' }))).toBe(
      'redact_kind_plate · AB12 CDE',
    );
    expect(getRegionLabel($t, region({ kind: RedactionKind.Manual }))).toBe('redact_kind_manual');
  });
});
