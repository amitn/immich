import { cosineDistance } from 'src/utils/agent/clustering.js';
import { softmax } from 'src/utils/collections/classify.js';
import {
  AssignEntry,
  AssignOptions,
  AssignPhoto,
  AssignResult,
  MatchSuggestion,
  SubjectMatch,
  SubjectPhoto,
} from 'src/utils/collections/match.js';

/*
 * Following the plants of a garden over a season, or years. The photographers walk the garden, photograph a plant's
 * tag at its foot (or its seed packet), then the plant: the whole plant first, then its flowers or fruit up close.
 * The photos of a day are cut into plants at every tag, and at every photo of a whole plant that comes after a
 * close-up (the next tree, whose tag was not photographed that day); a plant is named by the tag it follows, and the
 * plants of a variety on every day are one plant over the years. CLIP tells a whole plant from a close-up and the
 * growth stage of a photo, but not one peach tree from another: a plant without a tag that day stays unnamed, for the
 * assistant to name, with the tagged plants CLIP finds most like it as suggestions.
 */

/**
 * the texts CLIP compares each plant photo with (`match.photoPrompts` of the garden pack): whole plants and close-ups,
 * and the growth stages they show; `WHOLE` and `STAGES` say which is which. CLIP tells blossoms, fruit, seedlings and
 * seeds from each other up close, not one stage of a whole tree from another (a tree in leaf with small fruit, or at
 * the end of the season): those get no stage
 */
export const PLANT_PROMPTS = [
  'a photo of a whole young tree standing in a garden',
  'a photo of a whole plant in a garden bed',
  'a close-up photo of blossoms on a branch',
  'a close-up photo of small green unripe fruit on a branch',
  'a close-up photo of ripe fruit on a branch',
  'a photo of a tree with many leaves and fruit',
  'a photo of a bare tree with no leaves',
  'a close-up photo of lettuce leaves',
  'a photo of tiny seedlings sprouting in small pots',
  'a photo of a vegetable plant bolting with a tall flower stalk',
  'a close-up photo of small flowers on a stalk',
  'a close-up photo of seeds',
  'a photo of harvested fruit and vegetables',
];

/** the prompts of whole plants (the rest are close-ups) */
const WHOLE = new Set([0, 1, 5, 6, 8, 9]);

/** the stage each prompt of `PLANT_PROMPTS` shows, if it shows one */
const STAGES: Array<string | undefined> = [
  undefined,
  undefined,
  'flowering',
  'fruit',
  'fruit',
  undefined,
  undefined,
  undefined,
  'seedlings',
  'bolting',
  'flowering',
  'seeds',
  'harvest',
];

export type PlantOptions = {
  /** a plant's photos follow its tag, and each other, within this many minutes */
  tagMinutes: number;
  /** a stage is told only when its prompts have at least this share of the probability */
  minStage: number;
};

/** calibrated on real gardens, see `benchmark.spec.ts` */
export const DEFAULT_PLANT_OPTIONS: PlantOptions = { tagMinutes: 2, minStage: 0.5 };

const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, value, index) => sum + value * b[index], 0);

/** whether a photo shows a whole plant, from its similarities with `PLANT_PROMPTS` */
export const isWholePlant = (similarities: number[]) => {
  const best = similarities.indexOf(Math.max(...similarities));
  return WHOLE.has(best);
};

/**
 * The growth stage of a photo from its similarities with `PLANT_PROMPTS`, e.g. "flowering", when CLIP can tell it:
 * the stage of the prompt the photo is most like, when the prompts of that stage have `minStage` of the probability
 * over all of them
 */
export const getGrowthStage = (similarities: number[], minStage = DEFAULT_PLANT_OPTIONS.minStage) => {
  if (similarities.length < STAGES.length) {
    return;
  }
  const probabilities = softmax(similarities.slice(0, STAGES.length));
  const best = probabilities.indexOf(Math.max(...probabilities));
  const stage = STAGES[best];
  if (!stage) {
    return;
  }
  // the prompts of one stage share the probability: "fruit" is unripe and ripe fruit
  const share = STAGES.reduce((sum, other, index) => sum + (other === stage ? probabilities[index] : 0), 0);
  return share >= minStage ? stage : undefined;
};

type Event = { kind: 'tag'; source: SubjectPhoto; name?: number } | { kind: 'plant'; photo: AssignPhoto };

type Segment = { name?: number; tag?: SubjectPhoto; photos: AssignPhoto[] };

const eventTime = (event: Event) => (event.kind === 'tag' ? event.source.time : event.photo.time);

/** the entry of each source photo: the one read on it, or the one given in its place in the order of the sources */
const getTagNames = (sources: SubjectPhoto[], entries: AssignEntry[]) => {
  const names = new Map<string, number>();
  const read = entries.some((entry) => entry.sourceId);
  for (const [index, source] of sources.entries()) {
    const entry = read ? entries.findIndex((item) => item.sourceId === source.id) : index;
    if (entry !== -1 && entry < entries.length && (read || entries.length === sources.length)) {
      names.set(source.id, entry);
    }
  }
  return names;
};

/**
 * The plants of the photos of a garden, round by round: each tag starts a plant, and so does a photo of a whole plant
 * after a close-up, or a photo too long after the one before it
 */
