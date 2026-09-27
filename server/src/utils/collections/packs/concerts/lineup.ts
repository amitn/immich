import {
  OcrBoxInput,
  TextBox,
  TextLine,
  deskewBoxes,
  groupLines,
  median,
  toTextBoxes,
  toTextLine,
} from 'src/utils/collections/ocr.js';
import { toTitleCase } from 'src/utils/collections/place.js';
import { ParsedSource, SourceEntry, SourceParseOptions } from 'src/utils/collections/source.js';
import { stripAccents } from 'src/utils/collections/text.js';

/*
 * Reading the sources of a gig: the line-up of a festival stage (a banner with the acts of every day of the week
 * under day headings, "20:20 - MALIHINI"), a board of stage times (rows of act, start and stage: "SHELLAC 20H25
 * RAY-BAN") and a setlist (a header with the band, the date, the city and the venue, "SIDNEY GISH w/ THE BETHS /
 * FRIDAY FEB 17 2023 / SEATTLE WASHINGTON · NEUMOS", then the songs, one a line). The acts are the entries; the songs
 * of a setlist are not, but its book page is typeset from them.
 */

/** an act read on a line-up or a setlist */
export type ConcertAct = {
  /** the name as printed, in title case: "Kali Uchis", "Frank Carter & The Ratt" */
  name: string;
  /** the day heading it is listed under, 0 (Sunday) to 6 */
  weekday?: number;
  /** its start, "20:45" */
  time?: string;
  /** the stage, from its row or the heading of the line-up: "Seat", "Night Pro" */
  stage?: string;
  /** on a setlist: the band of the setlist itself (the first act of its header), or an act billed with it */
  setlist?: 'own' | 'billed';
  /** where it is on the photo: [left, top, right, bottom], normalized 0..1 */
  box: [number, number, number, number];
};

