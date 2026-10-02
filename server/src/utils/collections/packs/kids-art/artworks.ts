import { cosineDistance } from 'src/utils/agent/clustering.js';
import { AssignEntry, AssignOptions, AssignPhoto, AssignResult, SubjectMatch } from 'src/utils/collections/match.js';
import { ArtworkReading, formatArtworkName, readArtwork } from 'src/utils/collections/packs/kids-art/artwork.js';

/*
 * Naming the artworks of a child's year. Each photo is an artwork, or a page of one: the pages of an illustrated
 * letter are photographed (or scanned) one after the other, and the text of a later page runs on from the one before
 * it. A photo of the same drawing shot again is the same artwork. An artwork is named after the greeting written on
 * it ("Buon Natale (1947)"), or left unnamed for the assistant, who sees what it shows: children's writing is read in
 * fragments, and Cyrillic or Japanese not at all.
 */

export type ArtworkOptions = {
  /** the pages of one artwork are photographed within this many minutes of each other */
  samePagesMinutes: number;
  /** photos this alike (CLIP cosine distance) within `sameShotMinutes` are the same artwork shot again */
  sameShotDistance: number;
  sameShotMinutes: number;
};

/** calibrated on real artworks, see `benchmark.spec.ts` */
export const DEFAULT_ARTWORK_OPTIONS: ArtworkOptions = {
  samePagesMinutes: 10,
  sameShotDistance: 0.04,
  sameShotMinutes: 5,
};

export type ArtworkPhoto = AssignPhoto & { reading?: ArtworkReading };

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The photos of each artwork, in time order: a page whose text runs on from the page photographed just before it
 * (both with lines of writing), or the same artwork shot again
 */
export const groupArtworks = (photos: ArtworkPhoto[], options: ArtworkOptions = DEFAULT_ARTWORK_OPTIONS) => {
  const ordered = photos.toSorted((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const groups: ArtworkPhoto[][] = [];
  for (const photo of ordered) {
    const last = groups.at(-1);
    const previous = last?.at(-1);
    const nextPage =
      !!previous &&
      photo.time - previous.time <= options.samePagesMinutes * 60_000 &&
      !!photo.reading?.continues &&
      (previous.reading?.lines ?? 0) >= 3;
    const reshot = groups.find((members) =>
      members.some(
        (member) =>
          member.embedding.length > 0 &&
          member.embedding.length === photo.embedding.length &&
          Math.abs(photo.time - member.time) <= options.sameShotMinutes * 60_000 &&
          cosineDistance(member.embedding, photo.embedding) <= options.sameShotDistance,
      ),
    );
    if (nextPage && last) {
      last.push(photo);
    } else if (reshot) {
      reshot.push(photo);
    } else {
      groups.push([photo]);
    }
  }
  return groups;
};

/** the reading of an artwork from the readings of its pages: the title, age and year of any of them */
export const mergeArtworkReadings = (readings: ArtworkReading[]): ArtworkReading | undefined => {
  if (readings.length <= 1) {
    return readings[0];
  }
  const titled = readings.filter((reading) => reading.title).toSorted((a, b) => Number(b.sure) - Number(a.sure));
  const title = titled[0]?.title;
  const age = readings.find((reading) => reading.age)?.age;
  const year = readings.find((reading) => reading.year)?.year;
  return {
    ...(title && { title }),
    ...(age && { age }),
    ...(year && { year }),
    lines: readings.reduce((sum, reading) => sum + reading.lines, 0),
    continues: readings[0].continues,
    sure: titled[0]?.sure ?? false,
    ...(readings.find((reading) => reading.box) && { box: readings.find((reading) => reading.box)!.box }),
  };
};

/**
 * Names the artworks of a visit (`match.assign` of the kids' art pack): the photos are grouped by artwork, and each
 * one gets the entry the user or the assistant passed whose title it matches, or an entry of its own made from what
 * is written on it, added after them; the rest are left unnamed, for the assistant to name from what it sees. A name
 * is sure only when the greeting was read letter for letter.
 */
export const assignArtworks = (
  photos: AssignPhoto[],
  entries: AssignEntry[],
  options: AssignOptions,
  artworkOptions: ArtworkOptions = DEFAULT_ARTWORK_OPTIONS,
): AssignResult => {
  const read: ArtworkPhoto[] = photos.map((photo) => {
    const reading = photo.ocr ? readArtwork(photo.ocr) : undefined;
    return reading ? { ...photo, reading } : photo;
  });
  const added: Array<{ name: string; sourceId?: string }> = [];
  const matches: SubjectMatch[] = groupArtworks(read, artworkOptions).map((members) => {
    const ids = members.map(({ id }) => id);
    const reading = mergeArtworkReadings(members.flatMap(({ reading }) => (reading ? [reading] : [])));
    const name = reading ? formatArtworkName(reading) : undefined;
    if (!reading || !name) {
      return { ids, score: 0, unsure: true, suggestions: [] };
    }
    const given = entries.findIndex((entry) => entry.name.toLowerCase().startsWith(reading.title!.toLowerCase()));
    if (given !== -1) {
      return { ids, item: given, score: 0.8, unsure: true, suggestions: [{ item: given, score: 0.8, similarity: 0 }] };
    }
    let index = added.findIndex((entry) => entry.name === name);
    if (index === -1) {
      added.push({ name, sourceId: (members.find((member) => member.reading?.title) ?? members[0]).id });
      index = added.length - 1;
    }
    const item = entries.length + index;
    const score = round(reading.sure ? 0.9 : 0.5);
    return { ids, item, score, unsure: !reading.sure, suggestions: [{ item, score, similarity: 0 }] };
  });
  return { matches, ordered: false, ...(added.length > 0 && { entries: added }) };
};
