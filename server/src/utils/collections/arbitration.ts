import { CLIP_TEMPERATURE, CollectionPhotoKind, softmax } from 'src/utils/collections/classify.js';

/**
 * How well the prompts of each pack fit a photo: the best CLIP similarity of the photo with the pack's prompts of each
 * kind, by pack id, e.g. `{ garden: { subject: 0.31, source: 0.25 }, nature: { subject: 0.27 } }`. The packs'
 * prompts are texts about the same photo, so their similarities compare: a peach tree fits "a close-up photo of fruit
 * on a tree" (garden) better than "a photo of a plate of food" (food).
 */
export type PackFit = Record<string, Partial<Record<CollectionPhotoKind, number>>>;

/**
 * A visit is notified when its pack has at least this share of its subject photos (`getVisitShare`): a visit most of
 * whose photos another pack explains better (the stage shots of a gig taken for a trip, the trees of a garden taken
 * for a breakfast) is not its pack's
 */
export const MIN_NOTICE_SHARE = 0.5;

/**
 * a photo whose share for a pack, in the kind the pack takes it for, is below this is another pack's for sure (a
 * dish among the photos of a garden, a recipe card taken for a seed packet): it is left out when the pack's visits are
 * found, where it would join, and chain, visits across months in the packs whose visits last for seasons
 */
export const FOREIGN_SHARE = 0.02;

/**
 * The share of each pack in a photo as a kind (a subject by default): the softmax over the packs of their best prompt
 * of that kind, at CLIP's temperature, as if the prompts of the packs were the classes of one zero-shot classifier.
 * Packs without prompts of that kind have no share; empty when no pack has one.
 */
export const getPackShares = (fit: PackFit, kind: CollectionPhotoKind = 'subject'): Record<string, number> => {
  const packs = Object.keys(fit).filter((pack) => fit[pack][kind] !== undefined);
  const shares = softmax(
    packs.map((pack) => fit[pack][kind]!),
    CLIP_TEMPERATURE,
  );
  return Object.fromEntries(packs.map((pack, index) => [pack, shares[index]]));
};

/**
 * The mean share of a pack in the subject photos of a visit, over those that have a fit (smart search may not have
 * seen them all yet); undefined when none has one
 */
export const getVisitShare = (pack: string, subjectIds: string[], fits: Map<string, PackFit>) => {
  const shares = subjectIds.flatMap((id) => {
    const fit = fits.get(id);
    const share = fit ? getPackShares(fit)[pack] : undefined;
    return share === undefined ? [] : [share];
  });
  return shares.length === 0 ? undefined : shares.reduce((sum, share) => sum + share, 0) / shares.length;
};

/** the photos each pack's prompts of a kind fit far worse than another pack's: for sure another pack's, as that kind */
export type ForeignPhotos = Map<string, Map<CollectionPhotoKind, Set<string>>>;

/** the photos that are, as each kind, another pack's for sure (`FOREIGN_SHARE`), for each of the packs */
export const getForeignPhotos = (packs: string[], fits: Map<string, PackFit>): ForeignPhotos => {
  const kinds: CollectionPhotoKind[] = ['subject', 'source', 'sign', 'receipt'];
  const foreign: ForeignPhotos = new Map(packs.map((pack) => [pack, new Map(kinds.map((kind) => [kind, new Set()]))]));
  for (const [id, fit] of fits) {
    for (const kind of kinds) {
      const shares = getPackShares(fit, kind);
      for (const pack of packs) {
        const share = shares[pack];
        if (share !== undefined && share < FOREIGN_SHARE) {
          foreign.get(pack)!.get(kind)!.add(id);
        }
      }
    }
  }
  return foreign;
};

export type ArbitratedPhoto = { id: string; kind: CollectionPhotoKind };

/** a visit a pack found, as the arbitration sees it */
export type ArbitratedVisit = {
  pack: string;
  /** its photos in order, each with its kind in the pack (a plant tag is a garden's source, a book's subject) */
  photos: ArbitratedPhoto[];
  /** the fewest subject photos a visit of the pack is notified with */
  minSubjects: number;
  /** whether a visit of the pack needs a source photo to be notified (a trip, its ticket) */
  requireSource?: boolean;
};

export type ArbitrationResult = {
  /**
   * new: notified with `photos`; named-elsewhere: without the photos of visits named in other packs, it is too small;
   * unsure: its pack has less than `MIN_NOTICE_SHARE` of its subjects; duplicate: other packs' visits won so many of
   * its photos that it is too small without them
   */
  status: 'new' | 'named-elsewhere' | 'unsure' | 'duplicate';
  /** the photos left to the visit, in order: the photos of visits named in other packs, or won by them, are theirs */
  photos: ArbitratedPhoto[];
  /** the pack's share of the subjects left (undefined without fits) */
  share?: number;
};

/**
 * the share of the first of two claims on a photo (`kind` in `pack` against `otherKind` in `otherPack`): the softmax of
 * their prompts of those kinds, one half when either has no fit
 */
const getClaimShare = (
  fit: PackFit | undefined,
  pack: string,
  kind: CollectionPhotoKind,
  otherPack: string,
  otherKind: CollectionPhotoKind,
) => {
  const mine = fit?.[pack]?.[kind];
  const theirs = fit?.[otherPack]?.[otherKind];
  return mine === undefined || theirs === undefined ? 0.5 : softmax([mine, theirs], CLIP_TEMPERATURE)[0];
};

const subjectsOf = (photos: ArbitratedPhoto[]) => photos.filter(({ kind }) => kind === 'subject').map(({ id }) => id);