export const segmentPlants = (
  photos: AssignPhoto[],
  sources: SubjectPhoto[],
  names: Map<string, number>,
  whole: (photo: AssignPhoto) => boolean,
  options: PlantOptions = DEFAULT_PLANT_OPTIONS,
): Segment[] => {
  const events: Event[] = [
    ...sources.map((source): Event => ({ kind: 'tag', source, name: names.get(source.id) })),
    ...photos.map((photo): Event => ({ kind: 'plant', photo })),
  ].toSorted((a, b) => eventTime(a) - eventTime(b) || (a.kind === 'tag' ? -1 : 1) - (b.kind === 'tag' ? -1 : 1));
  const segments: Segment[] = [];
  let current: (Segment & { last: number; closeUp: boolean }) | undefined;
  for (const event of events) {
    if (event.kind === 'tag') {
      current = { name: event.name, tag: event.source, photos: [], last: event.source.time, closeUp: false };
      segments.push(current);
      continue;
    }
    const { photo } = event;
    const isWhole = whole(photo);
    const late = !current || photo.time - current.last > options.tagMinutes * 60_000;
    // the next plant: a whole plant after a close-up of this one, or too long after it
    if (late || (isWhole && current!.closeUp) || (isWhole && current!.photos.some((other) => whole(other)))) {
      current = { photos: [], last: photo.time, closeUp: false };
      segments.push(current);
    }
    current!.photos.push(photo);
    current!.last = photo.time;
    current!.closeUp ||= !isWhole;
  }
  return segments
    .filter((segment) => segment.photos.length > 0)
    .map(({ name, tag, photos }) => ({ name, tag, photos }));
};

/**
 * Names the plants of a garden (`match.assign` of the garden pack): the photos follow the tags and seed packets they
 * were photographed after (`options.sources`), and every plant of a variety over the rounds of the garden is one
 * plant, named after the entry of its tag (read on it, or passed in the order of the sources). A plant without a tag
 * that round, or whose tag could not be read, is unnamed and unsure, with the named plants CLIP finds most like it as
 * suggestions. A name is sure when the tag was read clearly (or given) and the photos follow it.
 */
export const assignPlants = (
  photos: AssignPhoto[],
  entries: AssignEntry[],
  options: AssignOptions,
  plantOptions: PlantOptions = DEFAULT_PLANT_OPTIONS,
): AssignResult => {
  const sources = (options.sources ?? []).toSorted((a, b) => a.time - b.time);
  const names = getTagNames(options.sources ?? [], entries);
  const prompts = options.prompts ?? [];
  const similarities = new Map(
    photos.map((photo) => [
      photo.id,
      prompts.length > 0 && photo.embedding.length > 0 ? prompts.map((prompt) => dot(photo.embedding, prompt)) : [],
    ]),
  );
  const whole = (photo: AssignPhoto) => {
    const values = similarities.get(photo.id) ?? [];
    return values.length > 0 && isWholePlant(values);
  };
  const segments = segmentPlants(photos, sources, names, whole, plantOptions);

  // one plant per variety, over every round of the garden: the entry first named so
  const key = (item: number) => entries[item].name.trim().toLowerCase();
  const firstOf = new Map<string, number>();
  for (const item of entries.keys()) {
    if (!firstOf.has(key(item))) {
      firstOf.set(key(item), item);
    }
  }
  const plants = new Map<number, AssignPhoto[]>();
  const loose: Segment[] = [];
  for (const segment of segments) {
    if (segment.name === undefined) {
      loose.push(segment);
      continue;
    }
    const item = firstOf.get(key(segment.name))!;
    plants.set(item, [...(plants.get(item) ?? []), ...segment.photos]);
  }
  const byTime = (a: AssignPhoto, b: AssignPhoto) => a.time - b.time || a.id.localeCompare(b.id);

  // a name read unclearly on its tag is still to check: matchVisit marks it unsure
  const matches: SubjectMatch[] = [...plants].map(([item, members]) => ({
    ids: members.toSorted(byTime).map(({ id }) => id),
    item,
    score: 0.9,
    unsure: false,
    suggestions: [{ item, score: 0.9, similarity: 0 }],
  }));
  const named = [...plants];
  for (const segment of loose) {
    // the named plants most like the segment, by CLIP: a guess, for the assistant to check
    const scores = named.map(([, members]) =>
      Math.max(
        ...segment.photos.flatMap((photo) =>
          members.flatMap((member) =>
            photo.embedding.length > 0 && photo.embedding.length === member.embedding.length
              ? [1 - cosineDistance(photo.embedding, member.embedding)]
              : [],
          ),
        ),
        -1,
      ),
    );
    const probabilities = scores.length > 0 ? softmax(scores, 30) : [];
    const suggestions: MatchSuggestion[] = named
      .map(([item], index) => ({
        item,
        score: Math.round(probabilities[index] * 1000) / 1000,
        similarity: scores[index],
      }))
      .toSorted((a, b) => b.score - a.score)
      .slice(0, options.suggestions);
    matches.push({ ids: segment.photos.toSorted(byTime).map(({ id }) => id), score: 0, unsure: true, suggestions });
  }
  const times = new Map(photos.map(({ id, time }) => [id, time]));
  return {
    matches: matches.toSorted((a, b) => times.get(a.ids[0])! - times.get(b.ids[0])!),
    ordered: false,
  };
};
