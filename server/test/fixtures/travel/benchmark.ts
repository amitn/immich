import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { classifyPhoto, getPromptList, summarizeText } from 'src/utils/collections/classify.js';
import { AssignEntry, SubjectMatch } from 'src/utils/collections/match.js';
import { OcrBoxInput, groupLines, toTextBoxes } from 'src/utils/collections/ocr.js';
import { getCollectionTagRules } from 'src/utils/collections/pack.js';
import { assignByTime } from 'src/utils/collections/packs/travel/assign.js';
import { formatTime, toIsoDate } from 'src/utils/collections/packs/travel/dates.js';
import { travelPack } from 'src/utils/collections/packs/travel/pack.js';
import { TicketFields, parseTicket, readTicket } from 'src/utils/collections/packs/travel/ticket.js';
import { ParsedSource, chooseSourceOcr, mergeSourceEntries } from 'src/utils/collections/source.js';
import { getEntryTag, getSourceTag } from 'src/utils/collections/tags.js';
import { stripAccents } from 'src/utils/collections/text.js';
import { OcrPass, mergeOcrPasses } from 'src/utils/collections/tiles.js';

/**
 * A benchmark of the travel pack on two real trips, captured by `capture-benchmark.mjs`: the stored and the tiled
 * full-resolution OCR of their travel documents, the stored OCR, CLIP embeddings and capture times of every photo,
 * and which leg each photo belongs to. The documents are read into legs as `CollectionService.readSource` does, the
 * photos classified as `findVisits` does and assigned to the legs as `matchVisit` does, and the result is scored:
 * fields read right, photos on the right leg, and personal fields let out (there must be none).
 *
 * `benchmark.json.gz` is derived from photos on Wikimedia Commons, CC BY-SA 4.0
 * (https://creativecommons.org/licenses/by-sa/4.0): Western Crete, 2-8 October 2016, by Joehawkins
 * (https://commons.wikimedia.org/wiki/User:Joehawkins), and Okinawa, 9-12 November 2019, by Solomon203
 * (https://commons.wikimedia.org/wiki/User:Solomon203). It holds no images, only their OCR, CLIP embeddings and capture
 * times. The personal fields of the documents (names, booking references, ticket and sequence numbers, SSR codes,
 * barcode digits) were replaced in the OCR by placeholders of the same shape before it was saved, and only the
 * placeholders are kept (`personal`), as the strings that must never leak.
 */

const FIXTURE = new URL('benchmark.json.gz', import.meta.url);

export type Photo = {
  /** the number of the file, e.g. "05" */
  key: string;
  kind: 'document' | 'photo';
  /** the leg of the trip in the ground truth, e.g. L1 (a leg) or D2 (a day without documents) */
  leg: string;
  time: number;
  width?: number;
  height?: number;
  embedding?: string;
  ocr: OcrBoxInput[];
  passes?: OcrPass[];
  /** placeholders of the personal fields of a document */
  personal?: string[];
  /** ticket and receipt serial numbers of a document */
  serials?: string[];
};

export type Trip = {
  key: string;
  trip: string;
  legs: Array<{ id: string; date: string; label: string; mode: string }>;
  photos: Photo[];
};

export type Fixture = { clipModel: string; ocrModel: string; trips: Trip[]; texts: Record<string, string> };

export const loadFixture = (): Fixture => JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString());

export const decode = (base64: string) => {
  const buffer = Buffer.from(base64, 'base64');
  const values = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
  const vector = Float32Array.from(values, (value) => value / 32_767);
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
};

const encode = (values: number[]) => {
  const vector = Int16Array.from(values, (value) => Math.round(value * 32_767));
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
};

