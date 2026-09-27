import { softmax } from 'src/utils/collections/classify.js';
import { AssignEntry, AssignPhoto, MatchResult, SubjectAssigner, SubjectMatch } from 'src/utils/collections/match.js';
import {
  DAY_MS,
  TravelDate,
  TravelTime,
  findDates,
  findTimes,
  getNearestYear,
  toLocalTime,
} from 'src/utils/collections/packs/travel/dates.js';
import { stripAccents } from 'src/utils/collections/text.js';

/*
 * Assigning the photos of a trip to its legs, mostly by time: a leg starts a little before its departure (the wait at
 * the station or the airport) and lasts until the next leg starts, or until the end of its day; the photos between two
 * legs belong to the destination of the earlier one. A leg whose document only has a date (an entry ticket, a time
 * that may have been changed by hand) covers its day where no timed leg does; one without a date takes the day its
 * document was photographed. Days without documents stay unassigned. Within that, the text read on a photo (a
 * ferry's name on its hull, a village's name on a sign) and what CLIP sees (a boarding gate, a gorge) move a photo
 * to the leg it shows.
 */

export type LegWhen = {
  /** local time in ms of the start of the leg (its departure, boarding or the purchase of the ticket) */
  time?: number;
  /** local midnight in ms of its day, when only the date is known */
  day?: number;
  /** the time is not certain: another one is written on the document */
  uncertain?: boolean;
  kind?: 'departure' | 'boarding' | 'purchase';
  /** the date comes from when the document was photographed, not from the document */
  fromPhoto?: boolean;
};

export type TravelAssignOptions = {
  /** photos taken this long before a departure belong to the leg (the station, the airport), in minutes */
  leadMinutes: number;
  /** more for a boarding time, which is already close to the departure */
  boardingLeadMinutes: number;
  /** a day ends at this hour of the next morning: a late evening belongs to the leg of the day */
  dayEndHour: number;
  /** the log-score of a photo that no leg covers */
  noneScore: number;
  /** the log-score of a photo in the day of a leg that only has a date */
  dayScore: number;
  /** the log-score of a leg that could not be dated at all */
  undatedScore: number;
  /** the cost of each hour a photo is taken before the window of a leg, on the same day */
  earlyPerHour: number;
  /** a word read on a photo that is a word of the leg (a place, a ship, an operator) */
  wordScore: number;
  /** a word of the mode of the leg read on a photo (FERRIES, BUS, AIRPORT) */
  modeWordScore: number;
  /** the weight of CLIP: the similarity of a photo with a leg, less its average over the legs */
  clipWeight: number;
  /** the cost of assigning photos taken within `runMinutes` of each other to different legs */
  switchCost: number;
  runMinutes: number;
  /** a match below this probability is unsure */
  sureScore: number;
};

/** calibrated on two real trips, see `benchmark.spec.ts` */
export const DEFAULT_TRAVEL_ASSIGN_OPTIONS: TravelAssignOptions = {
  leadMinutes: 90,
  boardingLeadMinutes: 60,
  dayEndHour: 4,
  noneScore: -1.2,
  dayScore: -0.4,
  undatedScore: -2,
  earlyPerHour: 2,
  wordScore: 1.5,
  modeWordScore: 0.6,
  clipWeight: 25,
  switchCost: 0.6,
  runMinutes: 30,
  sureScore: 0.6,
};

const HOUR_MS = 60 * 60 * 1000;

const startOfDay = (time: number) => Math.floor(time / DAY_MS) * DAY_MS;

/**
 * When a leg starts, from its name and description ("Bus Chania → Sougia, 4 Oct 2016" and "KTEL · departs 05:00"),
 * as the travel parser writes them or the assistant passes them; a date without a year takes the year nearest `near`
 * (the photos of the trip), a leg without a date the day its document was photographed.
 */
export const readLegWhen = (entry: Pick<AssignEntry, 'name' | 'description' | 'sourceTime'>, near: number): LegWhen => {
  const text = [entry.name, entry.description].filter(Boolean).join(' · ');
  const [found] = findDates(text);
  let date: Required<TravelDate> | undefined;
  let fromPhoto = false;
  if (found) {
    date = { year: found.year ?? getNearestYear(found, near), month: found.month, day: found.day };
  } else if (entry.sourceTime !== undefined) {
    const day = new Date(entry.sourceTime);
    date = { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() };
    fromPhoto = true;
  }
  if (!date) {
    return {};
  }
  const labeled = /(departs|boarding|bought)\s+(\d{1,2}:\d{2})(\?)?/i.exec(text);
  const time: TravelTime | undefined = labeled ? findTimes(labeled[2])[0] : findTimes(text)[0];
  const uncertain = labeled?.[3] === '?';
  const kind = labeled
    ? ({ departs: 'departure', boarding: 'boarding', bought: 'purchase' } as const)[
        labeled[1].toLowerCase() as 'departs' | 'boarding' | 'bought'
      ]
    : undefined;
  const day = toLocalTime(date);
  // a time read on the document goes with its printed date only, not with the day it was photographed
  if (!time || uncertain || fromPhoto) {
    return { day, ...(uncertain && { uncertain }), ...(fromPhoto && { fromPhoto }), ...(kind && { kind }) };
  }
  return { time: toLocalTime(date, time), day, ...(kind && { kind }) };
};

