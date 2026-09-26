import {
  CollectionChapter,
  CollectionChapterIssue,
  CollectionPack,
  getDefaultFallbackName,
} from 'src/utils/collections/pack.js';
import { COOKBOOK_CLASSIFY_RULES, COOKBOOK_PROMPTS } from 'src/utils/collections/packs/cookbook/classify.js';
import {
  RESULT_ENTRY,
  UNREAD_STEP,
  formatRecipeText,
  isFurniture,
  isIngredientLine,
  isMetaLine,
  parseRecipe,
  readRecipes,
} from 'src/utils/collections/packs/cookbook/recipe.js';
import { SourceEntry } from 'src/utils/collections/source.js';
import { DEFAULT_VISIT_OPTIONS } from 'src/utils/collections/visits.js';

/** no word names a kind of recipe the way "Trattoria" names a restaurant */
const NO_PLACE_WORDS = /(?!)/;

/** texts for photos of a cooking session that are not of the recipe: the other dishes of the meal or the party */
export const OFF_RECIPE_PROMPTS = [
  'a photo of a green salad',
  'a photo of a glass of wine',
  'a photo of a table set for a party',
  'a photo of a chocolate cake',
  'a photo of cookies on a plate',
];

/** the CLIP text of a step or of the finished dish */
export const recipeEntryPrompt = ({ name, description }: Pick<SourceEntry, 'name' | 'description'>) => {
  if (name === RESULT_ENTRY) {
    return `a photo of ${description ?? 'the finished dish'}, ready to serve`;
  }
  if (description?.startsWith(UNREAD_STEP)) {
    return `a photo of cooking with ${description.slice(UNREAD_STEP.length + 1).trim()}`;
  }
  const text = description ?? 'preparing food in a kitchen';
  return `a photo of cooking: ${text.length > 160 ? text.slice(0, 160) : text}`;
};

/** "Step 1: Preheat the oven" → "1. Preheat the oven", "Result" → "Finished dish" */
export const getStepCaption = (entry: string) => {
  if (entry === RESULT_ENTRY) {
    return 'Finished dish';
  }
  const match = /^(?:(.+?)\s+)?[Ss]tep\s+(\d+)(?::\s*(.+))?$/.exec(entry.trim());
  if (!match) {
    return entry;
  }
  const [, section, n, action] = match;
  return action ? `${section ? `${section} ` : ''}${n}. ${action}` : `${section ? `${section} step` : 'Step'} ${n}`;
};

const formatList = (values: string[]) =>
  values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;

/**
 * The checks of a recipe's chapter in a book: a photo of the finished dish, and a photo of every step up to the last
 * one shown (from the album, when it has them)
 */
export const reviewRecipeChapter = ({ place, placed, available }: CollectionChapter): CollectionChapterIssue[] => {
  const issues: CollectionChapterIssue[] = [];
  if (placed.every(({ entry }) => entry !== RESULT_ENTRY)) {
    const result = available.find(({ entry }) => entry === RESULT_ENTRY);
    issues.push(
      result
        ? {
            severity: 'medium',
            message: `The chapter of ${place} has no photo of the finished dish, which is in the album; add it, large, at the end of the chapter`,
            assetIds: result.assetIds.slice(0, 3),
          }
        : { severity: 'low', message: `The chapter of ${place} has no photo of the finished dish` },
    );
  }

  const steps = (list: CollectionChapter['placed']) =>
    list.flatMap(({ entry, assetIds }) => {
      const match = /^(?:(.+?)\s+)?[Ss]tep\s+(\d+)\b/.exec(entry);
      return match ? [{ section: match[1] ?? '', n: Number(match[2]), assetIds }] : [];
    });
  const shown = steps(placed);
  const album = steps(available);
  for (const [section, members] of Map.groupBy(shown, ({ section }) => section)) {
    const numbers = new Set(members.map(({ n }) => n));
    const missing = Array.from({ length: Math.max(...numbers) }, (_, index) => index + 1).filter(
      (n) => !numbers.has(n),
    );
    if (missing.length === 0) {
      continue;
    }
    const inAlbum = album.filter((step) => step.section === section && missing.includes(step.n));
    const names = missing.map((n) => `${section ? `${section} step` : 'step'} ${n}`);
    issues.push({
      severity: inAlbum.length > 0 ? 'medium' : 'low',
      message:
        `The chapter of ${place} shows no photo of ${formatList(names)}` +
        (inAlbum.length > 0 ? '; the album has some: add them in the order of the steps' : ''),
      ...(inAlbum.length > 0 && { assetIds: inAlbum.flatMap(({ assetIds }) => assetIds).slice(0, 6) }),
    });
  }
  return issues;
};

/**
 * Cookbook: a family cookbook of the dishes cooked at home. The recipe (a handwritten card or a printed cookbook page)
 * is the source, its steps and its finished dish are the entries, the photos of the cooking session (ingredients, a
 * step in the bowl, the pan or the oven, the dish on the table) the subjects, and the recipe's title the place; photos
 * are tagged `Recipes/<Recipe>/Step 1: Preheat the oven`, `Recipes/<Recipe>/Result` and `Recipes/<Recipe>/Recipe`,
 * and books in the Cookbook style have a chapter per recipe opened by a recipe page: the photo of the recipe with its
 * ingredients and steps typeset beside it.
 */
