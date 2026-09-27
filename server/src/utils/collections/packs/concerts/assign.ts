import { cosineDistance } from 'src/utils/agent/clustering.js';
import { haversineKm } from 'src/utils/agent/events.js';
import { softmax } from 'src/utils/collections/classify.js';
import {
  AssignEntry,
  AssignPhoto,
  MatchSuggestion,
  SubjectAssigner,
  SubjectMatch,
  alignCourses,
  matchSubjects,
} from 'src/utils/collections/match.js';
import { WEEKDAYS, isUnnamedSetlist } from 'src/utils/collections/packs/concerts/lineup.js';

/*
 * Matching the stage photos of a gig with its acts, mostly by time. A line-up or a board of stage times gives each
 * act its start, and its set lasts until the next act of its stage (at most `setMinutes`): a photo taken then is of
 * one of the acts on stage at that moment, the one of the stage its photo reads ("SEAT" on a banner), or whose stage
 * looks like it (the photos of an act of the same stage). At a festival the acts of the stages no source lists are
 * on stage too: the more stages, the likelier a photo is of an act on no source. A setlist gives no times, only when
 * it was photographed (right before, during or after the set) and the order of the bill ("SIDNEY GISH w/ THE BETHS"):
 * the photos of a club gig are aligned with the acts in that order, each photo near the setlist of its act.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type ConcertMatchOptions = {
  /** a set lasts at most this long, when the next act of its stage is not known */
  setMinutes: number;
  /** a photo up to this long before the start of an act is of its set (the band walking on) */
  earlyMinutes: number;
  /** photos this close in time are of one set, whatever they show... */
  sameSetMinutes: number;
  /** ...and photos this close that look this alike (cosine similarity) */
  lookalikeMinutes: number;
  lookalike: number;
  /** a setlist is photographed up to this long before its set starts, or after it began */
  setlistBeforeMinutes: number;
  setlistAfterMinutes: number;
  /** the log-probability cost of each hour between a photo and the setlist of its act */
  setlistHourCost: number;
  /** the log probability of a photo of a club gig being of an act on no setlist */
  clubOffList: number;
  /** the weight of how much more a photo looks like the other photos of a stage than like the rest */
  stageLook: number;
  /** the log-probability bonus of an act whose stage the photo reads, and the cost of the other stages */
  stageText: number;
  otherStageText: number;
  /**
   * a photo taken this close (in meters) to where the photos of a stage were taken is at that stage (a bonus of
   * `nearStage`), and one this far away is not (a cost of `farStage`), in between in proportion
   */
  nearMeters: number;
  farMeters: number;
  nearStage: number;
  farStage: number;
};

export const CONCERT_MATCH_OPTIONS: ConcertMatchOptions = {
  setMinutes: 75,
  earlyMinutes: 10,
  sameSetMinutes: 3,
  lookalikeMinutes: 10,
  lookalike: 0.86,
  setlistBeforeMinutes: 120,
  setlistAfterMinutes: 60,
  setlistHourCost: 1,
  clubOffList: -2.5,
  stageLook: 25,
  stageText: 2,
  otherStageText: 4,
  nearMeters: 100,
  farMeters: 250,
  nearStage: 1,
  farStage: 3,
};

/** a match at or above this probability, ahead of the runner-up by `MARGIN`, is sure */
const SURE = 0.6;
const MARGIN = 0.2;

