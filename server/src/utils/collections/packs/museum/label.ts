import { findColumns } from 'src/utils/collections/layout.js';
import {
  OcrBoxInput,
  TextBox,
  TextLine,
  deskewBoxes,
  median,
  toTextBoxes,
  verticalOverlap,
} from 'src/utils/collections/ocr.js';
import { Artwork, formatArtwork, isDate, isMedium } from 'src/utils/collections/packs/museum/artwork.js';
import { ParsedSource, SourceEntry, SourceParseOptions } from 'src/utils/collections/source.js';
import { editDistance } from 'src/utils/collections/text.js';

/*
 * Reading wall labels (cartels, placards, plaques): the artist (with life dates and qualifiers such as "attributed
 * to"), the title, the date, the medium and the inventory number of the artwork beside them, in any of the languages
 * of the label. A label printed in two languages (Portuguese and English in Évora, French and English side by side in
 * Agen) is one artwork: the English block gives the title, the date and the medium, the other one the original title.
 * An explanatory panel adds paragraphs of prose after the title lines, which are left out, and the label of a case
 * lists its objects, "A", "B", "C"..., each an artwork of its own.
 */

/** an artwork read on a label */
export type WallLabel = Artwork & {
  /** the title in the language of the museum, when the label gives it in English too */
  originalTitle?: string;
  inventory?: string;
  /** the heading of the label or the case, e.g. "Ceramics collection", "Les porcelaines tendres" */
  heading?: string;
  /** the letter of an object in a case, e.g. B */
  item?: string;
  /** where it is on the photo: [left, top, right, bottom], normalized 0..1 */
  box: [number, number, number, number];
};

export type LabelRole =
  'noise' | 'inventory' | 'lifeDates' | 'bio' | 'date' | 'medium' | 'credit' | 'prose' | 'item' | 'artist' | 'text';

export type LabelLine = {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  height: number;
  score: number;
};

/** Latin letters: the labels are read in the Latin script, and Bengali or Devanagari print reads as noise */
const LATIN = /[A-Za-z\u{C0}-\u{D6}\u{D8}-\u{F6}\u{F8}-\u{FF}\u{100}-\u{17F}]/u;
const NON_LATIN = /[\u{900}-\u{DFF}\u{3000}-\u{9FFF}\u{AC00}-\u{D7AF}\u{400}-\u{4FF}\u{600}-\u{6FF}\u{FF00}-\u{FFEF}]/u;

