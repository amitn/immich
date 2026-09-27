import { OcrBoxInput, TextLine, groupLines, toTextBoxes, verticalOverlap } from 'src/utils/collections/ocr.js';
import { isGarbled, toTitleCase } from 'src/utils/collections/place.js';
import { ParsedSource, SourceEntry } from 'src/utils/collections/source.js';
import { editDistance, stripAccents } from 'src/utils/collections/text.js';

/*
 * Reading the cover, spine or title page of a book. The title is the largest type near the top, with the lines set
 * close to it or nearly as large ("Wanderungen / in den / Dolomiten"); the author follows a line "von" or "by" (or
 * one that ends with it, "Roman von"), a genre line ("Roman"), or is a line of name-like words ("ZANE GREY", "PAUL · L
 * · FORD"), and a title set as "Dante Alighieri's …" names its author first. The year, the publisher (a line with
 * "Verlag", "Buchhandlung", "& Co", "Press"…) and the place (a city) come from the foot of the page. Library stamps,
 * shelf marks and the running text of an open page are left out.
 *
 * Fraktur is read as Latin lookalikes ("Rumft mmd Proletariat", "Bon Rlara Setin", "Stanislam pvanbyssemsti"): the
 * reader keeps what it can, and a reading with the signs of Fraktur, garbled words or unsure letters is never sure,
 * for the assistant to read the page on its crop. A page of running text (a songbook open at page 86) has no title to
 * read, and gets no name.
 */

export type BookReading = {
  title?: string;
  /** the smaller lines under the title, e.g. "Grundzüge einer Ästhetik", or the genre ("Roman") */
  subtitle?: string;
  author?: string;
  year?: string;
  publisher?: string;
  /** the place of publication, e.g. Stuttgart */
  place?: string;
  /** 0..1: how much of the page was read, and how clearly */
  confidence: number;
  /** the title and the author were read clearly, in roman type: no need to look */
  sure: boolean;
  /** the page reads like Fraktur (or another blackletter) read as Latin lookalikes */
  fraktur: boolean;
  /** a page of running text, e.g. a book open at a page: no title to read */
  openPage: boolean;
  /** the words of the title that tell it from other books, normalized, e.g. for a cover and a title page of one book */
  words: string[];
  /** where the title and the author are on the photo: [left, top, right, bottom], normalized 0..1 */
  box?: [number, number, number, number];
};

const fold = (text: string) =>
  stripAccents(text).toLowerCase().replaceAll('ß', 'ss').replaceAll('æ', 'ae').replaceAll('œ', 'oe');

/** the letters and digits of a text, lowercase, without accents */
const plain = (text: string) => fold(text).replaceAll(/[^\p{L}\d]+/gu, '');

const letters = (text: string) => text.replaceAll(/[^\p{L}]/gu, '').length;

/** "von", "by", and their Fraktur and OCR misreadings ("bon", "pon", "por", "Br") */
const AUTHOR_MARKERS = new Set([
  'von',
  'vom',
  'bon',
  'pon',
  'por',
  'pou',
  'bou',
  'uon',
  'by',
  'br',
  'bv',
  'di',
  'de',
  'da',
  'par',
  'door',
  'av',
  'af',
  'от',
]);

/** a marker that ends a line: "Roman von", "geschildert von", "IHM NACHERZÄHLT VON" */
const MARKER_AT_END = /(?:^|\s|[a-z]{3,})(?:von|bon|pon|por|by)\.?$/iu;
const MARKER_AT_START = /^(?:von|vom|bon|pon|por|by|di|par)\s+(.+)$/iu;

/** words of genres and editions, which never belong to a title or an author */
const GENRE =
  /(?:roman|novel|novelle|erz[aä]hlung|gedichte|poems|stories|trauer[sf]piel|lu[sf]t[sf]piel|[sf]chau[sf]piel|drama|rauer[sf]piel|u[sf]t[sf]piel|chau[sf]piel|trag[oö]die|kom[oö]die|comedy|tragedy|essays?|vortrag|bortrag|auflage|edition|ausgabe|band\b|theil|teil\b|volume|vol\.|tausend|abbildungen|holz[sf]chnitt|illustrat|author of|verfasser|herausgegeben|übersetzt|translated|edited)/iu;

