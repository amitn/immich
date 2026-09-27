import type { OcrBoxInput } from 'src/utils/collections/ocr.js';
import { CollectionReviewInput, CollectionReviewIssue, CollectionSourcePage } from 'src/utils/collections/pack.js';
import { WEEKDAYS, isSetlistMarker, readConcertSource } from 'src/utils/collections/packs/concerts/lineup.js';

/** the theme of concert books: the printed look on dark paper, with a bright accent (see `render.ts`) */
export const GIG_POSTER_THEME = 'gig-poster';

/** the minutes of a start into its night: "00:00" comes after "23:00" */
const getNightMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours < 6 ? hours + 24 : hours) * 60 + minutes;
};

/**
 * The page of a setlist or a line-up in a concert book (the `setlist` layout, see `setlist-page.ts`): the act and
 * where and when it played, then its songs, numbered; or the stage of a line-up, then its acts with their starts under
 * their days. The page joins the chapter of the act photographed closest to it (a setlist is photographed on stage,
 * right before, during or after its set), so it names no entry: the act as printed ("CHERRYGLAZERR") may be spelled
 * differently from the act as saved.
 */
export const formatSetlistPage = (
  ocr: OcrBoxInput[],
  { aspectRatio, place }: { aspectRatio?: number; place: string },
): CollectionSourcePage | undefined => {
  const source = readConcertSource(ocr, { aspectRatio });
  if (source.kind === 'setlist') {
    const songs = source.songs.filter((song) => !isSetlistMarker(song));
    if (songs.length < 3) {
      return;
    }
    const own = source.acts.find((act) => act.setlist === 'own');
    const billed = source.acts.filter((act) => act.setlist === 'billed').map((act) => act.name);
    const where = [source.venue ?? place.trim(), source.date].filter(Boolean).join(' · ');
    let number = 0;
    const list = source.songs.map((song) => (isSetlistMarker(song) ? song : `${++number}. ${song}`));
    const header = [own?.name ?? 'Setlist', ...(billed.length > 0 ? [`with ${billed.join(', ')}`] : []), where];
    return { text: `${header.filter(Boolean).join('\n')}\n\n${list.join('\n')}` };
  }

  const timed = source.acts.filter((act) => act.time);
  if (timed.length < 3) {
    return;
  }
  const title = source.title ?? 'Line-up';
  const days = Map.groupBy(timed, (act) => act.weekday ?? -1);
  const paragraphs = [...days]
    .toSorted(([a], [b]) => a - b)
    .map(([weekday, acts]) => {
      const lines = acts
        .toSorted((a, b) => getNightMinutes(a.time!) - getNightMinutes(b.time!))
        .map((act) => `${act.time} ${act.name}${act.stage && act.stage !== title ? ` — ${act.stage}` : ''}`);
      return [...(weekday === -1 ? [] : [`${WEEKDAYS[weekday]}:`]), ...lines].join('\n');
    });
  return { text: `${title}\n${place.trim()}\n\n${paragraphs.join('\n\n')}` };
};

/** "Kali Uchis · Primavera Sound 2019": the act, then the festival or the venue and the night */
export const getActChapterTitle = (act: string, place: string) => `${act.trim()} · ${place.trim()}`;

const formatPages = (pages: number[]) =>
  pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.slice(0, -1).join(', ')} and ${pages.at(-1)}`;

/**
 * The concerts pack's own check of its books: an act whose chapter shows only its setlist or line-up page, and no
 * photo of the set, while the album has some
 */
export const reviewConcertBook = ({ chapters }: CollectionReviewInput): CollectionReviewIssue[] =>
  chapters.flatMap((chapter) => {
    const placed = new Set(chapter.placed.flatMap(({ assetIds }) => assetIds));
    const missing = chapter.available.filter(({ assetIds }) => assetIds.every((id) => !placed.has(id)));
    if (chapter.placed.length > 0 || missing.length === 0) {
      return [];
    }
    return [
      {
        severity: 'low' as const,
        type: 'could-look-better' as const,
        message:
          `${formatPages(chapter.pages)} of ${chapter.place} ${chapter.pages.length === 1 ? 'shows' : 'show'} no photo ` +
          `of the set of ${missing[0].entry}: the album has some, add one beside the setlist`,
        pages: chapter.pages,
        assetIds: missing.flatMap(({ assetIds }) => assetIds).slice(0, 6),
      },
    ];
  });
