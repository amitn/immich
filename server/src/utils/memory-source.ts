import { DateTime } from 'luxon';
import { MemoryType } from 'src/enum.js';
import { formatDateRange } from 'src/utils/book/auto-layout.js';

/**
 * What a video, a book or a collage made from a memory covers (#5). A memory of noodle's rule engine (see
 * `src/services/memory-rules`) shows at most a dozen curated photos, but its `context` names the whole moment it
 * stands for: the window of a trip, a birthday's year, a month, a season. A creation is made from all the owner's
 * timeline photos and videos in that window (with the memory's people, favorites or videos when the rule is about
 * them), plus the memory's own photos; a memory without a window (a theme, a place across years, a hand-made one)
 * gives its own photos only.
 *
 * Times are local wall-clock times stored as UTC, like `asset.localDateTime`, which is what the rules store.
 */

export type MemorySourceKind = 'trip' | 'birthday' | 'period' | 'people' | 'day' | 'curated';

export type MemorySourceMemory = {
  id: string;
  type: MemoryType;
  data: unknown;
  memoryAt: Date;
  assetIds: string[];
};

export type MemorySource = {
  memoryId: string;
  /** the rule that made the memory, or `on_this_day` */
  ruleId: string;
  kind: MemorySourceKind;
  /** the card title in English; the web passes the card text in the viewer's language instead */
  title: string;
  /** the dates it covers, e.g. "12–19 August 2025"; undefined without a window */
  subtitle?: string;
  /** first and last local instant of the window, both included; undefined: the memory's photos only */
  from?: Date;
  to?: Date;
  /** only the photos showing all of these people (person group ids) */
  personIds: string[];
  favoritesOnly: boolean;
  videosOnly: boolean;
  /** the memory's own photos, always part of the creation */
  assetIds: string[];
  /** the key of the memory in the rule engine, e.g. `recent_trip:gr|athens:2026-09-20` */
  dedupeKey?: string;
  /** a book or video opens the chapters with maps */
  includeMaps: boolean;
  /** the book style preset to start from */
  stylePreset: string;
};

type Context = Record<string, unknown>;

const asString = (context: Context, key: string) =>
  typeof context[key] === 'string' && (context[key] as string).trim() !== '' ? (context[key] as string) : undefined;

const asNumber = (context: Context, key: string) =>
  typeof context[key] === 'number' && Number.isFinite(context[key]) ? (context[key] as number) : undefined;

const asDate = (context: Context, key: string) => {
  const value = context[key];
  const date = typeof value === 'string' || value instanceof Date ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
};

const utc = (date: Date) => DateTime.fromJSDate(date, { zone: 'utc' });

/** the whole days from the day of `start` to the day of `end` */
const wholeDays = (start: Date, end: Date) => {
  const [a, b] = start <= end ? [start, end] : [end, start];
  return { from: utc(a).startOf('day').toJSDate(), to: utc(b).endOf('day').toJSDate() };
};

const monthWindow = (year: number, month: number) => {
  const start = DateTime.utc(year, month, 1);
  return { from: start.toJSDate(), to: start.endOf('month').toJSDate() };
};

const monthYear = (year: number, month: number) => DateTime.utc(year, month, 1).setLocale('en').toFormat('LLLL yyyy');

const SEASONS: Record<string, { label: string; firstMonth: number }> = {
  spring: { label: 'Spring', firstMonth: 3 },
  summer: { label: 'Summer', firstMonth: 6 },
  autumn: { label: 'Autumn', firstMonth: 9 },
  winter: { label: 'Winter', firstMonth: 12 },
};