/** library stamps, shelf marks and ownership notes */
const STAMP =
  /(?:bibliothe|biblioteca|library|librar|seminar|universit|neuphilolog|institut|property of|eigentum|b[uü]cherei|stadtarchiv|\bfb\b|ex libris)/iu;

/** a publisher: Verlag (and its Fraktur misreadings Berlag, Derlag, Nerlag), Buchhandlung, & Co, Press… */
const PUBLISHER =
  /(?:verlag|berlag|derlag|nerlag|terlag|erlag\b|buchhandlung|budhandlung|budbandlung|verlagshandlung|verlagsanstalt|anstalt|publisher|publishing|\bpress\b|& ?co\b|company|\bsons?\b|brothers|libreria|librairie|editore|[ée]ditions|editorial|\bsohn\b|druckerei|imprimerie)/iu;

/** the cities of publishers, as printed in the languages of title pages */
const CITIES = [
  'Berlin',
  'München',
  'Leipzig',
  'Stuttgart',
  'Tübingen',
  'Wien',
  'Dresden',
  'Frankfurt am Main',
  'Frankfurt',
  'Hamburg',
  'Köln',
  'Weimar',
  'Jena',
  'Göttingen',
  'Heidelberg',
  'Breslau',
  'Königsberg',
  'Hannover',
  'Bremen',
  'Mainz',
  'Düsseldorf',
  'Nürnberg',
  'Augsburg',
  'Freiburg',
  'Basel',
  'Bern',
  'Zürich',
  'Graz',
  'Innsbruck',
  'Salzburg',
  'Prag',
  'Budapest',
  'Paris',
  'London',
  'Oxford',
  'Cambridge',
  'Edinburgh',
  'New York',
  'Boston',
  'Chicago',
  'Philadelphia',
  'Milano',
  'Roma',
  'Firenze',
  'Torino',
  'Venezia',
  'Napoli',
  'Madrid',
  'Barcelona',
  'Lisboa',
  'Amsterdam',
  'Leiden',
  'Bruxelles',
  'Kopenhagen',
  'Stockholm',
  'Warschau',
  'Mailand',
  'Venedig',
  'Florenz',
  'Neapel',
  'Rom',
  'Krakau',
  'Moskau',
];

const CONNECTORS = new Set([
  'in',
  'im',
  'den',
  'der',
  'die',
  'das',
  'des',
  'dem',
  'und',
  'zu',
  'zum',
  'zur',
  'am',
  'an',
  'auf',
  'aus',
  'mit',
  'of',
  'the',
  'and',
  'a',
  'on',
  'at',
  'to',
  'la',
  'le',
  'les',
  'de',
  'du',
  'di',
  'del',
  'della',
  'et',
  'e',
  'el',
  'y',
]);

/** Fraktur read as Latin lookalikes: "bon" for von, "Berlag" for Verlag, "Gtuttgart", "Zrauerfpiel", "Deutfden" */
const FRAKTUR = [
  /^(?:bon|pon|por|bou|pou|ber|bes|umd|mmd|uno|unb|Gin|Sm|Jm|Bon|Bortrag)$/u,
  /^(?:[BDNT]erlag|Rommi)/u,
  /^(?:Gt|Et|Zr|Zb|Zh)[a-zäöü]/u,
  /[a-zäöü]f(?:d|ch|p|t(?:e|en|er)\b)/u,
  /[a-zäöü][A-Z][a-zäöü]/u,
  /ſ/u,
];

const isFrakturWord = (word: string) => FRAKTUR.some((pattern) => pattern.test(word));

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** a shelf mark, an inventory number or a stray mark: mostly digits and symbols */
const isNoise = (text: string) => {
  const count = letters(text);
  const digits = text.replaceAll(/\D/g, '').length;
  if (findYear(text) !== undefined && count <= 2) {
    // "1882.", but not an inventory number ("F0.8=1680")
    return digits > 5;
  }
  if (count < 2) {
    return !CONNECTORS.has(fold(text).trim());
  }
  if (
    count === 2 &&
    !text.includes('&') &&
    !CONNECTORS.has(fold(text).replaceAll(/[^\p{L}]/gu, '')) &&
    !AUTHOR_MARKERS.has(plain(text))
  ) {
    return true;
  }
  return digits > count && findYear(text) === undefined;
};

