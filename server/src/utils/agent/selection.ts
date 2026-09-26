export type SelectionCandidate = {
  id: string;
  /** capture time in ms */
  time: number;
  /** quality score, 0..1 */
  score: number;
  /** similarity cluster (burst/near-duplicate group); unique photos have none */
  cluster?: number | null;
  event?: number | null;
  /** people in the photo */
  personIds?: string[];
};

export type SelectionConstraints = {
  count: number;
  /** default 2 */
  maxPerCluster?: number;
  requirePersonIds?: string[];
  /** default 1 when `requirePersonIds` is set */
  minPerPerson?: number;
  /** picks of every required person in each event where they appear, default 0 */
  minPerPersonPerEvent?: number;
  maxPerEvent?: number;
  minPerEvent?: number;
  /** favour photos with people in them */
  preferPeople?: boolean;
  /** sort the result by time instead of by pick order, default true */
  chronological?: boolean;
  excludeIds?: string[];
  /** always selected, even beyond `count` or the caps */
  mustIncludeIds?: string[];
  /** 0..1, how strongly to avoid photos that are similar or close in time to picked ones, default 0.3 */
  diversity?: number;
};

export type SelectionResult = {
  ids: string[];
  /** picks per required person */
  perPerson: Record<string, number>;
  /** picks per event index */
  perEvent: Record<string, number>;
  events: { covered: number; total: number };
  clusters: { represented: number; capped: number };
  unmet: string[];
};

/** defaults for the main people of a personal selection, see `getMainPeople` */
export const MAIN_PEOPLE_DEFAULTS = { maxPeople: 3, minShare: 0.08, minPhotos: 3, perEvent: 1, perBook: 4 };

/**
 * The people (named or not) who appear most often: at least `minPhotos` photos and `minShare` of the photos, at most
 * `maxPeople`, most frequent first.
 */
