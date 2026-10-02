import { OcrBoxInput, TextLine, groupLines, toTextBoxes } from 'src/utils/collections/ocr.js';
import { redactChildNames } from 'src/utils/collections/packs/kids-art/names.js';
import { isGarbled } from 'src/utils/collections/place.js';
import { ParsedSource, SourceEntry } from 'src/utils/collections/source.js';
import { editDistance, stripAccents } from 'src/utils/collections/text.js';

/*
 * Reading what a child wrote on an artwork: a greeting ("Buon Natale", "Happy Birthday"), an age ("age 7", "7 anni"),
 * a year or a date. Handwriting, crayon and illustrated letters are read in fragments ("RUON NAITHU", "Buon natble"),
 * and OCR does not read Cyrillic or Japanese at all: the reader keeps what it can tell apart, and a reading is sure
 * only of what it read clearly. The assistant's eyes do most of the work; the pages of an illustrated letter, whose
 * text runs on from one page to the next, are one artwork.
 */

export type ArtworkReading = {
  /** a greeting written on it, e.g. "Buon Natale", as the title */
  title?: string;
  /** the age written on it, e.g. "7" */
  age?: string;
  /** a year written on it, e.g. "1947" */
  year?: string;
  /** the lines of handwriting read on it, e.g. of a letter */
  lines: number;
  /** the text starts in the middle of a sentence (the second page of a letter) */
  continues: boolean;
  /** the title was read clearly */
  sure: boolean;
  /** where the text is on the photo: [left, top, right, bottom], normalized 0..1 */
  box?: [number, number, number, number];
};

