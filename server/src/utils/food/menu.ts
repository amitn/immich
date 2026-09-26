import { findColumns, splitAtPrices } from 'src/utils/food/layout.js';
import { OcrBoxInput, TextLine, deskewBoxes, isPrice, median, parsePrice, toTextBoxes } from 'src/utils/food/ocr.js';
import { editDistance } from 'src/utils/food/tiles.js';

export type MenuItem = {
  /** the name as printed, in the language of the menu */
  name: string;
  description?: string;
  /** the price as printed, e.g. "12,50 €" or "8 / 12" */
  price?: string;
  /** the (first) amount of the price, e.g. 12.5 */
  priceValue?: number;
  /** the heading the item is listed under, e.g. "Primi piatti" */
  section?: string;
  /** 0-based column of the page, left to right */
  column: number;
  /** where the item is on the photo: [left, top, right, bottom], normalized 0..1 */
  box: [number, number, number, number];
};

export type ParsedMenu = {
  items: MenuItem[];
  /** the largest text at the top of the page, often the name of the restaurant */
  title?: string;
  sections: string[];
  columns: number;
  /** text lines read from the photo */
  lines: number;
};

/** a line at most this much smaller than the item names is a description */
const SMALLER = 0.85;

const stripAccents = (text: string) => text.normalize('NFD').replaceAll(/\p{Diacritic}/gu, '');