export type ConcertAct = {
  /** the index of its entry */
  index: number;
  name: string;
  /** local ms of the start of its set, read on a line-up */
  start?: number;
  end?: number;
  stage?: string;
  /** local ms of the photo of its setlist */
  setlist?: number;
  /** the act of the setlist it is billed on ("with Sidney Gish") */
  billedWith?: string;
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

const TIMED = new RegExp(String.raw`^(?:(${WEEKDAYS.join('|')})\s+)?(\d{2}):(\d{2})(?:\s+·\s+(.+))?$`);

const stageKey = (stage: string) => stage.toLowerCase().replaceAll(/[^\p{L}\d]/gu, '');

/** the start of an act read at `time` on the day of `base` (local ms), or on the day of its week nearest to it */
export const getStart = (base: number, time: string, weekday?: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  let day = Math.floor(base / DAY) * DAY;
  if (weekday) {
    const wanted = WEEKDAYS.indexOf(weekday);
    const offset = [0, -1, 1, -2, 2, -3, 3].find((days) => new Date(day + days * DAY).getUTCDay() === wanted) ?? 0;
    day += offset * DAY;
  }
  // a night runs past midnight: "00:00" under Saturday, or on a board photographed in the evening, is the next day
  const evening = weekday !== undefined || new Date(base).getUTCHours() >= 12;
  return day + (hours < 6 && evening ? DAY : 0) + hours * 60 * MINUTE + minutes * MINUTE;
};

/**
 * The acts of the entries, from their descriptions (see `describeAct`): the start and the stage of an act of a
 * line-up, when its setlist was photographed, or the act it is billed with. A setlist that names no act is the set
 * of the act billed on an earlier setlist without one of its own ("SIDNEY GISH w/ THE BETHS", then the Beths'
 * setlist of songs only).
 */
export const readActs = (entries: AssignEntry[], fallbackTime: number, options = CONCERT_MATCH_OPTIONS) => {
  const acts: ConcertAct[] = entries.map((entry, index) => {
    const base = entry.sourceTime ?? fallbackTime;
    const timed = TIMED.exec(entry.description ?? '');
    if (timed) {
      return {
        index,
        name: entry.name,
        start: getStart(base, `${timed[2]}:${timed[3]}`, timed[1]),
        ...(timed[4] && { stage: timed[4] }),
      };
    }
    const billed = /^with (.+)$/.exec(entry.description ?? '')?.[1];
    if (billed) {
      return { index, name: entry.name, billedWith: billed };
    }
    return { index, name: entry.name, ...(entry.sourceTime !== undefined && { setlist: entry.sourceTime }) };
  });

  // a set lasts until the next act of its stage
  for (const act of acts) {
    if (act.start === undefined) {
      continue;
    }
    const next = acts
      .filter(
        (other) =>
          other.start !== undefined &&
          other.start > act.start! &&
          !!act.stage &&
          !!other.stage &&
          stageKey(other.stage) === stageKey(act.stage),
      )
      .map((other) => other.start!);
    act.end = Math.min(...next, act.start + options.setMinutes * MINUTE);
  }

  // the setlists of no act go to the acts billed without one, in order
  const unnamed = acts.filter((act) => isUnnamedSetlist(act.name) && act.setlist !== undefined);
  const taken = new Set<ConcertAct>();
  for (const setlist of unnamed.toSorted((a, b) => a.setlist! - b.setlist!)) {
    const billed = acts.find((act) => {
      const host = acts.find((other) => other.name === act.billedWith);
      return (
        act.billedWith &&
        act.setlist === undefined &&
        host?.setlist !== undefined &&
        host.setlist < setlist.setlist! &&
        !taken.has(act)
      );
    });
    if (!billed) {
      continue;
    }

    billed.setlist = setlist.setlist;
    taken.add(setlist);
  }
  return { acts, attributed: taken };
};

type Point = { latitude: number; longitude: number };

type Group = { members: AssignPhoto[]; times: number[]; embedding?: Float32Array; text: string; location?: Point };

const getCentroid = (points: Point[]): Point | undefined =>
  points.length === 0
    ? undefined
    : {
        latitude: mean(points.map((point) => point.latitude)),
        longitude: mean(points.map((point) => point.longitude)),
      };

const normalizeVector = (vectors: Float32Array[]) => {
  const sum = new Float32Array(vectors[0].length);
  for (const vector of vectors) {
    for (const [index, value] of vector.entries()) {
      sum[index] += value;
    }
  }
  const norm = Math.hypot(...sum);
  return norm > 0 ? sum.map((value) => value / norm) : sum;
};

const similarity = (a: Float32Array, b: Float32Array) => 1 - cosineDistance(a, b);

/** the photos of one set: taken minutes apart, or a little further apart when they look alike */
export const groupSetPhotos = (photos: AssignPhoto[], options = CONCERT_MATCH_OPTIONS): Group[] => {
  const sorted = photos.toSorted((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const groups: AssignPhoto[][] = [];
  for (const photo of sorted) {
    const previous = groups.at(-1)?.at(-1);
    const minutes = previous ? (photo.time - previous.time) / MINUTE : Infinity;
    const alike =
      !!previous &&
      previous.embedding.length > 0 &&
      photo.embedding.length > 0 &&
      similarity(previous.embedding, photo.embedding) >= options.lookalike;
    if (minutes <= options.sameSetMinutes || (alike && minutes <= options.lookalikeMinutes)) {
      groups.at(-1)!.push(photo);
    } else {
      groups.push([photo]);
    }
  }
  return groups.map((members) => {
    const embeddings = members.filter((member) => member.embedding.length > 0).map((member) => member.embedding);
    const location = getCentroid(
      members.flatMap(({ latitude, longitude }) =>
        latitude === undefined || longitude === undefined ? [] : [{ latitude, longitude }],
      ),
    );
    return {
      members,
      times: members.map((member) => member.time),
      ...(embeddings.length > 0 && { embedding: normalizeVector(embeddings) }),
      text: members.map((member) => member.text ?? '').join('\n'),
      ...(location && { location }),
    };
  });
};

/** the log-probability cost of a photo at `time` for an act on stage from `start` to `end` */
const getTimeScore = (time: number, start: number, end: number, options: ConcertMatchOptions) => {
  if (time < start - options.earlyMinutes * MINUTE) {
    return -Math.min(12, (start - options.earlyMinutes * MINUTE - time) / (5 * MINUTE));
  }
  return time <= end ? 0 : -Math.min(12, (time - end) / (10 * MINUTE));
};

/** the log-probability cost of a photo at `time` for the act whose setlist was photographed at `setlist` */
const getSetlistScore = (time: number, setlist: number, options: ConcertMatchOptions) => {
  const from = setlist - options.setlistAfterMinutes * MINUTE;
  const to = setlist + options.setlistBeforeMinutes * MINUTE;
  const hours = Math.abs(time - setlist) / (60 * MINUTE);
  if (time >= from && time <= to) {
    return -options.setlistHourCost * hours;
  }
  const outside = time < from ? from - time : time - to;
  return -options.setlistHourCost * hours - 1 - Math.min(12, outside / (5 * MINUTE));
};

/** the stages of the acts whose names the text of the photos reads, e.g. "SEAT" on the banner of a stage */
const readStages = (text: string, stages: string[]) => {
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\d&]+/u)
      .map((word) => stageKey(word)),
  );
  const compact = stageKey(text);
  return new Set(
    stages.filter((stage) => {
      const key = stageKey(stage);
      return key.length >= 3 && (key.length <= 5 ? words.has(key) : compact.includes(key));
    }),
  );
};

