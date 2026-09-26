import { findColumns } from 'src/utils/collections/layout.js';
import {
  OcrBoxInput,
  TextBox,
  TextLine,
  deskewBoxes,
  groupLines,
  median,
  toTextBoxes,
} from 'src/utils/collections/ocr.js';
import {
  DateOrders,
  TravelDate,
  TravelTime,
  findDates,
  findTimes,
  formatDate,
  formatTime,
  separateDateTime,
} from 'src/utils/collections/packs/travel/dates.js';
import { isGreekLookalike, readGreekName } from 'src/utils/collections/packs/travel/greek.js';
import { ParsedSource, SourceParseOptions } from 'src/utils/collections/source.js';

/**
 * Reading a travel document (a boarding pass; a bus, train, ferry or monorail ticket; a park or museum entry ticket;
 * a fare receipt) into the leg of a journey it is for: its mode, carrier, flight or train number, from, to, date,
 * time, seat and class. Documents print their fields with labels, in the language of the country and often in
 * English too ("ΑΠΟ-ΠΡΟΣ" over "FROM-TO"), inline ("Seat: 17B") or as a table (GATE over B8); the labels are matched
 * as printed and as OCR misreads them (Greek as Latin lookalikes, a letter cut off at the edge of the photo). Nothing
 * that is not a field of the journey is read: names, booking references and ticket numbers never leave this file.
 */

export const travelModes = ['flight', 'train', 'bus', 'ferry', 'monorail', 'metro', 'tram', 'entry'] as const;
export type TravelMode = (typeof travelModes)[number];

export type TimeKind = 'departure' | 'boarding' | 'purchase';

export type TicketFields = {
  mode?: TravelMode;
  /** a receipt of a fare rather than the ticket itself */
  receipt?: boolean;
  carrier?: string;
  /** flight or train number, e.g. BR186 */
  number?: string;
  from?: string;
  to?: string;
  /** IATA codes of the airports, e.g. TPE and OKA */
  fromCode?: string;
  toCode?: string;
  /** the park or museum of an entry ticket */
  venue?: string;
  date?: TravelDate;
  time?: TravelTime;
  timeKind?: TimeKind;
  /** another time written on the document (by hand, over the printed one): the time may not be the one used */
  otherTime?: string;
  arrival?: TravelTime;
  seat?: string;
  travelClass?: string;
  gate?: string;
  platform?: string;
  vessel?: string;
  /** the bus or coach number */
  coach?: string;
  fare?: string;
  /** names read from Greek print in Latin lookalikes, which may be misspelled */
  lookalike?: boolean;
  /** what could not be read, and what is ambiguous */
  flags: string[];
  box: [number, number, number, number];
};

type Segment = {
  label?: FieldLabel;
  value: string;
  line: TextLine;
  boxes: TextBox[];
  /** the label is followed by a colon ("Depart: OKINAWA") */
  colon?: boolean;
};

type FieldLabel =
  | 'date'
  | 'datetime'
  | 'time'
  | 'issued'
  | 'fromTo'
  | 'from'
  | 'to'
  | 'depart'
  | 'arrive'
  | 'route'
  | 'seat'
  | 'coach'
  | 'platform'
  | 'gate'
  | 'boarding'
  | 'class'
  | 'category'
  | 'vessel'
  | 'flight'
  | 'fare'
  | 'zone'
  | 'name'
  | 'number';

/**
 * Labels as printed and as OCR reads them: Greek in Latin lookalikes (ΗΜΕΡΟΜΗΝΙΑ → HMEPOMHNIA, ΑΠΟ-ΠΡΟΣ →
 * ANO-MPOE), a first letter cut off (VESSEL → /ESSEL), Japanese and Chinese. Longer labels first.
 */
