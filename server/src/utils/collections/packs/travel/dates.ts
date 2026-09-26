/**
 * Dates and times as travel documents print them, in many languages and formats: "04/10/2016 05:00" (day first in
 * Europe), "12NOV19" and "09N0V" (airline style, OCR reads O as 0), "4 ΟΚΤ. 2016" (Greek, or its Latin lookalikes
 * "4 OKT 2016"), "2019年11月11日" and "12時37分" (Japanese and Chinese), "2016-10-04", "0945" after a Depart label.
 */

export type TravelDate = {
  /** undefined when the year is not printed, e.g. "09NOV" */
  year?: number;
  /** 1-12 */
  month: number;
  day: number;
};

export type TravelTime = { hour: number; minute: number };

export type DateMatch = TravelDate & { index: number; length: number; text: string };

export type TimeMatch = TravelTime & { index: number; length: number; text: string };

/** month names and abbreviations, lowercase, without accents: English, Greek (and its Latin lookalikes), and more */
const MONTHS: Array<[number, string[]]> = [
  [1, ['jan', 'january', 'ian', 'ιαν', 'ιανουαριου', 'ιανουαριος', 'jän', 'janv', 'gen', 'ene']],
  [2, ['feb', 'february', 'φεβ', 'φεβρουαριου', 'fev', 'fevr', 'febr']],
  [3, ['mar', 'march', 'μαρ', 'μαρτιου', 'mrz', 'mars', 'marz']],
  [4, ['apr', 'april', 'απρ', 'απριλιου', 'avr', 'abr', 'aπp']],
  [5, ['may', 'μαι', 'μαιου', 'mai', 'mag', 'mayo']],
  [6, ['jun', 'june', 'ιουν', 'ιουνιου', 'juin', 'giu', 'juni']],
  [7, ['jul', 'july', 'ιουλ', 'ιουλιου', 'juil', 'lug', 'juli']],
  [8, ['aug', 'august', 'αυγ', 'αυγουστου', 'aou', 'ago', 'avg']],
  [9, ['sep', 'sept', 'september', 'σεπ', 'σεπτ', 'σεπτεμβριου', 'set']],
  [10, ['oct', 'october', 'οκτ', 'οκτωβριου', 'okt', 'ott', 'out']],
  [11, ['nov', 'november', 'νοε', 'νοεμβριου', 'noe']],
  [12, ['dec', 'december', 'δεκ', 'δεκεμβριου', 'dez', 'dic', 'dek']],
];

const MONTH_BY_NAME = new Map(MONTHS.flatMap(([month, names]) => names.map((name) => [name, month] as const)));

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const stripAccents = (text: string) => text.normalize('NFD').replaceAll(/\p{Diacritic}/gu, '');

/** "N0V" → "nov": OCR reads the letter O of a month as a zero */
const toMonthKey = (text: string) => stripAccents(text).toLowerCase().replaceAll('0', 'o').replace(/\.$/, '');

export const getMonth = (text: string): number | undefined => MONTH_BY_NAME.get(toMonthKey(text));

const isValidDate = ({ year, month, day }: TravelDate) =>
  month >= 1 && month <= 12 && day >= 1 && day <= 31 && (year === undefined || (year >= 1950 && year <= 2100));

const toYear = (text: string | undefined) => {
  if (!text) {
    return;
  }
  const value = Number(text);
  return text.length === 2 ? 2000 + value : value;
};

export type DateOrder = 'dmy' | 'mdy';

const MONTH_WORD = String.raw`[\p{L}0]{3,12}\.?`;

export type DateOrders = {
  /** how to read "04/10/2016": day first (Europe, the default) or month first (United States) */
  order?: DateOrder;
  /** how to read "11/11" without a year: day first (Europe, the default) or month first (Japan, United States) */
  shortOrder?: DateOrder;
};

