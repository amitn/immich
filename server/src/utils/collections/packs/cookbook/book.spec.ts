import { describe, expect, it } from 'vitest';
import { bookStylePresets } from 'src/dtos/book.dto.js';
import { AutoLayoutPhoto, planAutoLayout } from 'src/utils/book/auto-layout.js';
import { getPlaceVisits } from 'src/utils/book/collections.js';
import { parseRecipeText } from 'src/utils/book/recipe-page.js';
import { planPage } from 'src/utils/book/render.js';
import { reviewBook } from 'src/utils/book/review.js';
import { getStepCaption, reviewRecipeChapter } from 'src/utils/collections/packs/cookbook/pack.js';

const HOUR = 60 * 60 * 1000;
const start = Date.UTC(2006, 10, 15, 18);
const size = { pageWidthMm: 210, pageHeightMm: 210 };
const style = bookStylePresets.cookbook.style;

const RECIPE_TEXT = [
  'Prep 25 minutes · Bake 52 minutes',
  'Ingredients:\n4 beaten eggs\n1½ cups half-and-half',
  'Method:\n1. Preheat the oven to 450 degrees.\n2. Whisk the eggs and half-and-half.',
  'Basic Buttercream Frosting:\n2 tablespoons milk\n1. Beat until fluffy.',
].join('\n\n');

let counter = 0;
const photo = (hours: number, collection: AutoLayoutPhoto['collection'], extra: Partial<AutoLayoutPhoto> = {}) => {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    width: 3000,
    height: 2000,
    takenAt: start + hours * HOUR,
    score: 0.6,
    faces: [],
    isFavorite: false,
    collection,
    ...extra,
  } satisfies AutoLayoutPhoto;
};
const entry = (hours: number, name: string) =>
  photo(hours, { pack: 'cookbook', place: 'Quiche', kind: 'entry', entry: name });