export const cookbookPack: CollectionPack = {
  id: 'cookbook',
  title: 'Cookbook',
  description:
    'home cooking: photos of cooking a recipe (ingredients, steps, the finished dish), matched with the steps of ' +
    'the recipe card or cookbook page',
  tagRoot: 'Recipes',
  sourceLeaf: 'Recipe',
  names: {
    subject: 'cooking photo',
    subjects: 'cooking photos',
    source: 'recipe',
    sources: 'recipes',
    place: 'recipe',
    entry: 'step',
    entries: 'steps',
    visit: 'cooking session',
    visits: 'cooking sessions',
  },

  prompts: COOKBOOK_PROMPTS,
  classify: COOKBOOK_CLASSIFY_RULES,

  source: { parse: parseRecipe, prompt: recipeEntryPrompt, minEntries: 2 },

  place: {
    // a recipe is named by its title, the largest print at the top of the page, not by a word like "Trattoria"
    words: NO_PLACE_WORDS,
    blocked: /^(?:ingredients?|method|directions|preparation|serves|makes|nutrition facts|low fat|best loved|recipe)$/i,
    isNotName: (text) => isMetaLine(text) || isIngredientLine(text) || isFurniture(text),
    // the place of a recipe is its title
    title: (ocr) => readRecipes(ocr).recipes[0]?.title,
    titleBonus: 0.35,
    fallbackName: getDefaultFallbackName({ visit: 'cooking' }),
  },

  // a cooking session has long pauses (the oven), and the recipe is often photographed the day after
  visits: {
    options: { ...DEFAULT_VISIT_OPTIONS, maxGapMinutes: 120, maxSpanMinutes: 480, attachMinutes: 24 * 60 },
  },

  // calibrated on real cooking sessions, see `benchmark.spec.ts`: the photos follow the steps, several to a step
  // (no cost to share one), roughly at the pace of the session (the finished dish comes last), and the other dishes
  // of the meal are only off the list when they clearly look like one
  match: {
    options: {
      order: 'source',
      sharePenalty: 0,
      pacePenalty: 2,
      paceTolerance: 0.2,
      skipPenalty: 0,
      offListBias: -0.02,
    },
    offListPrompts: OFF_RECIPE_PROMPTS,
  },

  describe: (entry, recipe) => `${getStepCaption(entry)} · ${recipe.trim()}`,

  book: {
    preset: {
      id: 'cookbook',
      name: 'Cookbook',
      description:
        'A well-loved family recipe book: warm paper, friendly serif headings in brick red, a recipe page with the ' +
        'ingredients and steps typeset beside the photo of the recipe, the steps captioned and the finished dish large',
      summary:
        'a family recipe book: warm paper, serif headings, a typeset recipe page (ingredients and steps) beside the ' +
        'photo of the recipe, step captions; lays out one chapter per recipe',
      style: {
        marginMm: 16,
        gutterMm: 5,
        background: '#f7efe0',
        textColor: '#3a2c22',
        fontFamily: 'FreeSerif, serif',
        titleSizePt: 30,
        captionSizePt: 11,
        theme: 'cookbook',
        accentColor: '#a2432b',
      },
    },
    theme: {
      id: 'cookbook',
      summary:
        'a family recipe book: serif headings, thin rules, the recipe typeset on its page, and the steps captioned ' +
        'below their photos',
      look: 'printed',
    },
    caption: (entry) => getStepCaption(entry),
    review: { unnamedEntries: true, missingSourcePage: true, chapter: reviewRecipeChapter },
    // a chapter per recipe: its photos over a couple of days (the recipe photographed the morning after, the dish
    // served the next day)
    visitGapHours: 48,
    sourceText: (ocr, { aspectRatio, place }) => formatRecipeText(readRecipes(ocr, { aspectRatio }), place),
  },

  agent: {
    instructions:
      'Cookbook (pack "cookbook": subjects are the photos of cooking a recipe, the source is the recipe card or ' +
      'cookbook page, places are recipes, entries are its steps and "Result", the finished dish): find_visits finds ' +
      'the cooking sessions in an album or a date range (the recipe may be photographed the day after). For each: ' +
      'read_source the recipe photo (look at the image too: pages are photographed at an angle, and a page may show ' +
      'other recipes, listed as alternatives; the steps are "Step n: <short action>", with "Step n" alone for a step ' +
      'whose text is off the photo), then match_subjects with the subjectIds and sourceIds (it keeps the recipe of the ' +
      'page whose title fits the photos) and check the suggestions with view_photos: photos of ingredients belong to ' +
      'the step that uses them, and offList photos are other dishes of the meal (leave them out). The place is the ' +
      'recipe title as printed. Then save_entries (the recipe photo with source: true, the finished dish as "Result", ' +
      'each step photo as its step, e.g. "Step 2: Whisk the eggs", naming an unread step from what you see) and ' +
      'offer a cookbook photo book (stylePreset "cookbook").',
  },

  messages: {
    smartSearchDisabled: 'Smart search is disabled: cooking photos cannot be recognized, only recipes by their text',
    ocrDisabled: 'OCR is disabled: recipes are recognized by their look only',
    fewEntries:
      'Few steps could be read: look at the recipe image and read the steps yourself (pages photographed at an ' +
      'angle lose their far edge)',
  },
};
