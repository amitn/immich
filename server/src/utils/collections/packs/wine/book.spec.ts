import { describe, expect, it } from 'vitest';
import { bookStylePresets, bookStyleThemes } from 'src/dtos/book.dto.js';
import { AutoLayoutPhoto, planAutoLayout } from 'src/utils/book/auto-layout.js';
import { getEntryCaption, getPlaceVisits, isPrintedTheme } from 'src/utils/book/collections.js';
import { TASTING_LAYOUTS, TASTING_NOTE_LAYOUT } from 'src/utils/book/layouts.js';
import { planPage } from 'src/utils/book/render.js';
import { reviewBook } from 'src/utils/book/review.js';
import { parseTastingNote } from 'src/utils/book/tasting-note.js';
import { getWineCaption, isUnreadableWine, reviewWineBook } from 'src/utils/collections/packs/wine/book.js';

const HOUR = 60 * 60 * 1000;
const start = Date.UTC(2013, 10, 28, 12);
const size = { pageWidthMm: 210, pageHeightMm: 210 };
const style = bookStylePresets.wine.style;

let counter = 0;
const photo = (
  hours: number,
  collection: AutoLayoutPhoto['collection'],
  extra: Partial<AutoLayoutPhoto> = {},
): AutoLayoutPhoto => {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    // a bottle stands tall
    width: 1936,
    height: 2592,
    takenAt: start + hours * HOUR,
    score: 0.6,
    faces: [],
    isFavorite: false,
    collection,
    ...extra,
  };
};
const wine = (hours: number, entry: string, place = 'Thanksgiving tasting', extra: Partial<AutoLayoutPhoto> = {}) =>
  photo(hours, { pack: 'wine', place, kind: 'entry', entry }, extra);

