import { describe, expect, it } from 'vitest';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { levelBoxes } from 'src/utils/collections/packs/cookbook/page.js';
import {
  RESULT_ENTRY,
  UNREAD_STEP,
  formatRecipeText,
  getIngredientName,
  getStepAction,
  getStepName,
  isIngredientLine,
  normalizeQuantity,
  parseRecipe,
  readRecipes,
  splitMeta,
} from 'src/utils/collections/packs/cookbook/recipe.js';

type Line = [text: string, left: number, top: number, height?: number];

/** OCR boxes of lines at (left, top) on a square photo, about as wide as their text, tilted by `degrees` */
const page = (lines: Line[], degrees = 0): OcrBoxInput[] => {
  const angle = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  // rotate about the middle of the photo, as a page photographed at an angle
  const rotate = (x: number, y: number) => [
    0.5 + (x - 0.5) * cos - (y - 0.5) * sin,
    0.5 + (x - 0.5) * sin + (y - 0.5) * cos,
  ];
  return lines.map(([text, left, top, height = 0.02]) => {
    const right = left + text.length * height * 0.42;
    const bottom = top + height;
    const [x1, y1] = rotate(left, top);
    const [x2, y2] = rotate(right, top);
    const [x3, y3] = rotate(right, bottom);
    const [x4, y4] = rotate(left, bottom);
    return { x1, y1, x2, y2, x3, y3, x4, y4, text, textScore: 0.95 };
  });
};

/** a cookbook page: the quiche on the left, a spinach quiche beside it, the end of the quiche's method above it */
const COOKBOOK_PAGE: Line[] = [
  ['Quiche', 0.05, 0.1, 0.04],
  ['Prep: 25 minutes Bake: 52 minutes', 0.05, 0.16],
  ['Makes: 6 servings', 0.05, 0.19],
  ['1 recipe Pastry for Single-Crust Pie', 0.07, 0.24],
  ['4 beaten eggs', 0.07, 0.27],
  ['11/2 cups half-and-half', 0.07, 0.3],
  ['14 cup sliced green onions', 0.07, 0.33],
  ['3%cup chopped cooked ham,', 0.07, 0.36],
  ['chicken, or crabmeat', 0.1, 0.39],
  ['Dash ground nutmeg', 0.07, 0.42],
  ['1. Preheat the oven to 450 degrees.', 0.05, 0.5],
  ['Line a pie plate with pastry.', 0.05, 0.53],
  ['2. In a bowl whisk the eggs and', 0.05, 0.56],
  ['half-and-half; stir in onions and ham.', 0.05, 0.59],
  ['3. Pour into the pastry shell and bake', 0.05, 0.62],
  ['until a knife comes out clean.', 0.05, 0.65],
  ['Nutrition Facts per serving: 411 cal.', 0.55, 0.1],
  ['Spinach Quiche', 0.55, 0.2, 0.04],
  ['Prep: 25 minutes Bake: 57 minutes', 0.55, 0.26],
  ['8 beaten eggs', 0.57, 0.3],
  ['1/2 cup dairy sour cream', 0.57, 0.33],
  ['6 slices bacon, chopped', 0.57, 0.36],
  ['1. Cook the bacon in a skillet.', 0.55, 0.42],
];

describe('normalizeQuantity', () => {
  it('should read fraction glyphs as OCR garbles them, where the evidence is clear', () => {
    expect(normalizeQuantity('1/2 cup (1 stick) butter')).toBe('½ cup (1 stick) butter');
    expect(normalizeQuantity('11/2 cups sugar')).toBe('1½ cups sugar');
    expect(normalizeQuantity('1/zcups shredded Swiss')).toBe('1½ cups shredded Swiss');
    expect(normalizeQuantity('2/2 cups confectioners sugar')).toBe('2½ cups confectioners sugar');
    expect(normalizeQuantity('14cup sliced green onions')).toBe('¼ cup sliced green onions');
    expect(normalizeQuantity('3 cup chopped cooked ham')).toBe('¾ cup chopped cooked ham');
    expect(normalizeQuantity('1%cups milk')).toBe('1½ cups milk');
    expect(normalizeQuantity('3%cup shredded cheese')).toBe('¾ cup shredded cheese');
    expect(normalizeQuantity('V2 cup sour cream')).toBe('½ cup sour cream');
    expect(normalizeQuantity('i cup diced ham')).toBe('1 cup diced ham');
    expect(normalizeQuantity('crabmeat (about 3/2 ounces)')).toBe('crabmeat (about 3½ ounces)');
  });

  it('should leave quantities alone when the evidence is not clear', () => {
    expect(normalizeQuantity('4 beaten eggs')).toBe('4 beaten eggs');
    expect(normalizeQuantity('12 cupcake liners')).toBe('12 cupcake liners');
    expect(normalizeQuantity('2 teaspoons vanilla extract')).toBe('2 teaspoons vanilla extract');
    // a lost glyph leaves a stray mark, not a quantity
    expect(normalizeQuantity("' teaspoon black pepper")).toBe('teaspoon black pepper');
  });
});

