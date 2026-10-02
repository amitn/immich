import { Expression, ExpressionBuilder, SqlBool } from 'kysely';
import { DB } from 'src/schema/index.js';
import { getCollectionTagRules } from 'src/utils/collections/pack.js';
import { getCollectionPacks } from 'src/utils/collections/registry.js';
import { getSourceLeaves } from 'src/utils/collections/tags.js';
import { anyUuid } from 'src/utils/database.js';

/**
 * What a user keeps out of their memories (#12): the photos showing a person or a pet, the photos taken in a range of
 * days, the photos of an album, and, with `documents`, the screenshots, receipts and documents. It is a feature of the
 * memory engine (`src/services/memory-rules`): every rule's candidates, the memories already made, and everything made
 * of a memory (videos, books, collages), the suggested books and the year recap leave these photos out.
 */
export type MemoryExclusions = {
  /** person group ids of the user's people and pets; their face identities reach the photos of shared spaces too */
  personIds: string[];
  /** local days, `YYYY-MM-DD`, both included */
  dateRanges: MemoryExclusionDateRange[];
  albumIds: string[];
  /** no screenshots, receipts or documents */
  documents: boolean;
};

export type MemoryExclusionDateRange = { from: string; to: string };

export const NO_MEMORY_EXCLUSIONS: MemoryExclusions = Object.freeze({
  personIds: [],
  dateRanges: [],
  albumIds: [],
  documents: false,
}) as MemoryExclusions;

export const hasMemoryExclusions = (exclusions?: MemoryExclusions | null): exclusions is MemoryExclusions =>
  !!exclusions &&
  (exclusions.personIds.length > 0 ||
    exclusions.dateRanges.length > 0 ||
    exclusions.albumIds.length > 0 ||
    exclusions.documents);