const MIN_YEAR = 1450;
const MAX_YEAR = 2049;

/** the year printed on a line: "1882.", "1S39." (1839), "182 9." (1829); undefined when there is none */
export const findYear = (text: string): string | undefined => {
  const joined = text
    // a year set with spaces between its digits
    .replaceAll(/(?<!\d)(\d)\s?(\d)\s?(\d)\s?(\d)(?!\d)/g, '$1$2$3$4')
    // an 8 read as S
    .replaceAll(/(?<![\p{L}\d])1[Ss](\d\d)(?!\d)/gu, '18$1');
  const years = joined
    .matchAll(/(?<![\d])(1[4-9]\d\d|20[0-4]\d)(?![\d])/g)
    .map((match) => match[1])
    .filter((year) => Number(year) >= MIN_YEAR && Number(year) <= MAX_YEAR)
    .toArray();
  return years.at(-1);
};

/** the city of a line, as the reader knows it ("Etuttgart" is Stuttgart), with its place on the line */
export const findCity = (text: string): string | undefined => {
  for (const token of text.split(/[\s,./;:()-]+/)) {
    if (letters(token) < 4) {
      continue;
    }
    const key = plain(token);
    for (const city of CITIES) {
      const target = plain(city);
      const distance = editDistance(key, target);
      if (key === target || (target.length >= 6 && key.length >= 5 && distance <= 1)) {
        return city;
      }
    }
  }
  for (const city of CITIES) {
    if (city.includes(' ') && plain(text).includes(plain(city))) {
      return city;
    }
  }
};

/** "Die Kunstschätze Italiens" from "DIE KUNSTSCHATZE ITALIENS.": capitals to title case, with the small words low */
const toTitle = (text: string) => {
  const cleaned = text
    // "IN-DEN": a line of small words joined at a line break
    .replaceAll(/(?<=^|\s)(\p{L}{1,4})-(\p{L}{1,4})(?=\s|$)/gu, (match, a: string, b: string) =>
      CONNECTORS.has(a.toLowerCase()) && CONNECTORS.has(b.toLowerCase()) ? `${a} ${b}` : match,
    )
    .replaceAll(/[·•]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/^[\s,.;:-]+|[\s,.;:]+$/g, '')
    .trim();
  const cased = toTitleCase(cleaned);
  return cased === cleaned
    ? cleaned
    : cased
        .split(' ')
        .map((word, index) =>
          index > 0 && CONNECTORS.has(word.toLowerCase())
            ? word.toLowerCase()
            : word.includes('&')
              ? word.toUpperCase()
              : word,
        )
        .join(' ');
};

/** the particles of names, lowercase inside a name: "Carl von Lützow" */
const PARTICLES = new Set(['von', 'van', 'de', 'der', 'di', 'du', 'da', 'la', 'le', 'del', 'della']);

