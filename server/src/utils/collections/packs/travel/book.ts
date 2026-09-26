import { TICKET_STUB_LAYOUT } from 'src/utils/book/layouts.js';
import { formatTicketStub } from 'src/utils/book/ticket-stub.js';
import { OcrBoxInput, groupLines, toTextBoxes } from 'src/utils/collections/ocr.js';
import { CollectionReviewInput, CollectionReviewIssue, CollectionSourcePage } from 'src/utils/collections/pack.js';
import { formatDate, formatTime } from 'src/utils/collections/packs/travel/dates.js';
import { getLegName, getModeName, isTravelDocument, readTicket } from 'src/utils/collections/packs/travel/ticket.js';

/*
 * The travel pack in books: a chapter per leg, opened by a ticket stub typeset from the fields of its document
 * (never the photo of the document, which carries names and booking references), and checks for legs without
 * photos, photos that no document covers and documents without a date.
 */

const TIME_NOTES = { departure: '', boarding: ' boarding', purchase: ' bought' } as const;

/** the ticket stub of a travel document: the fields of its leg as "Label: value" lines, and the leg it is for */
export const getTicketStubPage = (
  ocr: OcrBoxInput[],
  options: { aspectRatio?: number } = {},
): CollectionSourcePage | undefined => {
  const ticket = readTicket(ocr, options);
  const text = groupLines(toTextBoxes(ocr))
    .map((line) => line.text)
    .join('\n');
  if (!ticket || !isTravelDocument(ticket, text)) {
    return;
  }
  const caption = formatTicketStub({
    ...(ticket.mode && { mode: ticket.mode === 'entry' ? 'Admission' : getModeName(ticket.mode) }),
    ...(ticket.carrier && { carrier: ticket.carrier }),
    ...(ticket.number && { number: ticket.number }),
    ...(ticket.from && { from: ticket.from }),
    ...(ticket.to && { to: ticket.to }),
    ...(ticket.venue && { venue: ticket.venue }),
    ...(ticket.date && { date: formatDate(ticket.date) }),
    ...(ticket.time && { time: `${formatTime(ticket.time)}${TIME_NOTES[ticket.timeKind ?? 'departure']}` }),
    ...(ticket.seat && { seat: ticket.seat }),
    ...(ticket.travelClass && { class: ticket.travelClass }),
    ...(ticket.gate && { gate: ticket.gate }),
    ...(ticket.platform && { platform: ticket.platform }),
    ...(ticket.fare && { fare: ticket.fare }),
    notes: ticket.otherTime ? [`Also written on the ticket: ${ticket.otherTime}`] : [],
  });
  return { entry: getLegName(ticket), caption };
};

const LEG =
  /^(flight|ferry|bus|train|monorail|metro|tram)(?:\s+([A-Z\d]{2}\d{1,4}))?\s+(.+?)(?:,\s*(\d{1,2} \p{L}{3}(?: \d{4})?))?$/iu;
const DATED = /^(.+?),\s*(\d{1,2} \p{L}{3}(?: \d{4})?)$/u;

/**
 * The title of the chapter of a leg: its route in the heading, then its mode, date and the trip, e.g.
 * "Chania → Sougia · Bus, 4 Oct 2016 · Crete, October 2016"; a day or a sight keeps its name
 */
export const getLegChapterTitle = (leg: string, trip: string) => {
  const match = LEG.exec(leg.trim());
  if (match) {
    const [, mode, number, route, date] = match;
    const kind = [mode, number].filter(Boolean).join(' ');
    // "→ 那覇空港" is where the leg goes, "from おもろまち" where it starts
    const heading = route.replace(/^→\s*/, 'To ').replace(/^from\s+/i, 'From ');
    return `${heading} · ${[kind, date].filter(Boolean).join(', ')} · ${trip}`;
  }
  const dated = DATED.exec(leg.trim());
  return dated ? `${dated[1]} · ${dated[2]} · ${trip}` : `${leg.trim()} · ${trip}`;
};

/** "sougia" and "soutia": a letter off, or the same first five letters */
const isNearWord = (a: string, b: string) => {
  if (a === b) {
    return true;
  }
  if (Math.min(a.length, b.length) < 5) {
    return false;
  }
  if (a.slice(0, 5) === b.slice(0, 5)) {
    return true;
  }
  return a.length === b.length && [...a].filter((char, index) => char !== b[index]).length <= 1;
};