describe('the cookbook in books', () => {
  it('should caption steps and the finished dish', () => {
    expect(getStepCaption('Step 1: Preheat the oven')).toBe('1. Preheat the oven');
    expect(getStepCaption('Frosting step 2: Add the vanilla')).toBe('Frosting 2. Add the vanilla');
    expect(getStepCaption('Step 3')).toBe('Step 3');
    expect(getStepCaption('Result')).toBe('Finished dish');
  });

  it('should read a recipe caption into its columns', () => {
    const recipe = parseRecipeText(RECIPE_TEXT);
    expect(recipe.meta).toBe('Prep 25 minutes · Bake 52 minutes');
    expect(recipe.ingredients.map(({ kind, text }) => `${kind}:${text}`)).toEqual([
      'heading:Ingredients',
      'ingredient:4 beaten eggs',
      'ingredient:1½ cups half-and-half',
      'heading:Basic Buttercream Frosting',
      'ingredient:2 tablespoons milk',
    ]);
    expect(recipe.method.map((item) => (item.kind === 'step' ? `${item.n}. ${item.text}` : item.text))).toEqual([
      'Method',
      '1. Preheat the oven to 450 degrees.',
      '2. Whisk the eggs and half-and-half.',
      'Basic Buttercream Frosting',
      '1. Beat until fluffy.',
    ]);
    // any other caption is text of the method
    expect(parseRecipeText('A family favourite.\nServed every Sunday.').method.map(({ text }) => text)).toEqual([
      'Method',
      'A family favourite.',
      'Served every Sunday.',
    ]);
  });

  it('should open a chapter per recipe with the recipe page, even when the recipe is photographed the day after', () => {
    counter = 0;
    const recipe = photo(
      17,
      { pack: 'cookbook', place: 'Quiche', kind: 'source' },
      { sourcePage: { text: RECIPE_TEXT, layout: 'recipe' } },
    );
    const photos = [
      entry(0, 'Step 1: Preheat the oven'),
      entry(0.5, 'Step 2: Whisk the eggs'),
      entry(0.6, 'Step 2: Whisk the eggs'),
      entry(1.5, 'Result'),
      entry(1.6, 'Result'),
      recipe,
    ];
    expect(getPlaceVisits(photos).visits).toHaveLength(1);

    const result = planAutoLayout(photos, { size, style, includeMaps: false, cover: false });
    const opener = result.pages.find((page) => page.layout === 'recipe')!;
    expect(opener.slots.map(({ assetId }) => assetId)).toEqual([recipe.id]);
    expect(opener.caption).toBe(RECIPE_TEXT);
    expect(opener.sectionTitle).toMatch(/^Quiche/);
    // the recipe page comes first, then the steps and the finished dish with their captions
    const pages = result.pages.filter((page) => page.layout !== 'cover');
    expect(pages[0]).toBe(opener);
    expect(pages.flatMap((page) => page.slots.map((slot) => slot.caption)).filter(Boolean)).toEqual(
      expect.arrayContaining(['1. Preheat the oven', '2. Whisk the eggs', 'Finished dish']),
    );
  });

  it('should typeset the recipe page', () => {
    const plan = planPage(
      { ...size, title: 'Family Cookbook', subtitle: null, style, coverAssetId: null },
      {
        layout: 'recipe',
        sectionTitle: 'Quiche · 15 November 2006',
        caption: RECIPE_TEXT,
        background: null,
        assets: [{ slot: 0, assetId: 'recipe', crop: null, caption: null }],
      },
      { dpi: 100, mode: 'review', sources: new Map([['recipe', { input: '/recipe.jpg', width: 3000, height: 2000 }]]) },
    );
    const texts = plan.text.map(({ text }) => text);
    expect(texts).toEqual(
      expect.arrayContaining([
        'Prep 25 minutes · Bake 52 minutes',
        'Ingredients',
        '4 beaten eggs',
        'Method',
        '1.',
        'Preheat the oven to 450 degrees.',
        'Basic Buttercream Frosting',
      ]),
    );
    // the ingredients on the left of the steps, all of it inside the page
    const ingredient = plan.text.find(({ text }) => text === '4 beaten eggs')!;
    const step = plan.text.find(({ text }) => text === 'Preheat the oven to 450 degrees.')!;
    expect(ingredient.rect.left + ingredient.rect.width).toBeLessThan(step.rect.left);
    for (const block of plan.text) {
      expect(block.rect.top + block.rect.height).toBeLessThanOrEqual(plan.spec.height);
    }
  });

  it('should review a recipe without its finished dish or with steps missing', () => {
    expect(
      reviewRecipeChapter({
        place: 'Quiche',
        placed: [
          { entry: 'Step 1: Preheat the oven', assetIds: ['a'] },
          { entry: 'Step 3: Pour', assetIds: ['c'] },
        ],
        available: [
          { entry: 'Step 1: Preheat the oven', assetIds: ['a'] },
          { entry: 'Step 2: Whisk', assetIds: ['b'] },
          { entry: 'Step 3: Pour', assetIds: ['c'] },
          { entry: 'Result', assetIds: ['d'] },
        ],
        pages: [2],
      }),
    ).toEqual([
      {
        severity: 'medium',
        message: expect.stringContaining('no photo of the finished dish, which is in the album'),
        assetIds: ['d'],
      },
      { severity: 'medium', message: expect.stringContaining('no photo of step 2'), assetIds: ['b'] },
    ]);

    counter = 0;
    const steps = [entry(0, 'Step 1: Preheat the oven'), entry(1, 'Step 3: Pour')];
    const review = reviewBook({
      size,
      style,
      pages: [
        { layout: 'dish-pair', assets: steps.map(({ id }, slot) => ({ slot, assetId: id, crop: null, caption: 'x' })) },
      ],
      photos: steps,
    });
    expect(review.issues.filter(({ message }) => message.includes('Quiche'))).toEqual([
      expect.objectContaining({ type: 'missing-dish-name', severity: 'low', pages: [1] }),
      expect.objectContaining({
        type: 'missing-dish-name',
        severity: 'low',
        message: expect.stringContaining('step 2'),
      }),
    ]);
  });
});
