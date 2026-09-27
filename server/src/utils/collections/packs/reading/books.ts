import { cosineDistance } from 'src/utils/agent/clustering.js';
import {
  AssignEntry,
  AssignOptions,
  AssignPhoto,
  AssignResult,
  MatchSuggestion,
  SubjectMatch,
} from 'src/utils/collections/match.js';
import {
  BookReading,
  formatBookDetails,
  formatBookName,
  getTitleWords,
  readBookPage,
} from 'src/utils/collections/packs/reading/title-page.js';
import { editDistance } from 'src/utils/collections/text.js';

/*
 * Naming the books of a reading period. Every photo shows a cover, a spine or a title page, read by
 * `readBookPage`; the photos of one book (the cover, then the title page a minute later) are grouped by the words of
 * their titles, and each book is named "Title — Author" after the surest of its readings, or after the line of a
 * reading list it matches when one was photographed. Two books by one author photographed a minute apart are two
 * books: their titles share no word, or their years differ.
 */

export type BookOptions = {
  /** photos of one book are taken within this many minutes of each other */
  sameBookMinutes: number;
  /** photos this alike (CLIP cosine distance) within `sameShotMinutes` are the same page shot again */
  sameShotDistance: number;
  sameShotMinutes: number;
  /** a reading matches a line of a reading list with at least this share of its title words, 0..1 */
  minListScore: number;
};

/** calibrated on real books, see `benchmark.spec.ts` */
export const DEFAULT_BOOK_OPTIONS: BookOptions = {
  sameBookMinutes: 60,
  sameShotDistance: 0.05,
  sameShotMinutes: 5,
  minListScore: 0.5,
};

export type BookPhoto = AssignPhoto & { reading?: BookReading };

const round = (value: number) => Math.round(value * 1000) / 1000;

/** the same word, give or take a letter or two OCR read differently ("Kunstschetze", "Kunstschatze") */
const isSameWord = (a: string, b: string) => {
  if (a === b) {
    return true;
  }
  const shorter = Math.min(a.length, b.length);
  return shorter >= 5 && editDistance(a, b) <= (shorter >= 8 ? 2 : 1);
};

const sharesWord = (a: string[], b: string[]) => a.some((word) => b.some((other) => isSameWord(word, other)));

/** two readings of one book: a word of their titles in common, and no other year */
export const isSameBook = (a?: BookReading, b?: BookReading) =>
  !!a && !!b && sharesWord(a.words, b.words) && (!(a.year && b.year) || a.year === b.year);

/** two readings that say they are of two books */
const conflicts = (a?: BookReading, b?: BookReading) => !!a?.words.length && !!b?.words.length && !isSameBook(a, b);

/**
 * The photos of each book, in time order: a photo joins the book of a photo taken at most `sameBookMinutes` before it
 * whose title reads alike, or that is the same page shot again (`sameShotDistance`) when neither reading says
 * otherwise
 */