const THEMES: Record<string, string> = {
  sunset: 'Sunsets',
  beach: 'Beach days',
  food: 'Food',
  mountains: 'Mountains',
  snow: 'Snow days',
  city_night: 'City lights',
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

type Window = { from: Date; to: Date };

type Resolved = Pick<MemorySource, 'kind' | 'title'> &
  Partial<Pick<MemorySource, 'personIds' | 'favoritesOnly' | 'videosOnly' | 'includeMaps' | 'stylePreset'>> & {
    window?: Window;
  };

/** the window and title of each rule, from the facts it stores in `data.context` (see `memory-card.ts` on the web) */
const RULES: Record<string, (context: Context, memory: MemorySourceMemory) => Resolved | undefined> = {
  recent_trip: (context) => {
    const start = asDate(context, 'tripWindowStart');
    const end = asDate(context, 'tripWindowEnd');
    const place = asString(context, 'placeLabel');
    if (!start || !end) {
      return;
    }
    return {
      kind: 'trip',
      title: place ? `Recent trip to ${place}` : 'Recent trip',
      window: wholeDays(start, end),
      includeMaps: true,
    };
  },

  trip_anniversary: (context) => {
    const start = asDate(context, 'tripStart');
    const end = asDate(context, 'tripEnd');
    const place = asString(context, 'placeLabel');
    if (!start || !end) {
      return;
    }
    return {
      kind: 'trip',
      title: place ? `Your trip to ${place}` : 'Your trip',
      window: wholeDays(start, end),
      includeMaps: true,
    };
  },

  // the year that ended on the birthday, like the birthday books (`getBirthdayYear` in `src/utils/book/drafts.ts`)
  birthday: (context, memory) => {
    const personId = asString(context, 'personId');
    if (!personId) {
      return;
    }
    const birthday = utc(memory.memoryAt).startOf('day');
    const name = asString(context, 'personName');
    return {
      kind: 'birthday',
      title: name ? `Happy birthday, ${name}` : 'Happy birthday',
      window: { from: birthday.minus({ years: 1 }).toJSDate(), to: birthday.endOf('day').toJSDate() },
      personIds: [personId],
      stylePreset: 'soft',
    };
  },

  month_recap: (context) => {
    const [year, month] = [asNumber(context, 'year'), asNumber(context, 'month')];
    return year && month
      ? { kind: 'period', title: monthYear(year, month), window: monthWindow(year, month) }
      : undefined;
  },

  favorites_throwback: (context) => {
    const [year, month] = [asNumber(context, 'year'), asNumber(context, 'month')];
    return year && month
      ? {
          kind: 'period',
          title: `Favorite moments from ${monthYear(year, month)}`,
          window: monthWindow(year, month),
          favoritesOnly: true,
        }
      : undefined;
  },

  video_moments: (context) => {
    const [year, month] = [asNumber(context, 'year'), asNumber(context, 'month')];
    return year && month
      ? {
          kind: 'period',
          title: `Video moments from ${monthYear(year, month)}`,
          window: monthWindow(year, month),
          videosOnly: true,
        }
      : undefined;
  },

  season_recap: (context) => {
    const season = SEASONS[asString(context, 'season') ?? ''];
    const seasonYear = asNumber(context, 'seasonYear');
    if (!season || !seasonYear) {
      return;
    }
    // a winter starts in the December of its season-year (see `seasonYearOf`)
    const start = DateTime.utc(seasonYear, season.firstMonth, 1);
    return {
      kind: 'period',
      title: `${season.label} ${seasonYear}`,
      window: { from: start.toJSDate(), to: start.plus({ months: 2 }).endOf('month').toJSDate() },
    };
  },

  people_together: (context) => {
    const [year, month] = [asNumber(context, 'year'), asNumber(context, 'month')];
    const [a, b] = [asString(context, 'personAId'), asString(context, 'personBId')];
    if (!year || !month || !a || !b) {
      return;
    }
    const names = [asString(context, 'personAName'), asString(context, 'personBName')];
    return {
      kind: 'people',
      title: names.every(Boolean) ? `${names[0]} & ${names[1]}` : monthYear(year, month),
      window: monthWindow(year, month),
      personIds: [a, b],
    };
  },

  person_throwback: (context) => {
    const personId = asString(context, 'personId');
    const [from, to] = [asDate(context, 'chapterFrom'), asDate(context, 'chapterTo')];
    if (!personId || !from || !to) {
      return;
    }
    const name = asString(context, 'personName');
    return {
      kind: 'people',
      title: name ? `Times with ${name}` : 'Times together',
      window: wholeDays(from, to),
      personIds: [personId],
    };
  },

  // the whole year in review (#12)
  year_recap: (context) => {
    const year = asNumber(context, 'year');
    if (!year) {
      return;
    }
    const start = DateTime.utc(year, 1, 1);
    return {
      kind: 'period',
      title: `${year} in review`,
      window: { from: start.toJSDate(), to: start.endOf('year').toJSDate() },
    };
  },

  // a theme and a place across years have no window: their own photos are the moment
  themed: (context) => {
    const theme = THEMES[asString(context, 'theme') ?? ''];
    const year = asNumber(context, 'year');
    return theme && year ? { kind: 'curated', title: `${theme} from ${year}` } : undefined;
  },

  on_this_day_place: (context) => {
    const city = asString(context, 'city');
    return city ? { kind: 'curated', title: `On this day in ${city}` } : undefined;
  },
};

/** the window, filters and title of a memory, to make a video, a book or a collage of it */
export const getMemorySource = (memory: MemorySourceMemory, now = new Date()): MemorySource => {
  const data = (memory.data ?? {}) as Record<string, unknown>;
  let ruleId: string;
  let resolved: Resolved | undefined;

  if (memory.type === MemoryType.OnThisDay) {
    ruleId = 'on_this_day';
    const year = typeof data.year === 'number' ? data.year : utc(memory.memoryAt).year;
    const day = utc(memory.memoryAt);
    const yearsAgo = utc(now).year - year;
    resolved = {
      kind: 'day',
      title: yearsAgo > 0 ? `${plural(yearsAgo, 'year')} ago` : day.setLocale('en').toFormat('d LLLL yyyy'),
      window: { from: day.startOf('day').toJSDate(), to: day.endOf('day').toJSDate() },
    };
  } else {
    ruleId = typeof data.ruleId === 'string' ? data.ruleId : 'unknown';
    const context = (data.context ?? {}) as Context;
    resolved = RULES[ruleId]?.(context, memory);
  }

  // a memory made before its rule stored a window, or by hand: its own photos
  resolved ??= { kind: 'curated', title: '' };
  const title = (typeof data.title === 'string' && data.title.trim()) || resolved.title || 'Memories';

  return {
    memoryId: memory.id,
    ruleId,
    kind: resolved.kind,
    title,
    ...(resolved.window && {
      from: resolved.window.from,
      to: resolved.window.to,
      subtitle: formatDateRange(resolved.window.from.getTime(), resolved.window.to.getTime()),
    }),
    personIds: resolved.personIds ?? [],
    favoritesOnly: resolved.favoritesOnly ?? false,
    videosOnly: resolved.videosOnly ?? false,
    assetIds: [...new Set(memory.assetIds)],
    ...(typeof data.dedupeKey === 'string' && { dedupeKey: data.dedupeKey }),
    includeMaps: resolved.includeMaps ?? false,
    stylePreset: resolved.stylePreset ?? 'classic',
  };
};