/** adds the missing text embeddings from the machine learning server, and drops the ones no longer used */
export const updateTexts = async (fixture: Fixture, used: Set<string>, url: string) => {
  for (const text of used) {
    if (fixture.texts[text]) {
      continue;
    }
    const form = new FormData();
    form.append('entries', JSON.stringify({ clip: { textual: { modelName: fixture.clipModel, options: {} } } }));
    form.append('text', text);
    const response = await fetch(new URL('predict', url), { method: 'POST', body: form });
    if (!response.ok) {
      throw new Error(`Unable to encode "${text}": ${response.status}`);
    }
    const { clip } = (await response.json()) as { clip: string };
    fixture.texts[text] = encode(JSON.parse(clip));
  }
  fixture.texts = Object.fromEntries(Object.entries(fixture.texts).filter(([text]) => used.has(text)));
  writeFileSync(FIXTURE, gzipSync(JSON.stringify(fixture), { level: 9 }));
};

/** a field as printed: any of the strings (or a pattern), or null when OCR did not read it and it must be flagged */
type Expected = string | RegExp | null;

type ExpectedLeg = Partial<Record<'mode' | 'from' | 'to' | 'venue' | 'date' | 'time' | 'number' | 'seat', Expected>> & {
  /** the time is ambiguous (written over by hand): the parser must flag it */
  ambiguous?: boolean;
};

/** the fields of every document, from `expected.json` (only the fields of the journey: none of them is personal) */
export const EXPECTED: Record<string, Record<string, ExpectedLeg>> = {
  'crete-samaria-2016-10': {
    '05': { mode: 'bus', from: 'chania', to: 'sougia', date: '2016-10-04', time: '05:00', seat: '5' },
    // the green date stamp is not read by OCR
    '11': { mode: 'entry', venue: /samaria/, date: null },
    // printed 09:20, "17.30" written over it by hand
    '15': { mode: 'ferry', from: 'sougia', to: 'sfakia', date: '2016-10-04', time: '09:20', ambiguous: true },
    '16': { mode: 'bus', from: /sfakion/, to: 'chania', date: '2016-10-04', time: '18:30' },
  },
  'okinawa-2019-11': {
    // "09NOV": no year printed; only the boarding time
    '01': { mode: 'flight', number: 'BR186', from: 'taipei', to: 'okinawa', date: '11-09', time: '16:20', seat: '40A' },
    // the back of the ticket: no date, and the park's name only as おきなわ
    '21': { mode: 'entry', venue: /おきなわ|okinawa/, date: null },
    '25': { mode: 'monorail', from: /おもろまち|omoromachi/, date: '2019-11-11', time: '12:37' },
    // the date and time are printed vertically, and OCR does not read them
    '26': { mode: 'monorail', to: /那覇空港|naha/, date: null, time: null },
    '27': { mode: 'monorail', to: /旭橋|asahibashi/, date: null, time: null },
    '28': {
      mode: 'flight',
      number: 'IT231',
      from: 'okinawa',
      to: 'taipei',
      date: '2019-11-12',
      time: '09:45',
      seat: '17B',
    },
  },
};

/**
 * the legs a photo may be assigned to besides its own, from the rules of the pack: a leg without a document (a walk)
 * belongs to the destination of the leg before it; a day without documents stays unassigned (none)
 */
export const ACCEPTED: Record<string, Record<string, Array<string | null>>> = {
  'crete-samaria-2016-10': {
    D1: [null],
    L2: ['L1', null],
    D2: [null],
    D3: [null],
    D4: [null],
  },
  'okinawa-2019-11': {
    L2: [null],
  },
};

const normalize = (text: string) => stripAccents(text).toLowerCase().replaceAll(/\s+/g, ' ').trim();

const isNear = (a: string, b: string) => {
  if (a === b || (b.length >= 4 && a.includes(b))) {
    return true;
  }
  if (Math.abs(a.length - b.length) > 1 || a.length < 5) {
    return false;
  }
  let different = 0;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    different += Number(a[index] !== b[index]);
  }
  return different <= 1;
};

