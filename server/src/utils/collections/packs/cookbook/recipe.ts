import { OcrBoxInput, median } from 'src/utils/collections/ocr.js';
import { PageLine, getOffset, readPage } from 'src/utils/collections/packs/cookbook/page.js';
import { toTitleCase } from 'src/utils/collections/place.js';
import { ParsedSource, SourceEntry, SourceParseOptions } from 'src/utils/collections/source.js';
import { stripAccents } from 'src/utils/collections/text.js';

/*
 * Reading a recipe from a photo of a handwritten card or a printed cookbook page: its title, the meta line (serves,
 * prep and bake times), the ingredients (quantities with fractions and units) and the steps, numbered or in
 * paragraphs, with the sub-recipes (a frosting) as sections. A cookbook page often shows the neighbouring recipes too
 * (the end of a soufflé, a spinach variant cut off at the edge): each titled recipe is read on its own, the one with
 * the most content first, and the text of no recipe is mixed into another.
 */

export type RecipeIngredient = { text: string; section?: string };

export type RecipeStep = {
  /** the number of the step within its section, 1-based */
  n: number;
  /** the text as read; none for a step whose number is known but whose text is off the photo */
  text?: string;
  /** the sub-recipe, e.g. "Basic Buttercream Frosting" */
  section?: string;
  /** the step was read from its number or its first words; a continued paragraph has lost its beginning */
  partial?: boolean;
};

export type Recipe = {
  title?: string;
  /** e.g. "Prep 25 minutes", "Bake 52 minutes", "Oven 450°F", "Makes 6 servings" */
  meta: string[];
  intro?: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  /** variations, tips and the cook's additions, e.g. "Vegetarian Quiche: omit the ham..." */
  notes: string[];
  /** the sub-recipes, e.g. a frosting */
  sections: string[];
  /** normalized 0..1 on the photo: left, top, right, bottom */
  box: [number, number, number, number];
};

export type RecipePage = {
  /** the recipes on the page, the main one (most content) first */
  recipes: Recipe[];
  columns: number;
  lines: number;
};

// ----------------------------------------------------------------------------------------------------------------
// quantities

const FRACTIONS: Record<string, string> = {
  '1/2': '½',
  '1/3': '⅓',
  '2/3': '⅔',
  '1/4': '¼',
  '3/4': '¾',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
};
/** a fraction glyph read as two digits ("¼" as "14") before a singular unit */
const GLYPH_DIGITS: Record<string, string> = {
  '12': '½',
  '13': '⅓',
  '23': '⅔',
  '14': '¼',
  '34': '¾',
  '18': '⅛',
  '38': '⅜',
  '58': '⅝',
  '78': '⅞',
};
const VULGAR = '½⅓⅔¼¾⅛⅜⅝⅞';

const SINGULAR_UNITS = new Set([
  'cup',
  'teaspoon',
  'tablespoon',
  'tsp',
  'tbsp',
  'ounce',
  'oz',
  'pound',
  'lb',
  'pint',
  'quart',
  'gallon',
  'stick',
  'can',
  'package',
  'envelope',
  'slice',
  'clove',
  'recipe',
  'inch',
]);
const UNIT_WORDS =
  '(?:cups?|teaspoons?|tablespoons?|tsps?|tbsps?|ounces?|oz|pounds?|lbs?|pints?|quarts?|gallons?|sticks?|cans?|packages?|pkgs?|envelopes?|slices?|cloves?|grams?|g|kg|ml|liters?|litres?|l|dl|cl|pinch(?:es)?|dash(?:es)?|recipes?|inch(?:es)?|large|medium|small|whole)';
const UNIT = new RegExp(String.raw`^${UNIT_WORDS}\b\.?`, 'i');

/** the unit a quantity is followed by, and whether it says one or less ("cup") or more ("cups") */
const unitAfter = (rest: string) => {
  const word = /^\s*([a-z]+)/i.exec(rest)?.[1]?.toLowerCase();
  if (!word) {
    return;
  }
  if (SINGULAR_UNITS.has(word)) {
    return 'singular';
  }
  if (word.endsWith('s') && SINGULAR_UNITS.has(word.slice(0, -1))) {
    return 'plural';
  }
};

const asFraction = (numerator: string, denominator: string) => FRACTIONS[`${numerator}/${denominator}`];