const toMatch = (
  group: Group,
  probabilities: number[],
  offList: number,
  acts: ConcertAct[],
  suggestions: number,
): SubjectMatch => {
  const ranked = acts
    .map((act, position) => ({ item: act.index, score: probabilities[position] }))
    .toSorted((a, b) => b.score - a.score);
  const best = ranked[0];
  const matched = !!best && best.score > offList && best.score >= 0.05;
  const runnerUp = Math.max(offList, ranked[1]?.score ?? 0);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const sure = matched && best.score >= SURE && best.score - runnerUp >= MARGIN;
  return {
    ids: group.members.map(({ id }) => id),
    ...(matched && { item: best.item }),
    score: round(matched ? best.score : 0),
    unsure: !sure,
    offList: round(offList),
    suggestions: ranked
      .slice(0, suggestions)
      .map(({ item, score }): MatchSuggestion => ({ item, score: round(score), similarity: 0 })),
  };
};

/**
 * A festival (acts with a start): each set of photos over the acts on stage at its time, and the acts of the stages
 * no source lists (off the list)
 */
const matchFestival = (groups: Group[], acts: ConcertAct[], options: ConcertMatchOptions, suggestions: number) => {
  const stages = [...new Set(acts.flatMap((act) => (act.stage ? [act.stage] : [])))];
  const scores = groups.map((group) =>
    acts.map((act) => {
      if (act.start !== undefined) {
        return mean(group.times.map((time) => getTimeScore(time, act.start!, act.end!, options)));
      }
      if (act.setlist !== undefined) {
        return mean(group.times.map((time) => getSetlistScore(time, act.setlist!, options)));
      }
      return -12;
    }),
  );

  // the stage a set reads on its photos
  const read = groups.map((group) => readStages(group.text, stages));
  // the looks and places of the stages: the sets of one act only, or that read the name of its stage
  const looks = new Map<string, number[]>();
  for (const index of groups.keys()) {
    const candidates = acts.filter((_, position) => scores[index][position] > -1);
    const stage =
      candidates.length === 1 ? candidates[0].stage : read[index].size === 1 ? [...read[index]][0] : undefined;
    if (stage) {
      looks.set(stageKey(stage), [...(looks.get(stageKey(stage)) ?? []), index]);
    }
  }
  const cache = new Map<string, number>();
  const getStageScore = (index: number, stage: string) => {
    const key = `${index}\n${stage}`;
    if (!cache.has(key)) {
      cache.set(key, scoreStage(index, stage));
    }
    return cache.get(key)!;
  };
  const scoreStage = (index: number, stage: string) => {
    const group = groups[index];
    const anchors = (looks.get(stage) ?? []).filter((other) => other !== index);
    let score = 0;
    const alike = anchors.filter((other) => groups[other].embedding);
    if (alike.length > 0 && group.embedding) {
      const others = groups.filter((other, position) => position !== index && other.embedding);
      const best = Math.max(...alike.map((other) => similarity(group.embedding!, groups[other].embedding!)));
      const usual = mean(others.map((other) => similarity(group.embedding!, other.embedding!)));
      score += options.stageLook * (best - usual);
    }
    const place = getCentroid(anchors.flatMap((other) => (groups[other].location ? [groups[other].location!] : [])));
    if (place && group.location) {
      const meters = haversineKm(place, group.location) * 1000;
      const share = Math.min(1, Math.max(0, (meters - options.nearMeters) / (options.farMeters - options.nearMeters)));
      score += options.nearStage - share * (options.nearStage + options.farStage);
    }
    return score;
  };

  return groups.map((group, index) => {
    const logits = acts.map((act, position) => {
      let score = scores[index][position];
      const stage = act.stage ? stageKey(act.stage) : undefined;
      if (stage && read[index].size > 0) {
        score += [...read[index]].some((other) => stageKey(other) === stage)
          ? options.stageText
          : -options.otherStageText;
      }
      return stage ? score + getStageScore(index, stage) : score;
    });
    // the stages whose act at that time no source names
    const onStage = new Set(
      acts.flatMap((act, position) => (scores[index][position] > -1 && act.stage ? [stageKey(act.stage)] : [])),
    );
    const day = acts.filter(
      (act) => act.start !== undefined && Math.abs(act.start - group.times[0]) <= 12 * 60 * MINUTE && act.stage,
    );
    const known = new Set(day.map((act) => stageKey(act.stage!)));
    const others = [...known].filter((stage) => !onStage.has(stage)).length;
    const off = Math.log(others + 0.2);
    const probabilities = softmax([...logits, off], 1);
    return toMatch(group, probabilities.slice(0, -1), probabilities.at(-1)!, acts, suggestions);
  });
};