export const getMainPeople = (
  photos: Array<{ personIds?: string[] }>,
  options: Partial<Pick<typeof MAIN_PEOPLE_DEFAULTS, 'maxPeople' | 'minShare' | 'minPhotos'>> = {},
): string[] => {
  const { maxPeople, minShare, minPhotos } = { ...MAIN_PEOPLE_DEFAULTS, ...options };
  const counts = new Map<string, number>();
  for (const photo of photos) {
    for (const id of new Set(photo.personIds)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const threshold = Math.max(minPhotos, minShare * photos.length);
  return [...counts]
    .filter(([, count]) => count >= threshold)
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxPeople)
    .map(([id]) => id);
};

/** the per-book minimum of each main person for a selection of `count` photos: at most half the budget in total */
export const getMainPersonMinimum = (count: number, people: number, perBook = MAIN_PEOPLE_DEFAULTS.perBook) =>
  people === 0 ? 0 : Math.min(perBook, Math.max(1, Math.floor((0.5 * count) / people)));

const TIME_WINDOW_MS = 30 * 60 * 1000;
const TIME_DECAY_MS = 2 * 60 * 1000;
const PEOPLE_BONUS = 0.15;
const MULTI_PEOPLE_BONUS = 0.05;

type State = {
  candidate: SelectionCandidate;
  utility: number;
  redundancy: number;
  selected: boolean;
};

const compare = (a: { gain: number; state: State }, b: { gain: number; state: State }) =>
  b.gain - a.gain ||
  b.state.candidate.score - a.state.candidate.score ||
  a.state.candidate.time - b.state.candidate.time ||
  a.state.candidate.id.localeCompare(b.state.candidate.id);

const similarity = (a: SelectionCandidate, b: SelectionCandidate) => {
  if (a.cluster !== null && a.cluster !== undefined && a.cluster === b.cluster) {
    return 1;
  }
  const delta = Math.abs(a.time - b.time);
  return delta < TIME_WINDOW_MS ? 0.8 * Math.exp(-delta / TIME_DECAY_MS) : 0;
};

const hasCluster = (candidate: SelectionCandidate): candidate is SelectionCandidate & { cluster: number } =>
  candidate.cluster !== null && candidate.cluster !== undefined;

const hasEvent = (candidate: SelectionCandidate): candidate is SelectionCandidate & { event: number } =>
  candidate.event !== null && candidate.event !== undefined;

/**
 * Greedy, deterministic selection in the spirit of maximal marginal relevance. Order of precedence:
 * `mustIncludeIds`, then the hard caps (`maxPerCluster`, `maxPerEvent`), then the minimums (people, people per
 * event, then events), then the best remaining photos, each pick penalized by its similarity to earlier picks
 * and by over-representing its event.
 */
export const selectBest = (candidates: SelectionCandidate[], constraints: SelectionConstraints): SelectionResult => {
  const count = Math.max(0, Math.floor(constraints.count));
  const maxPerCluster = constraints.maxPerCluster ?? 2;
  const maxPerEvent = constraints.maxPerEvent;
  const requirePersonIds = [...new Set(constraints.requirePersonIds)];
  const minPerPerson = requirePersonIds.length > 0 ? (constraints.minPerPerson ?? 1) : 0;
  const minPerPersonPerEvent = requirePersonIds.length > 0 ? (constraints.minPerPersonPerEvent ?? 0) : 0;
  const minPerEvent = constraints.minPerEvent ?? 0;
  const diversity = constraints.diversity ?? 0.3;
  const excluded = new Set(constraints.excludeIds);
  const unmet: string[] = [];

  const states: State[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (excluded.has(candidate.id) || seen.has(candidate.id)) {
      continue;
    }
    seen.add(candidate.id);

    const people = candidate.personIds?.length ?? 0;
    let utility = candidate.score;
    if (constraints.preferPeople && people > 0) {
      utility += PEOPLE_BONUS + (people > 1 ? MULTI_PEOPLE_BONUS : 0);
    }
    states.push({ candidate, utility, redundancy: 0, selected: false });
  }

  const eventSizes = new Map<number, number>();
  const clusterSizes = new Map<number, number>();
  for (const { candidate } of states) {
    if (hasEvent(candidate)) {
      eventSizes.set(candidate.event, (eventSizes.get(candidate.event) ?? 0) + 1);
    }
    if (hasCluster(candidate)) {
      clusterSizes.set(candidate.cluster, (clusterSizes.get(candidate.cluster) ?? 0) + 1);
    }
  }

  const picked: State[] = [];
  const clusterCounts = new Map<number, number>();
  const eventCounts = new Map<number, number>();
  const personCounts = new Map<string, number>(requirePersonIds.map((id) => [id, 0]));

  const pick = (state: State) => {
    state.selected = true;
    picked.push(state);
    const { candidate } = state;
    if (hasCluster(candidate)) {
      clusterCounts.set(candidate.cluster, (clusterCounts.get(candidate.cluster) ?? 0) + 1);
    }
    if (hasEvent(candidate)) {
      eventCounts.set(candidate.event, (eventCounts.get(candidate.event) ?? 0) + 1);
    }
    for (const personId of candidate.personIds ?? []) {
      if (personCounts.has(personId)) {
        personCounts.set(personId, personCounts.get(personId)! + 1);
      }
    }
    for (const other of states) {
      if (!other.selected) {
        other.redundancy = Math.max(other.redundancy, similarity(other.candidate, candidate));
      }
    }
  };

  const isEligible = ({ candidate, selected }: State) =>
    !selected &&
    (!hasCluster(candidate) || (clusterCounts.get(candidate.cluster) ?? 0) < maxPerCluster) &&
    (maxPerEvent === undefined || !hasEvent(candidate) || (eventCounts.get(candidate.event) ?? 0) < maxPerEvent);

  const eventPenalty = (candidate: SelectionCandidate) => {
    if (!hasEvent(candidate) || states.length === 0 || count === 0) {
      return 0;
    }
    const fairShare = (count * eventSizes.get(candidate.event)!) / states.length;
    const load = ((eventCounts.get(candidate.event) ?? 0) + 1) / Math.max(fairShare, 1);
    return load > 1 ? diversity * (load - 1) : 0;
  };

  const gain = (state: State) => state.utility - diversity * state.redundancy - eventPenalty(state.candidate);

  const best = (filter: (state: State) => boolean, bonus?: (state: State) => number) => {
    let result: { gain: number; state: State } | undefined;
    for (const state of states) {
      if (!isEligible(state) || !filter(state)) {
        continue;
      }
      const option = { gain: gain(state) + (bonus?.(state) ?? 0), state };
      if (!result || compare(option, result) < 0) {
        result = option;
      }
    }
    return result?.state;
  };

  const remaining = () => count - picked.length;

  // 1. forced picks
  const byId = new Map(states.map((state) => [state.candidate.id, state]));
  for (const id of new Set(constraints.mustIncludeIds)) {
    const state = byId.get(id);
    if (!state) {
      unmet.push(`mustInclude ${id}: not a candidate or excluded`);
      continue;
    }
    if (!state.selected) {
      pick(state);
    }
  }
  if (picked.length > count) {
    unmet.push(`count: mustIncludeIds alone has ${picked.length} photos`);
  }

  // 2. people minimums, round-robin so every person gets a fair share of the budget
  const personDeficit = (personId: string) => minPerPerson - personCounts.get(personId)!;
  const impossiblePeople = new Set<string>();
  let progress = true;
  while (progress && remaining() > 0) {
    progress = false;
    for (const personId of requirePersonIds) {
      if (remaining() <= 0 || impossiblePeople.has(personId) || personDeficit(personId) <= 0) {
        continue;
      }
      const state = best(
        ({ candidate }) => candidate.personIds?.includes(personId) ?? false,
        // prefer photos that also help other people short of their minimum
        ({ candidate }) =>
          0.2 *
          (candidate.personIds ?? []).filter((id) => id !== personId && personCounts.has(id) && personDeficit(id) > 0)
            .length,
      );
      if (state) {
        pick(state);
        progress = true;
      } else {
        impossiblePeople.add(personId);
      }
    }
  }

  const events = eventSizes
    .keys()
    .toArray()
    .toSorted((a, b) => a - b);

  // 3. people in every event they appear in
  if (minPerPersonPerEvent > 0) {
    const has = (candidate: SelectionCandidate, personId: string, event: number) =>
      candidate.event === event && (candidate.personIds?.includes(personId) ?? false);
    const pickedIn = (personId: string, event: number) =>
      picked.filter(({ candidate }) => has(candidate, personId, event)).length;
    const pairs = events.flatMap((event) =>
      requirePersonIds
        .filter((personId) => states.some(({ candidate }) => has(candidate, personId, event)))
        .map((personId) => ({ event, personId })),
    );
    const impossible = new Set<string>();
    progress = true;
    while (progress && remaining() > 0) {
      progress = false;
      for (const { event, personId } of pairs) {
        const key = `${event}:${personId}`;
        if (remaining() <= 0 || impossible.has(key) || pickedIn(personId, event) >= minPerPersonPerEvent) {
          continue;
        }
        const state = best(({ candidate }) => has(candidate, personId, event));
        if (state) {
          pick(state);
          progress = true;
        } else {
          impossible.add(key);
        }
      }
    }
    for (const { event, personId } of pairs) {
      const available = states.filter(({ candidate }) => has(candidate, personId, event)).length;
      const needed = Math.min(minPerPersonPerEvent, available);
      if (pickedIn(personId, event) < needed) {
        unmet.push(`minPerPersonPerEvent ${personId} event ${event}: ${pickedIn(personId, event)}/${needed}`);
      }
    }
  }

  // 4. event minimums
  if (minPerEvent > 0) {
    const eventDeficit = (event: number) =>
      Math.min(minPerEvent, eventSizes.get(event)!) - (eventCounts.get(event) ?? 0);
    const impossibleEvents = new Set<number>();
    progress = true;
    while (progress && remaining() > 0) {
      progress = false;
      for (const event of events) {
        if (remaining() <= 0 || impossibleEvents.has(event) || eventDeficit(event) <= 0) {
          continue;
        }
        const state = best(({ candidate }) => candidate.event === event);
        if (state) {
          pick(state);
          progress = true;
        } else {
          impossibleEvents.add(event);
        }
      }
    }
    for (const event of events) {
      const deficit = eventDeficit(event);
      if (deficit > 0) {
        unmet.push(
          `minPerEvent event ${event}: ${eventCounts.get(event) ?? 0}/${Math.min(minPerEvent, eventSizes.get(event)!)}`,
        );
      }
    }
  }

  for (const personId of requirePersonIds) {
    if (personDeficit(personId) <= 0) {
      continue;
    }

    const available = states.filter(({ candidate }) => candidate.personIds?.includes(personId)).length;
    unmet.push(
      `minPerPerson ${personId}: ${personCounts.get(personId)}/${minPerPerson}` +
        (available < minPerPerson ? ` (${available} candidates)` : ''),
    );
  }

  // 5. fill with the best remaining photos
  while (remaining() > 0) {
    const state = best(() => true);
    if (!state) {
      break;
    }
    pick(state);
  }

  if (picked.length < count) {
    const reason = picked.length === states.length ? 'not enough candidates' : 'limited by maxPerCluster/maxPerEvent';
    unmet.push(`count: ${picked.length}/${count} (${reason})`);
  }

  const selected = picked.map(({ candidate }) => candidate);
  if (constraints.chronological ?? true) {
    selected.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  }

  const perEvent: Record<string, number> = {};
  for (const event of events) {
    const eventCount = eventCounts.get(event);
    if (eventCount) {
      perEvent[event] = eventCount;
    }
  }

  let capped = 0;
  for (const [cluster, clusterCount] of clusterCounts) {
    if (clusterCount >= maxPerCluster && clusterSizes.get(cluster)! > clusterCount) {
      capped++;
    }
  }

  return {
    ids: selected.map(({ id }) => id),
    perPerson: Object.fromEntries(personCounts),
    perEvent,
    events: { covered: Object.keys(perEvent).length, total: events.length },
    clusters: { represented: clusterCounts.size, capped },
    unmet,
  };
};