describe('recipe lines', () => {
  it('should tell ingredients from steps and cookware', () => {
    expect(isIngredientLine('1 recipe Pastry for Single-Crust Pie')).toBe(true);
    expect(isIngredientLine('Dash ground nutmeg')).toBe(true);
    expect(isIngredientLine('cup diced cooked ham')).toBe(true);
    expect(isIngredientLine('2 Add the vanilla and milk')).toBe(false);
    expect(isIngredientLine('2-quart square baking dish with non-')).toBe(false);
  });

  it('should split the meta line', () => {
    expect(splitMeta('Prep: 25 minutes Bake:40minutes Oven: 350°F')).toEqual([
      'Prep 25 minutes',
      'Bake 40 minutes',
      'Oven 350°F',
    ]);
  });

  it('should name steps and ingredients in a few words', () => {
    expect(getStepAction('Preheat the oven to 350 degrees.')).toBe('Preheat the oven');
    expect(getStepAction("Combine the confectioners' sugar and butter in the bowl")).toBe(
      "Combine the confectioners' sugar and butter",
    );
    expect(
      getStepName({ n: 2, text: 'Add the vanilla and milk and beat', section: 'Basic Buttercream Frosting' }),
    ).toBe('Frosting step 2: Add the vanilla and milk');
    expect(getStepName({ n: 3, text: 'until a knife comes out clean', partial: true })).toBe('Step 3');
    expect(getIngredientName('1½ cups shredded Swiss, cheddar, or Havarti cheese (6 ounces)')).toBe('shredded Swiss');
  });
});

describe('readRecipes', () => {
  it('should read a recipe and keep the recipe beside it apart', () => {
    const { recipes } = readRecipes(page(COOKBOOK_PAGE));
    expect(recipes.map(({ title }) => title)).toEqual(['Quiche', 'Spinach Quiche']);
    const [quiche, spinach] = recipes;
    expect(quiche.meta).toEqual(['Prep 25 minutes', 'Bake 52 minutes', 'Makes 6 servings']);
    expect(quiche.ingredients.map(({ text }) => text)).toEqual([
      '1 recipe Pastry for Single-Crust Pie',
      '4 beaten eggs',
      '1½ cups half-and-half',
      '¼ cup sliced green onions',
      '¾ cup chopped cooked ham, chicken, or crabmeat',
      'Dash ground nutmeg',
    ]);
    expect(quiche.steps.map(({ n, text }) => [n, text])).toEqual([
      [1, 'Preheat the oven to 450 degrees. Line a pie plate with pastry.'],
      [2, 'In a bowl whisk the eggs and half-and-half; stir in onions and ham.'],
      [3, 'Pour into the pastry shell and bake until a knife comes out clean.'],
    ]);
    expect(spinach.ingredients.map(({ text }) => text)).toEqual([
      '8 beaten eggs',
      '½ cup dairy sour cream',
      '6 slices bacon, chopped',
    ]);
  });

  it('should read a page photographed at a steep angle', () => {
    const tilted = page(COOKBOOK_PAGE, -30);
    expect(levelBoxes(tilted)[0].y2).toBeCloseTo(levelBoxes(tilted)[0].y1, 5);
    const [quiche] = readRecipes(tilted).recipes;
    expect(quiche.title).toBe('Quiche');
    expect(quiche.ingredients).toHaveLength(6);
    expect(quiche.steps.map(({ n }) => n)).toEqual([1, 2, 3]);
  });

  it('should number the steps of a sub-recipe apart, and infer numbers OCR lost', () => {
    const { recipes } = readRecipes(
      page([
        ['SIMPLE CUPCAKES', 0.1, 0.05, 0.03],
        ['2 cups all-purpose flour', 0.1, 0.12],
        ['3 large eggs', 0.1, 0.15],
        ['Preheat the oven to 350 degrees.', 0.1, 0.22],
        ['2 Butter two muffin pans.', 0.1, 0.25],
        ['BASIC BUTTERCREAM FROSTING', 0.55, 0.05],
        ['2 tablespoons milk', 0.55, 0.08],
        ['1 Combine the sugar and butter.', 0.55, 0.13],
        ['2 Add the vanilla and milk.', 0.55, 0.16],
        ['Spread on top of the cooled cupcakes.', 0.55, 0.205],
      ]),
    );
    const [cupcakes] = recipes;
    expect(cupcakes.title).toBe('Simple Cupcakes');
    expect(cupcakes.sections).toEqual(['Basic Buttercream Frosting']);
    expect(cupcakes.steps.map(({ n, section }) => [n, section])).toEqual([
      [1, undefined],
      [2, undefined],
      [1, 'Basic Buttercream Frosting'],
      [2, 'Basic Buttercream Frosting'],
      [3, 'Basic Buttercream Frosting'],
    ]);
    expect(cupcakes.ingredients.at(-1)).toEqual({ text: '2 tablespoons milk', section: 'Basic Buttercream Frosting' });
  });
});

