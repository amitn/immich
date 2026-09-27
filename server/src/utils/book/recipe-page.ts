import type { PxRect } from 'src/utils/book/layouts.js';
import type { PageDecoration, PageTextBlock } from 'src/utils/book/render.js';

/*
 * The recipe page of a cookbook (the `recipe` layout): the caption typeset as a recipe below the photo of the card.
 * The caption is plain text a person can edit (see `formatRecipeText` of the cookbook pack): an optional first
 * paragraph of meta ("Prep 25 minutes · Bake 52 minutes"), then paragraphs under headings that end with a colon:
 * "Ingredients:" (a line per ingredient), "Method:" (numbered steps, "1. Preheat the oven...") and sub-recipes
 * ("Basic Buttercream Frosting:" with its ingredients and steps). The ingredients are set in a narrow column on the
 * left, the steps in a wider one on the right, as in a family cookbook.
 */

type Item = { kind: 'heading' | 'ingredient' | 'text'; text: string } | { kind: 'step'; n: string; text: string };

export type RecipeText = { meta?: string; ingredients: Item[]; method: Item[] };

const HEADING = /^(.{1,60}):\s*$/;
const STEP = /^(\d{1,2})[.)]\s+(.+)$/;
const INGREDIENTS = /^ingredients?$/i;
const METHOD = /^(?:method|directions?|instructions?|preparation|steps?)$/i;

/** Reads the recipe of a caption; a caption without headings or steps is text in the method column */
export const parseRecipeText = (caption: string): RecipeText => {
  const paragraphs = caption
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .filter((lines) => lines.length > 0);
  const recipe: RecipeText = { ingredients: [], method: [] };
  for (const [index, lines] of paragraphs.entries()) {
    const heading = HEADING.exec(lines[0])?.[1];
    if (index === 0 && !heading && lines.length === 1 && !STEP.test(lines[0])) {
      recipe.meta = lines[0];
      continue;
    }
    const body = heading ? lines.slice(1) : lines;
    const steps = body.flatMap((line): Item[] => {
      const step = STEP.exec(line);
      return step ? [{ kind: 'step', n: step[1], text: step[2] }] : [];
    });
    const others = body.filter((line) => !STEP.test(line));
    const isIngredients = heading
      ? !METHOD.test(heading)
      : steps.length === 0 && others.length > 1 && others.every((line) => !/[.!?]$/.test(line));
    // a sub-recipe's ingredients on the left and its steps on the right, each under its name
    if (isIngredients && others.length > 0) {
      recipe.ingredients.push(
        ...(heading ? [{ kind: 'heading' as const, text: INGREDIENTS.test(heading) ? 'Ingredients' : heading }] : []),
        ...others.map((text) => ({ kind: 'ingredient' as const, text })),
      );
    }
    const method: Item[] = [
      ...steps,
      ...(isIngredients ? [] : others.map((text) => ({ kind: 'text' as const, text }))),
    ];
    if (method.length === 0) {
      continue;
    }
    const name = heading && !INGREDIENTS.test(heading) ? heading : 'Method';
    recipe.method.push({ kind: 'heading', text: METHOD.test(name) ? 'Method' : name }, ...method);
  }
  return recipe;
};

export type RecipeBlockOptions = {
  /** the caption's font size in pixels */
  fontPx: number;
  ink: string;
  accent: string;
  /** pixels per millimeter, for the rules */
  pxPerMm: number;
  /** wraps text into lines, see `wrapText` */
  wrap: (text: string, widthPx: number, fontPx: number, charWidth: number) => string[];
  lineHeight: number;
  charWidth: number;
  smallCapsCharWidth: number;
};

type Placed = { blocks: PageTextBlock[]; height: number };