const MODE_WORDS: Array<[RegExp, RegExp]> = [
  [/^(?:flight|flug|vol)\b/i, /airport|airline|\bair\b|gate|terminal|departures|arrivals|空港|機場|机场|航空/i],
  [/^(?:ferry|boat)\b/i, /ferr(?:y|ies)|\bport\b|harbou?r|\bpier\b|\bquay\b|lines|港|フェリー|渡輪|λιμαν/i],
  [/^bus\b/i, /\bbus\b|ktel|ktea|κτελ|coach|バス|巴士|公車/i],
  [/^(?:train|rail)\b/i, /station|\brail|train|platform|駅|站|車站/i],
  [/^(?:monorail|metro|tram)\b/i, /monorail|station|モノレール|駅|站|metro/i],
];

const normalize = (text: string) =>
  stripAccents(text)
    .toLowerCase()
    .replaceAll(/[^\p{L}\d]+/gu, ' ')
    .trim();

/** words that tell the legs of a trip apart */
const COMMON = new Set([
  'bus',
  'flight',
  'ferry',
  'train',
  'monorail',
  'metro',
  'tram',
  'entry',
  'ticket',
  'national',
  'park',
  'museum',
  'departs',
  'boarding',
  'bought',
  'arrives',
  'vessel',
  'seat',
  'gate',
  'platform',
  'economy',
  'business',
  'class',
  'receipt',
  'also',
  'written',
  'from',
]);

/** the words of a leg worth finding on a photo: places, ships, operators, venues (5 letters or more, or CJK) */
const getLegWords = (entry: Pick<AssignEntry, 'name' | 'description'>) =>
  new Set(
    normalize([entry.name, entry.description].filter(Boolean).join(' '))
      .split(' ')
      .filter(
        (word) =>
          !COMMON.has(word) &&
          !/\d/.test(word) &&
          (word.length >= 5 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/u.test(word)),
      ),
  );

/** how many words of a leg a photo shows: the same word, or one OCR read with a letter off, or a longer run */
const countWords = (legWords: Set<string>, photoText: string) => {
  const text = normalize(photoText);
  if (!text) {
    return 0;
  }
  const compact = text.replaceAll(' ', '');
  const words = text.split(' ');
  let count = 0;
  for (const word of legWords) {
    const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word);
    if (cjk ? compact.includes(word) : compact.includes(word) || words.some((other) => isNear(other, word))) {
      count++;
    }
  }
  return count;
};

/** "sougia" and "soutia", "sfakion" and "sfakia": a letter off, or the same first five letters */
const isNear = (a: string, b: string) => {
  if (Math.min(a.length, b.length) < 5) {
    return false;
  }
  if (a.slice(0, 5) === b.slice(0, 5)) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  let different = 0;
  for (let index = 0; index < a.length; index++) {
    different += Number(a[index] !== b[index]);
  }
  return different <= 1;
};

const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);

const round = (value: number) => Math.round(value * 1000) / 1000;

type Leg = { index: number; when: LegWhen; start?: number; end?: number; words: Set<string>; mode?: RegExp };

/**
 * The windows of the legs: a timed leg from its start (less the lead) to the start of the next one or the end of its
 * day, whichever comes first
 */
const getWindows = (legs: Leg[], options: TravelAssignOptions) => {
  const timed = legs.filter(({ when }) => when.time !== undefined).toSorted((a, b) => a.when.time! - b.when.time!);
  for (const [position, leg] of timed.entries()) {
    const lead = (leg.when.kind === 'boarding' ? options.boardingLeadMinutes : options.leadMinutes) * 60_000;
    leg.start = leg.when.time! - lead;
    const next = timed[position + 1];
    const dayEnd = startOfDay(leg.when.time! - options.dayEndHour * HOUR_MS) + DAY_MS + options.dayEndHour * HOUR_MS;
    const nextLead = next
      ? (next.when.kind === 'boarding' ? options.boardingLeadMinutes : options.leadMinutes) * 60_000
      : 0;
    leg.end = Math.min(next ? next.when.time! - nextLead : Infinity, dayEnd);
  }
};

/** the day of a photo, which ends at `dayEndHour` the next morning */
const dayOf = (time: number, options: TravelAssignOptions) => startOfDay(time - options.dayEndHour * HOUR_MS);

/**
 * The time-based assignment of the travel pack (see the top of this file): each photo gets the log-score of each leg
 * (its time window, the words and the look it shares with the leg) and of no leg, runs of photos taken close together
 * stay on one leg (Viterbi), and the scores become probabilities (softmax). A photo no leg covers is off the list.
 */