/** the numbers of a name, e.g. its date */
const numbersOf = (list: string[]) =>
  list
    .filter((word) => /\d/.test(word))
    .toSorted()
    .join(' ');

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((word) => word.length >= 3);

/**
 * whether two names are of the same entry, give or take a place name corrected when it was saved: the same numbers
 * (a date), and three in four of their words the same or a letter off
 */
const isSameLeg = (a: string, b: string) => {
  const [x, y] = [words(a), words(b)];
  if (numbersOf(x) !== numbersOf(y)) {
    return false;
  }
  const [p, q] = [x.filter((word) => !/\d/.test(word)), y.filter((word) => !/\d/.test(word))];
  const shared = p.filter((word) => q.some((other) => isNearWord(word, other))).length;
  return p.length > 0 && q.length > 0 && shared >= 0.75 * Math.max(p.length, q.length);
};

const formatPages = (pages: number[]) =>
  pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.slice(0, -1).join(', ')} and ${pages.at(-1)}`;

/**
 * The checks of travel books: the photo of a document printed as it is (names, booking references), legs whose
 * document has no photos in the book, photos of legs no document covers (days between the legs), and documents whose
 * date could not be read
 */
export const reviewTravelBook = ({ pages, photos }: CollectionReviewInput): CollectionReviewIssue[] => {
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const issues: CollectionReviewIssue[] = [];
  const travel = (photo?: (typeof photos)[number]) => photo?.collection?.pack === 'travel';
  const placed = pages.flatMap((page, index) =>
    page.assets.flatMap(({ assetId }) => {
      const photo = byId.get(assetId);
      return photo && travel(photo) ? [{ photo, page: index + 1 }] : [];
    }),
  );
  const documents = photos.filter((photo) => travel(photo) && photo.collection!.kind === 'source');
  const stubs = pages.flatMap((page, index) => (page.layout === TICKET_STUB_LAYOUT ? [index + 1] : []));

  const printed = placed.filter(({ photo }) => photo.collection!.kind === 'source');
  if (printed.length > 0) {
    const numbers = [...new Set(printed.map(({ page }) => page))];
    issues.push({
      severity: 'high',
      type: 'missing-menu-page',
      message:
        `${formatPages(numbers)} print${numbers.length === 1 ? 's' : ''} the photo of a travel document, with the ` +
        'names, booking references and barcodes on it: replace it with a ticket-stub page (its caption is the fields ' +
        'of the leg), or lay the book out again',
      pages: numbers,
      assetIds: printed.map(({ photo }) => photo.id),
    });
  }

  const legs = placed.flatMap(({ photo, page }) =>
    photo.collection!.kind === 'entry' && photo.collection!.entry ? [{ entry: photo.collection!.entry, page }] : [],
  );
  const documented = documents.flatMap((photo) => (photo.sourcePage?.entry ? [photo.sourcePage.entry] : []));
  for (const document of documents) {
    const entry = document.sourcePage?.entry;
    if (entry && legs.every((leg) => !isSameLeg(leg.entry, entry))) {
      issues.push({
        severity: 'low',
        type: 'empty-slot',
        message:
          `The leg ${entry} has a travel document but no photos in the book: add photos of the leg, or leave its ` +
          'ticket stub out',
        pages: [],
        assetIds: [document.id],
      });
    }
    if (document.sourcePage && !/^Date:/m.test(document.sourcePage.caption)) {
      issues.push({
        severity: 'low',
        type: 'missing-captions',
        message:
          `The travel document of ${entry ?? 'a leg'} has no date that could be read (printed vertically, stamped or ` +
          'on the back): add a "Date: …" line to the caption of its ticket stub',
        pages: stubs,
        assetIds: [document.id],
      });
    }
  }

  const undocumented = legs.filter((leg) => documented.every((entry) => !isSameLeg(leg.entry, entry)));
  if (documents.length > 0 && undocumented.length > 0) {
    const names = [...new Set(undocumented.map(({ entry }) => entry))];
    const numbers = [...new Set(undocumented.map(({ page }) => page))].toSorted((a, b) => a - b);
    issues.push({
      severity: 'low',
      type: 'missing-menu-page',
      message:
        `${formatPages(numbers)} show${numbers.length === 1 ? 's' : ''} photos of ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}, which ` +
        'no travel document covers: days between the legs, titled as days (e.g. "Chania day"), or legs whose ticket ' +
        'is not in the album',
      pages: numbers,
    });
  }
  return issues;
};