/** the text blocks of a column of items from `top`, and how tall they are */
const placeColumn = (
  items: Item[],
  left: number,
  top: number,
  width: number,
  fontPx: number,
  options: RecipeBlockOptions,
): Placed => {
  const { wrap, lineHeight, charWidth, smallCapsCharWidth, ink, accent } = options;
  const blocks: PageTextBlock[] = [];
  let y = top;
  for (const [index, item] of items.entries()) {
    if (item.kind === 'heading') {
      y += index === 0 ? 0 : fontPx * 0.9;
      const headingPx = fontPx * 1.05;
      const letterSpacing = 0.1;
      const lines = wrap(item.text, width, headingPx, smallCapsCharWidth + letterSpacing);
      const height = lines.length * headingPx * lineHeight;
      blocks.push({
        kind: 'caption',
        rect: { left, top: y, width, height },
        text: item.text,
        fontPx: headingPx,
        align: 'left',
        color: accent,
        smallCaps: true,
        letterSpacing,
        valign: 'top',
      });
      y += height + fontPx * 0.25;
      continue;
    }
    if (item.kind === 'step') {
      const indent = fontPx * 1.6;
      const lines = wrap(item.text, width - indent, fontPx, charWidth);
      const height = lines.length * fontPx * lineHeight;
      blocks.push(
        {
          kind: 'caption',
          rect: { left, top: y, width: indent, height: fontPx * lineHeight },
          text: `${item.n}.`,
          fontPx,
          align: 'left',
          color: accent,
          bold: true,
          valign: 'top',
        },
        {
          kind: 'caption',
          rect: { left: left + indent, top: y, width: width - indent, height },
          text: item.text,
          fontPx,
          align: 'left',
          color: ink,
          valign: 'top',
        },
      );
      y += height + fontPx * 0.4;
      continue;
    }
    const lines = wrap(item.text, width, fontPx, charWidth);
    const height = lines.length * fontPx * lineHeight;
    blocks.push({
      kind: 'caption',
      rect: { left, top: y, width, height },
      text: item.text,
      fontPx,
      align: 'left',
      color: ink,
      valign: 'top',
    });
    y += height + fontPx * (item.kind === 'ingredient' ? 0.22 : 0.4);
  }
  return { blocks, height: y - top };
};

/** at most this much smaller than the caption's size, then the last items are left out */
const MIN_SCALE = 0.62;

/**
 * The text blocks and rules of a recipe caption in `rect`: the meta line in italics under a rule, the ingredients in
 * the left column and the method in the right one, at the largest size (up to the caption's) that fits.
 */
export const getRecipeBlocks = (
  caption: string,
  rect: PxRect,
  options: RecipeBlockOptions,
): { blocks: PageTextBlock[]; decorations: PageDecoration[] } => {
  const recipe = parseRecipeText(caption);
  const gap = rect.width * 0.05;
  const hasIngredients = recipe.ingredients.length > 0;
  const leftWidth = hasIngredients ? rect.width * 0.36 : 0;
  const rightLeft = rect.left + (hasIngredients ? leftWidth + gap : 0);
  const rightWidth = rect.width - (hasIngredients ? leftWidth + gap : 0);

  const layout = (fontPx: number, ingredients: Item[], method: Item[]) => {
    const blocks: PageTextBlock[] = [];
    const decorations: PageDecoration[] = [];
    let top = rect.top;
    if (recipe.meta) {
      const metaPx = fontPx * 0.95;
      const lines = options.wrap(recipe.meta, rect.width, metaPx, options.charWidth);
      const height = lines.length * metaPx * options.lineHeight;
      blocks.push({
        kind: 'caption',
        rect: { left: rect.left, top, width: rect.width, height },
        text: recipe.meta,
        fontPx: metaPx,
        align: 'center',
        color: options.accent,
        italic: true,
        valign: 'top',
      });
      top += height + fontPx * 0.5;
      const ruleWidth = Math.min(rect.width * 0.5, options.pxPerMm * 60);
      const x1 = rect.left + (rect.width - ruleWidth) / 2;
      decorations.push({
        kind: 'line',
        x1,
        y1: top,
        x2: x1 + ruleWidth,
        y2: top,
        color: options.accent,
        width: options.pxPerMm * 0.25,
        opacity: 0.7,
      });
      top += fontPx * 0.9;
    }
    const left = placeColumn(ingredients, rect.left, top, leftWidth, fontPx, options);
    const right = placeColumn(method, rightLeft, top, rightWidth, fontPx, options);
    if (hasIngredients && method.length > 0) {
      // a hairline between the columns
      const x = rect.left + leftWidth + gap / 2;
      decorations.push({
        kind: 'line',
        x1: x,
        y1: top,
        x2: x,
        y2: top + Math.max(left.height, right.height),
        color: options.accent,
        width: options.pxPerMm * 0.15,
        opacity: 0.45,
      });
    }
    blocks.push(...left.blocks, ...right.blocks);
    const bottom = top + Math.max(left.height, right.height);
    return { blocks, decorations, fits: bottom <= rect.top + rect.height };
  };

  for (let scale = 1; scale >= MIN_SCALE; scale *= 0.94) {
    const result = layout(options.fontPx * scale, recipe.ingredients, recipe.method);
    if (result.fits) {
      return result;
    }
  }
  // too long even at the smallest size: the last steps and ingredients are left out
  let ingredients = recipe.ingredients;
  let method = recipe.method;
  const fontPx = options.fontPx * MIN_SCALE;
  let result = layout(fontPx, ingredients, method);
  while (!result.fits && (ingredients.length > 1 || method.length > 1)) {
    if (method.length >= ingredients.length) {
      method = method.slice(0, -1);
    } else {
      ingredients = ingredients.slice(0, -1);
    }
    result = layout(fontPx, ingredients, method);
  }
  return result;
};
