/**
 * What the travel pack hides: travel documents carry the names of their passengers, booking references (PNRs),
 * ticket and sequence numbers, frequent flyer numbers, SSR codes and barcodes that encode all of them. The pack's
 * parser only ever reads the fields of a journey (mode, carrier, flight or train number, from, to, date, time, seat,
 * class, gate, platform, fare), and `redactTravelText` runs on every text the engine lets out of the pack (entries,
 * titles, place names, warnings, tags, descriptions and captions) as a second line of defence, including the names
 * the assistant passes in.
 */

export const REDACTED = '•••';

/** labels of a name field: whatever follows them on the line is the name, even after a space */
const NAME_LABELS = [
  String.raw`passenger(?:'?s)?\s+name`,
  String.raw`name\s+of\s+(?:the\s+)?passenger`,
  String.raw`pax\s+name`,
  // Greek ΟΝΟΜΑΤΕΠΩΝΥΜΟ and ΕΠΙΒΑΤΗΣ, as printed and as OCR reads them in Latin lookalikes
  'ονοματεπωνυμο',
  String.raw`[oj0]?nomate[\p{L}]*`,
  'επιβατη[σς]?',
  'e[mnп]ibath[se]?',
  // Japanese and Chinese: name, passenger
  '氏名',
  '姓名',
  'お名前',
  '搭乗者(?:名)?',
  '旅客姓名',
  '乘客姓名',
];

/** labels of a code (booking reference, ticket or sequence number): a code follows them, after a colon or a space */
const CODE_LABELS = [
  String.raw`p\s?n\s?r`,
  String.raw`booking(?:\s+(?:ref(?:erence)?|code|no|nr|number|id))?`,
  String.raw`reservation(?:\s+(?:code|no|nr|number))?`,
  String.raw`record\s+locator`,
  String.raw`confirmation(?:\s+(?:code|no|nr|number))?`,
  String.raw`conf\.?\s+no`,
  String.raw`e-?\s?ticket(?:\s+(?:no|nr|number))?`,
  String.raw`e?tkt(?:\s+(?:no|nr))?`,
  String.raw`ticket\s+(?:no|nr|number|#)`,
  String.raw`seq(?:uence)?(?:\s+(?:nbr|no|nr|number))?`,
  'sqn',
  'bsn',
  'ssr',
  'osi',
  String.raw`ffp?(?:\s+no)?`,
  String.raw`frequent\s+flyer(?:\s+(?:no|nr|number))?`,
  'κρατηση[σς]?',
  String.raw`(?:a\.?\s?)?kpathe?h[se]?`,
  // ΑΡΙΘ. ΕΙΣΙΤΗΡΙΟΥ (ticket number), as printed and in Latin lookalikes
  String.raw`αριθ\.?\s*εισιτηριου`,
  String.raw`[a∆]pi[oθ]\.?\s*ei[sσzξe]ithpio[yυ]`,
  '予約番号',
  '券番号',
  '伝票番号',
  '票號',
  '訂位(?:代號|代号)?',
  '確認番号',
  '会員番号',
];

/** labels whose value is personal after a colon: "Name: …", "Passenger: …", "Tel: …" */
const COLON_LABELS = [
  ...CODE_LABELS,
  String.raw`(?:full\s+|given\s+|sur)?name`,
  "passenger(?:'?s)?",
  'pax',
  'travell?er',
  String.raw`(?:seat\s+|card\s+)?holder`,
  String.raw`loyalty(?:\s+(?:no|number))?`,
  String.raw`membership(?:\s+(?:no|number))?`,
  String.raw`passport(?:\s+(?:no|number))?`,
  String.raw`id(?:\s+(?:no|number))?`,
  String.raw`document(?:\s+(?:no|number))?`,
  'barcode',
  'e-?mail',
  'phone',
  'mobile',
  'tel',
  '旅客',
  '乘客',
];

const START = String.raw`(?<![\p{L}\d])`;
/** the next "Label:" (a word or two and a colon), a " · " separator, or the end */
const NEXT = String.raw`(?=\s+\p{L}[\p{L}.]*(?:\s\p{L}[\p{L}.]*)?\s?[:：]|\s+·\s|$)`;

const LABELED_NAME = new RegExp(String.raw`${START}(${NAME_LABELS.join('|')})(\.?\s*[:：]?\s*)(?![\s•]|$).+$`, 'giu');

/** the value of a label does not start with the next label ("Name: Flt: IT 231" has no name) */
const NOT_A_LABEL = String.raw`(?![\s•]|$|\p{L}[\p{L}.]*\s?[:：])`;

const LABELED_COLON = new RegExp(
  String.raw`${START}(${COLON_LABELS.join('|')})(\.?\s*[:：#]\s*)${NOT_A_LABEL}(.+?)${NEXT}`,
  'giu',
);

const CODE_LABEL = new RegExp(String.raw`${START}(?:${CODE_LABELS.join('|')})\.?\s+`, 'giu');

/**
 * a code (case-sensitive): capitals and digits, with a digit or five characters at least, and up to two more such
 * groups, e.g. A41NQS or BG20 MS11
 */