const readValue = (ticket: TicketFields, field: keyof ExpectedLeg): string | undefined => {
  switch (field) {
    case 'date': {
      if (!ticket.date) {
        return;
      }
      const { year, month, day } = ticket.date;
      return year === undefined
        ? `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        : toIsoDate({ year, month, day });
    }
    case 'time': {
      return ticket.time ? formatTime(ticket.time) : undefined;
    }
    case 'from': {
      return ticket.from ?? ticket.fromCode;
    }
    case 'to': {
      return ticket.to ?? ticket.toCode;
    }
    default: {
      const value = ticket[field as 'mode' | 'venue' | 'number' | 'seat'];
      return typeof value === 'string' ? value : undefined;
    }
  }
};

/** whether a field was read right, or (expected null) left out and flagged */
const isRight = (ticket: TicketFields, field: keyof ExpectedLeg, expected: Expected): boolean => {
  const value = readValue(ticket, field);
  if (expected === null) {
    return value === undefined && ticket.flags.length > 0;
  }
  if (value === undefined) {
    return false;
  }
  const read = normalize(value);
  return typeof expected === 'string' ? isNear(read, normalize(expected)) : expected.test(read);
};

export type DocumentResult = {
  key: string;
  leg: string;
  ocr: 'tiles' | 'stored';
  fields: number;
  right: number;
  wrong: string[];
  flags: string[];
  entry?: string;
};

export type TripResult = {
  key: string;
  documents: DocumentResult[];
  fields: number;
  fieldsRight: number;
  /** documents classified as sources, photos as subjects */
  classified: { documents: number; documentsRight: number; photos: number; photosRight: number };
  photos: number;
  assigned: number;
  lines: string[];
  /** personal fields or serial numbers found in what the pack lets out */
  leaks: string[];
  /** the texts whose embeddings the trip used, and those the fixture lacks */
  used: string[];
  missing: string[];
};

/** the OCR a document is read from, as `CollectionService.getSourceReading` chooses it */
export const getDocumentOcr = (photo: Photo) => {
  const detailed = mergeOcrPasses(photo.width!, photo.height!, photo.passes ?? []);
  return chooseSourceOcr(photo.ocr, detailed) === 'tiles'
    ? { which: 'tiles' as const, boxes: detailed }
    : { which: 'stored' as const, boxes: photo.ocr };
};

/** a parsed source as the engine lets it out: every text redacted by the pack (`CollectionService.redactSource`) */
const redactSource = (parsed: ParsedSource): ParsedSource => {
  const redact = travelPack.privacy!.redact!;
  return {
    ...parsed,
    items: parsed.items.map((item) => ({
      ...item,
      name: redact(item.name),
      ...(item.description !== undefined && { description: redact(item.description) }),
      ...(item.section !== undefined && { section: redact(item.section) }),
      ...(item.price !== undefined && { price: redact(item.price) }),
    })),
    ...(parsed.title !== undefined && { title: redact(parsed.title) }),
    sections: parsed.sections.map((section) => redact(section)),
    ...(parsed.warnings && { warnings: parsed.warnings.map((warning) => redact(warning)) }),
  };
};

const runTrip = (trip: Trip, texts: Map<string, Float32Array>): TripResult => {
  const redact = travelPack.privacy!.redact!;
  const used: string[] = [];
  const missing: string[] = [];
  const embed = (text: string) => {
    used.push(text);
    const embedding = texts.get(text);
    if (!embedding) {
      missing.push(text);
    }
    return embedding ?? new Float32Array(512);
  };

  // classification, as findVisits does it
  const prompts = getPromptList(travelPack.prompts);
  const promptEmbeddings = prompts.map(({ text }) => embed(text));
  const textRules = {
    parse: travelPack.source.parse,
    receiptWords: travelPack.classify.receiptWords,
    placeWords: travelPack.place.words,
  };
  const classified = { documents: 0, documentsRight: 0, photos: 0, photosRight: 0 };
  const kinds = new Map<string, string>();
  for (const photo of trip.photos) {
    const embedding = photo.embedding ? decode(photo.embedding) : undefined;
    const similarities = embedding
      ? promptEmbeddings.map((prompt) => prompt.reduce((sum, value, index) => sum + value * embedding[index], 0))
      : undefined;
    const { kind } = classifyPhoto(travelPack.classify, prompts, {
      similarities,
      ocr: photo.ocr.length > 0 ? summarizeText(photo.ocr, textRules) : undefined,
    });
    kinds.set(photo.key, kind);
    if (photo.kind === 'document') {
      classified.documents++;
      classified.documentsRight += Number(kind === 'source');
    } else {
      classified.photos++;
      classified.photosRight += Number(kind === 'subject');
    }
  }

  // the legs, as readSource and matchVisit read them
  const documents: DocumentResult[] = [];
  const readings: Array<ParsedSource & { assetId: string }> = [];
  const outputs: string[] = [];
  for (const photo of trip.photos) {
    if (photo.kind !== 'document') {
      continue;
    }
    const { which, boxes } = getDocumentOcr(photo);
    const options = { aspectRatio: photo.width! / photo.height! };
    const ticket = readTicket(boxes, options);
    const parsed = redactSource(parseTicket(boxes, options));
    readings.push({ ...parsed, assetId: photo.key });
    outputs.push(
      ...parsed.items.flatMap((item) => [item.name, item.description ?? '', item.section ?? '', item.price ?? '']),
      parsed.title ?? '',
      ...parsed.sections,
      ...(parsed.warnings ?? []),
    );
    const expected = EXPECTED[trip.key]?.[photo.key] ?? {};
    const result: DocumentResult = {
      key: photo.key,
      leg: photo.leg,
      ocr: which,
      fields: 0,
      right: 0,
      wrong: [],
      flags: ticket?.flags ?? [],
      ...(parsed.items[0] && { entry: parsed.items[0].name }),
    };
    for (const [field, value] of Object.entries(expected)) {
      if (field === 'ambiguous') {
        result.fields++;
        const flagged = !!ticket?.otherTime;
        result.right += Number(flagged);
        if (!flagged) {
          result.wrong.push('ambiguous time not flagged');
        }
        continue;
      }
      result.fields++;
      const good = !!ticket && isRight(ticket, field as keyof ExpectedLeg, value as Expected);
      result.right += Number(good);
      if (!good) {
        result.wrong.push(`${field}: ${ticket ? String(readValue(ticket, field as keyof ExpectedLeg)) : 'no leg'}`);
      }
    }
    documents.push(result);
  }

  // the photos, assigned as matchVisit does it with the travel pack
  const merged = mergeSourceEntries(readings);
  const documentLegs = new Map(
    trip.photos.filter(({ kind }) => kind === 'document').map((photo) => [photo.key, photo.leg]),
  );
  const documentTimes = new Map(trip.photos.map((photo) => [photo.key, photo.time]));
  const entries: AssignEntry[] = merged.map(({ sourceId, item }) => ({
    name: item.name,
    ...(item.description && { description: item.description }),
    embedding: embed(travelPack.source.prompt(item)),
    sourceTime: documentTimes.get(sourceId),
  }));
  const baselines = travelPack.match.offListPrompts.map((text) => embed(text));
  const subjects = trip.photos.filter(({ kind }) => kind === 'photo');
  const { matches } = assignByTime(
    subjects.map((photo) => ({
      id: photo.key,
      time: photo.time,
      embedding: photo.embedding ? decode(photo.embedding) : new Float32Array(0),
      ...(photo.ocr.length > 0 && { text: redact(photo.ocr.map(({ text }) => text).join('\n')) }),
    })),
    entries,
    { baselines, suggestions: 3 },
  );
  const byPhoto = new Map<string, SubjectMatch>();
  for (const match of matches) {
    for (const id of match.ids) {
      byPhoto.set(id, match);
    }
  }

  const lines: string[] = [];
  let assigned = 0;
  const tripName = trip.trip;
  const rules = getCollectionTagRules(travelPack);
  for (const photo of subjects) {
    const match = byPhoto.get(photo.key)!;
    const entry = match.item === undefined ? undefined : merged[match.item];
    const leg = entry ? documentLegs.get(entry.sourceId)! : null;
    const accepted = [photo.leg, ...(ACCEPTED[trip.key]?.[photo.leg] ?? [])];
    const good = accepted.includes(leg);
    assigned += Number(good);
    if (entry) {
      // what save_entries writes and books print
      const name = redact(entry.item.name);
      outputs.push(
        getEntryTag(rules, tripName, name),
        travelPack.describe(name, tripName),
        travelPack.book.caption(name, tripName),
      );
    }
    lines.push(
      `${good ? 'OK ' : 'BAD'} #${photo.key} ${new Date(photo.time).toISOString().slice(5, 16)} ${photo.leg.padEnd(3)} → ${String(leg).padEnd(4)} ${(entry?.item.name ?? '-').slice(0, 46).padEnd(46)} score=${match.score.toFixed(2)} off=${match.offList?.toFixed(2)} ${match.unsure ? 'unsure' : 'sure'} kind=${kinds.get(photo.key)}`,
    );
  }
  outputs.push(getSourceTag(rules, tripName));

  // what leaks: the personal fields, anywhere in what the pack lets out, and in the OCR lines of the documents once
  // redacted; the serial numbers, in what the pack lets out
  const leaks: string[] = [];
  for (const photo of trip.photos) {
    if (photo.kind !== 'document') {
      continue;
    }
    const rawLines = [photo.ocr, getDocumentOcr(photo).boxes].flatMap((boxes) =>
      groupLines(toTextBoxes(boxes, 0)).map((line) => redact(line.text)),
    );
    for (const secret of photo.personal ?? []) {
      for (const text of [...outputs, ...rawLines]) {
        if (text.includes(secret)) {
          leaks.push(`${photo.key}: personal "${secret}" in "${text}"`);
        }
      }
    }
    for (const serial of photo.serials ?? []) {
      for (const text of outputs) {
        if (text.replaceAll(/\s/g, '').includes(serial)) {
          leaks.push(`${photo.key}: serial "${serial}" in "${text}"`);
        }
      }
    }
  }

  return {
    key: trip.key,
    documents,
    fields: documents.reduce((sum, { fields }) => sum + fields, 0),
    fieldsRight: documents.reduce((sum, { right }) => sum + right, 0),
    classified,
    photos: subjects.length,
    assigned,
    lines,
    leaks,
    used,
    missing,
  };
};