const normalizeWords = (text: string) =>
  stripAccents(text)
    .toLowerCase()
    .replaceAll(/[^\p{L}\s']/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

/** section headings of menus, in English, Italian, French, Spanish, Portuguese and German (without accents) */
const SECTION_WORDS = new Set(
  [
    // generic
    'menu',
    'menu del giorno',
    'menu du jour',
    'menu of the day',
    'carta',
    'la carta',
    'la carte',
    'a la carte',
    'specials',
    'daily specials',
    "today's specials",
    'specialita',
    'specialites',
    'especialidades',
    'suggestions',
    'suggerimenti',
    'fuori menu',
    'lunch',
    'dinner',
    'breakfast',
    'brunch',
    'pranzo',
    'cena',
    'colazione',
    'dejeuner',
    'diner',
    'petit dejeuner',
    'almuerzo',
    'desayuno',
    // English
    'starters',
    'appetizers',
    'appetisers',
    'small plates',
    'to share',
    'sharing',
    'mains',
    'main courses',
    'main course',
    'entrees',
    'sides',
    'side dishes',
    'soups',
    'soup',
    'salads',
    'salad',
    'pasta',
    'pizza',
    'pizzas',
    'burgers',
    'sandwiches',
    'fish',
    'seafood',
    'meat',
    'grill',
    'from the grill',
    'vegetarian',
    'vegan',
    'desserts',
    'dessert',
    'sweets',
    'cheese',
    'cheeses',
    'drinks',
    'beverages',
    'soft drinks',
    'hot drinks',
    'coffee',
    'tea',
    'wine',
    'wines',
    'wine list',
    'red wines',
    'white wines',
    'beer',
    'beers',
    'cocktails',
    'spirits',
    'pairing',
    'wine pairing',
    'juice pairing',
    'tea pairing',
    'kids',
    "kids' menu",
    'kids menu',
    // Italian
    'antipasti',
    'antipasto',
    'antipasti di mare',
    'antipasti di terra',
    'primi',
    'primi piatti',
    'secondi',
    'secondi piatti',
    'secondi di carne',
    'secondi di pesce',
    'contorni',
    'insalate',
    'zuppe',
    'pizze',
    'pizze rosse',
    'pizze bianche',
    'le pizze',
    'focacce',
    'dolci',
    'i dolci',
    'dessert della casa',
    'formaggi',
    'pesce',
    'carne',
    'crudi',
    'crudo',
    'bevande',
    'bibite',
    'vini',
    'vini rossi',
    'vini bianchi',
    'birre',
    'caffetteria',
    'amari',
    'liquori',
    'gelati',
    'piatti unici',
    // French
    'entrees',
    'hors d oeuvres',
    'plats',
    'plats principaux',
    'plat',
    'poissons',
    'viandes',
    'garnitures',
    'accompagnements',
    'fromages',
    'boissons',
    'vins',
    'bieres',
    'formules',
    'formule',
    // Spanish / Portuguese
    'entrantes',
    'entradas',
    'primeros',
    'primeros platos',
    'segundos',
    'segundos platos',
    'principales',
    'platos principales',
    'tapas',
    'raciones',
    'medias raciones',
    'pinchos',
    'carnes',
    'pescados',
    'mariscos',
    'arroces',
    'ensaladas',
    'sopas',
    'postres',
    'bebidas',
    'vinos',
    'cervezas',
    'petiscos',
    'sobremesas',
    'pratos principais',
    // German
    'vorspeisen',
    'suppen',
    'salate',
    'hauptgerichte',
    'hauptspeisen',
    'beilagen',
    'nachspeisen',
    'nachtisch',
    'desserts',
    'getranke',
    'weine',
    'biere',
  ].map((word) => normalizeWords(word)),
);

const POSSESSIVE =
  /^(?:i nostri|le nostre|il nostro|la nostra|gli|i|le|il|la|les|nos|our|the|los|las|nuestros|nuestras|unsere)\s+/;

export const isSectionHeading = (text: string) => {
  const words = normalizeWords(text);
  return SECTION_WORDS.has(words) || SECTION_WORDS.has(words.replace(POSSESSIVE, ''));
};

const FURNITURE = [
  // web, e-mail, social
  /www\.|https?:|@\w|\.(?:com|it|fr|es|de|net|org|co\.uk)\b|instagram|facebook|wi-?fi/i,
  // phone numbers
  /\b(?:tel|tél|phone|telefono|tlf|cell|fax|whatsapp|prenotazioni|reservations?)\b/i,
  /\+?\d[\d\s./-]{7,}\d/,
  // opening hours and days
  /\b\d{1,2}[:.h]\d{2}\s*[-–]\s*\d{1,2}[:.h]\d{2}\b/,
  /\b(?:open|opening|aperto|chiuso|closed|ouvert|ferme|fermé|abierto|cerrado|geöffnet|geschlossen)\b/i,
  // cover, service, taxes, legends
  /\b(?:coperto|servizio|service|iva|vat|tax|taxes|tva|p\.?\s?iva|cover charge|pane e coperto|prezzi|prices|precios|prix nets|propina|gratuity|mwst|inkl)\b/i,
  /\bprix\s+f[i1l]xe\b/i,
  /allerg|alérg|surgelat|congelat|frozen|abbattut|gluten[- ]free options/i,
  // addresses
  /^(?:via|viale|piazza|corso|vicolo|largo|rue|avenue|boulevard|calle|avenida|plaza|paseo|rua)\s+\p{L}/iu,
  /\b(?:street|road|straße|strasse)\b.*\d|\d.*\b(?:street|road|straße|strasse)\b/i,
  // footnotes
  /^[*†°]/,
];

export const isPageFurniture = (text: string) => FURNITURE.some((pattern) => pattern.test(text));

/** month names (in full, and abbreviations that aren't words) in English, Italian, French, Spanish, Portuguese, German */
const MONTHS = String.raw`(?:january|february|march|april|june|july|august|september|october|november|december|jan|feb|apr|aug|sept?|oct|nov|dec|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|dicembre|janvier|f[ée]vrier|avril|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre|enero|febrero|abril|mayo|junio|julio|septiembre|octubre|noviembre|diciembre|januar|februar|m[äa]rz|juni|juli|oktober|dezember|janeiro|fevereiro|mar[çc]o|maio|junho|julho|setembro|outubro|dezembro)`;
/** "January 11, 2014", "11 gennaio", "11/01/2014"; OCR reads zeros as the letter O */
const DATE = new RegExp(
  String.raw`(?<!\p{L})${MONTHS}\.?\s+[\dOo]{1,4}(?!\p{L})|(?<!\p{L})\d{1,2}(?:st|nd|rd|th|er|º)?\.?\s+(?:de\s+)?${MONTHS}(?!\p{L})|\b\d{1,2}[./-]\d{1,2}[./-](?:\d{4}|\d{2})\b`,
  'iu',
);
const YEAR = /(?<![\d\p{L}])(?:19|2[0O])[\dOo]{2}(?![\d\p{L}])/u;

/** a date, as printed on the menus of the day or of a tasting menu */
export const isDate = (text: string) => DATE.test(text);

/** the words of a menu's own title: "Chef's Tasting Menu", "Menu dégustation", "Prix fixe" */
const MENU_WORDS = new Set([
  'menu',
  'menus',
  'tasting',
  'degustation',
  'degustazione',
  'degustacion',
  'degustacao',
  'carte',
  'prix',
  'fixe',
  'omakase',
  'kaiseki',
]);
const MENU_TITLE_WORDS = new Set([
  ...MENU_WORDS,
  'chef',
  'chefs',
  'the',
  'our',
  'a',
  'la',
  'le',
  'il',
  'de',
  'du',
  'del',
  'di',
  'des',
  'jour',
  'giorno',
  'dia',
  'lunch',
  'dinner',
  'brunch',
  'seasonal',
  'season',
  'vegetarian',
  'vegan',
  'set',
  'signature',
  'grand',
  'petit',
  'discovery',
  'decouverte',
  'experience',
  'course',
  'courses',
  'and',
  'wine',
  'juice',
  'pairing',
  'pairings',
  'of',
  'today',
  'todays',
]);

/** the title of a menu rather than an item: "CHEF'S TASTING MENU JANUARY 11, 2014" */
export const isMenuTitle = (text: string) => {
  const words = normalizeWords(text.replace(DATE, ' '))
    .replaceAll(/['’]s\b/g, '')
    .replaceAll("'", '')
    .split(' ')
    .filter((word) => word.length > 0);
  return (
    words.length > 0 &&
    words.length <= 7 &&
    words.some((word) => MENU_WORDS.has(word)) &&
    words.every((word) => MENU_TITLE_WORDS.has(word))
  );
};

/** "(75.00 supplement)", "supplemento 10 €": the extra charge of an optional course */
const SUPPLEMENT =
  /\(\s*[^()]{0,16}?(?<!\p{L})(?:supplement|supplemento|suppl[ée]ment|suplemento|aufpreis|zuschlag|additional charge|extra charge)(?!\p{L})[^()]{0,8}\)?|(?:[$£€]\s?)?\d[\d.,]*\s*(?:[$£€]\s?)?(?:supplement|supplemento|suppl[ée]ment|suplemento)(?!\p{L})|(?<!\p{L})(?:supplement|supplemento|suppl[ée]ment|suplemento)\s*(?:[$£€]\s?)?\d[\d.,]*(?:\s?[$£€])?/giu;

const PRICE_PATTERN = String.raw`(?:(?:[$£€¥₹]|eur\s|chf\s)\s?\d{1,4}(?:[.,]\d{1,2})?|\d{1,4}(?:[.,]\d{1,2})?(?:\s?(?:[$£€¥₹]|eur\b|chf\b|,-|\.-))?)`;
const TRAILING_PRICE = new RegExp(String.raw`(?:\s*(?:\.{2,}|…+|_{2,}|-{2,}|\s/))?\s+(${PRICE_PATTERN})\s*$`, 'i');
const LEADER_PRICE = new RegExp(String.raw`(?:\.{2,}|…+|_{2,})\s*(${PRICE_PATTERN})\s*$`, 'i');
const MARKET_PRICE =
  /\s*[-–(]?\s*\b(s\.\s?q\.?|m\.\s?p\.?|market price|prezzo di mercato|secondo peso|selon arrivage|segun mercado|según mercado)\s*\)?\s*$/i;

const isBareInteger = (value: string) => /^\d{1,4}$/.test(value.trim());

/** splits trailing prices (up to two, e.g. small / large) off a text: "Margherita .... 8,50" → ["Margherita", "8,50"] */
export const splitPrice = (text: string): { text: string; price?: string } => {
  let rest = text.trim();
  const market = MARKET_PRICE.exec(rest);
  if (market && /\p{L}{2}/u.test(rest.slice(0, market.index))) {
    return { text: rest.slice(0, market.index).trim(), price: market[1] };
  }

  const prices: string[] = [];
  for (let i = 0; i < 2; i++) {
    const match = LEADER_PRICE.exec(rest) ?? TRAILING_PRICE.exec(rest);
    if (!match) {
      break;
    }
    const before = rest.slice(0, match.index).replace(/[\s/|.…_-]+$/, '');
    // a bare number is only a price after a name ("Quattro stagioni 9"), not a part of it ("Pizza 4 formaggi")
    if (!/\p{L}{2}/u.test(before) || (isBareInteger(match[1]) && match[1].length > 3)) {
      break;
    }
    prices.unshift(match[1].trim());
    rest = before;
  }

  return prices.length > 0 ? { text: rest, price: prices.join(' / ') } : { text: rest };
};

const ALLERGEN_CODE = String.raw`(?:\d{1,2}|[a-z]{1,2})(?!\p{L})`;
const ALLERGENS_PARENS = new RegExp(
  String.raw`\s*\(\s*${ALLERGEN_CODE}(?:\s*[,;/.\s]\s*${ALLERGEN_CODE})*\s*\)\s*$`,
  'iu',
);
const ALLERGENS_LIST = /\s+\d{1,2}(?:\s*[,;/.]\s*\d{1,2}){2,}\s*$/;
const SUPERSCRIPTS = /[¹²³⁴⁵⁶⁷⁸⁹⁰*†°]+/g;

/** removes allergen codes, footnote marks, numbering and leader dots from an item name */
export const cleanItemText = (text: string) => {
  let result = text.replaceAll(SUPPLEMENT, ' ').replaceAll(SUPERSCRIPTS, ' ');
  for (let i = 0; i < 3; i++) {
    result = result.replace(ALLERGENS_PARENS, '').replace(ALLERGENS_LIST, '').trim();
  }
  return result
    .replace(/^\d{1,3}\s?[.)]\s+/, '')
    .replaceAll(/(?:\s*\.{2,}|\s*…+|\s*_{2,})\s*/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .trim();
};

const CONNECTOR_END =
  /(?:\b(?:alla?|alle|allo|agli|ai|al|con|e|di|del|dello|della|delle|dei|degli|in|su|with|and|of|on|de|du|des|la|le|aux|au|à|et|y|en|el|los|las|mit|und|an)|[,&+-])$/i;
const CONNECTOR_START = /^(?:con|e|di|al|alla|alle|with|and|served|avec|et|aux|au|con|y|en|mit|und|in|su|on)\b/i;

/** a line that goes on from the one above: "and Garden Mache", "with truffle" */
const CONTINUATION = /^(?:and|with|or|served|con|alla|alle|avec|et|aux|mit|und|oder|und|y|con)\s+\p{L}/u;

const startsLowercase = (text: string) => /^[\p{Ll}(]/u.test(text);

/** joins two lines of text, mending words hyphenated over the line break */
const joinText = (a: string, b: string) =>
  /\p{L}-$/u.test(a) && startsLowercase(b) ? `${a.slice(0, -1)}${b}` : `${a} ${b}`;

type LineInfo = {
  line: TextLine;
  text: string;
  price?: string;
  kind: 'text' | 'price' | 'heading' | 'furniture';
};

const analyzeLine = (line: TextLine): LineInfo => {
  const priceBoxes = line.boxes.filter((box) => isPrice(box.text));
  const textBoxes = line.boxes.filter((box) => !isPrice(box.text));
  const joined = textBoxes.map((box) => box.text).join(' ');
  const split = splitPrice(joined);
  const prices = [...(split.price ? [split.price] : []), ...priceBoxes.map((box) => box.text.trim())];
  const price = prices.length > 0 ? prices.join(' / ') : undefined;
  const text = cleanItemText(split.text);

  if (isPageFurniture(line.text) || isDate(line.text) || isMenuTitle(text)) {
    return { line, text, price, kind: 'furniture' };
  }
  if (!/\p{L}{2}/u.test(text)) {
    return { line, text, price, kind: price ? 'price' : 'furniture' };
  }
  if (!price && isSectionHeading(text)) {
    return { line, text, kind: 'heading' };
  }
  return { line, text, price, kind: 'text' };
};

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** "OYSTERS AND PEARLS": the names of many tasting menus are in capitals, their descriptions not */
const isAllCaps = (text: string) => {
  const letters = text.match(/\p{L}/gu) ?? [];
  return (
    letters.length >= 3 && letters.filter((letter) => letter !== letter.toLowerCase()).length >= 0.85 * letters.length
  );
};

/**
 * The name of the restaurant and the title or the date of the menu at the top of a column ("THE FRENCH LAUNDRY",
 * "CHEF'S TASTING MENU", "JANUARY 11, 2014", "Noma Australia 2016") are not items.
 */
const markHeader = (lines: LineInfo[]) => {
  let end = -1;
  for (const [index, info] of lines.slice(0, 4).entries()) {
    const dated = isDate(info.line.text) || YEAR.test(info.line.text);
    if (info.price && !dated) {
      break;
    }
    if (
      (info.kind === 'furniture' && (dated || isMenuTitle(info.text))) ||
      (info.kind !== 'furniture' && dated && wordCount(info.text) <= 5)
    ) {
      end = index;
    }
  }
  for (const info of lines.slice(0, end + 1)) {
    info.kind = 'furniture';
  }
  return lines;
};
const isCapitalized = (text: string) => text === text.toUpperCase() || /^(?:\p{Lu}\p{Ll}*\s?)+$/u.test(text);

/**
 * Short, unpriced lines in much larger text are headings too (sections the list doesn't know), unless smaller text
 * follows right below them, as the description of an item name does.
 */
const markHeadings = (lines: LineInfo[], headingHeight: number) => {
  for (const [index, info] of lines.entries()) {
    if (info.kind !== 'text' || info.price || info.line.height < headingHeight) {
      continue;
    }
    if (wordCount(info.text) > 4 || !isCapitalized(info.text)) {
      continue;
    }
    const next = lines.slice(index + 1).find((candidate) => candidate.kind === 'text');
    const describedBelow =
      next &&
      next.line.top - info.line.bottom < 0.6 * info.line.height &&
      next.line.height < (SMALLER * headingHeight) / 1.35;
    if (!describedBelow) {
      info.kind = 'heading';
    }
  }
  return lines;
};

type Draft = {
  name: string[];
  description: string[];
  price?: string;
  section?: string;
  nameHeight: number;
  /** the height of the largest description line */
  descriptionHeight: number;
  lines: TextLine[];
};

const addDescription = (draft: Draft, { text, line }: { text: string; line: TextLine }) => {
  draft.description.push(text);
  draft.descriptionHeight = Math.max(draft.descriptionHeight, line.height);
  draft.lines.push(line);
};

const joinLines = (parts: string[]) => {
  let text = '';
  for (const part of parts) {
    text = text ? joinText(text, part) : part;
  }
  return cleanItemText(text);
};

/** a word that can't be a dish on its own: "CHEF'S", "Katz's", "and", "of" */
const isFragment = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  const letters = name.replaceAll(/[^\p{L}]/gu, '').length;
  return (
    letters < 3 ||
    (words.length === 1 && (/['’]s$/iu.test(name) || CONNECTOR_START.test(name) || CONNECTOR_END.test(name)))
  );
};

const toItem = (draft: Draft, column: number): MenuItem | undefined => {
  const name = joinLines(draft.name);
  if (!/\p{L}{2}/u.test(name) || isSectionHeading(name) || isPageFurniture(name) || isFragment(name)) {
    return;
  }
  const description = joinLines(draft.description);
  const priceValue = draft.price ? parsePrice(draft.price) : undefined;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    name,
    ...(description && { description }),
    ...(draft.price && { price: draft.price }),
    ...(priceValue !== undefined && { priceValue }),
    ...(draft.section && { section: draft.section }),
    column,
    box: [
      round(Math.min(...draft.lines.map((line) => line.left))),
      round(Math.min(...draft.lines.map((line) => line.top))),
      round(Math.max(...draft.lines.map((line) => line.right))),
      round(Math.max(...draft.lines.map((line) => line.bottom))),
    ],
  };
};

const looksLikeDescription = (text: string) => text.includes(',') || wordCount(text) >= 5 || CONNECTOR_START.test(text);

/** reads the items of one column, top to bottom */
const parseColumn = (lines: LineInfo[], column: number, section?: string) => {
  const textLines = lines.filter((info) => info.kind === 'text');
  const priced = textLines.filter((info) => info.price);
  const isPriced = priced.length + lines.filter((info) => info.kind === 'price').length >= 0.3 * textLines.length;
  const nameHeight = median((priced.length > 0 ? priced : textLines).map((info) => info.line.height)) || 0.02;
  // a list of one name per line with space between the lines: two lines set tight together are one name
  const gaps = textLines
    .slice(1)
    .map((info, index) => (info.line.top - textLines[index].line.bottom) / Math.max(info.line.height, 1e-6));
  const spaced = !isPriced && gaps.length >= 3 && median(gaps) > 0.8;

  const items: MenuItem[] = [];
  let current: Draft | undefined;
  let previous: TextLine | undefined;
  let currentSection = section;

  const finish = () => {
    if (current && (!isPriced || current.price || current.description.length > 0)) {
      const item = toItem(current, column);
      if (item) {
        items.push(item);
      }
    }
    current = undefined;
  };

  for (const info of lines) {
    const { line, text, price } = info;
    const gap = previous ? line.top - previous.bottom : Infinity;
    const close = gap <= 1.1 * Math.max(line.height, previous?.height ?? 0);
    const smaller = line.height < SMALLER * (current?.nameHeight ?? nameHeight);

    if (info.kind === 'furniture') {
      continue;
    }

    if (info.kind === 'heading') {
      finish();
      currentSection = text;
      previous = line;
      continue;
    }

    if (info.kind === 'price') {
      // a price on its own line belongs to the item above, unless it is far below it (e.g. a page number)
      if (current && !current.price && gap <= 3 * Math.max(line.height, nameHeight)) {
        current.price = price;
        current.lines.push(line);
      }
      previous = line;
      continue;
    }

    const start = () => {
      finish();
      current = {
        name: [text],
        description: [],
        price,
        section: currentSection,
        nameHeight: line.height,
        descriptionHeight: 0,
        lines: [line],
      };
    };

    // a name in capitals after the (mixed case) description of a name in capitals is the next item
    const nextInCapitals =
      current !== undefined &&
      current.description.length > 0 &&
      isAllCaps(text) &&
      isAllCaps(current.name[0]) &&
      !isAllCaps(current.description.at(-1)!);
    // "and Garden Mache" goes on from the line above, even after a gap
    const continues =
      current !== undefined &&
      !close &&
      !price &&
      CONTINUATION.test(text) &&
      gap <= 3 * Math.max(line.height, previous?.height ?? 0);

    if (continues) {
      addDescription(current!, info);
    } else if (!current || !close || nextInCapitals) {
      start();
    } else if (current.price) {
      // the item is complete: a description follows, or the next item; text as large as the name after a smaller
      // description is the next item
      const afterSmallDescription =
        current.description.length > 0 && !smaller && current.descriptionHeight < SMALLER * current.nameHeight;
      const isDescription =
        !afterSmallDescription &&
        (smaller ||
          startsLowercase(text) ||
          CONNECTOR_START.test(text) ||
          (!price && (current.description.length > 0 || looksLikeDescription(text))));
      if (isDescription && (!price || smaller || startsLowercase(text))) {
        addDescription(current, info);
      } else {
        start();
      }
    } else {
      const lastName = current.name.at(-1) ?? '';
      const continuesName =
        !smaller &&
        current.description.length === 0 &&
        (CONNECTOR_END.test(lastName) ||
          (/\p{L}-$/u.test(lastName) && startsLowercase(text)) ||
          (spaced && gap < 0.4 * line.height && isAllCaps(text) === isAllCaps(lastName)));
      const afterSmallDescription =
        current.description.length > 0 && !smaller && current.descriptionHeight < SMALLER * current.nameHeight;

      if (continuesName) {
        current.name.push(text);
        current.price = price;
        current.lines.push(line);
      } else if (afterSmallDescription) {
        start();
      } else if (smaller || startsLowercase(text) || looksLikeDescription(text) || current.description.length > 0) {
        if (current.description.length > 0 && price && !smaller && !looksLikeDescription(text)) {
          start();
        } else {
          addDescription(current, info);
          current.price = price;
        }
      } else if (isPriced && price && wordCount(text) <= 4 && wordCount(lastName) <= 4 && current.name.length === 1) {
        // a name over two lines, with the price at the end of the second one
        current.name.push(text);
        current.price = price;
        current.lines.push(line);
      } else {
        start();
      }
    }
    previous = line;
  }
  finish();

  return { items, section: currentSection };
};

const normalizeName = (name: string) => normalizeWords(name).replaceAll(' ', '');

/**
 * Reads the items of a menu from the OCR boxes of its photo: the boxes are split into columns and lines; prices,
 * section headings, allergen codes and page furniture (addresses, phone numbers, opening hours, cover charges) are set
 * aside; names over several lines are joined; the smaller text or the text that follows a priced name is the
 * description. Names are kept in the language of the menu. A tilted page is levelled first (see `deskewBoxes`; pass
 * the `aspectRatio` of the photo for an exact angle).
 */
export const parseMenu = (
  ocr: OcrBoxInput[],
  options: { minScore?: number; aspectRatio?: number } = {},
): ParsedMenu => {
  const boxes = toTextBoxes(deskewBoxes(ocr, options.aspectRatio), options.minScore).flatMap((box) =>
    splitAtPrices(box),
  );
  if (boxes.length === 0) {
    return { items: [], sections: [], columns: 0, lines: 0 };
  }

  const { columns, spanning } = findColumns(boxes, options.aspectRatio);
  const columnLines = columns.map((column) => markHeader(column.lines.map((line) => analyzeLine(line))));
  const spanningLines = markHeader(spanning.map((line) => analyzeLine(line)));
  const allLines = [...spanningLines, ...columnLines.flat()];

  // headings are much larger than the item names, which are the lines with a price when there are prices
  const texts = allLines.filter((info) => info.kind === 'text');
  const priced = texts.filter((info) => info.price);
  const nameHeight = Math.max(
    median(texts.map((info) => info.line.height)),
    median(priced.map((info) => info.line.height)),
  );
  const headingHeight = 1.35 * nameHeight;

  const title = getTitle(
    allLines.map((info) => info.line),
    nameHeight,
  );
  const isTitle = (info: LineInfo) => !!title && info.line.top < 0.35 && info.text === title;
  markHeadings(spanningLines, headingHeight);

  const items: MenuItem[] = [];
  const sections: string[] = [];
  for (const [index, analyzed] of columnLines.entries()) {
    const lines = markHeadings(analyzed, headingHeight).filter((info) => !isTitle(info));
    // a heading across the page names the section of the columns below it
    const heading = spanningLines.findLast(
      (info) => info.kind === 'heading' && !isTitle(info) && info.line.bottom <= (lines[0]?.line.top ?? 1),
    );
    items.push(...parseColumn(lines, index, heading?.text).items);
  }
  for (const info of allLines.toSorted((a, b) => a.line.top - b.line.top || a.line.left - b.line.left)) {
    if (info.kind === 'heading' && !isTitle(info) && !sections.includes(info.text)) {
      sections.push(info.text);
    }
  }

  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = normalizeName(item.name);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return {
    items: unique,
    ...(title && { title }),
    sections,
    columns: columns.length,
    lines: allLines.length,
  };
};

/** the largest text in the top part of the page that is not a section heading or page furniture */
const getTitle = (lines: TextLine[], bodyHeight: number) => {
  const candidates = lines
    .filter((line) => line.top < 0.35 && line.height >= 1.4 * bodyHeight)
    .map((line) => ({ line, text: cleanItemText(splitPrice(line.text).text) }))
    .filter(({ text }) => /\p{L}{3}/u.test(text) && !isSectionHeading(text) && !isPageFurniture(text))
    .toSorted((a, b) => b.line.height - a.line.height || a.line.top - b.line.top);
  return candidates[0]?.text;
};

const readText = (boxes: OcrBoxInput[]) =>
  toTextBoxes(boxes).reduce((sum, box) => sum + box.text.replaceAll(/[^\p{L}\d]/gu, '').length, 0);

/**
 * Which OCR to read a menu from: the tiled full-resolution reading, unless it somehow reads much less text than the
 * OCR stored for the photo.
 */
export const chooseMenuOcr = (stored: OcrBoxInput[], detailed: OcrBoxInput[]): 'tiles' | 'stored' =>
  readText(detailed) >= 0.8 * readText(stored) ? 'tiles' : 'stored';

const itemKey = (name: string) =>
  stripAccents(name)
    .toLowerCase()
    .replaceAll(/[^\p{L}\d]/gu, '');

/** the same name, give or take a few letters OCR read differently */
const isSameKey = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 8 && editDistance(a, b) <= 0.15 * Math.max(a.length, b.length));

export type MergedMenuItem = {
  menuId: string;
  item: MenuItem;
  /** the place of the item in the longest column of the menu, the courses in the order they are served */
  course?: number;
};

/**
 * The items of the menus of a meal, without the items another page (or photo) of it already listed, in menu order.
 * The longest column of any page is the sequence of courses (of a tasting menu): its items, and the items of other
 * photos that name them again, get their place in it.
 */
export const mergeMenuItems = <T extends { items: MenuItem[] }>(
  readings: Array<T & { assetId: string }>,
): MergedMenuItem[] => {
  let courses: string[] = [];
  for (const reading of readings) {
    const columns = Map.groupBy(reading.items, (item) => item.column);
    for (const column of columns.values()) {
      if (column.length > courses.length) {
        courses = column.map((item) => itemKey(item.name));
      }
    }
  }

  const seen: string[] = [];
  const items: MergedMenuItem[] = [];
  for (const reading of readings) {
    for (const item of reading.items) {
      const key = itemKey(item.name);
      if (seen.some((other) => isSameKey(other, key))) {
        continue;
      }
      seen.push(key);
      const course = courses.findIndex((other) => isSameKey(other, key));
      items.push({ menuId: reading.assetId, item, ...(course >= 0 && { course }) });
    }
  }
  return items;
};