const CODE =
  /(?:[\p{Lu}\d][\p{Lu}\d/-]*\d[\p{Lu}\d/-]*|[\p{Lu}\d]{5,})(?:\s+(?=[\p{Lu}]*\d)[\p{Lu}\d]{2,}(?![\p{L}\d]))*(?![\p{L}\d])/uy;

/** "PNR A41NQS" → "PNR •••": a code right after a label, without a colon */
const hideLabeledCodes = (text: string) => {
  let result = '';
  let last = 0;
  for (const match of text.matchAll(CODE_LABEL)) {
    const start = match.index + match[0].length;
    if (start < last) {
      continue;
    }
    CODE.lastIndex = start;
    const code = CODE.exec(text);
    if (!code) {
      continue;
    }

    result += text.slice(last, start) + REDACTED;
    last = start + code[0].length;
  }
  return result + text.slice(last);
};

const HONORIFIC = '(?:MR|MRS|MS|MISS|MSTR|DR|MX|CHD|INF)';

/** "CHEN, MEI MS", "CHEN/MEI MS", "SMITH JOHN MR": capitals then a title, as airlines print names */
const NAME_WITH_TITLE = new RegExp(
  String.raw`${START}\p{Lu}[\p{Lu}'’-]+(?:[\s,/]+\p{Lu}[\p{Lu}'’-]*){0,3}[\s,/]+${HONORIFIC}\.?(?![\p{L}\d])`,
  'gu',
);

/** "Mr John Smith", "Ms. Chen" */
const TITLE_WITH_NAME = new RegExp(
  String.raw`${START}(?:Mr|Mrs|Ms|Miss|Mstr|Dr)\.?\s+\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,2}`,
  'gu',
);

/** the IATA bar coded boarding pass payload: M1, the name, then the booking and the flight */
const BCBP = /(?<![\p{L}\d])M[1-4]\p{Lu}{2,}\/[\p{Lu} ]+.*$/u;

/** a name before 様 (Japanese "Mr/Ms") */
const JAPANESE_NAME = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]{1,16}\s*様/gu;

/** 7 digits or more (with dashes), e.g. ticket and booking numbers; or a group of 3-4 digits then 5 or more */
const LONG_NUMBER = /(?<![\p{L}\d])(?:\d(?:-?\d){6,}|\d{3,4} \d{5,})(?!\d)/gu;

/** a Latin code of 8 characters or more with 6 digits or more: ticket numbers with a check letter, barcode digits */
const LONG_CODE = /(?<![\p{L}\d])[A-Za-z\d]{8,}(?![\p{L}\d])/gu;

/** "TPE/169": the check-in sequence number after the airport */
const SEQUENCE = /(?<![\p{L}\d/])[A-Z]{3}\/\d{1,4}(?![\p{L}\d])/gu;

/** 6 capitals and digits, both: an airline booking reference (PNR) such as A41NQS */
const PNR = /(?<![\p{L}\d])(?=[A-Z\d]*\d)(?=[A-Z\d]*[A-Z])[A-Z\d]{6}(?![\p{L}\d])/gu;

/** what else 6 capitals and digits can be: a flight number (BR0186), a date (09NOV9) */
const NOT_PNR = /^(?:[A-Z\d]{2}\d{4}|\d{1,2}[A-Z]{3}\d{1,2})$/;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * The text without the personal data a travel document may carry: labelled values (names, booking references,
 * ticket, sequence, frequent flyer and SSR codes, contact details), names printed with a title, barcode payloads,
 * long numbers and codes, and booking references. The fields of a journey are kept: flight and train numbers,
 * places, dates, times, seats, classes, gates, platforms and fares.
 */
export const redactTravelText = (text: string): string => {
  if (!text) {
    return text;
  }
  let result = text.replace(BCBP, () => REDACTED);
  result = result.replaceAll(EMAIL, () => REDACTED);
  result = result.replaceAll(LABELED_NAME, (_, label: string, separator: string) => `${label}${separator}${REDACTED}`);
  result = result.replaceAll(LABELED_COLON, (_, label: string, separator: string) => `${label}${separator}${REDACTED}`);
  result = hideLabeledCodes(result);
  result = result.replaceAll(NAME_WITH_TITLE, () => REDACTED);
  result = result.replaceAll(TITLE_WITH_NAME, () => REDACTED);
  result = result.replaceAll(JAPANESE_NAME, () => `${REDACTED}様`);
  result = result.replaceAll(LONG_NUMBER, () => REDACTED);
  result = result.replaceAll(LONG_CODE, (code) => ((code.match(/\d/g)?.length ?? 0) >= 6 ? REDACTED : code));
  result = result.replaceAll(SEQUENCE, () => REDACTED);
  result = result.replaceAll(PNR, (code) => (NOT_PNR.test(code) ? code : REDACTED));
  // "••• •••" reads as one hidden value
  return result.replaceAll(/•••(?:[\s,/-]*•••)+/g, () => REDACTED);
};