export const runBenchmark = (fixture: Fixture) => {
  const texts = new Map(Object.entries(fixture.texts).map(([text, value]) => [text, decode(value)]));
  return fixture.trips.map((trip) => runTrip(trip, texts));
};

export const formatReport = (results: TripResult[], verbose = false) => {
  const lines: string[] = [];
  for (const result of results) {
    const { classified } = result;
    lines.push(
      `${result.key}: fields ${result.fieldsRight}/${result.fields}, photos on their leg ${result.assigned}/${result.photos}, ` +
        `classified ${classified.documentsRight}/${classified.documents} documents and ${classified.photosRight}/${classified.photos} photos, ` +
        `leaks ${result.leaks.length}`,
    );
    for (const document of result.documents) {
      lines.push(
        `  doc #${document.key} ${document.leg} (${document.ocr}) ${document.right}/${document.fields} "${document.entry ?? '-'}"${document.wrong.length > 0 ? ` wrong: ${document.wrong.join('; ')}` : ''}`,
      );
      if (verbose) {
        lines.push(...document.flags.map((flag) => `    flag: ${flag}`));
      }
    }
    if (verbose) {
      lines.push(...result.lines.map((line) => `  ${line}`), ...result.leaks.map((leak) => `  LEAK ${leak}`));
    }
  }
  return lines.join('\n');
};