export type ConcertSource = {
  kind: 'line-up' | 'setlist';
  /** the heading of a line-up (its stage or festival) */
  title?: string;
  acts: ConcertAct[];
  /** the songs of a setlist, in order, with markers such as "Interlude" or "Encore" (see `isSetlistMarker`) */
  songs: string[];
  /** a setlist's header: the date, the city and the venue as printed, e.g. "Friday Feb 17 2023" */
  date?: string;
  city?: string;
  venue?: string;
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** the names of the days, from Sunday, in the languages of festival line-ups */
const WEEKDAY_WORDS = [
  /\b(?:sunday|domingo|diumenge|dimanche|sonntag|domenica|zondag)\b/i,
  /\b(?:monday|lunes|dilluns|lundi|montag|luned[iì]|segunda|maandag)\b/i,
  /\b(?:tuesday|martes|dimarts|mardi|dienstag|marted[iì]|ter[cç]a|dinsdag)\b/i,
  /\b(?:wednesday|mi[eé]rcoles|dimecres|mercredi|mittwoch|mercoled[iì]|quarta|woensdag)\b/i,
  /\b(?:thursday|jueves|dijous|jeudi|donnerstag|gioved[iì]|quinta|donderdag)\b/i,
  /\b(?:friday|viernes|divendres|vendredi|freitag|venerd[iì]|sexta|vrijdag)\b/i,
  /\b(?:saturday|s[aá]bado|dissabte|samedi|samstag|sabato|zaterdag)\b/i,
];

const ENGLISH_WEEKDAY = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;

/** the day a heading names, English first (a Catalan, Spanish and English banner names it three times) */
export const readWeekday = (text: string): number | undefined => {
  const plain = stripAccents(text);
  const english = ENGLISH_WEEKDAY.exec(plain)?.[1];
  if (english) {
    return WEEKDAYS.findIndex((day) => day.toLowerCase() === english.toLowerCase());
  }
  const index = WEEKDAY_WORDS.findIndex((pattern) => pattern.test(text) || pattern.test(plain));
  return index === -1 ? undefined : index;
};

/** "20:20", "20H10", "20.30", "22:0O" (a letter O for the zero) */
const TIME = /(?<![\d:])([01]?\d|2[0-3])\s?[:hH.]\s?([0-5][\dOo])(?![\d])/;
/** the text before and after a start: "SHELLAC 20H25" → "SHELLAC", "" */
const TIME_SPLIT = new RegExp(String.raw`\s*${TIME.source.replaceAll(/\((?!\?)/g, '(?:')}\s*`);
const TIME_FIRST = new RegExp(String.raw`^\s*${TIME.source}\s*[-–—:.]?\s*(.*\p{L}.*)$`, 'u');

/** the start printed in a text, as "HH:MM" */
export const readTime = (text: string) => {
  const match = TIME.exec(text);
  return match ? `${match[1].padStart(2, '0')}:${match[2].replaceAll(/o/gi, '0')}` : undefined;
};

const MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
/** a month written out, with a day or a year beside it (digits OCR may read as letters: "MARCH T" is "MARCH 7") */
const MONTH_DATE = new RegExp(
  String.raw`\b(?:(?:${MONTHS})\.?\s*(?:\d{1,2}|[TIlOoSZ]\b|'?\d{2,4})|\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTHS})\b|(?:january|february|march|april|june|july|august|september|october|november|december)[TIlOSZ]?\b)`,
  'i',
);
const NUMERIC_DATE = /\b\d{1,2}[./-]\d{1,2}[./-](?:\d{2}|\d{4})\b/;

/** a date on a setlist header: "FRIDAY FEB 17 2023", "MARCH 7", "3/7/19" */
export const isDateText = (text: string) =>
  MONTH_DATE.test(text) || NUMERIC_DATE.test(text) || readWeekday(text) !== undefined;

/** "MARCHT" is "MARCH 7": the digits of a date that OCR read as letters, after the month */
const DATE_DIGITS: Record<string, string> = { T: '7', I: '1', l: '1', O: '0', o: '0', S: '5', Z: '2' };
export const repairDate = (text: string) =>
  text.replace(
    new RegExp(String.raw`\b((?:${MONTHS})\.?)\s*([TIlOoSZ\d]{1,2})\b`, 'i'),
    (_, month: string, day: string) => `${month} ${[...day].map((char) => DATE_DIGITS[char] ?? char).join('')}`,
  );

/** the separators of the parts of a setlist header: "CHERRY GLAZERR - SEATTLE - MARCH 7", "SEATTLE · NEUMOS" */
const VENUE_SEPARATOR = /\s*[·•@|]\s*|\s+at\s+/i;

/** "INTERLUDE", "--- INTERLUDE", "ENCORE": a line of a setlist that is no song */
export const isSetlistMarker = (text: string) =>
  /^[\s\-–—~*=.]*(?:interlude|intermission|encore|break|intro|outro|e\s?n\s?c\s?o\s?r\s?e)\b[\s\-–—~*=.!:]*$/i.test(
    text,
  );

const letters = (text: string) => text.replaceAll(/[^\p{L}]/gu, '').length;

/** DTSQ, NFX, F5, 5KHD: short capitals without a vowel are initials, kept in capitals */
const isInitials = (word: string) => /^[\dA-Z]{2,5}$/.test(word) && !/[AEIOUY]/.test(word);

/**
 * The name of an act as printed, in title case: "FRANK CARTER & THE RATT" → "Frank Carter & The Ratt", "MEUKO!
 * MEUKO! (Live)" → "Meuko! Meuko!", and an ampersand OCR read as an 8 between two names restored
 */
/** text printed in capitals, give or take the letters OCR read in lowercase from handwriting ("SIDNEY Gih") */
const isCapitals = (text: string) => {
  const all = text.replaceAll(/[^\p{L}]/gu, '');
  return all.length > 0 && all.replaceAll(/[^\p{Lu}]/gu, '').length >= 0.6 * all.length;
};

export const cleanActName = (text: string) => {
  const cleaned = text
    .replaceAll(/\((?:live|dj set|dj|a\/v|av|live a\/v)\)/gi, ' ')
    .replaceAll(/(?<=\p{L})\s+8\s+(?=\p{L})/gu, ' & ')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/^[\s\-–—:.,;!]+|[\s\-–—:,;]+$/g, '')
    .trim();
  if (!isCapitals(cleaned)) {
    return cleaned;
  }
  const upper = cleaned.toUpperCase();
  const titled = toTitleCase(upper).split(' ');
  return (
    upper
      .split(' ')
      .map((word, index) => (isInitials(word) ? word : titled[index]))
      .join(' ')
      // "PULL&BEAR" is "Pull&Bear", "RAY-BAN" "Ray-Ban"
      .replaceAll(/([&\-/])(\p{Ll})/gu, (_, mark: string, letter: string) => mark + letter.toUpperCase())
  );
};