const fold = (text: string) =>
  stripAccents(text)
    .toLowerCase()
    .replaceAll(/[^\p{L}\d\s']+/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

/** greetings children write on their drawings and letters, by language */
const GREETINGS = [
  'Buon Natale',
  'Buone Feste',
  'Buon Compleanno',
  'Buona Pasqua',
  'Auguri',
  'Merry Christmas',
  'Happy Christmas',
  'Happy Birthday',
  'Happy New Year',
  "Happy Mother's Day",
  "Happy Father's Day",
  'Happy Easter',
  'Happy Halloween',
  'I love you',
  'Thank you',
  'Frohe Weihnachten',
  'Alles Gute',
  'Joyeux Noël',
  'Bonne Année',
  'Bonne fête',
  'Feliz Navidad',
  'Feliz cumpleaños',
];

/** the greeting a line holds, give or take a letter or two misread ("Buon natble") */
const findGreeting = (text: string): { greeting: string; distance: number } | undefined => {
  const key = fold(text).replaceAll(' ', '');
  let best: { greeting: string; distance: number } | undefined;
  for (const greeting of GREETINGS) {
    const target = fold(greeting).replaceAll(' ', '');
    for (let start = 0; start + target.length - 1 <= key.length; start++) {
      const window = key.slice(start, start + target.length);
      const distance = editDistance(window, target);
      if (distance <= (target.length >= 9 ? 2 : target.length >= 6 ? 1 : 0) && (!best || distance < best.distance)) {
        best = { greeting, distance };
      }
    }
  }
  return best;
};

const AGE = [
  /(?<!\p{L})(?:age|aged|âge|eta|età|alter|edad|возраст)\s*:?\s*(\d{1,2})(?!\d)/iu,
  /(?<!\d)(\d{1,2})\s*(?:years?\s*old|yrs?\s*old|y\/o|ans|anni|jahre|años|лет|года|год|歳|才)(?!\p{L})/iu,
];

/** the age written on a line, e.g. "7" of "Lina, 7 years old"; undefined when there is none */
export const findAge = (text: string) => {
  for (const pattern of AGE) {
    const match = pattern.exec(text);
    if (match && Number(match[1]) >= 1 && Number(match[1]) <= 18) {
      return match[1];
    }
  }
};

/** the year written on a line, 1900 to 2049 */
export const findArtworkYear = (text: string) =>
  text
    .matchAll(/(?<!\d)(19\d\d|20[0-4]\d)(?!\d)/g)
    .map((match) => match[1])
    .toArray()
    .at(-1);

const letters = (text: string) => text.replaceAll(/[^\p{L}]/gu, '').length;

/** a line of handwriting: a few words, most of them read as words */
const isWriting = (line: TextLine) => letters(line.text) >= 6 && line.text.split(/\s+/).length >= 2;

/** Reads what is written on an artwork; undefined when nothing was read */
export const readArtwork = (ocr: OcrBoxInput[]): ArtworkReading | undefined => {
  const lines = groupLines(toTextBoxes(ocr)).filter((line) => letters(line.text) >= 3 || /\d{4}/.test(line.text));
  if (lines.length === 0) {
    return;
  }
  const writing = lines.filter((line) => isWriting(line));
  const greetings = lines
    .map((line) => ({ line, found: findGreeting(line.text) }))
    .filter((item): item is { line: TextLine; found: { greeting: string; distance: number } } => !!item.found)
    // the closest reading, and of two as close the longer greeting ("Buon Natale" before "Auguri")
    .toSorted((a, b) => a.found.distance - b.found.distance || b.found.greeting.length - a.found.greeting.length);
  const greeting = greetings[0];
  const age = lines.map((line) => findAge(line.text)).find(Boolean);
  const year = lines.map((line) => findArtworkYear(line.text)).find(Boolean);
  // the text runs on from another page: it starts with a word in lower case, mid-sentence
  const first = writing.toSorted((a, b) => a.top - b.top)[0];
  const continues = writing.length >= 3 && !!first && /^\p{Ll}/u.test(first.text.trim());
  const used = [greeting?.line, ...lines.filter((line) => findAge(line.text) || findArtworkYear(line.text))].filter(
    (line): line is TextLine => !!line,
  );
  const box: [number, number, number, number] | undefined =
    used.length > 0
      ? [
          Math.min(...used.map((line) => line.left)),
          Math.min(...used.map((line) => line.top)),
          Math.max(...used.map((line) => line.right)),
          Math.max(...used.map((line) => line.bottom)),
        ]
      : undefined;
  const garbled = lines.filter((line) => isGarbled(line.text)).length;
  return {
    ...(greeting && { title: greeting.found.greeting }),
    ...(age && { age }),
    ...(year && { year }),
    lines: writing.length,
    continues,
    sure: !!greeting && greeting.found.distance === 0 && garbled === 0,
    ...(box && { box }),
  };
};

/** the name of an artwork as it is tagged: "Buon Natale (age 7)", or with the year written on it, "(1947)" */
export const formatArtworkName = (reading: Pick<ArtworkReading, 'title' | 'age' | 'year'>) => {
  if (!reading.title) {
    return;
  }
  const detail = reading.age ? `age ${reading.age}` : reading.year;
  return redactChildNames(detail ? `${reading.title} (${detail})` : reading.title);
};

/** "Buon Natale (age 7)" apart */
export const parseArtworkName = (name: string): { title: string; age?: string; year?: string } => {
  const match = /^(.*?)\s*\((?:age\s+(\d{1,2}(?:[^)]*)?)|(\d{4}))\)\s*$/iu.exec(name);
  if (!match) {
    return { title: name.trim() };
  }
  return { title: match[1].trim(), ...(match[2] && { age: match[2].trim() }), ...(match[3] && { year: match[3] }) };
};

/** an artwork as an entry of the source parser, when something that names it was read */
export const toArtworkEntry = (reading: ArtworkReading): SourceEntry | undefined => {
  const name = formatArtworkName(reading);
  if (!name) {
    return;
  }
  return { name, column: 0, box: reading.box ?? [0, 0, 1, 1], ...(!reading.sure && { check: true }) };
};

/** The source parser of the kids' art pack: what is written on an artwork, or on a note beside it */
export const parseArtwork = (ocr: OcrBoxInput[]): ParsedSource => {
  const reading = readArtwork(ocr);
  const entry = reading ? toArtworkEntry(reading) : undefined;
  return {
    items: entry ? [entry] : [],
    sections: [],
    columns: 1,
    lines: reading?.lines ?? 0,
    ...(!entry && {
      warnings: [
        'Little could be read on the artwork (OCR reads handwriting in fragments, and no Cyrillic or Japanese): ' +
          'look at it and name it yourself',
      ],
    }),
  };
};