/** the quantity at the start of a line and what follows it → the quantity as printed, when OCR garbled it */
const QUANTITY_REPAIRS: Array<[RegExp, (match: RegExpExecArray, rest: string) => string | undefined]> = [
  // 1 1/2
  [
    /^(\d+)\s+(\d)\/(\d)(?=\s|\p{L}|$)/u,
    ([, whole, a, b]) => (asFraction(a, b) ? `${whole}${asFraction(a, b)}` : undefined),
  ],
  // 11/2 cups: a mixed number that lost its space
  [/^(\d)1\/([2348])(?=\s|\p{L}|$)/u, ([, whole, b]) => `${whole}${asFraction('1', b)}`],
  [
    /^(\d)\/(\d)(?=\s|\p{L}|$)/u,
    ([, numerator, denominator], rest) => {
      const fraction = asFraction(numerator, denominator);
      if (fraction) {
        // "½ cups" is more than one: the whole number before the glyph was lost
        return unitAfter(rest) === 'plural' && numerator === '1' ? `1${fraction}` : fraction;
      }
      // 3/2: the numerator of "½" was lost after a whole number
      return denominator === '2' && Number(numerator) >= 2 ? `${numerator}½` : undefined;
    },
  ],
  // the lower half of a glyph read as "%": "1%cups" is 1½ cups, "3%cup" ¾ cup
  [
    /^(\d)%/,
    ([, digit], rest) => {
      const unit = unitAfter(rest);
      if (unit === 'plural') {
        return `${digit}½`;
      }
      return unit === 'singular' ? { '1': '¼', '3': '¾' }[digit] : undefined;
    },
  ],
  // a glyph read as two digits before a singular unit: "14 cup"
  [/^(\d\d)(?=\s?\p{L})/u, ([, digits], rest) => (unitAfter(rest) === 'singular' ? GLYPH_DIGITS[digits] : undefined)],
  // three of a singular unit is a "¾" glyph
  [/^3(?=\s?(?:cup|teaspoon|tablespoon)\b)/, () => '¾'],
];

/**
 * Reads the quantity at the start of an ingredient line, repairing what OCR makes of fraction glyphs where the
 * evidence is clear: "1/2" → "½", "11/2 cups" → "1½ cups" (a mixed number without its space), "3/2 ounces" → "3½
 * ounces" (the numerator of "½" lost), "1/2 cups" → "1½ cups" (a plural needs more than one), "14 cup" → "¼ cup" and
 * "3 cup" → "¾ cup" (a glyph read as digits before a singular unit), "1%cups" → "1½ cups" and "3%cup" → "¾ cup" (the
 * lower half of a glyph read as "%"), "V2" → "½", "l/z" → "½". Stray marks where a glyph was lost ("' teaspoon") are
 * dropped.
 */
