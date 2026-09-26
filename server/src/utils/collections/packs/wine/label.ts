import { OcrBoxInput, TextLine, groupLines, toTextBoxes } from 'src/utils/collections/ocr.js';
import { parseMenu } from 'src/utils/collections/packs/food/menu.js';
import { isGarbled, toTitleCase } from 'src/utils/collections/place.js';
import { ParsedSource, SourceEntry, SourceParseOptions } from 'src/utils/collections/source.js';
import { editDistance } from 'src/utils/collections/text.js';
import {
  COMMON_WORDS,
  LEXICON_WORDS,
  LexiconEntry,
  WineType,
  normalizeWords,
} from 'src/utils/collections/packs/wine/lexicon.js';

/**
 * Reading a bottle label. Labels are set in script fonts, curve around the bottle and are photographed at an angle
 * next to a glass, so OCR reads them in fragments ("KUDOS / 12", "Wehle / 2009 / ing Kabinett", "1979er", "nomd").
 * The reader keeps what it can tell apart: the vintage (a year, "1979er"), the words of the wine lexicon (grapes,
 * styles such as Spätlese or Brut, regions and appellations, and the words that mark a producer such as Weingut,
 * Domaine or Winery), the vineyard sites of German labels ("Brauneberger Juffer"), and the most prominent remaining
 * name, which is the producer's more often than not. The mandatory small print (A.P.Nr., alcohol, volume,
 * "Gutsabfüllung", addresses, sulfites) and the prose of back labels are left out. Every reading says how sure it is:
 * the assistant's eyes are the main reader, and the reading is a start.
 */

export type WineLabel = {
  producer?: string;
  /** the wine or cuvée: its vineyard site, name, named appellation, grape and style, e.g. "Brauneberger Juffer Riesling Spätlese" */
  wine?: string;
  /** e.g. 2009, or NV */
  vintage?: string;
  region?: string;
  grape?: string;
  /** Red, White, Rosé, Sparkling, Sweet, Fortified, Beer or Cider, when the label says */
  type?: WineType;
  /** 0..1: how much of the label was read, and how clearly */
  confidence: number;
  /** the reading is clear enough to be trusted without a look */
  sure: boolean;
  /** several different labels (vintages) on the photo, e.g. three bottles at a tasting */
  several: boolean;
  /** the words that tell this label from others, normalized, for photos of the same bottle */
  words: string[];
  /** where the label's text is on the photo: [left, top, right, bottom], normalized 0..1 */
  box?: [number, number, number, number];
};

/** an entry read on a bottle label, with what was read on it */
export type WineEntry = SourceEntry & { label: WineLabel };

export const isWineEntry = (entry: SourceEntry): entry is WineEntry => 'label' in entry && !!entry.label;

const MIN_VINTAGE = 1900;
const MAX_VINTAGE = 2049;

/** OCR's letters for digits in a year: "20II" is 2011, "2O10" is 2010 */
const YEAR_TOKEN = /(?<![\d\p{L}])([12][\dIlOo]{3})(er)?(?![\d\p{L}])/gu;

/** the years on a line, e.g. 2009 in "2009", "1979er" or "Wehlener Sonnenuhr 2008" */
export const findVintages = (text: string) =>
  [...text.matchAll(YEAR_TOKEN)].flatMap((match) => {
    const digits = match[1].replaceAll(/[Il]/g, '1').replaceAll(/[Oo]/g, '0');
    const year = Number(digits);
    // a year needs most of its digits read as digits
    const letters = match[1].replaceAll(/\d/g, '').length;
    return year >= MIN_VINTAGE && year <= MAX_VINTAGE && letters <= 2 ? [String(year)] : [];
  });

/** a line that is just a year */
const isVintageLine = (text: string) => /^[\s·.,'’-]*[12][\dIlOo]{3}(?:er)?[\s·.,'’-]*$/u.test(text) && findVintages(text).length > 0;

/** the mandatory small print, addresses and numbers of a label */
const NOISE_TEXT = [
  /%/,
  /\bvol\b|by\s?vol/i,
  /\d\s?m[lI]\b|\bm[lI]e?\b|\bcl\b/,
  /\d{5,}/,
  /\ba[.\s-]{0,2}p[.\s-]{0,2}n[rt]/i,
  /since\s?\d{4}/i,
  /www\.|@|\.com\b/i,
  /\b[dfa]-?\s?\d{4,5}\b/i,
  /\be\s?\d{2,3}\s?m?l\b/i,
];
const NOISE_WORDS =
  /abfullung|abfuellung|qualitatswein|pradikat|deutscher|enthalt|sulfit|sulphit|contains|product of|produce of|produit de|bottled by|mis en bouteille|embotellado|imbottigliato|imported by|importer|government warning|\bvdp\b|\balc\b|\bsince \d{4}|\best \d{4}|\bestd\b/;

