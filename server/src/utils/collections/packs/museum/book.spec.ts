import { AutoLayoutPhoto, planAutoLayout } from 'src/utils/book/auto-layout.js';
import { getCollectionTag } from 'src/utils/book/collections.js';
import { FULL_CROP, getContainedRect, planPage, splitGalleryCaption } from 'src/utils/book/render.js';
import { reviewBook } from 'src/utils/book/review.js';
import { getCollectionTagRules } from 'src/utils/collections/pack.js';
import { museumPack } from 'src/utils/collections/packs/museum/pack.js';
import { getEntryTag, getSourceTag } from 'src/utils/collections/tags.js';

const rules = getCollectionTagRules(museumPack);
const museum = 'Museu de Évora';
const style = museumPack.book.preset.style;
const size = { pageWidthMm: 210, pageHeightMm: 210 };
const start = Date.UTC(2025, 7, 28, 15, 40);
const SECOND = 1000;

let counter = 0;
const photo = (tags: string[], seconds: number, dto: Partial<AutoLayoutPhoto> = {}): AutoLayoutPhoto => {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    width: 3000,
    height: 4000,
    takenAt: start + seconds * SECOND,
    score: 0.6,
    faces: [],
    isFavorite: false,
    collection: getCollectionTag(tags) ?? null,
    ...dto,
  };
};

const artwork = (entry: string, seconds: number, dto: Partial<AutoLayoutPhoto> = {}) =>
  photo([getEntryTag(rules, museum, entry)], seconds, dto);
const label = (seconds: number) =>
  photo([getSourceTag(rules, museum)], seconds, { width: 4000, height: 3000, score: 0.3 });

const VIRGIN = 'Virgin and Child — Nicolau Chanterene, 1535-1540, marble';
const EPHEBOS = 'Ephebos — Roman Period, bronze';
const CALVARY = 'Calvary — Gregório Lopes, 1544, oil on panel';
const TRIPTYCH = 'Triptych with the Passion of Christ — Attributed to Jean Pénicaud, c. 1530-1540, enamel on copper';