/**
 * A club gig (setlists only): the sets of photos aligned in time with the acts in the order of their setlists, each
 * near the setlist of its act
 */
const matchClub = (groups: Group[], acts: ConcertAct[], options: ConcertMatchOptions, suggestions: number) => {
  const ordered = acts.filter((act) => act.setlist !== undefined).toSorted((a, b) => a.setlist! - b.setlist!);
  const logs = groups.map((group) => [
    ...acts.map((act) =>
      act.setlist === undefined ? -12 : mean(group.times.map((time) => getSetlistScore(time, act.setlist!, options))),
    ),
    options.clubOffList,
  ]);
  const courses = ordered.map((act) => acts.indexOf(act));
  const alignment = alignCourses(logs, courses, [], {
    sharePenalty: 0,
    skipPenalty: 0,
    asidePenalty: 0,
    pacePenalty: 0,
    paceTolerance: 0,
    offPenalty: 0,
  });
  return groups.map((group, index) =>
    toMatch(group, alignment.marginals[index], alignment.offMarginals[index], acts, suggestions),
  );
};

/**
 * The concerts pack's assignment of the stage photos to the acts: by time, with the stage their photos read and look
 * like, at a festival; in the order of the setlists at a club gig. Entries without times or setlists (passed by the
 * assistant) are matched by what CLIP sees.
 */
export const assignConcertPhotos: SubjectAssigner = (photos, entries, options) => {
  if (photos.length === 0) {
    return { matches: [], ordered: false };
  }
  const first = Math.min(...photos.map((photo) => photo.time));
  const { acts, attributed } = readActs(entries, first);
  // the setlists of no act that went to an act of the bill are matched through it
  const playing = acts.filter((act) => !attributed.has(act));
  const groups = groupSetPhotos(photos);
  if (playing.some((act) => act.start !== undefined)) {
    return { matches: matchFestival(groups, playing, CONCERT_MATCH_OPTIONS, options.suggestions), ordered: false };
  }
  if (playing.some((act) => act.setlist !== undefined)) {
    return { matches: matchClub(groups, playing, CONCERT_MATCH_OPTIONS, options.suggestions), ordered: true };
  }
  const seen = photos.filter((photo) => photo.embedding.length > 0);
  const candidates = entries.every((entry) => entry.embedding)
    ? entries.map(({ embedding }) => ({ embedding: embedding! }))
    : [];
  const result = matchSubjects(seen, candidates, { ...options, order: 'none' });
  const unseen: SubjectMatch[] = photos
    .filter((photo) => photo.embedding.length === 0)
    .map((photo) => ({ ids: [photo.id], score: 0, unsure: true, suggestions: [] }));
  return { ...result, matches: [...result.matches, ...unseen] };
};