const LABELS: Array<[FieldLabel, string]> = [
  [
    'issued',
    String.raw`(?:hmepomhnia|ημερομηνια|[hi]m\/nia|ημ\/νια)?[\s-]*(?:[odr0]pa|ωρα)?[\s-]*(?:ekao[zeσ]h[se]|ekδoσhσ|εκδοσησ|ekδ|εκδ|eko)\b\.?|date\s+of\s+issue|issued?(?:\s+on)?|発行日?|發行|開票日?|出票`,
  ],
  [
    'datetime',
    String.raw`(?:hmepomhnia|ημερομηνια|[hi]m\/nia|ημ\/νια)[\s-]*(?:[odr0]pa|ωρα|rpa)|date[\s-]*(?:and\s+|&\s*)?time|j?ate-time`,
  ],
  ['boarding', String.raw`boarding\s*(?:time|at)?|登機時間|搭乗(?:開始)?時刻|登機`],
  ['date', String.raw`hmepomhnia|ημερομηνια|[hi]m\/nia|ημ\/νια|date|datum|利用日付|日付|日期|乗車日`],
  ['time', String.raw`(?<![\p{L}])(?:[odr0]pa|ωρα)(?![\p{L}])|time|時刻|時間|发车时间|發車時間`],
  ['fromTo', String.raw`(?:ano|απο|aπo|no|πo)[\s-]*(?:[mnп]poe|προσ|πpoσ|npoσ)|:?f?rom[\s-]*to|区間|區間|起訖`],
  ['route', 'route|[a∆δ]?pomoaotio[yυ]?|δρομολογιο[υ]?'],
  ['depart', String.raw`depart(?:ure|s)?|dep\b|出発|出發|發車|起飛|αναχωρ\p{L}*|anax[oω]p\p{L}*`],
  ['arrive', String.raw`arriv(?:e|al|es)|arr\b|到着|抵達`],
  ['from', String.raw`from(?=\s*[:：])|発駅|出発駅|起站`],
  ['to', String.raw`to(?=\s*[:：])|着駅|到站`],
  ['seat', String.raw`seat(?:\s*no)?|[o0θ][eε][eσzξ]h|θεση|座席|座位|席番`],
  ['coach', 'bus|coach|car|carriage|λεωφορειο|aeδωφopeio|aedqopeio|aeωφopeio|号車|車廂|车厢'],
  ['platform', 'platform|track|gleis|[a∆δ]iaapomo[eσ]|διαδρομοσ|乗り場|のりば|月台|站台'],
  ['gate', 'gate|登機門|搭乗口|閘口'],
  ['class', 'class|cabin|θεσεισ|艙等|クラス'],
  ['category', String.raw`cat(?:egory)?\.?|kathtopia|κατηγορια`],
  ['vessel', String.raw`v?\/?essel|ship|πλοιο|nλoio|船名`],
  ['flight', String.raw`fl(?:igh)?t(?:\s*no)?|f[il1]t|航班|便名`],
  [
    'fare',
    String.raw`fare|price|amount|total|timh(?:\s+ei[sσzξe]ithpio[yυ])?|τιμη|nay[aλ]o[eσ]|ναυλοσ|金額|運賃|票價|票价`,
  ],
  ['zone', 'zone|區|区'],
  [
    'name',
    String.raw`passenger(?:\s+name)?|name|[oj0]?nomate\p{L}*|ονοματεπωνυμο|e[mnп]ibath\p{L}*|επιβατη\p{L}*|氏名|姓名`,
  ],
  [
    'number',
    String.raw`seq(?:uence)?(?:\s*nbr)?|sqn|pnr|ssr|ticket\s*no|no\.?(?=\s*\d)|[a∆]pio\.?\s*ei[sσzξ]ithpio[yυ]|券番号|伝票番号|票號`,
  ],
];

const LABEL_PATTERN = new RegExp(
  LABELS.map(([field, pattern]) => String.raw`(?<${field}>(?<![\p{L}\d])(?:${pattern})(?![\p{L}\d]))`).join('|'),
  'giu',
);