/** a song as printed, in title case, without its number on the list: "1) STRFKR - 24" → "Strfkr - 24" */
export const cleanSong = (text: string) => {
  const cleaned = text
    .replace(/^\s*(?:\(?\d{1,2}\s?[.)]|[①-⑳]|#\d{1,2})\s*/u, '')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/^[\s\-–—.,;]+|[\s,;]+$/g, '')
    .trim();
  if (isSetlistMarker(cleaned)) {
    return toTitleCase(cleaned.replaceAll(/[^\p{L}\s]/gu, '').trim());
  }
  return isCapitals(cleaned) ? toTitleCase(cleaned.toUpperCase()) : cleaned;
};

const boxOf = (boxes: Array<Pick<TextBox, 'left' | 'top' | 'right' | 'bottom'>>): ConcertAct['box'] => {
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return [
    round(Math.min(...boxes.map((box) => box.left))),
    round(Math.min(...boxes.map((box) => box.top))),
    round(Math.max(...boxes.map((box) => box.right))),
    round(Math.max(...boxes.map((box) => box.bottom))),
  ];
};

type Heading = { weekday: number; left: number; right: number; top: number };

/** the day heading an act is listed under: the closest one above it, in its column */
const findHeading = (headings: Heading[], box: Pick<TextBox, 'left' | 'right' | 'top'>) =>
  headings
    .filter(
      (heading) =>
        heading.top < box.top &&
        Math.min(heading.right, box.right) > Math.max(heading.left, box.left) &&
        Math.abs(heading.left - box.left) < 0.1,
    )
    .toSorted((a, b) => b.top - a.top)[0];

/** a line continues the act above it: the act ends with a comma or "feat.", the line with no time of its own */
const continues = (act: string) => /(?:[,&+]|\bfeat\.?|\bwith|\bw\/)$/i.test(act.trim());

/**
 * The acts of a line-up: a start and a name in each box ("20:20 - MALIHINI", a banner), or rows of name, start and
 * stage ("SHELLAC 20H25 RAY-BAN", a board of stage times). Day headings apply to the acts below them in their column,
 * and the heading of a banner without a stage column is the stage of its acts.
 */
const readLineUp = (boxes: TextBox[], lines: TextLine[]): Omit<ConcertSource, 'kind'> => {
  const headings: Heading[] = boxes.flatMap((box) => {
    const weekday = readWeekday(box.text);
    return weekday !== undefined && !TIME.test(box.text) && letters(box.text) <= 40
      ? [{ weekday, left: box.left, right: box.right, top: box.top }]
      : [];
  });
  const timeFirst = boxes.filter((box) => TIME_FIRST.test(box.text)).length;
  const timeOnly = boxes.filter((box) => TIME.test(box.text) && !TIME_FIRST.test(box.text)).length;
  const acts: ConcertAct[] = [];
  const used = new Set<TextBox>();

  if (timeFirst >= timeOnly) {
    // a banner: "HH:MM - ACT" in each box, the name sometimes running on to the line below
    for (const box of boxes) {
      const match = TIME_FIRST.exec(box.text);
      if (!match || used.has(box)) {
        continue;
      }
      used.add(box);
      let name = match[3];
      const parts = [box];
      let last = box;
      while (continues(name)) {
        const next = boxes.find(
          (other) =>
            !used.has(other) &&
            !TIME.test(other.text) &&
            other.top > last.top &&
            other.top - last.bottom < 1.2 * last.height &&
            Math.abs(other.left - last.left) < 3 * last.height,
        );
        if (!next) {
          break;
        }
        used.add(next);
        parts.push(next);
        name += ` ${next.text}`;
        last = next;
      }
      const heading = findHeading(headings, box);
      acts.push({
        name: cleanActName(name),
        ...(heading && { weekday: heading.weekday }),
        time: readTime(box.text)!,
        box: boxOf(parts),
      });
    }
  } else {
    // a board: the name on the left of the start, the stage on its right
    for (const line of lines) {
      const index = line.boxes.findIndex((box) => TIME.test(box.text));
      if (index === -1) {
        continue;
      }
      const timeBox = line.boxes[index];
      const [before, after] = timeBox.text.split(TIME_SPLIT);
      const name = [...line.boxes.slice(0, index).map((box) => box.text), before ?? ''].join(' ');
      const stage = [after ?? '', ...line.boxes.slice(index + 1).map((box) => box.text)].join(' ');
      if (letters(name) < 2) {
        continue;
      }
      const heading = findHeading(headings, line.boxes[0]);
      acts.push({
        name: cleanActName(name),
        ...(heading && { weekday: heading.weekday }),
        time: readTime(timeBox.text)!,
        ...(letters(stage) >= 2 && { stage: cleanActName(stage) }),
        box: boxOf(line.boxes),
      });
    }
  }

  // the heading: the largest text above the first act, not a day
  const firstTop = Math.min(...acts.map((act) => act.box[1]));
  const title = lines
    .filter(
      (line) =>
        line.bottom <= firstTop &&
        letters(line.text) >= 3 &&
        !TIME.test(line.text) &&
        readWeekday(line.text) === undefined &&
        line.text.split(/\s+/).length <= 4,
    )
    .toSorted((a, b) => b.height - a.height)[0];
  const titleName = title ? cleanActName(title.text) : undefined;
  // a banner of one stage: its heading names the stage of every act
  const staged = acts.map((act) =>
    act.stage || !titleName || timeFirst < timeOnly ? act : { ...act, stage: titleName },
  );
  return { ...(titleName && { title: titleName }), acts: staged, songs: [] };
};

/** the boxes of a line split where a gap wider than `gap` text heights separates them */
const splitAtGaps = (line: TextLine, aspectRatio: number, gap: number): TextLine[] => {
  const parts: TextBox[][] = [];
  for (const box of line.boxes) {
    const previous = parts.at(-1)?.at(-1);
    if (previous && ((box.left - previous.right) * aspectRatio) / Math.max(box.height, previous.height) <= gap) {
      parts.at(-1)!.push(box);
    } else {
      parts.push([box]);
    }
  }
  return parts.map((boxes) => toTextLine(boxes));
};

/** a header whose parts OCR read without the spaces around the dashes: "CHERRYGLAZERR-SEATTLE-MARCHT" */
const HYPHENATED_PARTS = /\p{L}[-–—]\p{L}.*\p{L}[-–—][\p{L}\d]/u;

/** "SIDNEY GISH w/ THE BETHS": the band of the setlist, then the acts billed with it */
const splitBill = (text: string) =>
  text
    .split(/\s+(?:w\/|w\\|with|\+|feat\.?|x)\s+|\s*\bw\/\s*/i)
    .map((part) => part.trim())
    .filter((part) => letters(part) >= 2);

/** a list of songs without a header has at least this many (a few words stacked on a banner are no setlist) */
const MIN_UNNAMED_SONGS = 8;

/**
 * A setlist: a header of up to four lines (the band and the acts billed with it, the date, the city and the venue),
 * then a song a line. A setlist without a header (only songs) names no act.
 */
const readSetlist = (lines: TextLine[], aspectRatio: number): Omit<ConcertSource, 'kind'> => {
  const readable = lines.filter((line) => letters(line.text) >= 2);
  // the header ends with the last of the first four lines that holds a date or a venue
  let end = -1;
  for (const [index, line] of readable.slice(0, 4).entries()) {
    if (isDateText(line.text) || VENUE_SEPARATOR.test(line.text)) {
      end = index;
    }
  }
  const header = readable.slice(0, end + 1);
  const body = readable.slice(end + 1);

  const acts: ConcertAct[] = [];
  const places: string[] = [];
  let date: string | undefined;
  let venue: string | undefined;
  for (const [lineIndex, line] of header.entries()) {
    // the parts of a line: boxes far apart ("SIDNEY GISH    THE BETHS"), each split at its dashes ("CHERRY GLAZERR -
    // SEATTLE - MARCH 7"): on the first line, the first part names the band and the acts billed with it, and a part
    // far apart another act; the other parts are the date, the city and the venue
    const segments = splitAtGaps(line, aspectRatio, 1.5).map(({ text }) =>
      /\s[-–—]\s/.test(text)
        ? text.split(/\s+[-–—]\s+/)
        : HYPHENATED_PARTS.test(text)
          ? text.split(/\s*[-–—]\s*/)
          : [text],
    );
    for (const [segmentIndex, parts] of segments.entries()) {
      for (const [partIndex, part] of parts.map((text) => text.trim()).entries()) {
        if (letters(part) < 2) {
          continue;
        }
        if (isDateText(part)) {
          date = date ? `${date} ${repairDate(part)}` : repairDate(part);
          continue;
        }
        const [where, at] = part.split(VENUE_SEPARATOR);
        if (at !== undefined) {
          places.push(where);
          if (letters(at) >= 3) {
            venue = at;
          }
          continue;
        }
        if (lineIndex === 0 && partIndex === 0 && (segmentIndex === 0 || acts.length > 0)) {
          for (const name of splitBill(part)) {
            acts.push({
              name: cleanActName(name),
              setlist: acts.length === 0 ? 'own' : 'billed',
              box: boxOf(line.boxes),
            });
          }
          continue;
        }
        places.push(part);
      }
    }
  }

  // the songs: the main column, without the circled numbers before them or the notes far to their right
  const left = median(body.map((line) => line.left));
  // text scattered over a photo (the banners of a stage) is no list of songs, unless a header names an act
  const aligned = body.filter((line) => Math.abs(line.left - left) < 0.12).length;
  const span = body.length > 0 ? body.at(-1)!.bottom - body[0].top : 0;
  if (acts.length === 0 && (body.length < MIN_UNNAMED_SONGS || aligned < 0.7 * body.length || span < 0.25)) {
    return { acts, songs: [] };
  }
  const songs = body.flatMap((line) => {
    const parts = splitAtGaps(line, aspectRatio, 3);
    const main = parts.filter((part) => part.right > left + 0.02 && part.left < left + 0.4);
    const text = main.map((part) => part.text).join(' ');
    const words = text.replace(/^\S{1,3}\s+(?=\S{3})/, (lead) => (/\d|[①-⑳]/u.test(lead) ? '' : lead));
    const song = cleanSong(words);
    return letters(song) >= 2 ? [song] : [];
  });

  return {
    acts,
    songs,
    ...(date && { date: toTitleCase(date) }),
    ...(places.length > 0 && { city: toTitleCase(places.join(', ')) }),
    ...(venue && { venue: toTitleCase(venue) }),
  };
};

/** a line-up has several rows with a start time; a setlist has none */
const MIN_TIMED = 3;

/** Reads a line-up, a board of stage times or a setlist */
export const readConcertSource = (ocr: OcrBoxInput[], options: SourceParseOptions = {}): ConcertSource => {
  const aspectRatio = options.aspectRatio ?? 1;
  const boxes = toTextBoxes(deskewBoxes(ocr, aspectRatio), options.minScore);
  const lines = groupLines(boxes);
  const timed = lines.filter((line) => TIME.test(line.text)).length;
  return timed >= MIN_TIMED
    ? { kind: 'line-up', ...readLineUp(boxes, lines) }
    : { kind: 'setlist', ...readSetlist(lines, aspectRatio) };
};

/** the placeholder name of the act of a setlist without a header: "(setlist: Future Me, Knees Deep …)" */
export const getUnnamedSetlistName = (songs: string[]) =>
  `(setlist: ${songs
    .filter((song) => !isSetlistMarker(song))
    .slice(0, 2)
    .join(', ')}${songs.length > 2 ? ' …' : ''})`;

/** whether an entry is the placeholder of a setlist that names no act */
export const isUnnamedSetlist = (name: string) => /^\(setlist:/.test(name);

const songCount = (songs: string[]) => {
  const count = songs.filter((song) => !isSetlistMarker(song)).length;
  return `${count} ${count === 1 ? 'song' : 'songs'}`;
};

/**
 * The description of an act, which `assignConcertPhotos` reads back: "Saturday 19:30 · Night Pro" (a line-up), "setlist ·
 * 19 songs" (the band of a setlist), "with Sidney Gish" (billed on another act's setlist)
 */
export const describeAct = (act: ConcertAct, source: ConcertSource) => {
  if (act.time) {
    const day = act.weekday === undefined ? '' : `${WEEKDAYS[act.weekday]} `;
    return `${day}${act.time}${act.stage ? ` · ${act.stage}` : ''}`;
  }
  if (act.setlist === 'billed') {
    const own = source.acts.find((other) => other.setlist === 'own');
    return own ? `with ${own.name}` : 'on the bill';
  }
  return `setlist · ${songCount(source.songs)}`;
};

/** the entries of a line-up or a setlist: its acts (a setlist without a header gets a placeholder) */
export const toConcertEntries = (source: ConcertSource): SourceEntry[] => {
  if (source.kind === 'setlist' && source.acts.length === 0) {
    const songs = source.songs.filter((song) => !isSetlistMarker(song));
    return songs.length >= 3
      ? [
          {
            name: getUnnamedSetlistName(source.songs),
            description: `setlist · ${songCount(source.songs)}`,
            column: 0,
            box: [0, 0, 1, 1],
          },
        ]
      : [];
  }
  return source.acts.map((act) => ({
    name: act.name,
    description: describeAct(act, source),
    ...(act.weekday !== undefined && { section: WEEKDAYS[act.weekday] }),
    column: 0,
    box: act.box,
  }));
};

/** the parser of the concerts pack: the acts of a line-up, a board of stage times or a setlist */
export const parseConcertSource = (ocr: OcrBoxInput[], options: SourceParseOptions = {}): ParsedSource => {
  const source = readConcertSource(ocr, options);
  const items = toConcertEntries(source);
  const warnings =
    source.kind === 'setlist' && source.acts.length === 0 && items.length > 0
      ? ['The setlist names no act: name it from the photos of the set, or the other setlists of the night']
      : [];
  return {
    items,
    ...(source.title && { title: source.title }),
    sections: [...new Set(items.flatMap((item) => (item.section ? [item.section] : [])))],
    columns: 1,
    lines: groupLines(toTextBoxes(ocr)).length,
    ...(warnings.length > 0 && { warnings }),
  };
};