export const assignByTime = (
  photos: AssignPhoto[],
  entries: AssignEntry[],
  options: { suggestions?: number; baselines?: Float32Array[] } = {},
  settings: TravelAssignOptions = DEFAULT_TRAVEL_ASSIGN_OPTIONS,
): MatchResult => {
  const ordered = photos.toSorted((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const near = ordered.length > 0 ? ordered[Math.floor(ordered.length / 2)].time : Date.now();
  const legs: Leg[] = entries.map((entry, index) => ({
    index,
    when: readLegWhen(entry, near),
    words: getLegWords(entry),
    mode: MODE_WORDS.find(([pattern]) => pattern.test(entry.name))?.[1],
  }));
  getWindows(legs, settings);

  // CLIP compares a photo with the legs it may belong to by time, and with the texts of trip photos in general (the
  // baselines) for no leg: each look is measured against their average
  const baselines = options.baselines ?? [];
  const clip = legs.every((leg) => entries[leg.index].embedding) && baselines.length > 0;
  const scores = ordered.map((photo) => {
    const photoDay = dayOf(photo.time, settings);
    const timeScores = legs.map((leg) => {
      if (leg.start !== undefined && leg.end !== undefined) {
        if (photo.time >= leg.start && photo.time < leg.end) {
          return 0;
        }
        return photo.time < leg.start && dayOf(leg.when.time!, settings) === photoDay
          ? -settings.earlyPerHour * ((leg.start - photo.time) / HOUR_MS)
          : -Infinity;
      }
      if (leg.when.day === undefined) {
        return settings.undatedScore;
      }
      return leg.when.day === photoDay ? settings.dayScore : -Infinity;
    });
    const looks = new Map<number, number>();
    if (clip && photo.embedding.length > 0) {
      const possible = legs.filter((_, position) => timeScores[position] > -Infinity);
      const values = [
        ...possible.map((leg) => dot(photo.embedding, entries[leg.index].embedding!)),
        Math.max(...baselines.map((baseline) => dot(photo.embedding, baseline))),
      ];
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      for (const [position, leg] of possible.entries()) {
        looks.set(leg.index, settings.clipWeight * (values[position] - mean));
      }
      looks.set(-1, settings.clipWeight * (values.at(-1)! - mean));
    }
    const row = legs.map((leg, position) => {
      const score = timeScores[position];
      if (score === -Infinity) {
        return score;
      }
      const words = photo.text ? countWords(leg.words, photo.text) : 0;
      const modeWord = photo.text && leg.mode?.test(photo.text) ? 1 : 0;
      return (
        score +
        settings.wordScore * Math.min(2, words) +
        settings.modeWordScore * modeWord +
        (looks.get(leg.index) ?? 0)
      );
    });
    return [...row, settings.noneScore + (looks.get(-1) ?? 0)];
  });

  // runs of photos taken close together stay on one leg
  const states = legs.length + 1;
  let best = scores[0] ? [...scores[0]] : [];
  const back: number[][] = [];
  for (let index = 1; index < ordered.length; index++) {
    const gap = ordered[index].time - ordered[index - 1].time;
    const cost = gap <= settings.runMinutes * 60_000 ? settings.switchCost : 0;
    const next: number[] = [];
    const from: number[] = [];
    for (let state = 0; state < states; state++) {
      let value = -Infinity;
      let origin = state;
      for (let previous = 0; previous < states; previous++) {
        const candidate = best[previous] - (previous === state ? 0 : cost);
        if (!(candidate > value)) {
          continue;
        }

        value = candidate;
        origin = previous;
      }
      next.push(value + scores[index][state]);
      from.push(origin);
    }
    best = next;
    back.push(from);
  }
  const path: number[] = [];
  if (ordered.length > 0) {
    let state = best.indexOf(Math.max(...best));
    path.unshift(state);
    for (let index = ordered.length - 2; index >= 0; index--) {
      state = back[index][state];
      path.unshift(state);
    }
  }

  const suggestions = options.suggestions ?? 3;
  const matches: SubjectMatch[] = ordered.map((photo, index) => {
    const probabilities = softmax(
      scores[index].map((value) => (Number.isFinite(value) ? value : -50)),
      1,
    );
    const state = path[index];
    const item = state < legs.length ? state : undefined;
    const score = item === undefined ? 0 : probabilities[item];
    const offList = probabilities.at(-1)!;
    const leg = item === undefined ? undefined : legs[item];
    // a photo in the window of a timed leg is sure when nothing else comes close; a day-only leg never is
    const sure = item !== undefined && score >= settings.sureScore && leg?.when.time !== undefined;
    return {
      ids: [photo.id],
      ...(item !== undefined && { item }),
      score: round(score),
      unsure: !sure,
      offList: round(offList),
      suggestions: legs
        .map((leg, position) => ({ item: leg.index, score: probabilities[position] }))
        .filter(({ score }) => score >= 0.01)
        .toSorted((a, b) => b.score - a.score)
        .slice(0, suggestions)
        .map(({ item, score }) => ({ item, score: round(score), similarity: 0 })),
    };
  });
  return { matches, ordered: false };
};

/** the travel pack's assignment of trip photos to legs, see `assignByTime` */
export const assignTravelPhotos: SubjectAssigner = (photos, entries, options) => assignByTime(photos, entries, options);