const cleanValue = (text: string) =>
  text
    .replaceAll(/^[\s:：.,;/|-]+|[\s:：,;/|-]+$/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();

/** a line cut where its labels are: each label with the text up to the next one */
const segmentLine = (line: TextLine): Segment[] => {
  const text = separateDateTime(line.text);
  const matches = text
    .matchAll(LABEL_PATTERN)
    .map((match) => ({
      label: Object.entries(match.groups!).find(([, value]) => value !== undefined)![0] as FieldLabel,
      index: match.index,
      end: match.index + match[0].length,
    }))
    .toArray();
  const segments: Segment[] = [];
  const boxesIn = (start: number, end: number) => {
    // the boxes whose text falls in [start, end) of the line text
    let offset = 0;
    const result: TextBox[] = [];
    for (const box of line.boxes) {
      const boxStart = offset;
      offset += box.text.length + 1;
      if (boxStart < end && offset - 1 > start) {
        result.push(box);
      }
    }
    return result;
  };
  if (matches.length === 0 || matches[0].index > 0) {
    const end = matches[0]?.index ?? text.length;
    const value = cleanValue(text.slice(0, end));
    if (value) {
      segments.push({ value, line, boxes: boxesIn(0, end) });
    }
  }
  for (const [index, match] of matches.entries()) {
    const end = matches[index + 1]?.index ?? text.length;
    segments.push({
      label: match.label,
      value: cleanValue(text.slice(match.end, end)),
      line,
      boxes: boxesIn(match.end, end),
      ...(/^\s*[:：]/.test(text.slice(match.end)) && { colon: true }),
    });
  }
  return segments;
};

const MODE_WORDS: Array<[TravelMode, RegExp]> = [
  ['monorail', /monorail|モノレール/i],
  ['metro', /\bmetro\b|subway|u-bahn|地下鉄|捷運|地铁|地鐵/i],
  ['ferry', /\bferr(?:y|ies)\b|\/?\bv?essel\b|\bship\b|\bdeck\b|\bcabin\b|πλοιο|nλoio|渡輪|渡轮|フェリー|船/i],
  [
    'flight',
    /boarding\s*(?:pass|time|at)|\bfl(?:igh)?t\b|\bgate\b|airlines?|airways|\w+air\b|登機|搭乗|航班|航空|虎航|\b[A-Z]{3}\s?[-–>]\s?[A-Z]{3}\b/i,
  ],
  [
    'train',
    /\btrain\b|\brail(?:way)?\b|\bcarriage\b|列車|鉄道|号車|新幹線|火車|高鐵|τρενο|trenitalia|renfe|sncf|amtrak|eurostar/i,
  ],
  ['tram', /\btram\b|straßenbahn|路面電車|輕軌/i],
  ['bus', /\bbus\b|\bcoach\b|ktel|ktea|κτελ|λεωφορειο|aedqopeio|バス|巴士|公車|客運|autobus/i],
  [
    'entry',
    /national\s*park|\bmuseum\b|admission|entrance|\bentry\b|exit\s*control|valid\s+on\s+the\s+day|入場|入场|門票|门票|観光|美術館|博物館|musée|museo|μουσειο|δρυμο|apymo|εισοδ/i,
  ],
];

const RECEIPT = /receipt|領収[証書]|收據|收据|απόδειξη|αποδειξη/i;

const MODE_NAMES: Record<TravelMode, string> = {
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
  ferry: 'Ferry',
  monorail: 'Monorail',
  metro: 'Metro',
  tram: 'Tram',
  entry: 'Entry',
};

export const getModeName = (mode: TravelMode) => MODE_NAMES[mode];

const detectMode = (text: string): TravelMode | undefined => {
  const scores = MODE_WORDS.map(([mode, pattern]) => ({
    mode,
    score: (text.match(new RegExp(pattern.source, 'gi' + (pattern.unicode ? 'u' : ''))) ?? []).length,
  }));
  const best = scores.filter(({ score }) => score > 0).toSorted((a, b) => b.score - a.score)[0];
  // a monorail, a metro or a ferry is named on the document: it beats the words a bus or a flight shares with it
  const named = scores.find(({ mode, score }) => ['monorail', 'metro', 'ferry'].includes(mode) && score > 0);
  return named?.mode ?? best?.mode;
};

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** "EVAAIR" → "EVA Air", "tigerair" → "Tigerair", "(沖縄都市モノレール線)" → "沖縄都市モノレール" */
const cleanCarrier = (text: string) => {
  const value = text
    .replace(/^[\d\s:.,-]+/, '')
    .replaceAll(/[()（）「」]/g, '')
    .replace(/(?:株式会社|有限会社|線|[\s,.]+(?:a\.?\s?e|s\.?\s?a|ltd|inc|co)\.?)$/i, '')
    .replace(/^株式会社/, '')
    .trim();
  if (/^[A-Z]{2,5}AIR$/.test(value)) {
    return `${value.slice(0, -3)} Air`;
  }
  return value === value.toLowerCase() ? value.charAt(0).toUpperCase() + value.slice(1) : value;
};

/** the Greek bus operators' cooperative, as OCR reads ΚΤΕΛ */
const KNOWN_ACRONYMS: Record<string, string> = { KTEA: 'KTEL', ΚΤΕΛ: 'KTEL' };

/** the carrier: an airline, or the company named at the top of the document (Greek decoded) */
const findCarrier = (lines: TextLine[], mode: TravelMode | undefined, greek: boolean): string | undefined => {
  const text = lines.map((line) => line.text).join('\n');
  const known = text
    .split(/[^\p{L}]+/u)
    .map((word) => KNOWN_ACRONYMS[word.toUpperCase()])
    .find(Boolean);
  if (known) {
    return known;
  }
  if (mode === 'flight') {
    const airline =
      /\b(\p{L}+\s(?:airlines?|airways))\b/iu.exec(text)?.[1] ??
      /(?<![\p{L}])(\p{L}{2,}air)(?![\p{L}])/iu.exec(text)?.[1] ??
      /(\p{Script=Han}{2,6}(?:航空|虎航))/u.exec(text)?.[1];
    if (airline) {
      return cleanCarrier(airline);
    }
  }
  const company = lines.find((line) =>
    /(?:^|\s)(?:a\.?\s?e|s\.?\s?a|ltd|inc|gmbh|株式会社)\.?$|\(.*(?:線|鉄道|バス|モノレール).*\)|^\(?[^\s]+(?:線|鉄道|株式会社)\)?$/i.test(
      line.text,
    ),
  );
  if (!company) {
    return;
  }
  const words = company.text.split(/\s+/);
  if (greek) {
    const first = words[0];
    // a company acronym, e.g. ANENAYK (ΑΝΕΝΔΥΚ): decoded, it is kept in capitals
    return isGreekLookalike(first, true) ? readGreekName(first).name.toUpperCase() : cleanCarrier(company.text);
  }
  return cleanCarrier(company.text);
};

/** whether two words share a run of `length` letters: the same name read twice ("ZAMAPIA" and "EAMAPIA") */
const sharesRun = (a: string, b: string, length: number) => {
  for (let index = 0; index + length <= a.length; index++) {
    if (b.includes(a.slice(index, index + length))) {
      return true;
    }
  }
  return false;
};

const IATA_PAIR = /(?<![\p{L}\d])([A-Z]{3})\s?[-–>→]\s?([A-Z]{3})(?![\p{L}\d])/u;
const FLIGHT_NUMBER = /(?<![\p{L}\d])([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?0*(\d{1,4})(?=[/\s]|$)/u;

/** words printed on documents that are not places */
const NOT_PLACE =
  /^(?:passenger|vehicle|adult|child|full|single|return|one|way|economy|business|class|seat|gate|zone|fare|price|ticket|route|from|to|date|time|bus|platform|category|exit|control|national|park|boarding|pass|flight|depart|arrive|sequence|ticket|valid|only|the|day|and|of|a|e|s)$/i;

/** a place name as printed: title case, Greek lookalikes decoded; undefined when it is not a name */
const readPlace = (text: string, greek: boolean) => {
  const value = cleanValue(text.replaceAll(/[()（）]/g, ' '));
  const words = value.split(/\s+/).filter((word) => word.length > 0);
  if (
    value.length < 2 ||
    words.length > 4 ||
    !/\p{L}{2}/u.test(value) ||
    /\d{2}/.test(value) ||
    words.every((word) => NOT_PLACE.test(word.replaceAll(/[^\p{L}]/gu, '')))
  ) {
    return;
  }
  // "OK INAWA": OCR split a word
  const joined =
    words.length === 2 && Math.min(words[0].length, words[1].length) <= 2 && /^\p{Lu}+$/u.test(words.join(''))
      ? words.join('')
      : value;
  if (CJK.test(joined)) {
    return { name: joined, lookalike: false };
  }
  if (greek || /\p{Script=Greek}/u.test(joined)) {
    return readGreekName(joined);
  }
  return {
    name:
      joined === joined.toUpperCase()
        ? joined.toLowerCase().replaceAll(/(^|[\s-])(\p{L})/gu, (_, s, l) => s + l.toUpperCase())
        : joined,
    lookalike: false,
  };
};

/**
 * The fare: an amount in euros ("8.30 €", "EUR 16,20", "€ 5,00") or in yen ("金 230円", "270 円区間", or the fare
 * printed large on a Japanese ticket); the child fare ("小児140円") is not the one paid
 */
const findFare = (text: string, lines: TextLine[]) => {
  const euro = /(?:€|eur)\s?(\d{1,4}[.,]\d{2})|(\d{1,4}[.,]\d{2})\s?(?:€|eur)/i.exec(text);
  if (euro) {
    return `${euro[1] ?? euro[2]} €`;
  }
  const yen =
    /(\d{2,5})\s*\n?\s*円区間/u.exec(text) ??
    /(?:金|¥|￥)\s?(\d{2,5})/u.exec(text) ??
    /(?<!小児|子供|child\s?)(?<![\d:])(\d{2,5})\s?円/iu.exec(text);
  if (yen) {
    return `${yen[1]}円`;
  }
  if (!/円/.test(text)) {
    return;
  }
  const amount = lines.find((line) => /^\d{2,4}$/.test(line.text.trim()));
  return amount ? `${amount.text.trim()}円` : undefined;
};

/** "CHANIA-SOUGIA", "SOUGIA SFAKIA", "TAIPEI OKINAWA", "Chania → Sougia" */
const splitRoute = (text: string): [string, string] | undefined => {
  const value = text
    .split(/\s+/)
    .filter((word) => word.split('-').some((part) => !NOT_PLACE.test(part)))
    .join(' ');
  const byArrow = value.split(/\s*(?:→|->|>|–|—|\s-\s|-)\s*/).filter(Boolean);
  if (byArrow.length === 2) {
    return [byArrow[0], byArrow[1]];
  }
  const words = value.split(/\s+/).filter((word) => !NOT_PLACE.test(word.replaceAll(/[^\p{L}]/gu, '')));
  return words.length === 2 ? [words[0], words[1]] : undefined;
};

type FoundDate = { date: TravelDate; line: number; kind?: 'issued'; withTime: boolean };
type FoundTime = {
  time: TravelTime;
  line: number;
  kind?: TimeKind | 'issued' | 'arrival';
  text: string;
  score: number;
};

/** a place after a Depart or Arrive label, without the time printed with it ("OKINAWA 0945") */
const withoutTimes = (value?: string) => value?.replaceAll(/\d{1,2}[:.]\d{2}|\d{3,4}/g, ' ');

const lineKind = (segments: Segment[]) => segments.find((segment) => segment.label)?.label;

/** the label a value line takes from the line of labels above it (a table: GATE over B8) */
const labelAbove = (lines: TextLine[], segmentsByLine: Segment[][], index: number, box?: TextBox) => {
  const line = lines[index];
  for (let above = index - 1; above >= Math.max(0, index - 2); above--) {
    const other = lines[above];
    if (line.top - other.bottom > 2.5 * Math.max(line.height, other.height)) {
      break;
    }
    const labels = segmentsByLine[above].filter((segment) => segment.label && !segment.value);
    if (labels.length === 0 || segmentsByLine[above].some((segment) => segment.value && !segment.label)) {
      continue;
    }
    if (!box || labels.length === 1) {
      return labels[0].label;
    }
    // the label whose box is over the value
    const center = (box.left + box.right) / 2;
    const nearest = labels
      .map((segment) => {
        const labelBoxes = segment.line.boxes.filter((item) =>
          new RegExp(LABELS.find(([field]) => field === segment.label)![1], 'iu').test(item.text),
        );
        const left = Math.min(...labelBoxes.map((item) => item.left), 1);
        return { label: segment.label, distance: Math.abs(left - box.left) + 0.2 * Math.abs(left - center) };
      })
      .toSorted((a, b) => a.distance - b.distance)[0];
    return nearest?.label;
  }
};

const firstValue = (segments: Segment[], label: FieldLabel, pattern?: RegExp) =>
  segments.find((segment) => segment.label === label && segment.value && (!pattern || pattern.test(segment.value)))
    ?.value;

/**
 * Reads the leg of a travel document from its OCR boxes. Every field is optional: what can't be read (a date printed
 * vertically, a name blurred by the uploader) is left out and flagged, and so are ambiguities (a time written by hand
 * over the printed one, Greek names read as Latin lookalikes).
 */
export const readTicket = (ocr: OcrBoxInput[], options: SourceParseOptions = {}): TicketFields | undefined => {
  const boxes = toTextBoxes(deskewBoxes(ocr, options.aspectRatio), options.minScore);
  const lines = groupLines(boxes);
  if (lines.length === 0) {
    return;
  }
  const texts = lines.map((line) => separateDateTime(line.text));
  const text = texts.join('\n');
  const flags: string[] = [];

  const words = text.split(/[^\p{L}]+/u).filter(Boolean);
  const greek = /\p{Script=Greek}/u.test(text) || words.filter((word) => isGreekLookalike(word)).length >= 3;
  const cjk = CJK.test(text);
  // "04/10/2016" is day first but in the United States; "11/11" month first in Japan and China too
  const us = /\$|\busd\b/i.test(text);
  const orders: DateOrders = { order: us ? 'mdy' : 'dmy', shortOrder: us || cjk ? 'mdy' : 'dmy' };
  const mode = detectMode(text);
  const receipt = RECEIPT.test(text);

  const segmentsByLine = lines.map((line) => segmentLine(line));
  const segments = segmentsByLine.flat();

  // dates and times, with the kind of each from its label (on its line, or over it)
  const dates: FoundDate[] = [];
  const times: FoundTime[] = [];
  for (const [index, lineText] of texts.entries()) {
    const kinds = segmentsByLine[index].map((segment) => segment.label).filter(Boolean);
    const above = labelAbove(lines, segmentsByLine, index);
    const issued = kinds.includes('issued') || (kinds.length === 0 && above === 'issued');
    const lineDates = findDates(lineText, orders).filter(({ year }) => year === undefined || year >= 2000 || !cjk);
    for (const found of lineDates) {
      dates.push({ date: found, line: index, ...(issued && { kind: 'issued' }), withTime: false });
    }
    const departLabel = segmentsByLine[index].find((segment) => segment.label === 'depart');
    const arriveLabel = segmentsByLine[index].find((segment) => segment.label === 'arrive');
    const boardingLabel =
      segmentsByLine[index].find((segment) => segment.label === 'boarding') ??
      (above === 'boarding' ? segmentsByLine[index][0] : undefined);
    for (const segment of segmentsByLine[index]) {
      const bare = ['depart', 'arrive', 'boarding'].includes(segment.label ?? '');
      for (const found of findTimes(segment.value, { bareDigits: bare })) {
        let kind: FoundTime['kind'] = issued ? 'issued' : receipt ? 'purchase' : undefined;
        if (segment.label === 'depart' || (segment === departLabel && !kind)) {
          kind = 'departure';
        } else if (segment.label === 'arrive' || segment === arriveLabel) {
          kind = 'arrival';
        } else if (segment.label === 'boarding' || segment === boardingLabel) {
          kind = 'boarding';
        } else if (!segment.label && lineKind(segmentsByLine[index]) === undefined) {
          // a table: the label over the value
          const box = segment.boxes.find((item) => item.text.includes(found.text.slice(-2)));
          const over = labelAbove(lines, segmentsByLine, index, box);
          if (over === 'boarding') {
            kind = 'boarding';
          } else if (over === 'issued') {
            kind = 'issued';
          }
        }
        const score = Math.min(...segment.boxes.map((box) => box.score), 1);
        times.push({ time: found, line: index, kind, text: found.text, score });
      }
    }
    const withTime = times.some((time) => time.line === index && time.kind !== 'issued');
    for (const found of dates) {
      if (found.line === index) {
        found.withTime = withTime;
      }
    }
  }

  // the date of travel: one with a time, not the date of issue, else the first
  const travelDates = dates.filter(({ kind }) => kind !== 'issued');
  const chosen =
    travelDates.find(({ withTime }) => withTime) ??
    travelDates[0] ??
    dates.find(({ withTime }) => withTime) ??
    dates[0];
  let date = chosen?.date;
  if (date && date.year === undefined) {
    // a year printed elsewhere on the document for the same day ("09NOV" and "09NOV19")
    const year = dates.find(({ date: other }) => other.year && other.month === date!.month && other.day === date!.day);
    date = year ? { ...date, year: year.date.year } : date;
  }
  // a date far from the others is a reference printed on the ticket (a law, a licence), not the journey
  if (!date) {
    flags.push('No date could be read on the document (it may be printed vertically, stamped or on the other side)');
  } else if (date.year === undefined) {
    flags.push(`The year is not printed (${formatDate(date)})`);
  }

  const usable = times.filter(({ kind }) => kind !== 'issued');
  const departure =
    usable.find(({ kind }) => kind === 'departure') ??
    usable.find(({ kind, line }) => kind === undefined && chosen && line === chosen.line) ??
    usable.find(({ kind }) => kind === undefined) ??
    usable.find(({ kind }) => kind === 'purchase') ??
    usable.find(({ kind }) => kind === 'boarding');
  const arrival = usable.find(({ kind }) => kind === 'arrival');
  let time = departure?.time;
  let timeKind: TimeKind | undefined = departure
    ? departure.kind === 'boarding' || departure.kind === 'purchase'
      ? departure.kind
      : 'departure'
    : undefined;
  if (departure?.kind === 'boarding') {
    flags.push(`Only the boarding time is printed (${formatTime(departure.time)}); the departure is later`);
  }
  if (departure?.kind === 'purchase') {
    flags.push(`The time is when the ticket was bought (${formatTime(departure.time)}), not the departure`);
  }

  // a time written by hand over the printed one: another time on a line of its own, or a time with a smudged hour
  let otherTime: string | undefined;
  if (departure) {
    const written = texts
      .flatMap((lineText, index) =>
        lineText
          .matchAll(/(?<![\d:.])(\S?\d?)[.:]([0-5]\d)(?![\d.,])/gu)
          .map((match) => ({ match, index }))
          .toArray(),
      )
      .find(
        ({ match, index }) =>
          index !== departure.line &&
          findDates(texts[index], orders).every(
            (found) => !(found.index <= match.index && match.index < found.index + found.length),
          ) &&
          !/\d[.,]\d{2}\s?(?:€|eur|円|\$)/i.test(texts[index].slice(match.index)) &&
          !/(?:€|eur|\$)\s?\S?\d?[.,]\d{2}/i.test(
            texts[index].slice(Math.max(0, match.index - 5), match.index + match[0].length),
          ) &&
          times.every((other) => !(other.line === index && other.kind) || other.kind === undefined) &&
          (/[^\d]/.test(match[1]) ||
            (match[1].length === 2 && `${match[1]}:${match[2]}` !== formatTime(departure.time))),
      );
    if (written) {
      const [, hour, minute] = written.match;
      otherTime = /^\d{2}$/.test(hour) ? `${hour}:${minute}` : `?:${minute}`;
      flags.push(
        `Another time (${otherTime}) is written on the document, maybe by hand over the printed ${formatTime(departure.time)}: check which one was used`,
      );
    }
  }

  // from and to
  let from: string | undefined;
  let to: string | undefined;
  let lookalike = false as boolean;
  const place = (value?: string) => {
    const result = value ? readPlace(value, greek) : undefined;
    if (result?.lookalike) {
      lookalike = true;
    }
    return result?.name;
  };
  const route = firstValue(segments, 'fromTo') ?? firstValue(segments, 'route', /\p{L}{3}/u);
  const routeParts = route ? splitRoute(route) : undefined;
  if (routeParts) {
    from = place(routeParts[0]);
    to = place(routeParts[1]);
  }
  const codes = mode === 'flight' ? IATA_PAIR.exec(text) : undefined;
  const fromCode = codes?.[1];
  const toCode = codes?.[2];
  if (codes && (!from || !to)) {
    // the cities printed in the order of the codes: "TPE-OKA" and "TAIPEI OKINAWA"
    const cities = lines
      .map((line) => line.text.split(/\s+/).filter((word) => /^\p{Lu}{4,}$/u.test(word) && !NOT_PLACE.test(word)))
      .find((cityWords) => cityWords.length === 2 && cityWords.every((word) => !word.endsWith('AIR')));
    if (cities) {
      from ??= place(cities[0]);
      to ??= place(cities[1]);
    }
  }
  const labeled = (label: FieldLabel) =>
    segments.find((segment) => segment.label === label && segment.colon && /\p{L}{2}/u.test(segment.value))?.value;
  from ??= place(withoutTimes(labeled('depart') ?? labeled('from')));
  to ??= place(withoutTimes(labeled('to') ?? labeled('arrive')));
  if (mode === 'flight') {
    from ??= fromCode;
    to ??= toCode;
  }
  if (!from && !to && chosen && mode && mode !== 'entry' && !cjk) {
    // two names on lines of their own below the date: from, then to
    const names = lines
      .slice(chosen.line + 1, chosen.line + 4)
      .filter(
        (line, index, all) =>
          /^[\p{L} .-]{3,}$/u.test(line.text) &&
          segmentsByLine[lines.indexOf(line)].every((segment) => !segment.label) &&
          all,
      );
    if (names.length >= 2) {
      from = place(names[0].text);
      to = place(names[1].text);
    }
  }
  if (!to && cjk && mode && mode !== 'entry' && !receipt) {
    // a Japanese or Chinese ticket prints its destination (or fare zone) in the largest type
    const heights = median(lines.map((line) => line.height));
    const destination = lines
      .filter(
        (line) =>
          CJK.test(line.text) &&
          line.height >= heights &&
          !/[()（）]|券|円|有効|無効|monorail|モノレール|線/.test(line.text) &&
          line.text.replaceAll(/\s/g, '').length <= 12,
      )
      .toSorted((a, b) => b.height - a.height)[0];
    to = destination ? place(destination.text) : undefined;
  }
  if (!from && receipt && cjk) {
    // "おもろまち01券発行": the station whose machine issued the ticket
    const station =
      /([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]{2,12}?)\s?\d{0,3}\s?券?(?:発行|發行)/u.exec(text)?.[1];
    from = station ? place(station) : undefined;
  }

  /** the value on the line over a label that is alone on its line ("SAMARIA I" over "VESSEL") */
  const valueAbove = (label: FieldLabel, pattern: RegExp) => {
    for (const [index, lineSegments] of segmentsByLine.entries()) {
      if (index === 0 || lineSegments.length !== 1 || lineSegments[0].label !== label || lineSegments[0].value) {
        continue;
      }
      const above = texts[index - 1];
      const match = pattern.exec(above);
      if (match && lines[index].top - lines[index - 1].bottom < 2 * lines[index].height) {
        return match[1];
      }
    }
  };

  // the other fields
  const findField = (label: FieldLabel, pattern: RegExp) => {
    const inline = firstValue(segments, label, pattern);
    if (inline) {
      return pattern.exec(inline)?.[0];
    }
    // a table: the value under the label
    for (const [index, lineSegments] of segmentsByLine.entries()) {
      for (const segment of lineSegments) {
        if (segment.label) {
          continue;
        }
        for (const box of segment.boxes) {
          if (pattern.test(box.text) && labelAbove(lines, segmentsByLine, index, box) === label) {
            return pattern.exec(box.text)?.[0];
          }
        }
      }
    }
  };
  const seat = findField('seat', /^(?:\d{1,3}[A-K]?|[A-K]\d{1,3})\b/i);
  const gate = mode === 'flight' ? findField('gate', /^[A-Z]?\d{1,3}[A-Z]?\b/i) : undefined;
  const coach = findField('coach', /^\d{1,4}\b/);
  const platform = mode === 'flight' ? undefined : findField('platform', /^[A-Z]?\d{1,3}[A-Z]?\b/i);
  const vesselValue =
    firstValue(segments, 'vessel', /\p{L}{3}/u) ??
    valueAbove('vessel', /(\p{Lu}{3,}(?:\s\p{Lu}+)*(?:\s(?:I|II|III|IV|V))?)$/u);
  const vessel = vesselValue
    ? cleanValue(vesselValue.replace(/\s(?:passenger|vehicle).*$/i, ''))
        .toLowerCase()
        .replaceAll(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase())
        .replace(/ i$/i, ' I')
    : undefined;
  const classMatch =
    /\b(economy|business|first|premium economy)(?:\s+class)?\b/i.exec(text) ??
    /(?<![\p{L}])(ECO|DECK|CABIN|AIRSEAT|[12](?:st|nd)\s*class)(?![\p{L}])/iu.exec(text) ??
    /(普通車|グリーン車|指定席|自由席|經濟艙|经济舱|商務艙|商务舱)/u.exec(text);
  const travelClass = classMatch
    ? classMatch[1].length <= 4 && /^[A-Z]+$/.test(classMatch[1])
      ? classMatch[1]
      : classMatch[1].charAt(0).toUpperCase() + classMatch[1].slice(1).toLowerCase()
    : undefined;

  let number: string | undefined;
  if (mode === 'flight') {
    const flightValue = firstValue(segments, 'flight');
    const match = FLIGHT_NUMBER.exec(flightValue ?? '') ?? FLIGHT_NUMBER.exec(text.replaceAll(/[A-Z]{3}\/\d+/g, ''));
    number = match ? `${match[1]}${match[2]}` : undefined;
  }

  const fare = findFare(text, lines);

  const carrier = findCarrier(lines, mode, greek);

  // the park or museum of an entry ticket: the largest name on it, and its kind ("National Park")
  let venue: string | undefined;
  if (mode === 'entry') {
    const heights = median(lines.map((line) => line.height));
    const candidates = lines
      .filter(
        (line) =>
          line.height >= heights &&
          /\p{L}{3}/u.test(line.text) &&
          !/\d{2}|[:：]|valid|refund|reissue|lost|有効|払い戻し|紛失|control|exit|名所/i.test(line.text),
      )
      .toSorted((a, b) => b.height - a.height);
    const kind = /national\s*park/i.test(text) ? 'National Park' : /museum/i.test(text) ? 'Museum' : undefined;
    for (const line of candidates) {
      // the same name twice (a ticket and its stub): the reading that decodes best
      const parts = line.text.split(/\s+/);
      const twin = parts.length === 2 && sharesRun(parts[0], parts[1], 4);
      const value = twin
        ? (parts.find(
            (part) => part.startsWith('E') && part.length === Math.max(...parts.map((item) => item.length)),
          ) ?? parts.toSorted((a, b) => b.length - a.length)[0])
        : line.text;
      if (NOT_PLACE.test(value) || (kind && new RegExp(kind, 'i').test(value))) {
        continue;
      }
      const name = place(value);
      if (name) {
        venue = kind && !name.toLowerCase().includes(kind.toLowerCase()) ? `${name} ${kind}` : name;
        break;
      }
    }
  }

  if (lookalike) {
    flags.push('Greek print was read as Latin lookalikes: the place names may be misspelled');
  }
  if (mode && mode !== 'entry' && !from && !to) {
    flags.push('Neither where the journey starts nor where it ends could be read');
  } else if (mode && mode !== 'entry' && (!from || !to)) {
    flags.push(
      from
        ? 'Where the journey ends could not be read'
        : 'Where the journey starts is not printed or could not be read',
    );
  }
  if (!time && mode !== 'entry') {
    flags.push('No time could be read');
  }
  if (!mode) {
    flags.push('The kind of document could not be told (flight, train, bus, ferry or entry ticket)');
  }
  if (!time) {
    timeKind = undefined;
  }
  if (arrival && !time) {
    time = undefined;
  }

  const all = lines.flatMap((line) => line.boxes);
  return {
    ...(mode && { mode }),
    ...(receipt && { receipt }),
    ...(carrier && { carrier }),
    ...(number && { number }),
    ...(from && { from }),
    ...(to && { to }),
    ...(fromCode && toCode && { fromCode, toCode }),
    ...(venue && { venue }),
    ...(date && { date }),
    ...(time && { time, timeKind }),
    ...(otherTime && { otherTime }),
    ...(arrival && { arrival: arrival.time }),
    ...(seat && { seat }),
    ...(travelClass && { travelClass }),
    ...(gate && { gate }),
    ...(platform && { platform }),
    ...(vessel && { vessel }),
    ...(coach && { coach }),
    ...(fare && { fare }),
    ...(lookalike && { lookalike: true }),
    flags,
    box: [
      Math.min(...all.map((box) => box.left)),
      Math.min(...all.map((box) => box.top)),
      Math.max(...all.map((box) => box.right)),
      Math.max(...all.map((box) => box.bottom)),
    ],
  };
};

/**
 * The name of a leg, as it is tagged: "Bus Chania → Sougia, 4 Oct 2016", "Flight BR186 Taipei → Okinawa, 9 Nov",
 * "Monorail → 那覇空港", "Samaria National Park, 4 Oct 2016"
 */
export const getLegName = (ticket: Omit<TicketFields, 'flags' | 'box'>) => {
  const date = ticket.date ? `, ${formatDate(ticket.date)}` : '';
  if (ticket.mode === 'entry' || (!ticket.mode && ticket.venue)) {
    return `${ticket.venue ?? 'Entry ticket'}${date}`;
  }
  const mode = [ticket.mode ? getModeName(ticket.mode) : 'Journey', ticket.number].filter(Boolean).join(' ');
  if (ticket.from && ticket.to) {
    return `${mode} ${ticket.from} → ${ticket.to}${date}`;
  }
  if (ticket.to) {
    return `${mode} → ${ticket.to}${date}`;
  }
  if (ticket.from) {
    return `${mode} from ${ticket.from}${date}`;
  }
  return `${[mode, ticket.carrier].filter(Boolean).join(' ')}${date}`;
};

const TIME_WORDS: Record<TimeKind, string> = { departure: 'departs', boarding: 'boarding', purchase: 'bought' };

/**
 * The other fields of a leg, as its description: "KTEL · departs 05:00 · bus 55 · seat 5 · 8.30 €". The time is
 * followed by "?" when another time is written on the document.
 */
export const getLegDescription = (ticket: Omit<TicketFields, 'flags' | 'box'>) =>
  [
    ticket.carrier,
    ticket.time &&
      `${TIME_WORDS[ticket.timeKind ?? 'departure']} ${formatTime(ticket.time)}${ticket.otherTime ? '?' : ''}`,
    ticket.otherTime && `also written: ${ticket.otherTime}`,
    ticket.arrival && `arrives ${formatTime(ticket.arrival)}`,
    ticket.fromCode && ticket.toCode && `${ticket.fromCode}-${ticket.toCode}`,
    ticket.vessel && `vessel ${ticket.vessel}`,
    ticket.coach && `${ticket.mode === 'train' ? 'car' : 'bus'} ${ticket.coach}`,
    ticket.seat && `seat ${ticket.seat}`,
    ticket.travelClass,
    ticket.gate && `gate ${ticket.gate}`,
    ticket.platform && `platform ${ticket.platform}`,
    ticket.fare,
    ticket.receipt && 'receipt',
  ]
    .filter(Boolean)
    .join(' · ');

/** words of tickets and their rules: a ticket of any kind, valid for a day, not refundable */
const TICKET_WORDS =
  /ticket|boarding|valid|refund|reissue|passenger|ei[sσzξe]ithpio|εισιτηριο|有効|無効|券|入场|入場|門票|票|乗車/iu;

/**
 * whether the fields read make a travel document: three of a mode, a date, a time, a place (from, to or venue), a
 * fare, a seat or class, and ticket words; a sign that says "BUS" or a timetable is not one
 */
export const isTravelDocument = (ticket: TicketFields, text: string) =>
  [
    ticket.mode,
    ticket.date,
    ticket.time,
    ticket.from ?? ticket.to ?? ticket.venue,
    ticket.from && ticket.to,
    ticket.fare,
    ticket.seat ?? ticket.travelClass ?? ticket.gate,
    TICKET_WORDS.test(text) || undefined,
  ].filter(Boolean).length >= 3;

/**
 * The travel pack's source parser: a document is one leg (its entry), with the name it is tagged with and its other
 * fields as the description; what could not be read is in `warnings`
 */
export const parseTicket = (ocr: OcrBoxInput[], options: SourceParseOptions = {}): ParsedSource => {
  const boxes = toTextBoxes(deskewBoxes(ocr, options.aspectRatio), options.minScore);
  const lines = groupLines(boxes);
  // a boarding pass and its stub are two columns
  const columns = boxes.length > 0 ? Math.max(1, findColumns(boxes, options.aspectRatio).columns.length) : 0;
  const ticket = readTicket(ocr, options);
  if (!ticket || !isTravelDocument(ticket, lines.map((line) => line.text).join('\n'))) {
    return { items: [], sections: [], columns, lines: lines.length };
  }
  const { flags, box, ...fields } = ticket;
  const description = getLegDescription(fields);
  return {
    items: [
      {
        name: getLegName(fields),
        ...(description && { description }),
        ...(fields.fare && { price: fields.fare }),
        ...(fields.mode && { section: getModeName(fields.mode) }),
        column: 0,
        box,
      },
    ],
    ...(fields.carrier && { title: fields.carrier }),
    sections: fields.mode ? [getModeName(fields.mode)] : [],
    columns,
    lines: lines.length,
    ...(flags.length > 0 && { warnings: flags }),
  };
};