describe('museum books in the Gallery style', () => {
  it('should lay out a chapter per visit, with the artworks whole, numbered and captioned, and without the labels', () => {
    counter = 0;
    const photos = [
      artwork(VIRGIN, 0),
      label(5),
      artwork(EPHEBOS, 60, { width: 2000, height: 4000 }),
      label(64),
      artwork(CALVARY, 120, { width: 4000, height: 3000 }),
      label(125),
      // a detail of the Calvary
      artwork(CALVARY, 160, { width: 4000, height: 3000 }),
      artwork(TRIPTYCH, 200, { width: 4000, height: 2600 }),
      label(205),
    ];
    const labels = new Set([photos[1], photos[3], photos[5], photos[8]].map(({ id }) => id));

    const plan = planAutoLayout(photos, { size, style, includeMaps: false, cover: false });

    expect(plan.sections).toEqual([expect.objectContaining({ place: museum, pack: 'museum' })]);
    const slots = plan.pages.flatMap((page) => page.slots);
    expect(slots.some(({ assetId }) => labels.has(assetId))).toBe(false);
    expect(plan.droppedIds.toSorted()).toEqual([...labels].toSorted());
    expect(plan.pages[0]).toMatchObject({ layout: 'dish-opener', sectionTitle: expect.stringContaining(museum) });
    // shown whole, never cropped
    expect(slots.every(({ crop }) => crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1)).toBe(true);
    // numbered through the book in the order of the pages, a detail keeping the number of its artwork
    const captions = new Map(slots.map(({ assetId, caption }) => [assetId, caption]));
    expect([...new Set(slots.map(({ caption }) => caption!.split('.', 1)[0]))]).toEqual(['1', '2', '3', '4']);
    expect(captions.get(photos[0].id)).toMatch(/^\d\. Virgin and Child\nNicolau Chanterene, 1535-1540, marble$/);
    expect(captions.get(photos[2].id)).toMatch(/^\d\. Ephebos\nRoman Period, bronze$/);
    expect(captions.get(photos[4].id)).toMatch(/^\d\. Calvary\nGregório Lopes, 1544, oil on panel$/);
    expect(captions.get(photos[6].id)).toBe(captions.get(photos[4].id));
    expect(captions.get(photos[7].id)).toMatch(
      /^\d\. Triptych with the Passion of Christ\nAttributed to Jean Pénicaud/,
    );
  });

  it('should keep the labels in books of other packs, and the menus of food', () => {
    counter = 0;
    const photos = [artwork(VIRGIN, 0), label(5), artwork(CALVARY, 60)];
    const plan = planAutoLayout(photos, { size, style: { ...style, theme: 'food' }, includeMaps: false, cover: false });
    // the labels stay out whatever the style, as the pack says; only the look changes
    expect(plan.pages.flatMap((page) => page.slots).some(({ assetId }) => assetId === photos[1].id)).toBe(false);
    expect(plan.pages.flatMap((page) => page.slots).some(({ crop }) => crop.width < 1 || crop.height < 1)).toBe(true);
  });

  it('should draw an artwork whole, at the foot of its slot, with a museum label below it', () => {
    counter = 0;
    const portrait = artwork(EPHEBOS, 0, { width: 2000, height: 4000 });
    const page = planPage(
      { ...size, title: 'Museums', subtitle: null, style, coverAssetId: null },
      {
        layout: 'dish',
        sectionTitle: null,
        caption: null,
        background: null,
        assets: [{ slot: 0, assetId: portrait.id, crop: null, caption: '2. Ephebos\nRoman Period, bronze' }],
      },
      {
        dpi: 100,
        mode: 'review',
        sources: new Map([[portrait.id, { input: Buffer.from(''), width: 2000, height: 4000 }]]),
      },
    );
    const [slot] = page.slots;
    expect(slot.rectMm.width / slot.rectMm.height).toBeCloseTo(0.5, 2);
    // the whole photo, at the foot of the slot of the dish layout (the top 80% of the content box)
    expect(slot.crop).toEqual(FULL_CROP);
    expect(slot.rectMm.y + slot.rectMm.height).toBeCloseTo(
      style.marginMm + 0.8 * (210 - 2 * style.marginMm) - style.gutterMm / 2,
      1,
    );
    expect(page.spec.slots[0]).toMatchObject({ width: slot.rect.width, height: slot.rect.height });
    const texts = page.text.filter((block) => block.kind === 'slotCaption');
    expect(texts.map(({ text, italic }) => [text, !!italic])).toEqual([
      ['2', false],
      ['Ephebos', true],
      ['Roman Period, bronze', false],
    ]);
    expect(texts[0].rect.top).toBeGreaterThan(slot.rect.top + slot.rect.height);
    expect(texts[1].rect.top).toBeGreaterThan(texts[0].rect.top);
  });

  it('should fit a photo in a slot without cropping it', () => {
    expect(getContainedRect({ x: 0, y: 0, width: 100, height: 100 }, 2)).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    });
    expect(getContainedRect({ x: 0, y: 0, width: 100, height: 100 }, 2, true)).toEqual({
      x: 0,
      y: 50,
      width: 100,
      height: 50,
    });
    expect(getContainedRect({ x: 10, y: 0, width: 100, height: 100 }, 0.5)).toEqual({
      x: 35,
      y: 0,
      width: 50,
      height: 100,
    });
    expect(splitGalleryCaption('12. Calvary\nGregório Lopes, 1544')).toEqual({
      number: '12',
      title: 'Calvary',
      details: 'Gregório Lopes, 1544',
    });
    expect(splitGalleryCaption('Bust of a woman')).toEqual({ title: 'Bust of a woman', details: '' });
  });

  it('should review the artworks that are cropped or have no caption', () => {
    counter = 0;
    const calvary = artwork(CALVARY, 0, { width: 4000, height: 3000 });
    const virgin = artwork(VIRGIN, 60);
    const pages = [
      {
        layout: 'single',
        assets: [
          { slot: 0, assetId: calvary.id, crop: { x: 0.1, y: 0.1, width: 0.6, height: 0.6 }, caption: '1. Calvary' },
        ],
      },
      { layout: 'single', assets: [{ slot: 0, assetId: virgin.id, crop: null, caption: null }] },
    ];

    const gallery = reviewBook({ size, style, pages, photos: [calvary, virgin] });
    expect(gallery.issues).toContainEqual(
      expect.objectContaining({
        type: 'could-look-better',
        pages: [1],
        message: expect.stringMatching(/^Page 1 crops an artwork \(e\.g\. Calvary/),
      }),
    );
    expect(gallery.issues).toContainEqual(
      expect.objectContaining({
        type: 'missing-dish-name',
        message: expect.stringMatching(/^Page 2 shows? an artwork without its name/),
      }),
    );
    // museum labels are left out on purpose: no issue for them
    expect(gallery.issues.map(({ type }) => type)).not.toContain('missing-menu-page');

    // another style trims a portrait artwork to its square slot
    const classic = reviewBook({ size, style: { ...style, theme: 'plain' }, pages, photos: [calvary, virgin] });
    expect(classic.issues).toContainEqual(
      expect.objectContaining({
        type: 'could-look-better',
        pages: [1, 2],
        message: expect.stringContaining('2 artworks'),
      }),
    );
  });
});