/** inventory numbers: "ME 1774", "ME1531", "MNR 223", "Me 1381/1", "3961/24126", "S.60/A24175", "039/A2 5294" */
const INVENTORY_LINE =
  /^(?:(?:inv(?:entaire|entory|\.)?|n[°º]|no\.)\s*(?:d['’]\s*inv\.?)?\s*:?\s*)?(?:[A-Z]{1,4}[.\s]?\s?)?\d[\d.]*(?:\s?[/-]\s?[A-Z]?\s?\d[\d.\s]*)*[A-Z]?$/i;
/** an inventory number in running text: "N° d'inv: 2017.2.1", "°d'inv:D.848.1.2", "Inv. 1234" */
const INVENTORY_IN_TEXT =
  /(?:n?[°º]\s*d['’]\s*inv\.?|\binv(?:entaire|entory)?\.?(?:\s*n[°º])?)\s*:?\s*([A-Z]{0,4}[.\s]?\d[\w./-]*\d)/i;
/** words before a year that make it a date, not a number of the museum */
const CIRCA = /^(?:c|ca|circa|cerca|vers|env|um|around|about)\b/i;

/** life dates of an artist at the end of the name: "(1797-1865)", "(act. 1511 circa 1551)", "(c. 1480-1541)" */
const LIFE_DATES = /\([^()]*\d{3,4}[^()]*\)\s*$/u;
/** birth and death places and years: "Engayrac 1860-Paris, 1944", "Dammartin 1598-Gaillon 1659" */
const BIRTH_AND_DEATH = /^\p{L}[\p{L}' .-]*,?\s*\d{4}\s*[-–]\s*\p{L}[\p{L}' .-]*,?\s*\d{4}\.?$/u;
/** one place and a range: "Paris, 1860-1942", "Paris, 1815- 1824" (the dates of an artist, or of a workshop's work) */
const PLACE_AND_RANGE = /^(?!(?:c|ca|circa|cerca|vers|env|um)\b)\p{L}[\p{L}' .-]*,?\s*\d{4}\s*[-–]\s*\d{2,4}\.?$/iu;
/** what an artist did and when: "Known activity 1511 circa 1551", "Pintor flamengo activo em Portugal entre 1506" */
const BIO =
  /\b(?:active|activo|activa|actif|active|activité|actividade|atividade|known activity|pintor|pintora|painter|peintre|sculpteur|sculptor|escultor|born|nascido|nascida|died)\b.*\d{4}/iu;

/** the qualifiers of an attribution: "(atribuído / assigned)", "attributed to", "attribué à" */
const ATTRIBUTED = /\b(?:atribu[ií]d[oa]|attribu(?:é|ée|ted)|attribuito|zugeschrieben|assigned)\b/iu;
/** words of an artist's line: workshops, schools, manufactures, "after", "called" */
const ARTIST_WORDS =
  /\b(?:attributed|atribu[ií]d[oa]|attribu[ée]e?|workshop|atelier|ateliers|oficina|bottega|werkstatt|circle of|entourage|c[ií]rculo|follower|seguidor|suiveur|d['’]après|a partir de|manner of|manufacture|manufactura|fábrica|unknown|anonymous|anonyme|anónimo|anonimo|autor desconhecido|maître|mestre|called|dit|dite|dita|dito|detto|genannt)\b/iu;

/** credit lines and provenance: how the artwork came to the museum and where it comes from */
const CREDIT =
  /^(?:\(?\s*(?:d[ée]p[ôo]t|dons?|l?egs|achat|acquis|acquisition|acquired|purchased|purchase|gift|given|bequest|bequeathed|on loan|loan|lent|pr[êe]t|fonds|with the support|avec l['’]aide|avec le soutien|sponsorship|mecenato|adquirid[oa]|oferta|doa[çc][ãa]o|legado|dep[óo]sito|colec?[çcg][ãa]o|cole[cç]{1,2}[ãa]o|colecgao|coleccao|collection|collezione|sammlung|from the|from a|originally|proveniente|proveni[êe]ncia|provenant|provenance|antiga|former|ancienne|excavated|found|trouvé|centre national|recovered|récupér|[œoe]?uvre récup|agen, mus[ée]e|pal[áa]cio|palace|convento|convent|herdade|estate)\b)/iu;

/** a word that ends a line in the middle of a title: "Retrato de Dona Catarina de Bragança, rainha de" */
const OPEN_END =
  /(?:[-,:]|\b(?:de|da|do|das|dos|du|des|la|le|les|of|the|and|or|with|in|on|at|to|for|e|et|y|con|com|em|en|sur|sous|sob|pour|par|entre|avec|à|au|aux|un|une|o|os|as|el|los|il|di|del|della|und|der|die|von|mit|zu))$/iu;

/** words of a date line besides the numbers: "Portuguese School, 1st quarter of 16th century", "Periodo Romano" */
const DATE_WORDS =
  /(?<![\p{L}\d])(?:c|ca|circa|cerca|vers|env|um|around|about|century|centuries|cent|siècle|siècles|séc|sec|s|século|secolo|jh|jahrhundert|quarter|quartel|half|metade|moitié|quart|first|second|third|late|early|mid|fin|début|milieu|finais|inícios|of|the|do|da|de|du|des|e|and|et|period|periodo|período|époque|epoca|época|dynasty|dinastia|dynastie|roman|romano|romana|romaine|romain|school|escola|école|scuola|b|c|e|a|d|bce|ce|bc|ad|[ivxlc]{1,5}(?:e|er|ème)?|\d+(?:st|nd|rd|th|h|na|e|er|ème|°|º|o|a)?)(?![\p{L}\d])\.?/giu;

const letterWords = (text: string) => text.split(/[\s,;:()]+/).filter((word) => /\p{L}{2}/u.test(word));

/** a line that is a date, and no more than a school: "circa 1760", "Portuguese School, 1544", "Ca. 10th century C.E." */
const isDateLine = (text: string) =>
  isDate(text) &&
  letterWords(text.replace(/^\p{L}+\s+school\b|^(?:escola|école|scuola)\s+\p{L}+/iu, ' ').replaceAll(DATE_WORDS, ' '))
    .length <= 1;

/** a heading in capitals: "COLECAO DE CERAMICA", "CERAMICS COLLECTION" */
const isCapitals = (text: string) => {
  const letters = text.replaceAll(/[^\p{L}]/gu, '');
  return letters.length >= 4 && letters === letters.toUpperCase();
};

const ordinal = (value: number) => {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) {
    return 'th';
  }
  return ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
};

/** OCR slips that labels invite: "Vers1840", "Ca.13th", "1Oth", "2na century", "14h century", "I'Etat", "atribuído I assigned" */
export const fixLabelText = (text: string) =>
  text
    .replaceAll(/[|¦]/g, ' / ')
    // a separator between two languages read as a capital I: "atribuído I assigned", "Surajkund, I Nalanda"
    .replaceAll(/(\p{Ll}|,)\s+I\s+(?=\p{L})/gu, '$1 / ')
    .replaceAll(/\b[Il]['’](?=[AEÉIOUaeéiou]\p{Ll})/gu, "l'")
    .replaceAll(
      /\b(Vers|vers|Ca|ca|Circa|circa|C|c)\.?(?=\d)/g,
      (_, word: string) => `${word}${word.length <= 2 ? '.' : ''} `,
    )
    .replaceAll(/\b(\d)O(th)\b/g, '$10$2')
    .replaceAll(
      /\b(\d{1,2})\s?(?:h|t|na|nd|th|st|rd)?\s+(centur(?:y|ies)|cent\b)/giu,
      (_, number: string, word: string) => `${number}${ordinal(Number(number))} ${word}`,
    )
    .replaceAll(/(\p{L})\s+'(\p{L})/gu, '$1$2')
    .replaceAll(/\s+/g, ' ')
    .trim();

/** "Antoine CALBET" → "Antoine Calbet", "Claude MoNET" → "Claude Monet", "JeanILEMAIRE" → "Jean Lemaire" */
const fixNameCase = (text: string) =>
  text
    .replaceAll(/\b(\p{Lu}\p{Ll}+)[Il](\p{Lu}{3,})/gu, '$1 $2')
    .split(/(\s+|-)/)
    .map((word) => {
      const letters = word.replaceAll(/[^\p{L}]/gu, '');
      const upper = letters.replaceAll(/[^\p{Lu}]/gu, '').length;
      return letters.length >= 3 && upper >= 0.6 * letters.length
        ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        : word;
    })
    .join('');

const toLabelLine = (line: TextLine): LabelLine => ({
  text: fixLabelText(line.text),
  left: line.left,
  top: line.top,
  right: line.right,
  bottom: line.bottom,
  height: line.height,
  score: Math.min(...line.boxes.map((box) => box.score)),
});

/**
 * The same text read twice where two OCR tiles meet, on one row: "Triptych with the Passion" and "ssion of Christ"
 * are "Triptych with the Passion of Christ"; "Ca. 9th cer C.E." and "century" (read inside it) are "Ca. 9th century
 * C.E.".
 */
export const mergeFragments = (a: string, b: string) => {
  for (let k = Math.min(a.length, b.length) - 1; k >= 1; k--) {
    if (a.slice(-k).toLowerCase() !== b.slice(0, k).toLowerCase()) {
      continue;
    }
    // a long overlap is the same letters read twice; a letter or two is more likely a letter read on both sides
    return k >= 3 ? a + b.slice(k) : `${a.slice(0, -k).trimEnd()} ${b}`;
  }
  // a word read better inside the other text replaces its broken reading
  const tokens = a.split(' ');
  const lower = b.toLowerCase();
  const index = tokens.findIndex(
    (token) =>
      token.length < b.length &&
      /\p{L}/u.test(token) &&
      (lower.startsWith(token.toLowerCase()) ||
        lower.endsWith(token.toLowerCase()) ||
        (token.length >= 3 && editDistance(token.toLowerCase(), lower.slice(0, token.length)) <= 1)),
  );
  if (index !== -1) {
    tokens[index] = b;
    return tokens.join(' ');
  }
  return `${a} ${b}`;
};

const overlapX = (a: LabelLine, b: LabelLine) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
const width = (line: LabelLine) => line.right - line.left;

/** lines of one row that overlap are one line that two tiles read */
export const mergeRows = (lines: LabelLine[]): LabelLine[] => {
  const result: LabelLine[] = [];
  for (const line of lines.toSorted((a, b) => a.left - b.left || a.top - b.top)) {
    const other = result.find(
      (item) =>
        verticalOverlap(item, line) >= 0.6 &&
        Math.max(item.height, line.height) <= 1.5 * Math.min(item.height, line.height) &&
        overlapX(item, line) > 0.05 * Math.min(width(item), width(line)),
    );
    if (!other) {
      result.push({ ...line });
      continue;
    }
    other.text = mergeFragments(other.text, line.text);
    other.right = Math.max(other.right, line.right);
    other.top = Math.min(other.top, line.top);
    other.bottom = Math.max(other.bottom, line.bottom);
    other.score = Math.min(other.score, line.score);
  }
  return result.toSorted((a, b) => a.top - b.top || a.left - b.left);
};

/** the date at the end of a title line: "Léda et le cygne, 1901" → ["Léda et le cygne", "1901"] */
export const splitTrailingDate = (text: string): [string, string?] => {
  const match = /^(.*?\p{L}.*?)[,.]?\s+((?:(?:vers|c\.|ca\.|circa)\s*)?\d{4}(?:\s*[-–]\s*\d{2,4})?)\.?$/iu.exec(text);
  return match ? [match[1].trim(), match[2]] : [text];
};

/** the inventory number of a line, alone or in a credit line */
const readInventory = (text: string) => {
  const inline = INVENTORY_IN_TEXT.exec(text);
  if (inline) {
    return inline[1].trim();
  }
  const compact = text.trim();
  if (
    INVENTORY_LINE.test(compact) &&
    compact.replaceAll(/\D/g, '').length >= 3 &&
    // a number alone is an audio guide or a room, unless it is long
    (/[A-Za-z/.-]/.test(compact) || compact.replaceAll(/\D/g, '').length >= 5) &&
    !CIRCA.test(compact) &&
    // a year or a range of years is a date, unless the museum prints its numbers that way (see `readLines`)
    !/^\d{4}(?:\s*-\s*\d{2,4})?$/.test(compact)
  ) {
    return compact.replaceAll(/\s*\/\s*/g, '/').replaceAll(/(?<=\d)\s+(?=\d)/g, '');
  }
};

const isYearRange = (text: string) => /^\d{4}\s*-\s*\d{4}$/.test(text.trim());

/** a name with its life dates, "Joseph-Désiré Court (1797-1865)", but not "(1630-1684)" alone */
const hasNameWithLifeDates = (text: string) =>
  LIFE_DATES.test(text) && letterWords(text.replace(LIFE_DATES, '')).length > 0;

/** the role of a line on a label, from its text alone */
export const classifyLabelLine = (line: LabelLine, medianHeight: number): LabelRole => {
  const { text } = line;
  const letters = text.replaceAll(/[^\p{L}]/gu, '').length;
  const inventory = readInventory(text);
  if (NON_LATIN.test(text) || (letters > 0 && !LATIN.test(text))) {
    return 'noise';
  }
  // the tiny print of a sign on the wall, letters OCR made up of foreign print, a letter or two of noise
  if (line.height < 0.45 * medianHeight) {
    return 'noise';
  }
  if (line.score < 0.72 && !isMedium(text) && !isDate(text) && !inventory) {
    return 'noise';
  }
  if (inventory && !INVENTORY_IN_TEXT.test(text)) {
    return 'inventory';
  }
  if (/^\([^()]*\d{4}[^()]*\)$/.test(text.trim()) || BIRTH_AND_DEATH.test(text) || PLACE_AND_RANGE.test(text)) {
    return 'lifeDates';
  }
  if (letters < 3 && !/^[A-H]$/.test(text.trim())) {
    return isYearRange(text) || isDateLine(text) ? 'date' : 'noise';
  }
  if (hasNameWithLifeDates(text) && !isDateLine(text.replace(LIFE_DATES, ''))) {
    return 'artist';
  }
  if (BIO.test(text)) {
    return 'bio';
  }
  if (CREDIT.test(text) || INVENTORY_IN_TEXT.test(text)) {
    return 'credit';
  }
  if (isMedium(text)) {
    return 'medium';
  }
  if (isDateLine(text)) {
    return 'date';
  }
  if (letterWords(text).length >= 9) {
    return 'prose';
  }
  return 'text';
};

/** "Portuguese School, circa 1760" → c. 1760; "Escola portuguesa 1° quartel do séc. XVI" → 1° quartel do séc. XVI */
export const cleanDate = (text: string) =>
  text
    .replace(/^\p{L}+\s+school(?:\s*\([^)]*\))?[,\s]*/iu, '')
    .replace(/^(?:escola|école|scuola)\s+\p{L}+(?:\s*\([^)]*\))?[,\s]*/iu, '')
    .replace(/^(?:c|ca|circa|cerca|vers|env)\.?\s*(?=\d)/i, 'c. ')
    .replaceAll(/\s*-\s*/g, '-')
    .replace(/[,;]$/, '')
    .trim();

/** the school of a date line, e.g. "Portuguese School" */
const getSchool = (text: string) => /^(\p{L}+\s+school|escola\s+\p{L}+|école\s+\p{L}+)/iu.exec(text)?.[1];

/** the medium without the dimensions: "Huile sur toile, 271 X 306 cm" → "Huile sur toile" */
export const cleanMedium = (text: string) =>
  text
    .replaceAll(/,?\s*\d+(?:[.,]\d+)?\s*[x×X]\s*\d+(?:[.,]\d+)?(?:\s*[x×X]\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm|m)?\.?/g, '')
    .replaceAll(/\s+\d{2,}$/g, '')
    .replace(/\bstr\b/, 'sur')
    .replace(/[,;.\s]+$/, '')
    .replaceAll(/\s+/g, ' ')
    .trim();

/**
 * "5.Joseph-Désiré Court (1797-1865)" → "Joseph-Désiré Court"; "Francisco Niculoso (atribuído / assigned)" →
 * "Attributed to Francisco Niculoso"; "Antoine CALBET -" → "Antoine Calbet"
 */
export const cleanArtist = (text: string) => {
  const attributed = ATTRIBUTED.test(text);
  const name = fixNameCase(
    text
      .split('(', 1)[0]
      .replace(/^\d{1,3}\s?[.)]\s*/, '')
      .replace(/[\s,;:–—-]+$/, '')
      .replaceAll(/\s+/g, ' ')
      .trim(),
  );
  return attributed && name && !/^attributed/i.test(name) ? `Attributed to ${name}` : name;
};

/** how English a text reads, to prefer the English block of a bilingual label */
const ENGLISH =
  /\b(?:the|of|and|with|on|oil|canvas|panel|marble|portrait|virgin|child|saint|saints|school|collection|from|called|after|unknown|master|attributed|century|circa|period|roman|gold|still|life|mice|flowers)\b/giu;
const OTHER =
  /\b(?:de|da|do|dos|das|com|e|o|a|sobre|óleo|tela|madeira|retrato|virgem|menino|escola|colecção|dita|um|modelo|le|la|les|et|du|des|aux|au|sur|huile|toile|dit|vers|siècle|il|di|del|della|olio|tavola|morte)\b/giu;
const englishScore = (text: string) => (text.match(ENGLISH) ?? []).length - (text.match(OTHER) ?? []).length;

type Block = {
  title: string[];
  date?: string;
  medium?: string;
  inventory?: string;
  school?: string;
  lines: LabelLine[];
};

type Reading = {
  artists: string[];
  lifeRange?: string;
  blocks: Block[];
  heading?: string;
  item?: string;
  inventory?: string;
  lines: LabelLine[];
};

const nameWords = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[\s,()]+/)
      .filter((word) => word.length >= 4 && /^\p{L}/u.test(word)),
  );

/** whether a line names the same artist in another language: "…, dita Josefa de Óbidos" and "…, called Josefa de" */
const isSameArtist = (a: string, b: string) => {
  const words = nameWords(b);
  return [...nameWords(a)].filter((word) => words.has(word)).length >= 2;
};

/** a line that names an artist: a qualifier, a workshop, or a surname in capitals ("Paul LEROY") */
const looksLikeArtist = (text: string) =>
  ARTIST_WORDS.test(text) ||
  hasNameWithLifeDates(text) ||
  (/\b\p{Lu}[\p{Ll}-]+\s+\p{Lu}{3,}/u.test(text) && letterWords(text).length <= 5) ||
  (/^\p{Lu}{3,}(?:\s+\p{Lu}{3,}){0,3}$/u.test(text.trim()) && text.trim().length <= 30 && false);

/** reads the lines of one label (or of one object of a case), top to bottom */
const readLines = (lines: LabelLine[], roles: LabelRole[]): Reading => {
  const reading: Reading = { artists: [], blocks: [], lines: [] };
  let block: Block | undefined;
  let lastRole: LabelRole | undefined;
  let pendingArtist = false;
  let proseStarted = false;

  const isOpen = (current: Block) => !current.date && !current.medium && !current.inventory;
  const startBlock = (line: LabelLine, text: string) => {
    const [title, date] = splitTrailingDate(text);
    block = { title: [date ? title : text], lines: [line], ...(date && { date: cleanDate(date) }) };
    reading.blocks.push(block);
  };

  for (const [index, line] of lines.entries()) {
    let role = roles[index];
    const next = lines[index + 1];
    const nextRole = roles[index + 1];
    const previous = lines[index - 1];
    if (proseStarted || role === 'noise') {
      continue;
    }
    // a credit or provenance runs on over the next lines: "Dépot de l'Etat au Musée" "d'Agen en 1903, puis"
    if (
      lastRole === 'credit' &&
      ['text', 'date', 'prose', 'lifeDates'].includes(role) &&
      (/^\p{Ll}/u.test(line.text) || /[,-]$|\b(?:de|du|des|of|the|and|e|et)$/iu.test(previous?.text ?? ''))
    ) {
      role = 'credit';
    }
    // a long line before any title is a long title, e.g. "S.A.R. Mgr le duc d'Orléans posant la première pierre du pont-"
    if (role === 'prose' && (!block || (isOpen(block) && lastRole === 'text'))) {
      role = 'text';
    }
    reading.lines.push(line);

    switch (role) {
      case 'prose': {
        // an explanatory panel: its paragraphs follow the title lines
        proseStarted = true;
        break;
      }
      case 'inventory':
      case 'credit': {
        const value = readInventory(line.text);
        if (value && block && !block.inventory) {
          block.inventory = value;
        } else if (value && !block) {
          reading.inventory ??= value;
        }
        break;
      }
      case 'bio': {
        break;
      }
      case 'lifeDates': {
        const range = /\d{4}\s*[-–]\s*\d{2,4}/.exec(line.text)?.[0];
        if (PLACE_AND_RANGE.test(line.text) && range) {
          reading.lifeRange = range.replaceAll(/\s+/g, '');
        }
        if (/^\(/.test(line.text.trim())) {
          pendingArtist = false;
        }
        break;
      }
      case 'date': {
        if (block && !block.date) {
          block.date = cleanDate(line.text);
          block.school = getSchool(line.text);
        } else if (!block && reading.artists.length === 0 && isYearRange(line.text) && next) {
          // a number of the museum above the title: Kolkata prints "1796-1797" above "Yakshi"
          reading.inventory ??= line.text.replaceAll(/\s+/g, '');
        }
        break;
      }
      case 'medium': {
        if (!block) {
          break;
        }
        if (block.medium && lastRole === 'medium' && /,\s*$/.test(block.medium)) {
          // "Palissandre plaqué, peuplier teinté, marbre," "bronze doré"
          block.medium = `${block.medium} ${line.text}`;
        } else {
          block.medium ??= line.text;
        }
        break;
      }
      case 'item': {
        const [, letter, rest] = /^([A-H])\s*(.*)$/u.exec(line.text.trim()) ?? [];
        reading.item = letter;
        if (rest) {
          startBlock(line, rest);
        }
        break;
      }
      case 'artist':
      case 'text': {
        const text = line.text;
        if (!block) {
          // the name runs on: "Autor desconhecido, a partir de um modelo de Peter" "Lely (1618-1680)"
          if (pendingArtist && (hasNameWithLifeDates(text) || /^\p{Ll}/u.test(text))) {
            reading.artists[reading.artists.length - 1] += ` ${text}`;
            pendingArtist = !hasNameWithLifeDates(text);
            break;
          }
          const artist =
            role === 'artist' ||
            looksLikeArtist(text) ||
            nextRole === 'lifeDates' ||
            nextRole === 'bio' ||
            (reading.artists.length > 0 && isSameArtist(reading.artists.at(-1)!, text));
          if (artist) {
            reading.artists.push(text);
            pendingArtist = !hasNameWithLifeDates(text) && nextRole !== 'lifeDates';
            break;
          }
          // the heading of a label or a case, above its artist: "COLECAO DE CERAMICA", "Les porcelaines tendres"
          if (
            reading.artists.length === 0 &&
            next &&
            (isCapitals(text) || (nextRole !== 'item' && looksLikeArtist(next.text))) &&
            !/\d/.test(text)
          ) {
            reading.heading ??= text;
            break;
          }
        }
        pendingArtist = false;
        const continues =
          block &&
          ['text', 'item', 'artist'].includes(lastRole!) &&
          isOpen(block) &&
          previous &&
          line.top - previous.bottom < 1.2 * Math.max(line.height, previous.height) &&
          (/^[\p{Ll}(]/u.test(text) || OPEN_END.test(block.title.at(-1)!));
        if (continues) {
          const [title, date] = splitTrailingDate(text);
          block!.title.push(date ? title : text);
          block!.lines.push(line);
          if (date) {
            block!.date = cleanDate(date);
          }
        } else if (!block || !isOpen(block) || (lastRole !== 'text' && lastRole !== 'item')) {
          startBlock(line, text);
        }
        break;
      }
    }
    lastRole = role;
  }
  return reading;
};

/** the lines of a title, joined; a word hyphenated at the end of a line is joined without a space ("pont-canal") */
const joinTitle = (parts: string[]) => {
  let title = '';
  for (const part of parts) {
    title = /\p{L}-$/u.test(title) ? `${title}${part}` : `${title} ${part}`;
  }
  return title
    .replaceAll(/\s+/g, ' ')
    .replace(/[,;:]+$/, '')
    .trim();
};

/** how much of a language block a block is: a date and a medium */
const getFields = (block: Block) => (block.date ? 1 : 0) + (block.medium ? 1 : 0);

const isTextLine = (line: TextLine) => /\p{L}{3}/u.test(line.text);

const unionBox = (lines: LabelLine[]): WallLabel['box'] => {
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
  return [
    clamp(Math.min(...lines.map((line) => line.left))),
    clamp(Math.min(...lines.map((line) => line.top))),
    clamp(Math.max(...lines.map((line) => line.right))),
    clamp(Math.max(...lines.map((line) => line.bottom))),
  ];
};

/** a label names more than a title: an artist, a date, a medium or a number of the museum */
const hasEvidence = (reading: Reading) =>
  reading.artists.length > 0 ||
  !!reading.inventory ||
  !!reading.lifeRange ||
  reading.blocks.some((block) => block.date || block.medium || block.inventory);

/** the artwork of the readings of a label: the English block, with the title of the other as the original title */
const toLabel = (readings: Reading[]): WallLabel | undefined => {
  const blocks = readings
    .flatMap((reading) => reading.blocks)
    .filter((block) => /\p{L}{2}/u.test(block.title.join(' ')));
  if (blocks.length === 0 || readings.every((reading) => !hasEvidence(reading))) {
    return;
  }
  // the blocks of a language have the most of a date and a medium; the others are where the artwork was found, or
  // credit lines
  const most = Math.max(...blocks.map((block) => getFields(block)));
  const candidates = most > 0 ? blocks.filter((block) => getFields(block) === most) : [blocks[0]];
  // English first, else the last language (the translation comes after the original)
  const scores = candidates.map((block) =>
    englishScore(`${joinTitle(block.title)} ${block.medium ?? ''} ${block.date ?? ''}`),
  );
  const chosen = candidates[scores.lastIndexOf(Math.max(...scores))];
  const other = candidates.find((block) => block !== chosen);

  const title = joinTitle(chosen.title);
  const artists = readings
    .flatMap((reading) => reading.artists)
    .map((artist) => cleanArtist(artist))
    .filter(Boolean);
  const artistScores = artists.map((artist) => englishScore(artist));
  const artist = artists.length > 0 ? artists[artistScores.indexOf(Math.max(...artistScores))] : undefined;
  const date =
    chosen.date ??
    candidates.find((block) => block.date)?.date ??
    readings.find((reading) => reading.lifeRange)?.lifeRange;
  const medium = chosen.medium ?? candidates.find((block) => block.medium)?.medium;
  const original = other ? joinTitle(other.title) : undefined;
  const inventory =
    chosen.inventory ??
    blocks.find((block) => block.inventory)?.inventory ??
    readings.find((reading) => reading.inventory)?.inventory;
  const school = chosen.school ?? candidates.find((block) => block.school)?.school;
  const lines = readings.flatMap((reading) => reading.lines);

  return {
    title,
    ...((artist || school) && { artist: artist || school }),
    ...(date && { date: cleanDate(date) }),
    ...(medium && { medium: cleanMedium(medium) }),
    ...(original && original.toLowerCase() !== title.toLowerCase() && { originalTitle: original }),
    ...(inventory && { inventory }),
    ...(readings[0].heading && { heading: readings[0].heading }),
    ...(readings[0].item && { item: readings[0].item }),
    box: unionBox(lines.length > 0 ? lines : chosen.lines),
  };
};

/** the lines of a label in reading order, one list per column when two columns are printed side by side */
const getLines = (boxes: TextBox[], aspectRatio: number): LabelLine[][] => {
  const layout = findColumns(boxes, aspectRatio);
  const columns = layout.columns.filter((column) => column.lines.filter((line) => isTextLine(line)).length >= 3);
  const [a, b] = columns;
  const extent = (column: typeof a) => ({ top: column.lines[0].top, bottom: column.lines.at(-1)!.bottom });
  // two columns of text beside each other: a label in two languages, read one after the other
  if (columns.length === 2 && a.right <= b.left + 0.02 && verticalOverlap(extent(a), extent(b)) > 0.5) {
    const rest = [
      ...layout.spanning,
      ...layout.columns.filter((column) => !columns.includes(column)).flatMap((column) => column.lines),
    ];
    return [
      mergeRows([...a.lines, ...rest].map((line) => toLabelLine(line))),
      mergeRows(b.lines.map((line) => toLabelLine(line))),
    ];
  }
  const all = [...layout.spanning, ...layout.columns.flatMap((column) => column.lines)];
  return [mergeRows(all.map((line) => toLabelLine(line)))];
};

/** the roles of the lines; letters "A", "B"... are the objects of a case only when there are several */
const getRoles = (lines: LabelLine[], medianHeight: number): LabelRole[] => {
  const roles = lines.map((line) => classifyLabelLine(line, medianHeight));
  const items = lines.flatMap((line, index) => {
    const match = /^([A-H])(?:\s+\p{Lu}|$)/u.exec(line.text.trim());
    return match && roles[index] !== 'noise' ? [{ index, letter: match[1] }] : [];
  });
  const letters = items.map(({ letter }) => letter);
  const isSequence = letters.length >= 2 && letters.every((letter, i) => i === 0 || letter > letters[i - 1]);
  for (const { index } of items) {
    if (isSequence) {
      roles[index] = 'item';
    } else if (/^[A-H]$/.test(lines[index].text.trim())) {
      roles[index] = 'noise';
    }
  }
  return roles;
};

/** the objects of a case, each from the maker above its letter: [heading, maker, A…], [maker, B…], … */
const splitItems = (lines: LabelLine[], roles: LabelRole[]): Array<{ lines: LabelLine[]; roles: LabelRole[] }> => {
  const starts = roles.flatMap((role, index) => (role === 'item' ? [index] : []));
  if (starts.length < 2) {
    return [{ lines, roles }];
  }
  const cuts = starts.map((start, index) => {
    if (index === 0) {
      return 0;
    }
    // the maker of the object is the line above its letter
    const above = start - 1;
    return above > starts[index - 1] && ['text', 'artist'].includes(roles[above]) ? above : start;
  });
  return cuts.map((cut, index) => {
    const end = cuts[index + 1] ?? lines.length;
    return { lines: lines.slice(cut, end), roles: roles.slice(cut, end) };
  });
};

/** the lines of a label and their roles, for tests and for tuning the reader */
export const getLabelLines = (ocr: OcrBoxInput[], options: SourceParseOptions = {}) => {
  const aspectRatio = options.aspectRatio ?? 1;
  const boxes = toTextBoxes(deskewBoxes(ocr, aspectRatio), options.minScore).filter(
    (box) => !NON_LATIN.test(box.text) && /[\p{L}\d]/u.test(box.text),
  );
  if (boxes.length === 0) {
    return { groups: [], medianHeight: 0 };
  }
  const groups = getLines(boxes, aspectRatio);
  const medianHeight = median(groups.flat().map((line) => line.height));
  return { groups: groups.map((lines) => ({ lines, roles: getRoles(lines, medianHeight) })), medianHeight };
};

/** Reads the artworks of a wall label from its OCR: one, or one per object of a case */
export const readWallLabels = (ocr: OcrBoxInput[], options: SourceParseOptions = {}): WallLabel[] => {
  const { groups } = getLabelLines(ocr, options);
  if (groups.length === 0) {
    return [];
  }
  if (groups.length > 1) {
    const label = toLabel(groups.map(({ lines, roles }) => readLines(lines, roles)));
    return label ? [label] : [];
  }

  const labels: WallLabel[] = [];
  const parts = splitItems(groups[0].lines, groups[0].roles);
  let heading: string | undefined;
  for (const [index, part] of parts.entries()) {
    const reading = readLines(part.lines, part.roles);
    heading ??= reading.heading;
    // the heading of a case is above its first object; the others share it
    reading.heading ??= index > 0 ? heading : undefined;
    const label = toLabel([reading]);
    if (label) {
      labels.push(label);
    }
  }
  return labels;
};

/** the description of an entry: the original title and the inventory number */
export const getLabelDescription = (label: WallLabel) =>
  [label.originalTitle, label.inventory && `Inv. ${label.inventory}`].filter(Boolean).join(' · ') || undefined;

/**
 * The entries of a wall label for the collections engine: each artwork named "Title — Artist, Date, Medium" (see
 * `formatArtwork`), described by its original title and inventory number, under the heading of the label.
 */
export const parseWallLabel = (ocr: OcrBoxInput[], options: SourceParseOptions = {}): ParsedSource => {
  const labels = readWallLabels(ocr, options);
  const items: SourceEntry[] = labels.map((label) => {
    const description = getLabelDescription(label);
    return {
      name: formatArtwork(label),
      ...(description && { description }),
      ...(label.heading && { section: label.heading }),
      column: 0,
      box: label.box,
    };
  });
  return {
    items,
    sections: [...new Set(labels.flatMap((label) => (label.heading ? [label.heading] : [])))],
    columns: items.length > 0 ? 1 : 0,
    lines: toTextBoxes(ocr).length,
  };
};