describe('parseRecipe', () => {
  it('should list the steps and the finished dish, with the other recipes as alternatives', () => {
    const parsed = parseRecipe(page(COOKBOOK_PAGE));
    expect(parsed.title).toBe('Quiche');
    expect(parsed.items.map(({ name }) => name)).toEqual([
      'Step 1: Preheat the oven',
      'Step 2: In a bowl whisk the eggs',
      'Step 3: Pour into the pastry shell',
      RESULT_ENTRY,
    ]);
    expect(parsed.items.at(-1)?.description).toBe('the finished Quiche');
    expect(parsed.alternatives?.map(({ title }) => title)).toEqual(['Spinach Quiche']);
  });

  it('should hint at the ingredients of a step whose text is off the photo', () => {
    const parsed = parseRecipe(
      page([
        ['Quiche', 0.05, 0.1, 0.04],
        ['4 beaten eggs', 0.07, 0.2],
        ['1 cup chopped ham', 0.07, 0.23],
        ['1. Prepare the pastry shell with the pie crust.', 0.05, 0.3],
        ['3. Bake until a knife comes out clean.', 0.05, 0.33],
      ]),
    );
    expect(parsed.items.map(({ name }) => name)).toEqual([
      'Step 1: Prepare the pastry shell',
      'Step 2',
      'Step 3: Bake',
      RESULT_ENTRY,
    ]);
    expect(parsed.items[1].description).toBe(`${UNREAD_STEP}: beaten eggs, chopped ham`);
  });

  it('should read nothing from a photo with a word or two', () => {
    expect(parseRecipe(page([['FRIGIDAIRE', 0.4, 0.4]])).items).toEqual([]);
  });
});

describe('formatRecipeText', () => {
  it('should typeset the tagged recipe of the page for its book page', () => {
    const recipes = readRecipes(page(COOKBOOK_PAGE));
    const text = formatRecipeText(recipes, 'Quiche')!;
    expect(text.split('\n\n')).toEqual([
      'Prep 25 minutes · Bake 52 minutes · Makes 6 servings',
      [
        'Ingredients:',
        '1 recipe Pastry for Single-Crust Pie',
        '4 beaten eggs',
        '1½ cups half-and-half',
        '¼ cup sliced green onions',
        '¾ cup chopped cooked ham, chicken, or crabmeat',
        'Dash ground nutmeg',
      ].join('\n'),
      [
        'Method:',
        '1. Preheat the oven to 450 degrees. Line a pie plate with pastry.',
        '2. In a bowl whisk the eggs and half-and-half; stir in onions and ham.',
        '3. Pour into the pastry shell and bake until a knife comes out clean.',
      ].join('\n'),
    ]);
    expect(formatRecipeText(recipes, 'Spinach Quiche')).toContain('8 beaten eggs');
    expect(formatRecipeText(recipes, 'Quiche', 200)!.length).toBeLessThanOrEqual(200);
  });
});
