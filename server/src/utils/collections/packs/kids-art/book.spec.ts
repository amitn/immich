import { bookStylePresets } from 'src/dtos/book.dto.js';
import { AutoLayoutPhoto, planAutoLayout } from 'src/utils/book/auto-layout.js';
import { isMountedTheme } from 'src/utils/book/collections.js';
import { getFontStack } from 'src/utils/book/fonts.js';
import { MOUNT_MAT_MM, getMountDecorations } from 'src/utils/book/mounted.js';
import { planPage } from 'src/utils/book/render.js';
import { checkBookStyle } from 'src/utils/book/style-check.js';

const style = bookStylePresets['kids-art'].style;
const book = { pageWidthMm: 210, pageHeightMm: 210, title: 'On the fridge', subtitle: null, style, coverAssetId: null };

/** an artwork photographed in Tallinn */
const photo = (id: string, takenAt: number): AutoLayoutPhoto => ({
  id,
  width: 3000,
  height: 2000,
  takenAt,
  lat: 59.43,
  lon: 24.75,
  city: 'Tallinn',
  country: 'Estonia',
  score: 0.7,
  faces: [],
  isFavorite: false,
  collection: { pack: 'kids-art', place: 'Lina, 2025', kind: 'entry', entry: `Drawing ${id}` },
});

describe('refrigerator gallery', () => {
  it('should be a mounted theme with a handwriting-like font that renders', () => {
    expect(isMountedTheme('kids-art')).toBe(true);
    expect(isMountedTheme('museum')).toBe(false);
    expect(checkBookStyle(style).errors).toEqual([]);
    expect(getFontStack(style.fontFamily)).toMatch(/^'Patrick Hand', 'Comic Neue', 'Liberation Sans', .*sans-serif$/);
  });

  it('should show an artwork whole on a mat inside its slot, taped, with its label under it', () => {
    const plan = planPage(
      book,
      {
        layout: 'dish-opener',
        sectionTitle: 'Lina, 2025',
        caption: null,
        background: null,
        assets: [
          { slot: 0, assetId: 'art', crop: null, caption: 'Two foxes under green leaves\nage 8 · January 2025' },
        ],
      },
      { dpi: 72, mode: 'review', sources: new Map([['art', { input: 'art.jpg', width: 3000, height: 2000 }]]) },
    );
    const [slot] = plan.slots;
    // never cropped: the slot is the shape of the artwork
    expect(slot.rectMm.width / slot.rectMm.height).toBeCloseTo(1.5, 2);
    expect(plan.text.map(({ text }) => text)).toEqual([
      'Lina, 2025',
      'Two foxes under green leaves',
      'age 8 · January 2025',
    ]);
    const kinds = plan.decorations.map(({ kind }) => kind);
    // a squiggle under the heading, a shadow, the mat and its edge, two strips of tape
    expect(kinds.filter((kind) => kind === 'path')).toHaveLength(6);
    expect(kinds.filter((kind) => kind === 'frame')).toHaveLength(2);
  });

  it('should hold every third artwork by photo corners', () => {
    const decorations = getMountDecorations({ left: 100, top: 100, width: 400, height: 300 }, 2, 150);
    expect(decorations.filter(({ kind }) => kind === 'path')).toHaveLength(3 + 4);
    expect(MOUNT_MAT_MM).toBeGreaterThan(0);
  });

  it('should never show where the artworks were taken', () => {
    const plan = planAutoLayout(
      Array.from({ length: 8 }, (_, index) => photo(`p${index}`, Date.UTC(2025, 0, 7 + index))),
      { size: { pageWidthMm: 210, pageHeightMm: 210 }, style },
    );
    expect(plan.pages.some(({ layout }) => layout === 'map' || layout === 'map-photo')).toBe(false);
    expect(JSON.stringify(plan)).not.toContain('Tallinn');
    expect(plan.sections.every(({ located }) => !located)).toBe(true);
  });
});
