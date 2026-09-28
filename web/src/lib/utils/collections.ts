import { DateTime } from 'luxon';
import type { MessageFormatter } from 'svelte-i18n';
import { getCollectionLabel, type WebCollectionPack } from '$lib/collections/pack';
import { collectionPacks } from '$lib/collections/registry';
import type {
  CollectionEntriesDto,
  CollectionEntriesResponse,
  CollectionEntry,
  CollectionMatch,
  CollectionSubjectMatch,
  CollectionVisit,
} from '$lib/collections/types';

/** A subject of a visit as it is edited: its photos (of the same subject, e.g. a dish) and the name they get */
export type EntryRow = {
  /** stable key: the first photo */
  key: string;
  assetIds: string[];
  /** the name the photos get; empty skips them */
  name: string;
  /** named freely instead of with an entry of the source */
  offList: boolean;
  /** the suggested match is weak: the user should check it */
  unsure: boolean;
  /** the photos already have this name in the tags of the pack */
  savedName?: string;
  /** the entry the server matched */
  matchedName?: string;
  /** entries, best first */
  suggestions: string[];
};

/** The subject is probably not on the source (e.g. bread, not on the menu): no entry beats "off the list" */
export const isOffListSubject = (subject: CollectionSubjectMatch) =>
  subject.index === undefined &&
  subject.offList !== undefined &&
  subject.offList > (subject.suggestions[0]?.score ?? 0);

const normalizeName = (name: string) =>
  name
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^\p{L}\d]/gu, '');

/** The other names read for the place of a visit, but not the name it has (in another case or with other accents) */
export const getOtherPlaceNames = <T extends { name: string }>(candidates: T[], place: string) => {
  const key = normalizeName(place);
  const seen = new Set<string>();
  return candidates.filter(({ name }) => {
    const candidate = normalizeName(name);
    if (!candidate || candidate === key || seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);
    return true;
  });
};

/** Every photo of a visit */
export const getVisitAssetIds = (visit: CollectionVisit) => [
  ...new Set([...visit.sourceIds, ...visit.subjectIds, ...visit.signIds, ...visit.receiptIds]),
];

/** The source photos of a visit the user can name: not the photos of others (e.g. of a shared space) */
export const getNameableSourceIds = (visit: CollectionVisit) => {
  const readOnly = new Set(visit.readOnlyIds);
  return visit.sourceIds.filter((id) => !readOnly.has(id));
};

/** How many photos of a visit are someone else's: they help to read the names, but only their owner names them */
export const countReadOnlyPhotos = (visit: CollectionVisit) => {
  const readOnly = new Set(visit.readOnlyIds);
  return getVisitAssetIds(visit).filter((id) => readOnly.has(id)).length;
};