const isLargeEnough = (visit: ArbitratedVisit, photos: ArbitratedPhoto[]) =>
  subjectsOf(photos).length >= visit.minSubjects &&
  (!visit.requireSource || photos.some(({ kind }) => kind === 'source'));

/**
 * Decides which pack's visit gets the photos that several packs found: the visits of the same photos in several packs
 * (the trees of a garden, found by the garden, the nature walks, the travel and the food packs) are one occasion,
 * notified once, in the pack that fits it best.
 *
 * - the photos of visits named in another pack (`named`) are that pack's: a visit is notified without them, or not at
 *   all when it is too small without them (named-elsewhere)
 * - a visit whose pack has less than `MIN_NOTICE_SHARE` of its subject photos is unsure: another pack explains them
 *   better, or no pack does
 * - the others are taken from the best supported (the most subjects that are surely the pack's: the sum of their
 *   shares), and the photos two of them share all go to the one whose prompts fit them better in the kinds they have
 *   in each pack (a garden's plant tag is its source, which the garden's tag prompts fit better than the reading pack's
 *   title pages do): the shared photos stay together, so that one occasion is not split between two packs
 * - a visit left too small without the photos it lost (the pack's minimum, the source it needs), or that its pack no
 *   longer fits, is a duplicate; one still large enough is notified with the photos it kept
 *
 * `fits` holds the fit of each photo (`PackFit`); photos without one count as a tie. Returns the result of each visit,
 * in the order given.
 */
export const arbitrateVisits = (
  visits: ArbitratedVisit[],
  fits: Map<string, PackFit>,
  named: Set<string> = new Set(),
): ArbitrationResult[] => {
  const results: ArbitrationResult[] = visits.map((visit) => {
    const photos = visit.photos.filter(({ id }) => !named.has(id));
    if (!isLargeEnough(visit, photos)) {
      return { status: 'named-elsewhere', photos };
    }
    const share = getVisitShare(visit.pack, subjectsOf(photos), fits);
    return {
      status: share !== undefined && share < MIN_NOTICE_SHARE ? 'unsure' : 'new',
      photos,
      ...(share !== undefined && { share }),
    };
  });

  const strength = (index: number) =>
    subjectsOf(results[index].photos).reduce((sum, id) => {
      const fit = fits.get(id);
      return sum + (fit ? (getPackShares(fit)[visits[index].pack] ?? 0.5) : 0.5);
    }, 0);
  const order = visits
    .map((_, index) => index)
    .filter((index) => results[index].status === 'new')
    .map((index) => ({ index, strength: strength(index) }))
    .toSorted((a, b) => b.strength - a.strength || a.index - b.index)
    .map(({ index }) => index);
  const initial = new Map(order.map((index) => [index, results[index].photos.length]));

  for (const [position, index] of order.entries()) {
    const visit = visits[index];
    if (!isLargeEnough(visit, results[index].photos)) {
      continue;
    }
    for (const otherIndex of order.slice(position + 1)) {
      const other = visits[otherIndex];
      const kinds = new Map(results[otherIndex].photos.map(({ id, kind }) => [id, kind]));
      const shared = results[index].photos.filter(({ id }) => kinds.has(id));
      if (shared.length === 0) {
        continue;
      }
      const won = shared.reduce(
        (sum, { id, kind }) => sum + getClaimShare(fits.get(id), visit.pack, kind, other.pack, kinds.get(id)!),
        0,
      );
      const ids = new Set(shared.map(({ id }) => id));
      if (won >= shared.length / 2) {
        results[otherIndex].photos = results[otherIndex].photos.filter(({ id }) => !ids.has(id));
      } else {
        results[index].photos = results[index].photos.filter(({ id }) => !ids.has(id));
        if (!isLargeEnough(visit, results[index].photos)) {
          break;
        }
      }
    }
  }

  for (const index of order) {
    const result = results[index];
    if (result.photos.length === initial.get(index)) {
      continue;
    }
    const share = getVisitShare(visits[index].pack, subjectsOf(result.photos), fits);
    if (share === undefined) {
      delete result.share;
    } else {
      result.share = share;
    }
    if (!isLargeEnough(visits[index], result.photos) || (share !== undefined && share < MIN_NOTICE_SHARE)) {
      result.status = 'duplicate';
    }
  }
  return results;
};

/** a visit named in a pack: its photos, and when it started and ended (local ms) */
export type NamedVisit = { pack: string; assetIds: string[]; start: number; end: number };

/**
 * The photos that are the occasion of a visit named in a pack, for `arbitrateVisits`: its photos, and the photos
 * another pack's visit found within `marginMinutes` of it that the named pack's prompts fit better than that pack's
 * (the winery photographed during a named tasting is the tasting's, not a garden's). `visits` are the visits that may
 * lose them, `times` the local times of the photos.
 */
export const getNamedPhotos = (
  named: NamedVisit[],
  visits: Array<Pick<ArbitratedVisit, 'pack' | 'photos'>>,
  times: Map<string, number>,
  fits: Map<string, PackFit>,
  marginMinutes: number,
) => {
  const photos = new Set(named.flatMap(({ assetIds }) => assetIds));
  const margin = marginMinutes * 60_000;
  for (const visit of visits) {
    for (const { id } of visit.photos) {
      const time = times.get(id);
      const fit = fits.get(id);
      if (time === undefined || !fit || photos.has(id)) {
        continue;
      }
      const shares = getPackShares(fit);
      const occasion = named.some(
        ({ pack, start, end }) =>
          pack !== visit.pack &&
          time >= start - margin &&
          time <= end + margin &&
          (shares[pack] ?? 0) > (shares[visit.pack] ?? 0),
      );
      if (occasion) {
        photos.add(id);
      }
    }
  }
  return photos;
};