export const groupBooks = (photos: BookPhoto[], options: BookOptions = DEFAULT_BOOK_OPTIONS) => {
  const ordered = photos.toSorted((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const groups: BookPhoto[][] = [];
  const reshot = (a: BookPhoto, b: BookPhoto) =>
    a.embedding.length > 0 &&
    a.embedding.length === b.embedding.length &&
    Math.abs(a.time - b.time) <= options.sameShotMinutes * 60_000 &&
    cosineDistance(a.embedding, b.embedding) <= options.sameShotDistance;
  for (const photo of ordered) {
    const group = groups
      .filter((members) => photo.time - members.at(-1)!.time <= options.sameBookMinutes * 60_000)
      .find((members) =>
        members.some(
          (member) =>
            isSameBook(member.reading, photo.reading) ||
            (reshot(member, photo) && !conflicts(member.reading, photo.reading)),
        ),
      );
    if (group) {
      group.push(photo);
    } else {
      groups.push([photo]);
    }
  }
  return groups;
};

/** how much of a reading can be trusted, to choose the parts of a book from its readings */
const rank = (reading: BookReading) =>
  (reading.sure ? 2 : 0) + (reading.fraktur ? -1 : 0) + reading.confidence + (reading.author ? 0.2 : 0);

/** the book from the readings of its photos: each part from the surest reading that has it */
export const mergeReadings = (readings: BookReading[]): BookReading | undefined => {
  const named = readings.filter((reading) => reading.title || reading.author);
  if (named.length <= 1) {
    return named[0];
  }
  const ranked = named.toSorted((a, b) => rank(b) - rank(a));
  const pick = <K extends 'title' | 'subtitle' | 'author' | 'year' | 'publisher' | 'place'>(key: K) =>
    ranked.find((reading) => reading[key])?.[key];
  const title = pick('title');
  const subtitle = pick('subtitle');
  const author = pick('author');
  const year = pick('year');
  const publisher = pick('publisher');
  const place = pick('place');
  // the title and the author from sure readings (the cover and the title page agree), or a reading sure of both
  const sure = ranked.some((reading) => reading.sure && reading.title === title && reading.author === author);
  return {
    ...(title && { title }),
    ...(subtitle && { subtitle }),
    ...(author && { author }),
    ...(year && { year }),
    ...(publisher && { publisher }),
    ...(place && { place }),
    confidence: Math.min(1, Math.max(...named.map((reading) => reading.confidence)) + 0.05 * (named.length - 1)),
    sure,
    fraktur: ranked[0].fraktur,
    openPage: false,
    words: [...new Set(named.flatMap((reading) => reading.words))],
    ...(ranked[0].box && { box: ranked[0].box }),
  };
};

/** how well a book matches a line of a reading list, 0..1: the share of the line's title words read on the book */
export const scoreListEntry = (reading: BookReading, entry: Pick<AssignEntry, 'name'>) => {
  const [title] = entry.name.split(/\s+—\s+/, 1);
  const wanted = getTitleWords(title);
  if (wanted.length === 0) {
    return 0;
  }
  const found = wanted.filter((word) => reading.words.some((other) => isSameWord(word, other))).length;
  return round(found / wanted.length);
};

type Book = { photos: BookPhoto[]; reading?: BookReading };

/**
 * Names the books of a reading period (`match.assign` of the reading pack): the photos are grouped by book, and each
 * book gets the line of the reading list its title matches (`entries`), or an entry of its own made from its
 * readings, added after them. A book whose pages could not be read (an open page, a spine in the dark) gets no name:
 * the assistant reads it. A name is sure only when a reading of the book was sure of both its title and its author.
 */
export const assignBooks = (
  photos: AssignPhoto[],
  entries: AssignEntry[],
  options: AssignOptions,
  bookOptions: BookOptions = DEFAULT_BOOK_OPTIONS,
): AssignResult => {
  const read: BookPhoto[] = photos.map((photo) => {
    const reading = photo.ocr ? readBookPage(photo.ocr) : undefined;
    return reading ? { ...photo, reading } : photo;
  });
  const books: Book[] = groupBooks(read, bookOptions).map((members) => ({
    photos: members,
    reading: mergeReadings(members.flatMap(({ reading }) => (reading && !reading.openPage ? [reading] : []))),
  }));

  const added: Array<{ name: string; description?: string; sourceId?: string }> = [];
  const matches: SubjectMatch[] = books.map((book) => {
    const ids = book.photos.map(({ id }) => id);
    const { reading } = book;
    if (!reading) {
      return { ids, score: 0, unsure: true, suggestions: [] };
    }
    if (entries.length > 0) {
      const scores = entries.map((entry) => scoreListEntry(reading, entry));
      const best = scores.indexOf(Math.max(...scores));
      if (scores[best] >= bookOptions.minListScore) {
        const suggestions: MatchSuggestion[] = scores
          .map((score, item) => ({ item, score, similarity: 0 }))
          .toSorted((a, b) => b.score - a.score)
          .slice(0, options.suggestions);
        const runnerUp = suggestions[1]?.score ?? 0;
        return { ids, item: best, score: scores[best], unsure: scores[best] < 0.8 || runnerUp >= 0.5, suggestions };
      }
    }
    const name = formatBookName(reading);
    if (!name) {
      return { ids, score: 0, unsure: true, suggestions: [] };
    }
    let index = added.findIndex((entry) => entry.name === name);
    if (index === -1) {
      const description = formatBookDetails(reading);
      const source = book.photos.find((photo) => photo.reading && formatBookName(photo.reading)) ?? book.photos[0];
      added.push({ name, ...(description && { description }), sourceId: source.id });
      index = added.length - 1;
    }
    const item = entries.length + index;
    const score = round(reading.confidence);
    return { ids, item, score, unsure: !reading.sure, suggestions: [{ item, score, similarity: 0 }] };
  });

  const counts = new Map<number, number>();
  for (const { item } of matches) {
    if (item !== undefined) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  return {
    matches: matches.map((match) =>
      match.item !== undefined && counts.get(match.item)! > 1 ? { ...match, shared: true } : match,
    ),
    ordered: false,
    ...(added.length > 0 && { entries: added }),
  };
};
