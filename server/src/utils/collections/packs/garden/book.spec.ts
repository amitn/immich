import { bookStylePresets } from 'src/dtos/book.dto.js';
import { AutoLayoutPhoto, planAutoLayout } from 'src/utils/book/auto-layout.js';
import { GROWTH_TIMELINE_LAYOUT, GROWTH_TIMELINE_LAYOUTS } from 'src/utils/book/layouts.js';
import { planPage } from 'src/utils/book/render.js';
import { checkBookStyle } from 'src/utils/book/style-check.js';

const style = bookStylePresets.garden.style;

/** a photo of a plant on a day, in the chapter of the plant */
const plant = (id: string, day: number): AutoLayoutPhoto => ({
  id,
  width: 3000,
  height: 2000,
  takenAt: Date.UTC(2013, 1, 1) + day * 24 * 60 * 60 * 1000,
  score: 0.7,
  faces: [],
  isFavorite: false,
  collection: { pack: 'garden', place: 'Hawea Pl garden', kind: 'entry', entry: "Peach 'Tropic Prince'" },
  description: "Peach 'Tropic Prince' · flowering",
});

describe('garden journal', () => {
  it('should be a printed style that renders', () => {
    expect(checkBookStyle(style).errors).toEqual([]);
  });

  it('should set the photos of a plant on its growth timeline, a dot and a date beside each', () => {
    const plan = planPage(
      { pageWidthMm: 210, pageHeightMm: 210, title: 'Garden journal', subtitle: null, style, coverAssetId: null },
      {
        layout: GROWTH_TIMELINE_LAYOUT,
        sectionTitle: null,
        caption: null,
        background: null,
        assets: [
          { slot: 0, assetId: 'a', crop: null, caption: '1 Feb 2013\nflowering' },
          { slot: 1, assetId: 'b', crop: null, caption: '4 May 2013\nfruit' },
        ],
      },
      {
        dpi: 72,
        mode: 'review',
        sources: new Map([
          ['a', { input: 'a.jpg', width: 3000, height: 2000 }],
          ['b', { input: 'b.jpg', width: 3000, height: 2000 }],
        ]),
      },
    );
    expect(plan.text.map(({ text }) => text)).toEqual(['1 Feb 2013', 'flowering', '4 May 2013', 'fruit']);
    // the line, a dot (and its halo) for each of the two photos, and the leaf at its end
    const kinds = plan.decorations.map(({ kind }) => kind);
    expect(kinds.filter((kind) => kind === 'circle')).toHaveLength(4);
    expect(kinds).toContain('path');
  });

  it('should lay out a plant on growth timelines, in the order of its photos', () => {
    const plan = planAutoLayout(
      Array.from({ length: 6 }, (_, index) => plant(`p${index}`, index * 40)),
      { size: { pageWidthMm: 210, pageHeightMm: 210 }, style },
    );
    const timelines = plan.pages.filter(({ layout }) => GROWTH_TIMELINE_LAYOUTS.includes(layout));
    expect(timelines.length).toBeGreaterThan(0);
    const order = timelines.flatMap((page) => page.slots.map(({ assetId }) => Number(assetId.slice(1))));
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    // the cover and the opener of the chapter take a photo; the timeline dates the others
    expect(timelines[0].slots[0].caption).toMatch(/^\d{1,2} [A-Z][a-z]{2} 201[34]\nflowering$/);
  });
});