/** The dates in a text, in the order they appear */
export const findDates = (text: string, { order = 'dmy', shortOrder = order }: DateOrders = {}): DateMatch[] => {
  const found: DateMatch[] = [];
  const add = (index: number, length: number, date: TravelDate) => {
    if (
      isValidDate(date) &&
      found.every((other) => !(index < other.index + other.length && other.index < index + length))
    ) {
      found.push({ ...date, index, length, text: text.slice(index, index + length) });
    }
  };

  // 2019年11月11日, 2019/11/11, 2016-10-04: year first
  for (const match of text.matchAll(
    /(?<!\d)((?:19|20)\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?(?!\d)/g,
  )) {
    add(match.index, match[0].length, { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
  }
  // 11月11日 (no year)
  for (const match of text.matchAll(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
    add(match.index, match[0].length, { month: Number(match[1]), day: Number(match[2]) });
  }
  // 04/10/2016, 4.10.16: day and month in the order of the country
  for (const match of text.matchAll(/(?<!\d)(\d{1,2})\s?[/.-]\s?(\d{1,2})\s?[/.-]\s?((?:19|20)\d{2}|\d{2})(?!\d)/g)) {
    const [first, second] = [Number(match[1]), Number(match[2])];
    const monthFirst = order === 'mdy' ? first <= 12 : first <= 12 && second > 12;
    const date = monthFirst
      ? { year: toYear(match[3]), month: first, day: second }
      : { year: toYear(match[3]), month: second, day: first };
    add(match.index, match[0].length, date);
  }
  // 12NOV19, 09N0V, 4 OKT 2016, 4 ΟΚΤ. 2016, 4 October 2016
  for (const match of text.matchAll(
    new RegExp(
      String.raw`(?<![\p{L}\d])(\d{1,2})\s?(${MONTH_WORD})(?:\s?,?\s?((?:19|20)\d{2}|\d{2}))?(?![\p{L}\d])`,
      'gu',
    ),
  )) {
    const month = getMonth(match[2]);
    if (month) {
      add(match.index, match[0].length, { year: toYear(match[3]), month, day: Number(match[1]) });
    }
  }
  // Oct 4, 2016 / October 4 2016
  for (const match of text.matchAll(
    new RegExp(String.raw`(?<![\p{L}\d])(${MONTH_WORD})\s(\d{1,2})(?:,?\s((?:19|20)\d{2}))?(?![\p{L}\d])`, 'gu'),
  )) {
    const month = getMonth(match[1]);
    if (month) {
      add(match.index, match[0].length, { year: toYear(match[3]), month, day: Number(match[2]) });
    }
  }
  // 11/11 (no year), only month first in the order of the country, e.g. a Japanese receipt "11/11 12:37"
  for (const match of text.matchAll(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
    const [first, second] = [Number(match[1]), Number(match[2])];
    add(
      match.index,
      match[0].length,
      shortOrder === 'mdy' ? { month: first, day: second } : { month: second, day: first },
    );
  }
  return found.toSorted((a, b) => a.index - b.index);
};

/**
 * The times in a text: "05:00", "17.30", "D9:20" (OCR reads 0 as D or O), "12時37分", "0945" (only with
 * `bareDigits`, e.g. after a Depart label, since four digits are often a year or a number). Seconds are dropped.
 */
export const findTimes = (text: string, { bareDigits = false }: { bareDigits?: boolean } = {}): TimeMatch[] => {
  const found: TimeMatch[] = [];
  const add = (index: number, length: number, hour: number, minute: number) => {
    if (
      hour <= 23 &&
      minute <= 59 &&
      found.every((other) => !(index < other.index + other.length && other.index < index + length))
    ) {
      found.push({ hour, minute, index, length, text: text.slice(index, index + length) });
    }
  };
  for (const match of text.matchAll(/(\d{1,2})\s*時\s*(\d{1,2})\s*分/g)) {
    add(match.index, match[0].length, Number(match[1]), Number(match[2]));
  }
  // "8.30 €" and "EUR 16.20" are prices, "04.10.2016" a date: a time with a dot has two digits for the hour
  for (const match of text.matchAll(
    /(?<![\d:.]|(?:€|eur|\$)\s?)([0-2]?\d|[DO]\d)\s?([:.])\s?([0-5]\d)(?::[0-5]\d)?(?![\d.,]|\s?(?:€|eur|円|\$|%))/gi,
  )) {
    if (match[2] === '.' && match[1].length < 2) {
      continue;
    }
    add(match.index, match[0].length, Number(match[1].replace(/^[do]/i, '0')), Number(match[3]));
  }
  if (bareDigits) {
    for (const match of text.matchAll(/(?<!\d)([01]\d|2[0-3])([0-5]\d)(?!\d)/g)) {
      add(match.index, match[0].length, Number(match[1]), Number(match[2]));
    }
  }
  return found.toSorted((a, b) => a.index - b.index);
};

/** "04/10/201618:30" → "04/10/2016 18:30": OCR runs a time into the year before it */
export const separateDateTime = (text: string) => text.replaceAll(/((?:19|20)\d{2})(\d{2}[:.]\d{2})/g, '$1 $2');

const pad = (value: number) => String(value).padStart(2, '0');

/** "4 Oct 2016", "9 Nov" */
export const formatDate = ({ year, month, day }: TravelDate) =>
  `${day} ${MONTH_NAMES[month - 1]}${year === undefined ? '' : ` ${year}`}`;

/** "October 2016" */
export const formatMonth = (year: number, month: number) => `${MONTH_FULL_NAMES[month - 1]} ${year}`;

export const formatTime = ({ hour, minute }: TravelTime) => `${pad(hour)}:${pad(minute)}`;

/** "2016-10-04" */
export const toIsoDate = ({ year, month, day }: Required<TravelDate>) => `${year}-${pad(month)}-${pad(day)}`;

/** local wall-clock time in ms, as `localDateTime.getTime()` */
export const toLocalTime = ({ year, month, day }: Required<TravelDate>, time?: TravelTime) =>
  Date.UTC(year, month - 1, day, time?.hour ?? 0, time?.minute ?? 0);

export const DAY_MS = 24 * 60 * 60 * 1000;

/** the year that puts a day and month without a year closest to a time (e.g. the photos of the trip) */
export const getNearestYear = ({ month, day }: TravelDate, near: number) => {
  const year = new Date(near).getUTCFullYear();
  return [year - 1, year, year + 1].toSorted(
    (a, b) => Math.abs(Date.UTC(a, month - 1, day) - near) - Math.abs(Date.UTC(b, month - 1, day) - near),
  )[0];
};