const FUNCTION_WORDS = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'und',
  'wenn',
  'bei',
  'auf',
  'ist',
  'sind',
  'zu',
  'im',
  'mit',
  'the',
  'and',
  'for',
  'of',
  'with',
  'to',
  'is',
  'are',
  'an',
  'this',
  'our',
  'from',
  'le',
  'les',
  'et',
  'du',
  'en',
  'el',
  'los',
  'las',
  'con',
  'para',
  'que',
]);

/** "Spätlese" is still "SPATLESE" with a letter or two misread: how many, by the length of the word */
const tolerance = (length: number) => (length <= 4 ? 0 : length <= 8 ? 1 : length <= 11 ? 2 : 3);

type Term = { entry: LexiconEntry; start: number; end: number; exact: boolean };

/**
 * How a window of words matches a lexicon entry: exactly, with a letter or two misread (a short word only when its
 * first letter was read, so that "Cherry" is not "Sherry"), or cut at the edge of the label ("RRONTES" is Torrontés,
 * "NRGOGNE" Bourgogne)
 */
const matchWindow = (window: string, target: string, size: number) => {
  if (window === target) {
    return true;
  }
  if (window.length >= 5 && editDistance(window, target) <= tolerance(target.length)) {
    return target.length >= 7 || window[0] === target[0];
  }
  if (size === 1 && target.length >= 6 && window.length >= 5 && window.length < target.length) {
    const slack = window.length >= 7 ? 1 : 0;
    return (
      window.length >= 0.7 * target.length &&
      (editDistance(window, target.slice(-window.length)) <= slack ||
        editDistance(window, target.slice(0, window.length)) <= slack)
    );
  }
  return false;
};

/**
 * The lexicon words on a line of normalized words, left to right, exact readings first; a word is used by one term
 * at most
 */
export const findTerms = (words: string[]): Term[] => {
  const used = Array.from({ length: words.length }, () => false);
  const terms: Term[] = [];
  const lengths = [...new Set(LEXICON_WORDS.map((entry) => entry.words.join('').length))].toSorted((a, b) => b - a);
  for (const length of lengths) {
    const entries = LEXICON_WORDS.filter((entry) => entry.words.join('').length === length);
    for (const exact of [true, false]) {
      for (const entry of entries) {
        const size = entry.words.length;
        const target = entry.words.join('');
        for (let start = 0; start + size <= words.length; start++) {
          if (used.slice(start, start + size).some(Boolean)) {
            continue;
          }
          const window = words.slice(start, start + size).join('');
          const match = exact
            ? window === target
            : matchWindow(window, target, size) ||
              // a grape cut after four letters: "VIUR" is Viura
              (entry.kind === 'grape' && size === 1 && window.length === 4 && target.length <= 6 && target.startsWith(window));
          if (!match) {
            continue;
          }
          for (let index = start; index < start + size; index++) {
            used[index] = true;
          }
          terms.push({ entry, start, end: start + size, exact });
        }
      }
    }
  }
  return terms.toSorted((a, b) => a.start - b.start);
};

type LabelLine = TextLine & {
  words: string[];
  terms: Term[];
  /** the text left when the lexicon words and years are taken out */
  rest: string;
  vintages: string[];
  noise: boolean;
  prose: boolean;
  /** 0..1, from the OCR confidence of its words */
  confidence: number;
};

const SURE_TEXT = 0.9;

const lineConfidence = (line: TextLine) => {
  const score = Math.min(...line.boxes.map((box) => box.score));
  return score >= SURE_TEXT ? 1 : Math.max(0.3, 0.6 + 4 * (score - 0.8));
};

const isLatin = (text: string) => {
  const letters = text.replaceAll(/[^\p{L}]/gu, '');
  return letters.length > 0 && letters.replaceAll(/[^\p{Script=Latin}]/gu, '').length >= 0.6 * letters.length;
};

/** words of the raw text, without punctuation around them */
const rawWords = (text: string) =>
  text
    .split(/\s+/)
    .map((word) => word.replaceAll(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ''))
    .filter(Boolean);