/** "WILLA S. CATHER", "PAUL·L·FORD", "iæiBaum" as names: title case, initials with a dot, glued names apart */
const toName = (text: string) => {
  const cleaned = text
    .replaceAll(/[·•]/g, ' ')
    .replaceAll(/[^\p{L}\s.'’-]/gu, '')
    .replaceAll(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/[\s,.;:-]+$/g, '')
    .trim();
  return toTitle(cleaned)
    .replaceAll(/(?<=^|\s)(\p{L})(?=\.?(?:\s|$))/gu, (letter: string) => letter.toUpperCase())
    .split(' ')
    .filter((word) => letters(word) >= 2 || /^\p{Lu}\.?$/u.test(word))
    .map((word) => (/^\p{Lu}$/u.test(word) ? `${word}.` : word))
    .map((word, index) => (index > 0 && PARTICLES.has(word.toLowerCase()) ? word.toLowerCase() : word))
    .join(' ');
};

/** a line of a name: two to four words, capitalized, with initials and particles ("CARL VON LUTZOW", "ZANE GREY") */
const isNameLine = (text: string) => {
  const parts = words(text.replaceAll(/[·•]/g, ' ').replace(/[.,]+$/, ''));
  if (parts.length < 2 || parts.length > 4 || GENRE.test(text) || PUBLISHER.test(text) || findYear(text)) {
    return false;
  }
  // "METRISCH UBERTRAGEN UND": words of a sentence, not a name
  if (
    parts.some((part) => CONNECTORS.has(plain(part)) && !['de', 'di', 'la', 'le', 'du', 'da'].includes(plain(part)))
  ) {
    return false;
  }
  // "MAILAND. FLORENZ. FALERMO.": a list of places
  if (parts.filter((part) => /\p{L}{2,}\.$/u.test(part)).length > 1 || findCity(text)) {
    return false;
  }
  return parts.every(
    (part) =>
      /^\p{Lu}[\p{L}'’-]*\.?$/u.test(part) ||
      /^\p{Lu}\.$/u.test(part) ||
      ['von', 'van', 'de', 'der', 'di', 'la', 'le', 'du', 'da'].includes(part.toLowerCase()),
  );
};

/** a name with an initial is never a title: "WILLA S. CATHER", "CLARENCE E", "PAUL·L·FORD" */
const hasInitial = (text: string) =>
  words(text.replaceAll(/[·•]/g, ' ')).some((part, index, all) => /^\p{Lu}\.?$/u.test(part) && all.length > 1);

type Line = TextLine & { score: number; index: number };

/** two readings of one line (the tiles and the whole page read it differently): the one read more surely */
const dedupe = (lines: Line[]) =>
  lines.filter((line) =>
    lines.every(
      (other) =>
        !(
          other !== line &&
          verticalOverlap(line, other) >= 0.5 &&
          Math.min(line.right, other.right) - Math.max(line.left, other.left) >
            0.6 * Math.min(line.right - line.left, other.right - other.left) &&
          (other.score * letters(other.text) > line.score * letters(line.text) ||
            (other.score * letters(other.text) === line.score * letters(line.text) && other.index < line.index))
        ),
    ),
  );

/** a line of running text: many words, most of them lowercase, as on an open page or in a review */
const isProse = (text: string) => {
  const parts = words(text).filter((word) => letters(word) > 0);
  return parts.length >= 6 && parts.filter((word) => /^\p{Ll}/u.test(word)).length >= 0.5 * parts.length;
};

const SURE_TEXT = 0.9;

/** Reads the book on a photo of its cover, spine or title page; undefined when no text was read */
export const readBookPage = (ocr: OcrBoxInput[]): BookReading | undefined => {
  const all = groupLines(toTextBoxes(ocr)).map((line, index): Line => ({
    ...line,
    index,
    score: Math.min(...line.boxes.map((box) => box.score)),
  }));
  const read = dedupe(all.filter((line) => !isNoise(line.text) && !STAMP.test(line.text)));
  if (read.length === 0) {
    return;
  }

  const prose = read.filter((line) => isProse(line.text));
  const heights = read.map((line) => line.height).toSorted((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)];
  const largest = heights.at(-1)!;
  // an open page: running text in one size
  const openPage = prose.length >= 8 && prose.length >= 0.5 * read.length && largest < 1.8 * medianHeight;
  const fraktur = read.flatMap((line) => words(line.text)).filter((word) => isFrakturWord(word)).length >= 2;
  if (openPage) {
    return { confidence: 0, sure: false, fraktur, openPage, words: [] };
  }

  const lines = read.filter((line) => !isProse(line.text));
  const isMarker = (line: Line) => AUTHOR_MARKERS.has(plain(line.text));
  const isYearLine = (line: Line) =>
    findYear(line.text) !== undefined &&
    letters(line.text.replaceAll(/[Ss](?=\d)/g, '')) <= 1 &&
    line.text.replaceAll(/\D/g, '').length <= 5;
  const isImprint = (line: Line) => PUBLISHER.test(line.text) || (findCity(line.text) && line.top > 0.55);
  // the largest type is the title, whatever it starts with ("VON MONET ZU PICASSO", "D[as] Gericht")
  const large = (line: Line) => line.height >= 0.8 * largest;
  const excluded = (line: Line) =>
    isMarker(line) ||
    isYearLine(line) ||
    isImprint(line) ||
    GENRE.test(line.text) ||
    MARKER_AT_END.test(line.text) ||
    (!large(line) && (hasInitial(line.text) || MARKER_AT_START.test(line.text)));
  const isConnectorLine = (line: Line) =>
    line.text.split(/[\s-]+/).every((word) => CONNECTORS.has(plain(word)) && plain(word).length > 0);

  // the title: the largest line (a little higher on the page counts more), and the lines set with it
  const candidates = lines.filter((line) => !excluded(line) && !isGarbled(line.text));
  const pool = candidates.length > 0 ? candidates : lines.filter((line) => !excluded(line));
  const seed = pool.toSorted(
    (a, b) => b.height * (1.15 - 0.4 * b.top) - a.height * (1.15 - 0.4 * a.top) || a.top - b.top,
  )[0];

  let author: { text: string; line?: Line } | undefined;
  const titleLines: Line[] = [];
  if (seed) {
    titleLines.push(seed);
    const position = lines.indexOf(seed);
    const joins = (line: Line, neighbour: Line) => {
      if (excluded(line)) {
        return false;
      }
      const gap = Math.max(line.top, neighbour.top) - Math.min(line.bottom, neighbour.bottom);
      const single = words(seed.text).filter((word) => letters(word) >= 3).length === 1;
      return (
        (line.height >= 0.55 * seed.height && gap <= 1.2 * Math.max(line.height, neighbour.height)) ||
        (gap <= 0.35 * Math.min(line.height, neighbour.height) && line.height >= (single ? 0.25 : 0.3) * seed.height) ||
        (isConnectorLine(line) && line.height >= 0.15 * seed.height && gap <= 2 * neighbour.height)
      );
    };
    for (let index = position - 1; index >= 0 && joins(lines[index], titleLines[0]); index--) {
      titleLines.unshift(lines[index]);
    }
    for (let index = position + 1; index < lines.length && joins(lines[index], titleLines.at(-1)!); index++) {
      titleLines.push(lines[index]);
    }
    // a trailing connector ("… und") belongs to the next line, not the title
    while (titleLines.length > 1 && CONNECTORS.has(plain(titleLines.at(-1)!.text))) {
      titleLines.pop();
    }
    // "Dante Alighieri's …": the author first, as a possessive
    const first = titleLines[0];
    if (titleLines.length > 1 && /['’]s$/u.test(first.text.trim())) {
      author = { text: first.text.trim().replace(/['’]s$/u, ''), line: first };
      titleLines.shift();
    }
  }

  const titleBottom = titleLines.at(-1)?.bottom ?? 0;
  const below = titleLines.length > 0 ? lines.slice(lines.indexOf(titleLines.at(-1)!) + 1) : lines;
  const isAuthor = (text: string) =>
    letters(text) >= 4 &&
    words(text).length <= 5 &&
    !/\d/.test(text) &&
    !GENRE.test(text) &&
    !PUBLISHER.test(text) &&
    !STAMP.test(text);
  const findAuthorAfter = (isLead: (line: Line) => boolean) => {
    for (const [index, line] of below.entries()) {
      if (!isLead(line)) {
        continue;
      }
      const start = MARKER_AT_START.exec(line.text.trim());
      if (start && isAuthor(start[1])) {
        return { text: start[1], line };
      }
      // the author follows, after a stray mark or two ("po1t")
      const target = below
        .slice(index + 1, index + 3)
        .find((other) => !isMarker(other) && isAuthor(other.text) && !isYearLine(other));
      if (target) {
        return { text: target.text, line: target };
      }
    }
  };
  // "von" alone or a line that ends with it ("Roman von"), then a genre line ("Roman", "Trauerspiel in einem Aufzuge")
  author ??= findAuthorAfter(
    (line) => isMarker(line) || MARKER_AT_END.test(line.text.trim()) || MARKER_AT_START.test(line.text.trim()),
  );
  if (!author) {
    // "Dante Alighieri's" at the head of the page: the author, as a possessive
    const possessive = lines.find(
      (line) => line.top < 0.35 && /['’]s$/u.test(line.text.trim()) && words(line.text).length <= 4,
    );
    if (possessive) {
      author = { text: possessive.text.trim().replace(/['’]s$/u, ''), line: possessive };
    }
  }
  author ??= findAuthorAfter((line) => GENRE.test(line.text) && !PUBLISHER.test(line.text));
  if (!author) {
    // a line of name-like words, nearest the title (a cover names its author above the title too)
    const names = lines
      .filter((line) => !titleLines.includes(line) && isNameLine(line.text) && line.height >= 0.2 * (seed?.height ?? 0))
      .toSorted(
        (a, b) =>
          Math.abs(a.top - (seed?.top ?? 0)) - Math.abs(b.top - (seed?.top ?? 0)) || Number(b.top > a.top) - 0.5,
      );
    const line =
      names[0] ??
      lines.find(
        (line) => hasInitial(line.text) && !titleLines.includes(line) && !PUBLISHER.test(line.text) && !isImprint(line),
      );
    if (line) {
      // "CLARENCE E" over "MULFORD": a name on two lines
      const next = lines[lines.indexOf(line) + 1];
      const joined =
        next && next.top - line.bottom < 1.5 * line.height && /^\p{Lu}[\p{L}'’-]+\.?$/u.test(next.text.trim())
          ? `${line.text} ${next.text}`
          : line.text;
      author = { text: joined, line };
    }
  }

  // the year, publisher and place of the imprint: the lowest ones on the page
  const imprint = lines.filter((line) => !titleLines.includes(line) && line !== author?.line);
  const year = imprint
    .toSorted((a, b) => Number(isYearLine(b)) - Number(isYearLine(a)) || b.top - a.top)
    .map((line) => findYear(line.text))
    .find(Boolean);
  const publisherLine = imprint.findLast((line) => PUBLISHER.test(line.text));
  const firstProse = prose.length >= 4 ? Math.min(...prose.map((line) => line.top)) : 1;
  const place = imprint
    .filter((line) => line.top < firstProse)
    .toSorted((a, b) => b.top - a.top)
    .map((line) => findCity(line.text))
    .find(Boolean);
  const publisher = publisherLine
    ? toTitle(
        publisherLine.text
          .replaceAll(/(?<![\d])(1[4-9]\d\d|20[0-4]\d)\.?/g, '')
          .split(/[,/]/)
          .map((part) => part.trim())
          .filter((part) => part && !findCity(part))
          .join(', ')
          .replace(/^(?:im|in der|verlag von|verlag der|published by|si vende presso la)\s+/i, ''),
      ) || undefined
    : undefined;

  const title = titleLines.length > 0 ? toTitle(titleLines.map((line) => line.text).join(' ')) : undefined;
  const authorName = author ? toName(author.text) : undefined;
  const subtitleLines = author?.line
    ? lines
        .filter(
          (line) =>
            !titleLines.includes(line) &&
            line !== author?.line &&
            line.top > titleBottom - 0.005 &&
            line.top < (author?.line?.top ?? 1) &&
            !isMarker(line) &&
            !MARKER_AT_END.test(line.text) &&
            !isImprint(line) &&
            !isNameLine(line.text),
        )
        .slice(0, 2)
    : [];
  const subtitle = subtitleLines.length > 0 ? toTitle(subtitleLines.map((line) => line.text).join(' ')) : undefined;

  const used = [...titleLines, ...(author?.line ? [author.line] : [])];
  const unsureText = used.some((line) => line.score < SURE_TEXT);
  const garbled = [title, authorName].some((text) => text && isGarbled(text));
  // a large fragment beside the title ("pa" of "Hopalong" over "Cassidy"): part of the title was not read
  const torn = all.some(
    (line) =>
      !!seed &&
      isNoise(line.text) &&
      line.height >= 0.4 * seed.height &&
      titleLines.some((title) => Math.abs(title.top - line.top) < 1.5 * seed.height),
  );
  const sure = !!title && !!authorName && words(authorName).length >= 2 && !fraktur && !unsureText && !garbled && !torn;
  const parts = [title, authorName, year].filter(Boolean).length;
  const confidence = Math.round(Math.min(1, 0.3 * parts + (sure ? 0.15 : 0) - (fraktur ? 0.2 : 0)) * 100) / 100;

  const box: [number, number, number, number] | undefined =
    used.length > 0
      ? [
          Math.min(...used.map((line) => line.left)),
          Math.min(...used.map((line) => line.top)),
          Math.max(...used.map((line) => line.right)),
          Math.max(...used.map((line) => line.bottom)),
        ]
      : undefined;

  return {
    ...(title && { title }),
    ...(subtitle && { subtitle }),
    ...(authorName && { author: authorName }),
    ...(year && { year }),
    ...(publisher && { publisher }),
    ...(place && { place }),
    confidence: Math.max(0, confidence),
    sure,
    fraktur,
    openPage: false,
    words: title ? getTitleWords(title) : [],
    ...(box && { box }),
  };
};

const STOP = new Set([
  ...CONNECTORS,
  'die',
  'der',
  'das',
  'ein',
  'eine',
  'einer',
  'the',
  'and',
  'with',
  'from',
  'for',
  'roman',
  'novel',
]);

/** the words of a title that tell it apart: four letters or more, without the small words */
export const getTitleWords = (title: string) =>
  [...new Set(words(fold(title).replaceAll(/[^\p{L}\d\s]+/gu, ' ')))].filter(
    (word) => word.length >= 4 && !STOP.has(word) && !GENRE.test(word),
  );

/** the name of a book as it is tagged: "Title — Author", or the title alone */
export const formatBookName = (reading: Pick<BookReading, 'title' | 'author'>) =>
  [reading.title, reading.author].filter(Boolean).join(' — ') || undefined;

/** the other things printed about a book, for the description of its entry: "1882 · Verlagshandlung · Stuttgart" */
export const formatBookDetails = (reading: Pick<BookReading, 'year' | 'publisher' | 'place' | 'subtitle'>) =>
  [reading.subtitle, reading.year, reading.publisher, reading.place].filter(Boolean).join(' · ') || undefined;

/** "Title — Author" apart */
export const parseBookName = (name: string): { title?: string; author?: string } => {
  const [title, ...rest] = name.split(/\s+—\s+/);
  const author = rest.join(' — ').trim();
  return { ...(title.trim() && { title: title.trim() }), ...(author && { author }) };
};

/** a book as an entry of the source parser */
export const toBookEntry = (reading: BookReading): SourceEntry | undefined => {
  const name = formatBookName(reading);
  if (!name) {
    return;
  }
  const description = formatBookDetails(reading);
  return {
    name,
    ...(description && { description }),
    column: 0,
    box: reading.box ?? [0, 0, 1, 1],
    ...(!reading.sure && { check: true }),
  };
};

/**
 * The source parser of the reading pack: a cover or title page is one book; a reading list (many short lines, most
 * of them "Title — Author" or "Title by Author") is a book per line
 */
export const parseBooks = (ocr: OcrBoxInput[]): ParsedSource => {
  const lines = groupLines(toTextBoxes(ocr));
  const listed = lines.filter((line) => /\s(?:—|–|-|by|von)\s/iu.test(line.text) && words(line.text).length >= 3);
  if (listed.length >= 3 && listed.length >= 0.5 * lines.length) {
    const items = listed.map((line): SourceEntry => {
      const [title, author] = line.text.split(/\s(?:—|–|-|by|von)\s/iu, 2);
      return {
        name: formatBookName({ title: toTitle(title), author: author ? toName(author) : undefined })!,
        column: 0,
        box: [line.left, line.top, line.right, line.bottom],
      };
    });
    return { items, sections: [], columns: 1, lines: lines.length };
  }
  const reading = readBookPage(ocr);
  const entry = reading ? toBookEntry(reading) : undefined;
  return {
    items: entry ? [entry] : [],
    sections: [],
    columns: 1,
    lines: lines.length,
    ...(reading?.openPage && { warnings: ['An open page with no title: look at the photo and name the book'] }),
    ...(reading?.fraktur && {
      warnings: ['The page is set in Fraktur, which OCR reads as other letters: read the title on the photo'],
    }),
  };
};