/** The saved name of the photos: the one most of them have */
const getSavedName = (assetIds: string[], visit: CollectionVisit) => {
  const counts = new Map<string, number>();
  for (const saved of visit.saved) {
    if (saved.entry && assetIds.includes(saved.assetId)) {
      counts.set(saved.entry, (counts.get(saved.entry) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  for (const [name, count] of counts) {
    if (best === undefined || count > counts.get(best)!) {
      best = name;
    }
  }
  return best;
};

/**
 * The subjects of a visit to edit: the groups the match found, then the subject photos it could not match (no smart
 * search yet, or over the limit of one request) one by one. A name already saved in the tags wins over the match: it is
 * the entry of the subject, even when the source reads it differently (a bottle's label, a leg of a trip), and never
 * "off the list".
 */
export const getEntryRows = (visit: CollectionVisit, match?: CollectionMatch): EntryRow[] => {
  const hasSource = (match?.entries.length ?? 0) > 0;
  const grouped = new Set(match?.subjects.flatMap(({ assetIds }) => assetIds));
  const sourceIds = new Set(visit.sourceIds);
  // the photos of others are only read: only their owner names them
  const readOnly = new Set(visit.readOnlyIds);

  const rows: EntryRow[] = (match?.subjects ?? []).flatMap((subject) => {
    const assetIds = subject.assetIds.filter((id) => !readOnly.has(id));
    if (assetIds.length === 0) {
      return [];
    }
    const savedName = getSavedName(assetIds, visit);
    const offList = isOffListSubject(subject);
    const name = savedName ?? (offList ? '' : (subject.name ?? ''));
    return {
      key: assetIds[0],
      assetIds,
      name,
      offList: hasSource && !savedName && offList,
      unsure: !savedName && subject.name !== undefined && subject.unsure,
      savedName,
      matchedName: subject.name,
      suggestions: subject.suggestions.map((suggestion) => suggestion.name),
    };
  });

  for (const id of visit.subjectIds) {
    if (grouped.has(id) || sourceIds.has(id) || readOnly.has(id)) {
      continue;
    }
    const savedName = getSavedName([id], visit);
    rows.push({
      key: id,
      assetIds: [id],
      name: savedName ?? '',
      offList: false,
      unsure: false,
      savedName,
      suggestions: [],
    });
  }

  return rows;
};

/** The entries for a subject, its saved name first when the source reads it differently, then its suggestions */
export const getEntryOptions = (
  entries: CollectionEntry[],
  row: Pick<EntryRow, 'suggestions'> & Partial<Pick<EntryRow, 'savedName'>>,
) => {
  const rank = (entry: CollectionEntry) => {
    const index = row.suggestions.indexOf(entry.name);
    return index === -1 ? row.suggestions.length : index;
  };
  const options = [...entries]
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index)
    .map((entry) => ({ id: String(entry.index), label: entry.name, value: entry.name }));
  const { savedName } = row;
  if (savedName && entries.every(({ name }) => name !== savedName)) {
    options.unshift({ id: `saved-${savedName}`, label: savedName, value: savedName });
  }
  return options;
};

/**
 * Whether the subjects of a visit were read even without a source photo: a pack whose subjects carry their source
 * (`sourceOnSubjects`, a bottle's label) read entries on them, matched one, or the photos already have a name
 */
export const hasSubjectReadings = (entries: CollectionEntry[], rows: EntryRow[]) =>
  entries.length > 0 || rows.some((row) => !!row.savedName || !!row.matchedName);

/** The request that names the photos of a visit; subjects without a name are left out */
export const getCollectionEntriesDto = (place: string, sourceIds: string[], rows: EntryRow[]) => {
  const named = rows.filter((row) => row.name.trim());
  const dto: CollectionEntriesDto = {
    place: place.trim(),
    photos: [
      ...sourceIds.map((id) => ({ id, source: true })),
      ...named.flatMap((row) => row.assetIds.map((id) => ({ id, entry: row.name.trim() }))),
    ],
  };
  return { dto, skipped: rows.length - named.length };
};

export type CollectionSaveSummary = { place: string; subjects: number; sources: number; failed: number };

/** How many subject and source photos were named, and how many failed */
export const summarizeCollectionEntries = (
  response: CollectionEntriesResponse,
  sourceIds: string[],
): CollectionSaveSummary => {
  const sources = new Set(sourceIds);
  const succeeded = response.results.filter(({ success }) => success);
  return {
    place: response.place,
    sources: succeeded.filter(({ id }) => sources.has(id)).length,
    subjects: succeeded.filter(({ id }) => !sources.has(id)).length,
    failed: response.results.length - succeeded.length,
  };
};

/** The visit with the tags a save wrote, so it shows as named */
export const applyCollectionEntries = (
  visit: CollectionVisit,
  response: CollectionEntriesResponse,
  sourceIds: string[],
): CollectionVisit => {
  const sources = new Set(sourceIds);
  const written = new Map(
    response.results
      .filter(({ success, tag }) => success && tag)
      .map(({ id, tag }) => [id, tag!.split('/').slice(2).join('/')]),
  );
  return {
    ...visit,
    place: { ...visit.place, name: response.place, source: 'tag', confidence: 1 },
    saved: [
      ...visit.saved.filter(({ assetId }) => !written.has(assetId)),
      ...[...written].map(([assetId, leaf]) =>
        sources.has(assetId)
          ? { assetId, place: response.place, source: true }
          : { assetId, place: response.place, entry: leaf, source: false },
      ),
    ],
  };
};

/** The local time of a visit, e.g. "Sat, Jun 14, 2025, 1:05 PM"; the server sends it without a zone */
export const formatVisitTime = (visit: Pick<CollectionVisit, 'start'>, locale?: string) =>
  DateTime.fromISO(visit.start, { zone: 'UTC', locale }).toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);

/** The local day of a visit, e.g. "Saturday, June 14, 2025" */
export const formatVisitDay = (visit: Pick<CollectionVisit, 'start'>, locale?: string) =>
  DateTime.fromISO(visit.start, { zone: 'UTC', locale }).toLocaleString(DateTime.DATE_HUGE);

export const formatVisitPlace = (visit: Pick<CollectionVisit, 'city' | 'country'>) =>
  [visit.city, visit.country].filter(Boolean).join(', ');

/** The request for the assistant to name the subjects of a visit, with its photos attached */
export const getCollectionAssistantPrompt = (
  $t: MessageFormatter,
  pack: Pick<WebCollectionPack, 'id'>,
  visit: CollectionVisit,
  place: string,
  locale?: string,
) => {
  const values = { type: visit.type ?? '', date: formatVisitDay(visit, locale), place: place.trim() };
  return visit.place.source === 'fallback' && place.trim() === visit.place.name
    ? $t(getCollectionLabel(pack, 'assistant_prompt_unknown_place'), { values })
    : $t(getCollectionLabel(pack, 'assistant_prompt'), { values });
};

/**
 * The tag of a subject or a source of any pack, `<Root>/<Place>/<Entry>` or `<Root>/<Place>/<SourceLeaf>` (e.g.
 * `Food/<Restaurant>/<Dish>`): there are too many of them to show one by one next to the other tags, so their place
 * stands for them
 */
export const isCollectionPhotoTag = (
  value: string,
  packs: readonly Pick<WebCollectionPack, 'tagRoot'>[] = collectionPacks,
) => {
  const parts = value.split('/');
  return parts.length === 3 && packs.some((pack) => pack.tagRoot === parts[0]);
};