const toLabelLine = (line: TextLine): LabelLine => {
  const words = normalizeWords(line.text).split(' ').filter(Boolean);
  const terms = findTerms(words);
  const inTerm = new Set(terms.flatMap(({ start, end }) => Array.from({ length: end - start }, (_, i) => start + i)));
  const vintages = findVintages(line.text);
  const normalized = words.join(' ');
  const noise = NOISE_TEXT.some((pattern) => pattern.test(line.text)) || NOISE_WORDS.test(normalized);
  const functionWords = words.filter((word) => FUNCTION_WORDS.has(word)).length;
  const prose = words.length >= 3 && functionWords >= 1 && terms.length === 0;
  // the text without the lexicon words and years, e.g. "Chavy" of "Louis Chavy", punctuation kept ("Joh.Jos. Prim")
  const tokens = [...line.text.matchAll(/[\p{L}\p{M}\d]+/gu)];
  let rest = line.text;
  if (tokens.length === words.length) {
    const cuts = [
      ...terms.map(({ start, end }) => [tokens[start].index, tokens[end - 1].index + tokens[end - 1][0].length]),
      ...tokens.filter((token) => findVintages(token[0]).length > 0).map((token) => [token.index, token.index + token[0].length]),
    ].toSorted((a, b) => b[0] - a[0]);
    for (const [from, to] of cuts) {
      rest = `${rest.slice(0, from)} ${rest.slice(to)}`;
    }
  } else {
    rest = terms.length === 0 ? line.text.replaceAll(YEAR_TOKEN, ' ') : '';
  }
  rest = rest.replaceAll(/\s+/g, ' ').replaceAll(/^[\s\p{P}]+|[\s\p{P}]+$/gu, (match) => (/[.]$/.test(match) ? match.trim() : '')).trim();
  return {
    ...line,
    words,
    terms,
    rest,
    vintages,
    noise,
    prose,
    confidence: lineConfidence(line),
  };
};

const letters = (text: string) => text.replaceAll(/[^\p{L}]/gu, '').length;

/** a line that only says what every label says: "SELECTION", "ESTATE GROWN", "Crisp and refreshing" */
const isCommonOnly = (text: string) => {
  const words = normalizeWords(text)
    .split(' ')
    .filter((word) => word.length > 2);
  return words.length > 0 && words.every((word) => COMMON_WORDS.has(word) || FUNCTION_WORDS.has(word));
};

const GERMAN_STYLES = new Set([
  'Kabinett',
  'Spätlese',
  'Auslese',
  'Beerenauslese',
  'Trockenbeerenauslese',
  'Eiswein',
  'Trocken',
  'Halbtrocken',
  'Feinherb',
  'Edelsüß',
]);
const GERMAN_REGIONS = new Set([
  'Mosel',
  'Mosel-Saar-Ruwer',
  'Saar',
  'Ruwer',
  'Rheinhessen',
  'Rheingau',
  'Pfalz',
  'Nahe',
  'Baden',
  'Franken',
  'Württemberg',
  'Ahr',
]);

/** the vineyard site of a German label: the village with "-er" and the site, e.g. "Graacher Himmelreich" */
const SITE_WORD = /^(?:[A-ZÄÖÜ][a-zäöüß]{3,}|[A-ZÄÖÜ]{4,}|[a-zäöüß]{4,})(?:er|ER)$/u;

const findSite = (line: LabelLine): string | undefined => {
  const words = rawWords(line.rest);
  const index = words.findIndex((word) => SITE_WORD.test(word));
  if (index === -1) {
    return;
  }
  const site = words.slice(index, index + 2).filter((word) => letters(word) >= 3);
  // a village alone ("Graacher") needs a long name
  return site.length > 1 || site[0].length >= 7 ? site.join(' ') : undefined;
};