describe('the wine pack in books', () => {
  it('should have the Cellar notes style, printed', () => {
    expect(bookStylePresets.wine.name).toBe('Cellar notes');
    expect(bookStyleThemes).toContain('wine');
    expect(isPrintedTheme('wine')).toBe(true);
  });

  it('should caption a wine by its name, and on a tasting note by its fiche and the note of its description', () => {
    const name = 'Louis Chavy · Bourgogne Pinot Noir · 2010';
    expect(getWineCaption(name, { layout: 'dish-pair' })).toBe(name);
    expect(getWineCaption(name, { layout: TASTING_NOTE_LAYOUT, description: name })).toBe(
      'Producer: Louis Chavy\nWine: Bourgogne Pinot Noir\nVintage: 2010\nRegion: Bourgogne\nGrape: Pinot Noir',
    );
    expect(getWineCaption(name, { layout: TASTING_NOTE_LAYOUT, description: 'Bright cherry.' })).toBe(
      'Producer: Louis Chavy\nWine: Bourgogne Pinot Noir\nVintage: 2010\nRegion: Bourgogne\nGrape: Pinot Noir\n\nBright cherry.',
    );
    // a grape or region that is the whole wine is said once
    expect(getWineCaption('Peter & Peter · Riesling · 2008', { layout: TASTING_NOTE_LAYOUT })).toBe(
      'Producer: Peter & Peter\nWine: Riesling\nVintage: 2008',
    );
    expect(getWineCaption('Snakebite', { layout: TASTING_NOTE_LAYOUT })).toBe('Wine: Snakebite');
  });

  it('should read the fiche of a tasting note back, or a name without labels', () => {
    expect(
      parseTastingNote('Producer: Kudos\nWine: Pinot Noir\nVintage: 2012\nRegion: Willamette Valley\n\nCherry, spice.'),
    ).toEqual({
      producer: 'Kudos',
      wine: 'Pinot Noir',
      vintage: '2012',
      rows: [{ label: 'Region', value: 'Willamette Valley' }],
      note: 'Cherry, spice.',
    });
    expect(parseTastingNote('Kudos · Pinot Noir · 2012')).toEqual({
      producer: 'Kudos',
      wine: 'Pinot Noir',
      vintage: '2012',
      rows: [],
    });
    expect(parseTastingNote('Snakebite')).toEqual({ wine: 'Snakebite', rows: [] });
  });

  it('should typeset the fiche beside the bottle, inside the page', () => {
    const plan = planPage(
      { ...size, title: 'Cellar Notes', subtitle: null, style, coverAssetId: null },
      {
        layout: TASTING_NOTE_LAYOUT,
        sectionTitle: null,
        caption: null,
        background: null,
        assets: [
          {
            slot: 0,
            assetId: 'bottle',
            crop: null,
            caption: getWineCaption('Willi Haag · Brauneberger Juffer-Sonnenuhr Riesling Spätlese · 2009', {
              layout: TASTING_NOTE_LAYOUT,
              description: 'Honey and slate, a long finish.',
            }),
          },
        ],
      },
      { dpi: 100, mode: 'review', sources: new Map([['bottle', { input: '/bottle.jpg', width: 1936, height: 2592 }]]) },
    );
    const texts = plan.text.map(({ text }) => text);
    expect(texts).toEqual(
      expect.arrayContaining([
        'Willi Haag',
        'Brauneberger Juffer-Sonnenuhr Riesling Spätlese',
        '2009',
        'Grape',
        'Riesling',
        'Tasting note',
        'Honey and slate, a long finish.',
      ]),
    );
    const photoRight = plan.slots[0].rect.left + plan.slots[0].rect.width;
    for (const block of plan.text) {
      expect(block.rect.left).toBeGreaterThan(photoRight);
      expect(block.rect.top + block.rect.height).toBeLessThanOrEqual(plan.spec.height);
    }
    expect(plan.decorations.some((decoration) => decoration.kind === 'line')).toBe(true);
  });

  it('should lay out a tasting with its bottles on tasting-note pages, and never give dishes those pages', () => {
    counter = 0;
    const bottles = [
      wine(0, 'Patrick Javillier · Bourgogne Cuvée des Forgets · 2011'),
      wine(0.2, 'Kudos · Pinot Noir · 2012'),
      wine(0.4, 'Louis Chavy · Bourgogne Pinot Noir · 2010', undefined, { description: 'Bright cherry.' }),
      wine(0.6, 'Barbadillo · Palomino Fina · 2010'),
      wine(0.8, 'Trumpeter · Torrontés · 2009'),
      wine(1, 'Castillo de Monséran · Viura · 2009'),
    ];
    const result = planAutoLayout(bottles, { size, style, includeMaps: false, cover: false });
    expect(result.sections.map(({ place, pack }) => ({ place, pack }))).toEqual([
      { place: 'Thanksgiving tasting', pack: 'wine' },
    ]);
    const notes = result.pages.filter((page) => TASTING_LAYOUTS.includes(page.layout));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.flatMap((page) => page.slots.map(({ caption }) => caption))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Producer: /)]),
    );
    // the other bottles are named below their photos
    const named = result.pages.filter((page) => !TASTING_LAYOUTS.includes(page.layout)).flatMap((page) => page.slots);
    expect(named.every(({ caption }) => !caption?.includes('Producer:'))).toBe(true);

    counter = 0;
    const dishes = Array.from({ length: 6 }, (_, index) =>
      photo(index * 0.2, { pack: 'food', place: 'Trattoria', kind: 'entry', entry: `Dish ${index + 1}` }),
    );
    const food = planAutoLayout(dishes, { size, style: bookStylePresets.food.style, includeMaps: false, cover: false });
    expect(food.pages.some((page) => TASTING_LAYOUTS.includes(page.layout))).toBe(false);
  });

  it('should lay out the drinks of a meal in the chapter of the meal, at the same restaurant', () => {
    counter = 0;
    const menu = photo(0.4, { pack: 'food', place: 'Noma Australia', kind: 'source' }, { width: 2000, height: 3000 });
    const dishes = [0.5, 1, 1.5, 2, 2.5].map((hours, index) =>
      photo(hours, { pack: 'food', place: 'Noma Australia', kind: 'entry', entry: `Course ${index + 1}` }),
    );
    const drinks = [wine(0, 'Snakebite', 'Noma Australia'), wine(3.3, 'Edge Brewing Project · Ale', 'Noma Australia')];
    // another restaurant, and the same name another day, are other chapters
    const elsewhere = wine(1, 'Kudos · Pinot Noir · 2012', 'Katz’s');
    const later = wine(30, 'Kudos · Pinot Noir · 2012', 'Noma Australia');

    const { visits } = getPlaceVisits([menu, ...dishes, ...drinks, elsewhere, later]);
    expect(visits.map(({ pack, place, photos }) => [pack, place, photos.length])).toEqual([
      ['food', 'Noma Australia', 8],
      ['wine', 'Katz’s', 1],
      ['wine', 'Noma Australia', 1],
    ]);
    expect(getEntryCaption(drinks[1], { layout: 'dish' })).toBe('Edge Brewing Project · Ale');
    expect(getEntryCaption(drinks[1], { layout: TASTING_NOTE_LAYOUT })).toBe(
      'Producer: Edge Brewing Project\nWine: Ale',
    );
  });

  it('should review bottles without a readable name and bottles on several photos', () => {
    expect(isUnreadableWine('Unknown bottle')).toBe(true);
    expect(isUnreadableWine('Snarbtghte')).toBe(true);
    expect(isUnreadableWine('Snakebite')).toBe(false);
    expect(isUnreadableWine('Kudos · 2012')).toBe(false);

    expect(
      reviewWineBook({
        pages: [],
        photos: [],
        chapters: [
          {
            place: 'Noma Australia',
            placed: [
              { entry: 'Snakebite', assetIds: ['a', 'b'] },
              { entry: 'Wine', assetIds: ['c'] },
            ],
            available: [],
            pages: [3, 4],
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        severity: 'medium',
        message: expect.stringContaining('without a readable name'),
        assetIds: ['c'],
      }),
      expect.objectContaining({
        severity: 'low',
        message: expect.stringContaining('on more than one photo'),
        assetIds: ['b'],
      }),
    ]);

    counter = 0;
    const [first, second] = [wine(0, 'Snakebite', 'Noma Australia'), wine(0.1, 'Snakebite', 'Noma Australia')];
    const review = reviewBook({
      size,
      style,
      pages: [
        {
          layout: 'tasting-notes',
          assets: [first, second].map(({ id }, slot) => ({
            slot,
            assetId: id,
            crop: null,
            caption: 'Wine: Snakebite',
          })),
        },
      ],
      photos: [first, second],
    });
    expect(review.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('on more than one photo') })]),
    );
  });
});
