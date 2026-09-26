import {
  OcrBoxInput,
  TextBox,
  TextLine,
  deskewBoxes,
  groupLines,
  isPrice,
  median,
  parsePrice,
  toTextBoxes,
} from 'src/utils/food/ocr.js';

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

type Column = { left: number; right: number; boxes: TextBox[] };

/** the width is split into this many bins to find the gutters between columns */
const BINS = 100;
/** a bin covered by at most this fraction of the busiest bin's boxes is part of a gutter */
const GUTTER = 0.2;
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
  /allerg|alérg|surgelat|congelat|frozen|abbattut|gluten[- ]free options/i,
  // addresses
  /^(?:via|viale|piazza|corso|vicolo|largo|rue|avenue|boulevard|calle|avenida|plaza|paseo|rua)\s+\p{L}/iu,
  /\b(?:street|road|straße|strasse)\b.*\d|\d.*\b(?:street|road|straße|strasse)\b/i,
  // footnotes
  /^[*†°]/,
];

export const isPageFurniture = (text: string) => FURNITURE.some((pattern) => pattern.test(text));

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
  let result = text.replaceAll(SUPERSCRIPTS, ' ');
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

const startsLowercase = (text: string) => /^[\p{Ll}(]/u.test(text);

/** joins two lines of text, mending words hyphenated over the line break */
const joinText = (a: string, b: string) =>
  /\p{L}-$/u.test(a) && startsLowercase(b) ? `${a.slice(0, -1)}${b}` : `${a} ${b}`;

/** splits the photo into columns at its gutters, with the strips of prices joined to the text on their left */
export const findColumns = (boxes: TextBox[]): Column[] => {
  // how many boxes cover each 1% of the width; the gutters between columns are (almost) empty
  const counts = Array.from({ length: BINS }, () => 0);
  for (const box of boxes) {
    for (let i = Math.max(0, Math.floor(box.left * BINS)); i < Math.min(BINS, Math.ceil(box.right * BINS)); i++) {
      counts[i]++;
    }
  }
  // a few headings, addresses or titles across the page don't close a gutter
  const threshold = Math.floor(GUTTER * Math.max(...counts));

  const bands: Column[] = [];
  let start = -1;
  for (let i = 0; i <= BINS; i++) {
    const covered = i < BINS && counts[i] > threshold;
    if (covered && start < 0) {
      start = i;
    } else if (!covered && start >= 0) {
      bands.push({ left: start / BINS, right: i / BINS, boxes: [] });
      start = -1;
    }
  }
  if (bands.length <= 1) {
    return [{ left: bands[0]?.left ?? 0, right: bands[0]?.right ?? 1, boxes: [...boxes] }];
  }

  const overlap = (column: Column, box: TextBox) =>
    Math.max(0, Math.min(column.right, box.right) - Math.max(column.left, box.left));
  const nearest = (columns: Column[], box: TextBox) => {
    const overlaps = columns.map((column) => overlap(column, box));
    return overlaps.indexOf(Math.max(...overlaps));
  };

  for (const box of boxes) {
    bands[nearest(bands, box)].boxes.push(box);
  }

  // strips of prices (and stray boxes) belong to the text on their left, or on their right at the left edge
  const isPriceBand = (band: Column) =>
    band.boxes.length < 2 || band.boxes.filter((box) => isPrice(box.text)).length >= 0.6 * band.boxes.length;
  const columns: Column[] = [];
  for (const band of bands) {
    if (band.boxes.length === 0) {
      continue;
    }
    const previous = columns.at(-1);
    if (previous && (isPriceBand(band) || isPriceBand(previous))) {
      previous.right = band.right;
      previous.boxes.push(...band.boxes);
    } else {
      columns.push(band);
    }
  }

  // boxes across more than one column are headings, titles and addresses of the whole page
  const result = columns.map((column) => ({ ...column, boxes: [] as TextBox[] }));
  for (const box of boxes) {
    const spanned = result.filter((column) => overlap(column, box) > 0.3 * (column.right - column.left));
    if (spanned.length > 1) {
      continue;
    }
    result[nearest(result, box)].boxes.push(box);
  }

  return result.filter((column) => column.boxes.length > 0);
};

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

  if (isPageFurniture(line.text)) {
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

const toItem = (draft: Draft, column: number): MenuItem | undefined => {
  const name = joinLines(draft.name);
  if (!/\p{L}{2}/u.test(name) || isSectionHeading(name) || isPageFurniture(name)) {
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

    if (!current || !close) {
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
        (CONNECTOR_END.test(lastName) || (/\p{L}-$/u.test(lastName) && startsLowercase(text)));
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
  const boxes = toTextBoxes(deskewBoxes(ocr, options.aspectRatio), options.minScore);
  if (boxes.length === 0) {
    return { items: [], sections: [], columns: 0, lines: 0 };
  }

  const columns = findColumns(boxes);
  const assigned = new Set(columns.flatMap((column) => column.boxes));
  const spanning = boxes.filter((box) => !assigned.has(box));

  const columnLines = columns
    .toSorted((a, b) => a.left - b.left)
    .map((column) => groupLines(column.boxes).map((line) => analyzeLine(line)));
  const spanningLines = groupLines(spanning).map((line) => analyzeLine(line));
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