/** "WILLI HAAG" → "Willi Haag", "Joh.Jos. Prim" as printed; the canonical spelling of lexicon words */
const cleanName = (text: string) =>
  toTitleCase(
    text
      .replaceAll(/\s*:\s*/g, ' ')
      .replaceAll(/[“”"«»]/g, '')
      .replaceAll(/\s+/g, ' ')
      .trim(),
  );

const unique = <T>(values: T[]) => [...new Set(values)];

const contains = (a: string, b: string) => {
  const x = normalizeWords(a).replaceAll(' ', '');
  const y = normalizeWords(b).replaceAll(' ', '');
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
};

/** the words that tell a label apart: not lexicon words, years, or words every label has */
const distinctWords = (lines: LabelLine[]) =>
  unique(
    lines.flatMap((line) => {
      const inTerm = new Set(line.terms.flatMap(({ start, end }) => Array.from({ length: end - start }, (_, i) => start + i)));
      return line.words.filter(
        (word, index) =>
          !inTerm.has(index) &&
          word.length >= 4 &&
          /\p{L}{3}/u.test(word) &&
          !COMMON_WORDS.has(word) &&
          !FUNCTION_WORDS.has(word) &&
          findVintages(word).length === 0,
      );
    }),
  );

const union = (lines: TextLine[]): [number, number, number, number] | undefined =>
  lines.length === 0
    ? undefined
    : [
        Math.min(...lines.map((line) => line.left)),
        Math.min(...lines.map((line) => line.top)),
        Math.max(...lines.map((line) => line.right)),
        Math.max(...lines.map((line) => line.bottom)),
      ];

const typeOf = (styles: LexiconEntry[], grapes: LexiconEntry[]): WineType | undefined => {
  for (const type of ['Beer', 'Cider', 'Sparkling', 'Fortified', 'Rosé', 'Sweet'] as const) {
    if (styles.some((style) => style.type === type)) {
      return type;
    }
  }
  const colors = unique(grapes.map((grape) => grape.color));
  return colors.length === 1 ? (colors[0] === 'red' ? 'Red' : 'White') : undefined;
};

/**
 * Reads a bottle label from its OCR: the producer, the wine, the vintage, the region, the grape and the kind of wine,
 * and how sure the reading is; undefined when nothing on the photo reads as a label.
 */
export const readWineLabel = (ocr: OcrBoxInput[]): WineLabel | undefined => {
  const lines = groupLines(toTextBoxes(ocr))
    .filter((line) => findVintages(line.text).length > 0 || isLatin(line.text))
    .map((line) => toLabelLine(line));
  if (lines.length === 0) {
    return;
  }

  // the vintage: a year on a line of its own before a year in running text, the largest first
  const years = lines
    .filter((line) => !line.noise || isVintageLine(line.text))
    .flatMap((line) => line.vintages.map((year) => ({ year, line, alone: isVintageLine(line.text) })))
    .toSorted((a, b) => Number(b.alone) - Number(a.alone) || b.line.height - a.line.height);
  const vintage = years[0];
  const several = new Set(years.map(({ year }) => year)).size > 1;

  // lexicon words: from every line but prose (a noise line may still name the region, "appellation bourgogne")
  const termLines = lines.filter((line) => !line.prose);
  const terms = termLines.flatMap((line) => line.terms.map((term) => ({ term, line })));
  const regions = terms.filter(({ term }) => term.entry.kind === 'region');
  const grapes = unique(terms.filter(({ term }) => term.entry.kind === 'grape').map(({ term }) => term.entry));
  const styles = unique(terms.filter(({ term }) => term.entry.kind === 'style').map(({ term }) => term.entry));
  const german =
    styles.some((style) => GERMAN_STYLES.has(style.name)) ||
    regions.some(({ term }) => GERMAN_REGIONS.has(term.entry.name)) ||
    terms.some(({ term }) => term.entry.kind === 'prefix' && /^Wein/.test(term.entry.name));
  // the most specific region: the longest name, e.g. Mosel-Saar-Ruwer over Mosel
  const region = regions
    .map(({ term, line }) => ({ entry: term.entry, line, exact: term.exact }))
    .toSorted((a, b) => Number(b.exact) - Number(a.exact) || b.entry.name.length - a.entry.name.length)[0];

  // names: the text of the lines that are not small print, prose, years or lexicon words alone
  const kept = lines.filter((line) => !line.noise && !line.prose);
  const sites = german
    ? kept.flatMap((line) => {
        const site = findSite(line);
        return site ? [{ site, line }] : [];
      })
    : [];
  type Name = { text: string; lines: LabelLine[]; marker: boolean; height: number; confidence: number };
  const names: Name[] = [];
  for (const [index, line] of kept.entries()) {
    const markers = line.terms.filter(({ entry }) => entry.kind === 'prefix' || entry.kind === 'suffix');
    let text = line.rest;
    for (const { site } of sites.filter((item) => item.line === line)) {
      text = text.replace(site, ' ');
    }
    text = text.replaceAll(/\s+/g, ' ').trim();
    const marker = markers[0]?.entry;
    const bareMarker =
      markers.length > 0 && rawWords(text).every((word) => letters(word) <= 2 || FUNCTION_WORDS.has(word.toLowerCase()));
    if (isCommonOnly(line.text) && !bareMarker) {
      continue;
    }
    if (marker) {
      // a producer word joins the name on the line (or, alone, the name on the line next to it): "Chateau De
      // RocheMory", "CAIRDEAS WINERY"
      const own = rawWords(text).filter((word) => letters(word) > 2 && !FUNCTION_WORDS.has(word.toLowerCase()));
      let partner: LabelLine | undefined;
      if (own.length === 0) {
        const next = kept[index + 1];
        const previous = kept[index - 1];
        const near = (other?: LabelLine) =>
          other && Math.abs(other.centerY - line.centerY) < 3 * Math.max(line.height, other.height) && other.rest;
        partner = marker.kind === 'prefix' ? (near(next) ? next : undefined) : near(previous) ? previous : undefined;
      }
      const base = partner ? partner.rest : text;
      if (letters(base) < 3) {
        continue;
      }
      const joined = marker.kind === 'prefix' ? `${marker.name} ${cleanName(base)}` : `${cleanName(base)} ${marker.name}`;
      const used = partner ? [line, partner] : [line];
      names.push({
        text: joined.replaceAll(/\s+/g, ' ').trim(),
        lines: used,
        marker: true,
        height: Math.max(...used.map((item) => item.height)),
        confidence: Math.min(...used.map((item) => item.confidence)),
      });
      continue;
    }
    if (letters(text) < 3 || isCommonOnly(text)) {
      continue;
    }
    names.push({ text: cleanName(text), lines: [line], marker: false, height: line.height, confidence: line.confidence });
  }
  // a name repeated on the neck label ("HAAG" and "WILLI HAAG"): the longer reading, unless it only adds a letter or
  // two of noise ("NACHTGOLD NA"), as large as the largest of them
  const extra = (a: Name, b: Name) => Math.abs(letters(a.text) - letters(b.text));
  const better = (a: Name, b: Name) =>
    extra(a, b) <= 2 ? a.height > b.height || (a.height === b.height && a.text.length <= b.text.length) : a.text.length > b.text.length;
  const distinct = names
    .filter((name) => !names.some((other) => other !== name && contains(other.text, name.text) && better(other, name)))
    .map((name) => ({
      ...name,
      height: Math.max(name.height, ...names.filter((other) => contains(other.text, name.text)).map((other) => other.height)),
    }))
    .filter((name, index, all) => all.findIndex((other) => other.text === name.text) === index);
  const largest = Math.max(0, ...distinct.map((name) => name.height));
  const score = (name: Name) =>
    (name.height / (largest || 1)) * (name.confidence < 0.75 ? 0.5 : name.confidence) +
    (name.marker ? 0.6 : 0) -
    (isGarbled(name.text) ? 0.4 : 0);
  const producer = distinct.toSorted((a, b) => score(b) - score(a))[0];

  // the wine: the site, the cuvée (another prominent name when there is no grape or site), the appellation that
  // names it, the grape and the style, in the order they are printed
  type Part = { text: string; line: LabelLine; order: number };
  const parts: Part[] = [];
  const add = (text: string, line: LabelLine, offset = 0) => {
    if (!parts.some((part) => normalizeWords(part.text) === normalizeWords(text))) {
      parts.push({ text, line, order: line.top + offset });
    }
  };
  for (const { site, line } of sites) {
    if (!producer || !contains(producer.text, site)) {
      add(cleanName(site), line);
    }
  }
  if (sites.length === 0 && grapes.length === 0) {
    for (const name of distinct) {
      if (
        name !== producer &&
        !name.marker &&
        name.confidence >= 0.8 &&
        !isGarbled(name.text) &&
        name.height >= 0.25 * (producer?.height ?? name.height) &&
        (!producer || !contains(producer.text, name.text))
      ) {
        add(name.text, name.lines[0]);
      }
    }
  }
  if (region?.entry.names && sites.length === 0) {
    // the appellation leads the name of the wine: "Bourgogne Pinot Noir"
    add(region.entry.name, region.line, -1);
  }
  for (const { term, line } of terms) {
    if (term.entry.kind === 'grape' || term.entry.kind === 'style') {
      add(term.entry.name, line, term.start * 1e-4);
    }
  }
  const wineParts = parts.toSorted((a, b) => a.order - b.order).map(({ text }) => text);
  // a wine named only by its grape or style is known by its region too: "Napa Valley Reserve"
  const named = sites.length > 0 || parts.some(({ text }) => !grapes.some((grape) => grape.name === text) && !styles.some((style) => style.name === text));
  if (region && !region.entry.names && region.entry.name.length <= 20 && wineParts.length > 0 && !named) {
    wineParts.unshift(region.entry.name);
  }
  const wine = wineParts.join(' ') || undefined;

  if (!producer && !wine && !vintage) {
    return;
  }

  const producerSure = !!producer && producer.confidence >= 1 && !isGarbled(producer.text) && letters(producer.text) >= 4;
  const confidence =
    (several ? 0.5 : 1) *
    ((producer ? 0.4 * producer.confidence : 0) +
      (wine ? 0.3 : 0) +
      (vintage ? 0.2 * vintage.line.confidence : 0) +
      (region ? 0.1 : 0));
  const used = [
    ...(producer?.lines ?? []),
    ...parts.map(({ line }) => line),
    ...(vintage ? [vintage.line] : []),
    ...(region ? [region.line] : []),
  ];
  return {
    ...(producer && { producer: producer.text }),
    ...(wine && { wine }),
    ...(vintage && { vintage: vintage.year }),
    ...(region && { region: region.entry.name }),
    ...(grapes.length > 0 && { grape: grapes.map(({ name }) => name).join(', ') }),
    ...(typeOf(styles, grapes) && { type: typeOf(styles, grapes) }),
    confidence: Math.round(confidence * 100) / 100,
    sure: producerSure && !!(wine || vintage) && !several && confidence >= 0.7,
    several,
    words: distinctWords(kept),
    box: union(used),
  };
};

const SEPARATOR = ' · ';

/**
 * The name of a wine in tags and descriptions: "Producer · Wine · Vintage", e.g. "Willi Haag · Brauneberger Juffer
 * Riesling Spätlese · 2009"; what is unknown is left out ("Kudos · 2012", "Snakebite")
 */
export const formatWineName = ({ producer, wine, vintage }: Pick<WineLabel, 'producer' | 'wine' | 'vintage'>) =>
  [producer, wine, vintage]
    .map((part) => part?.replaceAll('/', '-').replaceAll(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(SEPARATOR);

const VINTAGE_PART = /^(?:\d{4}|NV|N\.V\.)$/i;

/** the parts of a name written by `formatWineName` (or by hand, "Producer · Wine · Vintage") */
export const parseWineName = (name: string): Pick<WineLabel, 'producer' | 'wine' | 'vintage'> => {
  const parts = name
    .split(/\s+[·•|]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const vintage = parts.length > 1 && VINTAGE_PART.test(parts.at(-1)!) ? parts.pop() : undefined;
  if (parts.length === 0) {
    return { ...(vintage && { vintage }) };
  }
  if (parts.length === 1) {
    return { wine: parts[0], ...(vintage && { vintage }) };
  }
  return { producer: parts[0], wine: parts.slice(1).join(SEPARATOR), ...(vintage && { vintage }) };
};

/** a line of a wine list: a vintage or a price, e.g. "2015 Barolo, Vietti .... 95" */
const isListLine = (line: TextLine) => findVintages(line.text).length > 0 || /\d+[.,]\d{2}\b|[$€£]\s?\d/.test(line.text);

/** a wine list, a tasting sheet or a pairing menu: many lines, several with a vintage or a price */
export const isWineList = (ocr: OcrBoxInput[]) => {
  const lines = groupLines(toTextBoxes(ocr));
  return lines.length >= 8 && lines.filter((line) => isListLine(line)).length >= 3;
};

/** the entry of a bottle label: its name, its region and grape as the description, and where the label is */
export const toWineEntry = (label: WineLabel): WineEntry => ({
  name: formatWineName(label),
  ...((label.region || label.grape) && { description: [label.region, label.grape].filter(Boolean).join(SEPARATOR) }),
  column: 0,
  box: label.box ?? [0, 0, 1, 1],
  label,
});

/**
 * Reads a wine photo: a wine list, tasting sheet or pairing menu is read like a menu (an entry per wine), and a bottle
 * label into a single entry with what was read on it (see `readWineLabel`).
 */
export const parseWine = (ocr: OcrBoxInput[], options: SourceParseOptions = {}): ParsedSource => {
  if (isWineList(ocr)) {
    return parseMenu(ocr, options);
  }
  const lines = groupLines(toTextBoxes(ocr)).length;
  const label = readWineLabel(ocr);
  return { items: label ? [toWineEntry(label)] : [], sections: [], columns: label ? 1 : 0, lines };
};