export const normalizeQuantity = (line: string): string => {
  let text = line.trim().replace(/^[\s'’`"‘.,*•■]+(?=\s*\p{L})/u, '');
  // OCR letters for digits inside a fraction: l/z, I/2, 1l/z
  text = text.replace(
    /^([\dlI]{1,2})\s?\/\s?([\dzZ])(?=\s?\p{L}|\s|$)/u,
    (_, a: string, b: string) => `${a.replaceAll(/[lI]/g, '1')}/${b.replaceAll(/[zZ]/g, '2')}`,
  );
  text = text.replace(/^[Vv]2(?=\s|\p{L})/u, '1/2');
  // a lone "i" or "l" for 1 before a unit
  text = text.replace(new RegExp(String.raw`^[ilI](?=\s+${UNIT_WORDS}\b)`, 'i'), '1');
  // garbage left of a unit where a glyph was lost: "S teaspoon", "'h teaspoon"
  text = text.replace(new RegExp(String.raw`^(?:S|'h|’h|h)\s+(?=${UNIT_WORDS}\b)`, 'i'), '');

  for (const [pattern, read] of QUANTITY_REPAIRS) {
    const match = pattern.exec(text);
    const rest = match ? text.slice(match[0].length) : '';
    const quantity = match ? read(match, rest) : undefined;
    if (quantity) {
      text = `${quantity} ${rest.trimStart()}`;
      break;
    }
  }

  // a space between a quantity and its unit: "1½cups" → "1½ cups"
  text = text.replace(new RegExp(String.raw`^([\d${VULGAR}]+)(?=\p{L})`, 'u'), '$1 ');
  return normalizeFractions(text);
};

/** fractions in the middle of a line: "(about 3/2 ounces)" → "(about 3½ ounces)", "1/2 teaspoon" → "½ teaspoon" */
export const normalizeFractions = (line: string) =>
  line
    .replaceAll(
      /(^|[\s(])(\d)\/2(?=\s?(?:ounces?|cups?|teaspoons?|tablespoons?|pounds?)\b)/g,
      (all, before: string, whole: string) => (Number(whole) >= 2 ? `${before}${whole}½` : all),
    )
    .replaceAll(/(^|[\s(])(\d)\s?\/\s?(\d)(?!\d)/g, (all, before: string, a: string, b: string) => {
      const fraction = asFraction(a, b);
      return fraction ? `${before}${fraction}` : all;
    })
    .replaceAll(/\s+/g, ' ')
    .trim();

// ----------------------------------------------------------------------------------------------------------------
// lines

const QUANTITY = new RegExp(String.raw`^(?:about\s+)?(?:[\d${VULGAR}]+(?:\s*[-–]\s*\d+)?|[\d]+\s*[${VULGAR}])`, 'u');

/** first words of ingredients printed without a quantity */
const INGREDIENT_START =
  /^(?:dash|pinch|nonstick|non-stick|salt|pepper|freshly|ground|butter|oil|olive oil|flour|sugar|water|milk|ice|cooking spray|vegetable|fresh|grated|shredded|sliced|chopped|juice|zest)\b/i;
/** of those, the ones that start an ingredient even in lower case below another ("butter, at room temperature" ends one) */
const NEW_INGREDIENT = /^(?:dash|pinch|nonstick|non-stick|salt and|freshly|cooking spray)\b/i;

const META_LABELS = [
  'prep',
  'preparation',
  'prep time',
  'bake',
  'baking',
  'cook',
  'cooking',
  'cook time',
  'stand',
  'chill',
  'cool',
  'marinate',
  'rise',
  'oven',
  'makes',
  'serves',
  'servings',
  'yield',
  'yields',
  'total',
  'total time',
  'start to finish',
  'freeze',
  'grill',
  'roast',
  'broil',
  'slow cook',
];
const META = new RegExp(
  String.raw`(?:^|\s)(${META_LABELS.toSorted((a, b) => b.length - a.length).join('|')})\s*:\s*`,
  'gi',
);
const META_PHRASE =
  /^(?:makes|serves|yields?|servings)\b.*\d|^(?:low fat|low-fat|best loved|quick|easy|vegetarian|make-ahead|kid friendly)$/i;

/** nutrition panels, exchanges, page numbers and chapter tabs */
const FURNITURE =
  /nutrition\s*facts|daily\s*values?|exchanges?\s*:|\b\d+\s*cal\.|total\s*fat|\bcarbo\b|\bsodium\b|\bchol\.|\bprotein\b|\bfiber\b|per\s+serving|^page\s+\d+$|^\d{1,3}$|^[\d\W]+$/i;

/** cooking verbs that start a step */
const STEP_VERBS = new Set(
  [
    'add',
    'arrange',
    'bake',
    'beat',
    'blend',
    'boil',
    'bring',
    'broil',
    'brown',
    'brush',
    'butter',
    'chill',
    'chop',
    'coat',
    'combine',
    'cook',
    'cool',
    'cover',
    'cream',
    'crimp',
    'cut',
    'dice',
    'dip',
    'divide',
    'drain',
    'drizzle',
    'dust',
    'fill',
    'fold',
    'fry',
    'garnish',
    'grate',
    'grease',
    'grill',
    'heat',
    'in',
    'knead',
    'layer',
    'let',
    'line',
    'mash',
    'melt',
    'mix',
    'place',
    'pour',
    'preheat',
    'prepare',
    'press',
    'reduce',
    'refrigerate',
    'remove',
    'return',
    'roast',
    'roll',
    'saute',
    'season',
    'serve',
    'set',
    'shape',
    'sift',
    'simmer',
    'slice',
    'spoon',
    'spray',
    'spread',
    'sprinkle',
    'stir',
    'strain',
    'stuff',
    'toss',
    'transfer',
    'trim',
    'turn',
    'whisk',
  ].map((verb) => verb),
);

const NUMBERED_STEP = /^(?:[Ss]tep\s*)?(\d{1,2})\s*[.):]?\s+(?=\p{Lu})(.+)$/u;

const letters = (text: string) => text.replaceAll(/[^\p{L}]/gu, '').length;
const words = (text: string) => text.split(/\s+/).filter(Boolean);
const firstWord = (text: string) =>
  stripAccents(words(text)[0] ?? '')
    .toLowerCase()
    .replaceAll(/[^a-z]/g, '');

/** "2-quart square baking dish", "9-inch pie plate": the start of an instruction whose verb was cut off */
const COOKWARE =
  /^\d+(?:[-\s](?:quart|inch|cup|by)|x\d+)\b.*\b(?:dish|pans?|plate|skillet|saucepan|pot|bowl|sheet|tin|mou?ld)\b/i;

export const isIngredientLine = (text: string) => {
  const normalized = normalizeQuantity(text);
  if (COOKWARE.test(normalized)) {
    return false;
  }
  return (
    (QUANTITY.test(normalized) &&
      /^\S+\s*\p{Ll}|^\S+\s*\(|^[\d½⅓⅔¼¾⅛⅜⅝⅞\s-]+(?:\p{L}+-)?\p{L}/u.test(normalized) &&
      !NUMBERED_STEP.test(normalized)) ||
    UNIT.test(normalized) ||
    INGREDIENT_START.test(normalized)
  );
};

export const isMetaLine = (text: string) => {
  META.lastIndex = 0;
  return (META.test(text) && /\d/.test(text)) || META_PHRASE.test(text.trim());
};

export const isFurniture = (text: string) => FURNITURE.test(text.trim());

/** a paragraph of instructions: a numbered step, or a sentence that starts with a cooking verb */
const isStepStart = (text: string) => NUMBERED_STEP.test(text) || STEP_VERBS.has(firstWord(text));

/** prose: several words, mostly letters */
const isProse = (text: string) => words(text).length >= 3 && letters(text) >= 0.6 * text.replaceAll(/\s/g, '').length;

/** "Vegetarian Quiche: Prepare as at left..." */
const VARIATION = /^(?:\p{Lu}[\p{L}'’-]*\s){0,3}\p{Lu}[\p{L}'’-]*\s?[:.]\s+\p{Lu}/u;

/** the formatted meta of a line: "Prep: 25 minutes Bake: 40 minutes" → ["Prep 25 minutes", "Bake 40 minutes"] */
export const splitMeta = (text: string): string[] => {
  META.lastIndex = 0;
  const parts: string[] = [];
  const matches = text.matchAll(META).toArray();
  if (matches.length === 0) {
    return [text.trim()];
  }
  for (const [index, match] of matches.entries()) {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const label = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    const value = text
      .slice(start, end)
      .trim()
      .replaceAll(/(\d)\s*(minutes?|hours?|servings?|min)/gi, '$1 $2')
      .replaceAll(/(\d)(?=[a-z])/gi, '$1 ');
    if (value) {
      parts.push(`${label} ${value}`);
    }
  }
  return parts;
};

type Kind = 'title' | 'heading' | 'meta' | 'ingredient' | 'step' | 'prose' | 'note' | 'furniture' | 'other';

type Line = {
  line: PageLine;
  text: string;
  kind: Kind;
  column: number;
  /** a new paragraph starts here: a new column, a step number or a wider gap */
  paragraph: boolean;
};

/** words that stay in lower case in a title */
const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'with',
  'in',
  'on',
  'or',
  'for',
  'to',
  'à',
  'la',
  'le',
  'de',
]);

/** a few capitalized words: "Farmer's Casserole", "SIMPLE CUPCAKES", "Basic Buttercream Frosting" */
const isTitleLike = (text: string) => {
  const capitalized = words(text).filter((word) => !SMALL_WORDS.has(word.toLowerCase()));
  return (
    words(text).length <= 6 &&
    /^\p{Lu}/u.test(text) &&
    !/\d/.test(text) &&
    !STEP_VERBS.has(firstWord(text)) &&
    capitalized.filter((word) => /^\p{Lu}/u.test(word)).length >= 0.6 * capitalized.length &&
    letters(text) >= 0.75 * text.replaceAll(/\s/g, '').length &&
    letters(text) >= 4
  );
};

const isAllCaps = (text: string) => letters(text) >= 6 && text === text.toUpperCase() && /\p{Lu}/u.test(text);

const classify = (line: PageLine, bodyHeight: number): Kind => {
  const text = line.text.trim();
  if (isFurniture(text)) {
    return 'furniture';
  }
  if (isMetaLine(text)) {
    return 'meta';
  }
  const big = line.height >= 1.3 * bodyHeight;
  const titleLike = isTitleLike(text);
  if (titleLike && big) {
    return 'title';
  }
  if (titleLike && isAllCaps(text)) {
    return 'heading';
  }
  if (VARIATION.test(text) && !isStepStart(text)) {
    return 'note';
  }
  if (isIngredientLine(text)) {
    return 'ingredient';
  }
  if (isStepStart(text)) {
    return 'step';
  }
  return isProse(text) ? 'prose' : 'other';
};

// ----------------------------------------------------------------------------------------------------------------
// recipes

type Draft = {
  title?: PageLine;
  lines: Line[];
};

const byContent = (recipe: Recipe) =>
  recipe.ingredients.length + 1.5 * recipe.steps.filter((step) => step.text).length + (recipe.title ? 2 : 0);

/** a line of words of which none are longer than two letters, or a few letters: what OCR reads in a blur */
const isFragment = (text: string) => letters(text) < 6;

/**
 * A few short lines that are neither meta, ingredients nor steps: the ends of lines of the column beside them that
 * OCR read apart ("options and allows", "cken, or crabmeat."), or a scribble in the margin
 */
const isTorn = (part: Line[]) =>
  part.length <= 3 &&
  part.every(
    ({ text, kind }) =>
      kind === 'meta' ||
      (words(text).length <= 4 && ['prose', 'other', 'furniture'].includes(kind) && !isStepStart(text)),
  );

/**
 * Splits the columns of the page at titles into the parts of each recipe: a part under a title belongs to it; a part
 * without a title continues the recipe of the nearest title above it (the end of its steps at the top of the next
 * column), unless there is none (the end of the recipe of the page before) or it is a strip of fragments cut by the
 * edge of the photo (the page beside it).
 */
const toDrafts = (lines: Line[][], lineHeight: number): { drafts: Draft[]; leftover: Line[] } => {
  const parts: Line[][] = [];
  for (const column of lines) {
    let current: Line[] = [];
    for (const line of column) {
      if (line.kind === 'title' && current.length > 0) {
        parts.push(current);
        current = [];
      }
      current.push(line);
    }
    if (current.length > 0) {
      parts.push(current);
    }
  }

  const drafts: Draft[] = parts.flatMap((part) =>
    part[0].kind === 'title' ? [{ title: part[0].line, lines: [] as Line[] }] : [],
  );
  const leftover: Line[] = [];
  for (const part of parts) {
    const own = part[0].kind === 'title' ? drafts.find((draft) => draft.title === part[0].line) : undefined;
    if (own) {
      own.lines.push(...part);
      continue;
    }
    const fragments = part.filter((line) => isFragment(line.text)).length;
    if (fragments >= 0.5 * part.length && part.some((line) => line.line.edge)) {
      leftover.push(...part);
      continue;
    }
    const first = part[0].line;
    // below a title, or beside it to its right (the next column): not to its left, which comes before it
    const above = drafts
      .filter((draft) => draft.title!.y <= first.y + 1.5 * lineHeight && first.x >= draft.title!.x - 5 * lineHeight)
      .map((draft) => ({ draft, cost: first.y - draft.title!.y + 0.5 * Math.abs(first.x - draft.title!.x) }))
      .toSorted((a, b) => a.cost - b.cost)[0];
    if (!above) {
      leftover.push(...part);
    } else if (isTorn(part)) {
      // only the meta of a torn part is worth keeping, e.g. the oven temperature at the end of a line
      above.draft.lines.push(...part.filter(({ kind }) => kind === 'meta'));
      leftover.push(...part.filter(({ kind }) => kind !== 'meta'));
    } else {
      above.draft.lines.push(...part);
    }
  }
  if (drafts.length === 0) {
    return { drafts: [{ lines: parts.flat() }], leftover: [] };
  }
  return { drafts, leftover };
};

const cleanText = (text: string) =>
  text
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/\s+([,.;:!?)])/g, '$1')
    .replaceAll(/([(])\s+/g, '$1')
    .trim();

/** joins the lines of a paragraph, mending words hyphenated at the end of a line */
const joinLines = (texts: string[]) => {
  let all = '';
  for (const text of texts) {
    all = all ? (/\p{L}-$/u.test(all) ? `${all.slice(0, -1)}${text}` : `${all} ${text}`) : text;
  }
  return cleanText(all);
};

const toTitle = (text: string) => toTitleCase(cleanText(text).replace(/[\s:.]+$/, ''));

/** headings of the parts of any recipe, which are not sub-recipes */
const INGREDIENTS_HEADING = /^(?:ingredients?|you(?:'ll)? need|what you need|shopping list)$/i;
const METHOD_HEADING = /^(?:method|directions?|instructions?|preparation|steps?|how to make it|to make)$/i;

/** reads one recipe from its lines in reading order */
const toRecipe = (draft: Draft, bodyHeight: number): Recipe => {
  const recipe: Recipe = { meta: [], ingredients: [], steps: [], notes: [], sections: [], box: [1, 1, 0, 0] };
  if (draft.title) {
    recipe.title = toTitle(draft.title.text);
  }
  let phase: 'head' | 'ingredients' | 'steps' = 'head';
  let section: string | undefined;
  const intro: string[] = [];
  type Paragraph = { texts: string[]; n?: number; section?: string; continued: boolean; cutBefore: boolean };
  const paragraphs: Paragraph[] = [];
  let note: string[] | undefined;
  let lastIngredient: { item: RecipeIngredient; line: PageLine } | undefined;

  const flushNote = () => {
    if (!note) {
      return;
    }

    recipe.notes.push(joinLines(note));
    note = undefined;
  };

  for (const [index, entry] of draft.lines.entries()) {
    const { line, kind, paragraph } = entry;
    const text = cleanText(entry.text);
    const [left, top, right, bottom] = line.box;
    recipe.box = [
      Math.min(recipe.box[0], left),
      Math.min(recipe.box[1], top),
      Math.max(recipe.box[2], right),
      Math.max(recipe.box[3], bottom),
    ];
    if (kind === 'title' && line === draft.title) {
      continue;
    }
    if (kind === 'furniture') {
      flushNote();
      continue;
    }
    if (kind === 'meta') {
      recipe.meta.push(...splitMeta(text));
      continue;
    }
    if (kind === 'heading' || (kind === 'title' && line !== draft.title)) {
      flushNote();
      const heading = text.replace(/[\s:]+$/, '');
      if (INGREDIENTS_HEADING.test(heading)) {
        phase = 'ingredients';
        continue;
      }
      if (METHOD_HEADING.test(heading)) {
        phase = 'steps';
        continue;
      }
      // right below the title: a subtitle ("Crumbs Bake Shop / Makes 24 large cupcakes")
      if (phase === 'head' && index <= 2) {
        continue;
      }
      // a sub-recipe (a frosting, a sauce) starts with its own ingredients
      section = toTitle(heading.replace(/^for the\s+/i, ''));
      if (!recipe.sections.includes(section)) {
        recipe.sections.push(section);
      }
      phase = 'ingredients';
      lastIngredient = undefined;
      continue;
    }
    if (kind === 'note') {
      flushNote();
      note = [text];
      continue;
    }
    if (note && !paragraph && kind !== 'ingredient' && kind !== 'step') {
      note.push(text);
      continue;
    }
    flushNote();

    const previous = lastIngredient?.line;
    const offset = previous ? getOffset(previous, line) : undefined;
    const indented = offset !== undefined && offset.along > 0.6 && offset.across < 2.2;
    const normalized = normalizeQuantity(text);
    const continuesIngredient =
      phase === 'ingredients' &&
      lastIngredient !== undefined &&
      !paragraph &&
      kind !== 'step' &&
      (indented || /^[\p{Ll}(]/u.test(text)) &&
      !QUANTITY.test(normalized) &&
      !UNIT.test(normalized) &&
      !NEW_INGREDIENT.test(normalized);
    if (continuesIngredient) {
      lastIngredient!.item.text = normalizeFractions(joinLines([lastIngredient!.item.text, text]));
      lastIngredient!.line = line;
      continue;
    }
    // an ingredient list is a block of ingredient lines (and names of sub-recipes: "Basic Buttercream Frosting");
    // prose after it is the method
    const named = phase === 'ingredients' && !paragraph && isTitleLike(text) && !isStepStart(text);
    if ((kind === 'ingredient' || named) && (phase !== 'steps' || paragraph)) {
      const item: RecipeIngredient = { text: normalizeQuantity(text), ...(section && { section }) };
      recipe.ingredients.push(item);
      lastIngredient = { item, line };
      phase = 'ingredients';
      continue;
    }
    if (phase === 'head' && kind !== 'step') {
      if (kind === 'prose' || kind === 'other') {
        intro.push(text);
      }
      continue;
    }
    if ((kind === 'other' && isFragment(text)) || line.height > 1.8 * bodyHeight) {
      // a blur, or a note in large handwriting beside the steps ("+ color sprinkles")
      continue;
    }

    // the method
    const numbered = NUMBERED_STEP.exec(text);
    const current = paragraphs.at(-1);
    const starts =
      !current ||
      numbered !== null ||
      phase !== 'steps' ||
      (paragraph && (isStepStart(text) || entry.column !== draft.lines[index - 1]?.column));
    phase = 'steps';
    if (starts) {
      const previousLine = draft.lines[index - 1]?.line;
      paragraphs.push({
        texts: [numbered ? numbered[2] : text],
        ...(numbered && { n: Number(numbered[1]) }),
        ...(section && { section }),
        continued: !numbered && /^\p{Ll}/u.test(text),
        // the paragraph before ends at the edge of the photo: what came between is lost
        cutBefore: !!current && entry.column !== draft.lines[index - 1]?.column && !!previousLine?.edge,
      });
    } else {
      current.texts.push(text);
    }
  }
  flushNote();

  if (intro.length > 0) {
    recipe.intro = joinLines(intro);
  }
  recipe.steps = numberSteps(paragraphs);
  return recipe;
};

/**
 * Numbers the paragraphs of the method by section: a printed number is kept, the first paragraph is step 1, a
 * paragraph right before a numbered one takes the number before it, and the others the number after the one before
 * them. A paragraph that continues a step whose beginning is off the photo (it starts in lower case, at the top of a
 * column after a column cut by the edge) is a later step: at least one step between them was not read.
 */
const numberSteps = (
  paragraphs: Array<{ texts: string[]; n?: number; section?: string; continued: boolean; cutBefore: boolean }>,
): RecipeStep[] => {
  const steps: RecipeStep[] = [];
  const sections = Map.groupBy(paragraphs, (paragraph) => paragraph.section ?? '');
  for (const [section, members] of sections) {
    const numbers: Array<number | undefined> = members.map((paragraph) => paragraph.n);
    if (numbers[0] === undefined && !members[0].continued && (numbers[1] === undefined || numbers[1] > 1)) {
      numbers[0] = 1;
    }
    for (const [index, value] of numbers.entries()) {
      const next = numbers[index + 1];
      if (value === undefined && next !== undefined && next > 1 && next - 1 > (numbers[index - 1] ?? 0)) {
        numbers[index] = next - 1;
      }
    }
    for (const [index, paragraph] of members.entries()) {
      if (numbers[index] !== undefined) {
        continue;
      }
      const before = numbers[index - 1] ?? 0;
      numbers[index] = before + (paragraph.continued && paragraph.cutBefore ? 2 : 1);
    }
    let last = 0;
    for (const [index, paragraph] of members.entries()) {
      const n = numbers[index]!;
      if (n <= last) {
        // a number read twice (a variant) or out of order: the paragraph belongs to the step before
        const step = steps.at(-1);
        if (step?.text) {
          step.text = joinLines([step.text, ...paragraph.texts]);
        }
        continue;
      }
      // the steps between two read ones, whose text is off the photo
      for (let missing = last + 1; missing < n; missing++) {
        steps.push({ n: missing, ...(section && { section }) });
      }
      steps.push({
        n,
        text: joinLines(paragraph.texts),
        ...(section && { section }),
        ...(paragraph.continued && { partial: true }),
      });
      last = n;
    }
  }
  return steps;
};

/** Reads the recipes on a photo of a recipe card or a cookbook page, the main one first. */
export const readRecipes = (ocr: OcrBoxInput[], { aspectRatio = 1 }: SourceParseOptions = {}): RecipePage => {
  const page = readPage(ocr, aspectRatio);
  const all = page.columns.flatMap((column) => column.lines);
  if (all.length === 0) {
    return { recipes: [], columns: 0, lines: 0 };
  }
  const bodyHeight = median(all.map((line) => line.height));
  const lines: Line[][] = page.columns.map((column, columnIndex) => {
    const gaps = column.lines.map((line) => line.gap).filter((gap) => Number.isFinite(gap));
    const spacing = gaps.length > 0 ? median(gaps) : 1.3;
    return column.lines.map((line, index) => {
      const kind = classify(line, bodyHeight);
      return {
        line,
        text: line.text,
        kind,
        column: columnIndex,
        // a new paragraph: a wider gap, a step number, or a cooking verb after a sentence that ended a little higher
        paragraph:
          index === 0 ||
          line.gap > 1.5 * spacing ||
          NUMBERED_STEP.test(line.text) ||
          (line.gap > 1.2 * spacing && /[.!]$/.test(column.lines[index - 1].text) && isStepStart(line.text)),
      };
    });
  });

  // OCR of a small photo reads all text about as tall: a title is then a few capitalized words a little larger than
  // the text, right above the ingredients of its column
  if (lines.flat().every((line) => line.kind !== 'title')) {
    for (const column of lines) {
      for (const [index, line] of column.entries()) {
        const below = column.slice(index + 1, index + 4);
        if (
          ['prose', 'other', 'heading'].includes(line.kind) &&
          line.line.height >= 1.08 * bodyHeight &&
          isTitleLike(line.text) &&
          below.some(({ kind }) => kind === 'ingredient')
        ) {
          line.kind = 'title';
        }
      }
    }
  }
  // with no title in larger print, the first heading in capitals is the title
  if (lines.flat().every((line) => line.kind !== 'title')) {
    const heading = lines.flat().find((line) => line.kind === 'heading');
    if (heading) {
      heading.kind = 'title';
    }
  }

  const { drafts } = toDrafts(lines, page.lineHeight);
  const recipes = drafts
    .map((draft) => toRecipe(draft, bodyHeight))
    .filter((recipe) => recipe.ingredients.length + recipe.steps.length > 0 || recipe.title)
    .toSorted((a, b) => byContent(b) - byContent(a));
  return { recipes, columns: page.columns.length, lines: all.length };
};

// ----------------------------------------------------------------------------------------------------------------
// entries

/** the name of a finished-dish photo */
export const RESULT_ENTRY = 'Result';

const STOP_WORDS = new Set([
  'with',
  'in',
  'into',
  'for',
  'until',
  'on',
  'onto',
  'to',
  'at',
  'over',
  'from',
  'or',
  'about',
  'before',
  'after',
  'then',
  'while',
  'by',
]);

/**
 * The action of a step in a few words: its first clause up to a preposition, e.g. "Preheat the oven to 350 degrees"
 * → "Preheat the oven", "Combine the confectioners' sugar and butter in the bowl" → "Combine the confectioners' sugar
 * and butter".
 */
export const getStepAction = (text: string, maxWords = 6) => {
  const clause = text.split(/[.;:,!?]/, 1)[0].trim();
  const result: string[] = [];
  for (const word of words(clause)) {
    const lower = word.toLowerCase();
    if (
      (result.length >= 2 && STOP_WORDS.has(lower)) ||
      (result.length > 0 && /^(?:until|before|after|while)$/.test(lower))
    ) {
      break;
    }
    result.push(word);
    if (result.length >= maxWords) {
      break;
    }
  }
  while (result.length > 1 && /^(?:a|an|the|and|of)$/i.test(result.at(-1)!)) {
    result.pop();
  }
  return result.join(' ').replace(/-$/, '');
};

/** "Basic Buttercream Frosting" → "Frosting" */
const shortSection = (section: string) => {
  const last = words(section.replace(/\(.*\)/, '')).at(-1) ?? section;
  return last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
};

/** the entry of a step: "Step 1: Preheat the oven", "Frosting step 2: Add the vanilla", "Step 3" */
export const getStepName = (step: Pick<RecipeStep, 'n' | 'text' | 'section' | 'partial'>) => {
  const label = `${step.section ? `${shortSection(step.section)} step` : 'Step'} ${step.n}`;
  const action = step.text && !step.partial ? getStepAction(step.text) : undefined;
  return action ? `${label}: ${action}` : label;
};

/** the description of a step whose text is off the photo, before the ingredients it may use */
export const UNREAD_STEP = 'not on the photo, may use';

/** "1½ cups shredded Swiss, cheddar, or Havarti cheese (6 ounces)" → "shredded Swiss" */
export const getIngredientName = (text: string) =>
  words(
    text
      .replace(new RegExp(String.raw`^(?:about\s+)?[\d${VULGAR}\s./-]*`, 'u'), '')
      .replace(new RegExp(String.raw`^${UNIT_WORDS}\b\.?\s*`, 'i'), '')
      .replaceAll(/\(.*?\)/g, '')
      .split(/[,;]| or /, 1)[0],
  )
    .slice(0, 3)
    .join(' ')
    .trim();

const toParsed = (recipe: Recipe, columns: number, lines: number): ParsedSource => {
  const entry = (name: string, description?: string, section?: string): SourceEntry => ({
    name,
    ...(description && { description }),
    ...(section && { section }),
    column: 0,
    box: recipe.box,
  });
  // a step whose text is off the photo uses the ingredients no step that was read names
  const read = recipe.steps.flatMap((step) => (step.text ? [step.text.toLowerCase()] : []));
  const unused = recipe.ingredients
    .filter((item) => !item.section)
    .map((item) => getIngredientName(item.text))
    .filter((name) => name && read.every((text) => !text.includes(name.split(' ').at(-1)!.toLowerCase())));
  const hint = unused.length > 0 ? `${UNREAD_STEP}: ${unused.slice(0, 5).join(', ')}` : undefined;
  const items = recipe.steps.map((step) =>
    entry(getStepName(step), step.text ?? (step.section ? undefined : hint), step.section),
  );
  if (recipe.ingredients.length > 0 || recipe.steps.length > 0) {
    items.push(entry(RESULT_ENTRY, recipe.title ? `the finished ${recipe.title}` : 'the finished dish'));
  }
  return {
    items,
    ...(recipe.title && { title: recipe.title }),
    sections: recipe.sections,
    columns,
    lines,
  };
};

/**
 * The cookbook pack's source parser: the steps of the main recipe of the page, in order, and its finished dish
 * ("Result") as the entries, and its title. The other recipes on the page are its alternatives, which the engine
 * chooses from by how well their titles fit the photos.
 */
export const parseRecipe = (ocr: OcrBoxInput[], options: SourceParseOptions = {}): ParsedSource => {
  const page = readRecipes(ocr, options);
  const [main, ...others] = page.recipes;
  if (!main) {
    return { items: [], sections: [], columns: page.columns, lines: page.lines };
  }
  const alternatives = others
    .filter((recipe) => recipe.title)
    .map((recipe) => toParsed(recipe, page.columns, page.lines));
  return {
    ...toParsed(main, page.columns, page.lines),
    ...(alternatives.length > 0 && { alternatives }),
  };
};

// ----------------------------------------------------------------------------------------------------------------
// the recipe page of a book

const titleKey = (text: string) =>
  stripAccents(text)
    .toLowerCase()
    .replaceAll(/[^a-z\d]/g, '');

/** the recipe of the page with this title (as tagged), or the main one */
export const chooseRecipe = (page: RecipePage, title?: string) => {
  const key = title ? titleKey(title) : '';
  const titled = page.recipes.filter((recipe) => recipe.title);
  return (
    (key && titled.find((recipe) => titleKey(recipe.title!) === key)) ||
    (key && titled.find((recipe) => titleKey(recipe.title!).includes(key) || key.includes(titleKey(recipe.title!)))) ||
    page.recipes[0]
  );
};

/** text OCR ran together or made up: words run together, stray capitals, few letters */
const isGarbled = (text: string) => {
  const tokens = words(text);
  // words run together ("untilknife", "10minutesbefore", "ven.Reduce") or read with a stray capital ("folL")
  const suspicious = tokens.filter((token) =>
    /\p{L}{10,}|\d\p{L}{3,}|\p{L}[.,]\p{Lu}|\p{Ll}\p{Lu}/u.test(token.replace(/^\p{L}+['’]\p{L}+$/u, '')),
  ).length;
  return tokens.length === 0 || suspicious > 0.12 * tokens.length || letters(text) < 0.6 * text.length;
};

/** the step of a book page: "1. Preheat the oven to 350 degrees.", "3. … until a knife inserted near the center" */
const formatStep = (step: RecipeStep) => `${step.n}. ${step.partial ? '… ' : ''}${step.text}`;

/**
 * The recipe typeset for its page in a book, as plain text a person can edit: the meta line, then blocks under
 * headings that end with a colon: "Ingredients:", "Method:" (numbered steps) and one block per sub-recipe. Steps whose
 * text is off the photo, or too garbled to print, are left out; at most `maxLength` characters.
 */
export const formatRecipeText = (page: RecipePage, title?: string, maxLength = 2000): string | undefined => {
  const recipe = chooseRecipe(page, title);
  if (!recipe || (recipe.ingredients.length === 0 && recipe.steps.length === 0)) {
    return;
  }
  const blocks: string[] = [];
  if (recipe.meta.length > 0) {
    blocks.push(recipe.meta.join(' · '));
  }
  const ingredients = (section?: string) =>
    recipe.ingredients.filter((item) => item.section === section).map((item) => item.text);
  const steps = (section?: string) =>
    recipe.steps
      .filter((step) => step.section === section && step.text && !isGarbled(step.text))
      .map((step) => formatStep(step));

  if (ingredients().length > 0) {
    blocks.push(['Ingredients:', ...ingredients()].join('\n'));
  }
  if (steps().length > 0) {
    blocks.push(['Method:', ...steps()].join('\n'));
  }
  for (const section of recipe.sections) {
    const lines = [...ingredients(section), ...steps(section)];
    if (lines.length > 0) {
      blocks.push([`${section}:`, ...lines].join('\n'));
    }
  }

  let text = '';
  for (const block of blocks) {
    const next = text ? `${text}\n\n${block}` : block;
    if (next.length > maxLength) {
      break;
    }
    text = next;
  }
  return text || undefined;
};
