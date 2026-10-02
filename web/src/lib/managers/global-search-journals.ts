import { searchCollections, type CollectionSearchVisitDto } from '@immich/sdk';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';

/**
 * The "From your journals" section of the Search Palette: the visits of the collections (a meal, a museum visit, a
 * gig…) whose names match what was typed, found without AI by `GET /collections/search`, and a last row that asks
 * the assistant the question. It takes over from the answers panel of the search page, which stays for `/search`.
 */

/** how many visits the section lists */
export const JOURNALS_TOP_N = 4;
/** the id of the row that asks the assistant (a visit id always has a `|`) */
export const ASK_ASSISTANT_ID = 'ask';

export type JournalVisitItem = { id: string; kind: 'visit'; visit: CollectionSearchVisitDto };
export type JournalAskItem = { id: typeof ASK_ASSISTANT_ID; kind: 'ask'; question: string };
export type JournalItem = JournalVisitItem | JournalAskItem;

export type JournalsStatus = { status: 'ok'; items: JournalItem[]; total: number } | { status: 'empty' };

export const getJournalVisitId = (visit: Pick<CollectionSearchVisitDto, 'tag' | 'date'>) =>
  `${visit.tag}|${visit.date}`;

/** e.g. "12 Mar 2024 · Sydney", or "3 – 9 Oct 2016 · Crete" for a visit of several days */
export const formatJournalVisit = (visit: CollectionSearchVisitDto) =>
  [visit.endDate ? `${visit.date} – ${visit.endDate}` : visit.date, visit.city ?? visit.country]
    .filter(Boolean)
    .join(' · ');

export async function runJournalsProvider(query: string, signal: AbortSignal): Promise<JournalsStatus> {
  const question = query.trim();
  const ask: JournalAskItem[] = featureFlagsManager.valueOrUndefined?.assistant
    ? [{ id: ASK_ASSISTANT_ID, kind: 'ask', question }]
    : [];

  let visits: JournalVisitItem[] = [];
  let total = 0;
  try {
    const result = await searchCollections({ q: question }, { signal });
    visits = result.visits
      .slice(0, JOURNALS_TOP_N)
      .map((visit) => ({ id: getJournalVisitId(visit), kind: 'visit', visit }));
    total = result.total;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    // the section only adds to the results: when the collections can't be searched, it shows the assistant alone,
    // or nothing
  }

  const items: JournalItem[] = [...visits, ...ask];
  return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: total + ask.length };
}