/** the stored exclusions with the ones of one request, e.g. "my 2026 recap without Dana" */
export const mergeMemoryExclusions = (
  base: MemoryExclusions,
  extra?: Partial<MemoryExclusions> | null,
): MemoryExclusions => ({
  personIds: [...new Set([...base.personIds, ...(extra?.personIds ?? [])])],
  dateRanges: [...base.dateRanges, ...(extra?.dateRanges ?? [])],
  albumIds: [...new Set([...base.albumIds, ...(extra?.albumIds ?? [])])],
  documents: base.documents || !!extra?.documents,
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** the instants a range of local days covers: from its first midnight up to, not including, the midnight after it */
export const getDateRangeBounds = ({ from, to }: MemoryExclusionDateRange) => {
  if (!DAY.test(from) || !DAY.test(to)) {
    throw new Error(`Invalid date range ${from}..${to}`);
  }
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

/** whether a local time (`asset.localDateTime`) is in one of the ranges */
export const isInDateRanges = (localDateTime: Date, ranges: MemoryExclusionDateRange[]) =>
  ranges.some((range) => {
    const { start, end } = getDateRangeBounds(range);
    return localDateTime >= start && localDateTime < end;
  });

/** the classification categories whose `Auto/<Category>` tag marks a screenshot, a receipt or a document */
const DOCUMENT_CATEGORY_WORDS = ['screenshot', 'receipt', 'document'];

/**
 * The tags of document-like photos, as LIKE patterns (ILIKE for the classification): noodle's classification tags
 * (`Auto/Screenshots`, `Auto/Receipts`, `Auto/Documents`, whatever the admin named the category, as long as it says
 * so), and the source photos of every journal, the photographed text of a visit (`Food/<Restaurant>/Menu`,
 * `Travel/<Trip>/Tickets`, `Art/<Museum>/Label`…)
 */
export const getDocumentTagPatterns = () => ({
  classification: DOCUMENT_CATEGORY_WORDS.map((word) => `Auto/%${word}%`),
  journals: getCollectionPacks().flatMap((pack) => {
    const rules = getCollectionTagRules(pack);
    return getSourceLeaves(rules).map((leaf) => `${rules.tagRoot}/%/${leaf}`);
  }),
});

/** whether a tag value marks a document-like photo (the same test as `getDocumentTagPatterns`, in code) */
export const isDocumentTag = (value: string) => {
  const lower = value.toLowerCase();
  if (lower.startsWith('auto/') && DOCUMENT_CATEGORY_WORDS.some((word) => lower.includes(word))) {
    return true;
  }
  const parts = value.split('/');
  if (parts.length !== 3) {
    return false;
  }
  return getCollectionPacks().some((pack) => {
    const rules = getCollectionTagRules(pack);
    return parts[0] === rules.tagRoot && getSourceLeaves(rules).includes(parts[2]);
  });
};

/**
 * The SQL test that keeps an asset (`"asset"` in the query) out of the exclusions; undefined when nothing is
 * excluded, so that the query is unchanged. Use it in the asset subqueries of the memories, like the hidden people.
 */
export const notExcludedFromMemories = (
  eb: ExpressionBuilder<DB, keyof DB>,
  exclusions?: MemoryExclusions | null,
): Expression<SqlBool> | undefined => {
  if (!hasMemoryExclusions(exclusions)) {
    return;
  }

  const terms: Expression<SqlBool>[] = [];

  if (exclusions.personIds.length > 0) {
    const ids = anyUuid(exclusions.personIds);
    terms.push(
      eb.not(
        eb.exists(
          eb
            .selectFrom('asset_face')
            .select(eb.lit(1).as('one'))
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where((eb) =>
              eb.or([
                eb('asset_face.personGroupId', '=', ids),
                // the same person in the photos of a shared space, through their face identity
                eb.exists(
                  eb
                    .selectFrom('face_identity_face')
                    .innerJoin('person', 'person.identityId', 'face_identity_face.identityId')
                    .select(eb.lit(1).as('one'))
                    .whereRef('face_identity_face.assetFaceId', '=', 'asset_face.id')
                    .where('person.personGroupId', '=', ids),
                ),
              ]),
            ),
        ),
      ),
    );
  }

  for (const range of exclusions.dateRanges) {
    const { start, end } = getDateRangeBounds(range);
    terms.push(eb.or([eb('asset.localDateTime', '<', start), eb('asset.localDateTime', '>=', end)]));
  }

  if (exclusions.albumIds.length > 0) {
    terms.push(
      eb.not(
        eb.exists(
          eb
            .selectFrom('album_asset')
            .select(eb.lit(1).as('one'))
            .whereRef('album_asset.assetId', '=', 'asset.id')
            .where('album_asset.albumId', '=', anyUuid(exclusions.albumIds)),
        ),
      ),
    );
  }

  if (exclusions.documents) {
    const { classification, journals } = getDocumentTagPatterns();
    terms.push(
      eb.not(
        eb.exists(
          eb
            .selectFrom('tag_asset')
            .innerJoin('tag', 'tag.id', 'tag_asset.tagId')
            .select(eb.lit(1).as('one'))
            .whereRef('tag_asset.assetId', '=', 'asset.id')
            .where((eb) =>
              eb.or([
                ...classification.map((pattern) => eb('tag.value', 'ilike', pattern)),
                ...journals.map((pattern) => eb('tag.value', 'like', pattern)),
              ]),
            ),
        ),
      ),
    );
  }

  return eb.and(terms);
};

/** the context keys of the rules that are about people (`birthday`, `person_throwback`, `people_together`) */
const CONTEXT_PERSON_KEYS = ['personId', 'personAId', 'personBId'];
/** the context keys that list people, e.g. the most photographed people of a `year_recap` */
const CONTEXT_PEOPLE_LIST_KEYS = ['topPeople', 'topPets'];

type MemoryContext = Record<string, unknown>;

/** the people a memory is about, by the ids its rule stored in its context */
export const getMemoryContextPersonIds = (context?: MemoryContext | null): string[] =>
  CONTEXT_PERSON_KEYS.flatMap((key) => {
    const value = context?.[key];
    return typeof value === 'string' && value ? [value] : [];
  });

/** whether a memory is about someone the user left out, e.g. the birthday of an excluded person */
export const isMemoryAboutExcludedPerson = (context: MemoryContext | null | undefined, exclusions: MemoryExclusions) =>
  exclusions.personIds.length > 0 && getMemoryContextPersonIds(context).some((id) => exclusions.personIds.includes(id));

const isExcludedPerson = (person: unknown, exclusions: MemoryExclusions) =>
  !!person &&
  typeof person === 'object' &&
  exclusions.personIds.includes(String((person as { id?: unknown }).id ?? ''));

/** the context without the excluded people it lists (the people of a year recap made before they were excluded) */
export const withoutExcludedPeople = <T extends MemoryContext | null | undefined>(
  context: T,
  exclusions: MemoryExclusions,
): T => {
  if (!context || exclusions.personIds.length === 0) {
    return context;
  }
  let changed = false;
  const result: MemoryContext = { ...context };
  for (const key of CONTEXT_PEOPLE_LIST_KEYS) {
    const list = context[key];
    if (!Array.isArray(list)) {
      continue;
    }
    const kept = list.filter((person) => !isExcludedPerson(person, exclusions));
    if (kept.length !== list.length) {
      result[key] = kept;
      changed = true;
    }
  }
  return (changed ? result : context) as T;
};
