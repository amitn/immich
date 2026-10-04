import type { PxRect } from 'src/utils/book/layouts.js';
import type { PageDecoration, PageTextBlock } from 'src/utils/book/render.js';

/**
 * A ticket stub, typeset on a page in place of the photo of a travel document (which carries names and booking
 * references): a card with a perforated stub, the mode and carrier on a band, from → to on a route line, the date,
 * time, seat and class below, and a round date stamp across the perforation. Its text is the page caption, as lines
 * of "Label: value", which a pack writes from the redacted fields of the document (see
 * `CollectionPack.book.sourcePage`) and the assistant can edit.
 */

export type TicketStubFields = Partial<
  Record<
    | 'mode'
    | 'carrier'
    | 'number'
    | 'from'
    | 'to'
    | 'venue'
    | 'date'
    | 'time'
    | 'seat'
    | 'class'
    | 'gate'
    | 'platform'
    | 'fare',
    string
  >
> & { notes: string[] };

const LABELS: Record<string, keyof Omit<TicketStubFields, 'notes'>> = {
  mode: 'mode',
  carrier: 'carrier',
  operator: 'carrier',
  number: 'number',
  flight: 'number',
  train: 'number',
  from: 'from',
  to: 'to',
  venue: 'venue',
  date: 'date',
  time: 'time',
  departs: 'time',
  seat: 'seat',
  class: 'class',
  gate: 'gate',
  platform: 'platform',
  fare: 'fare',
  price: 'fare',
};

/** "Mode: Bus\nFrom: Chania\n…" → the fields; other lines ("Note: …", or text without a label) are notes */
export const parseTicketStub = (caption: string): TicketStubFields => {
  const fields: TicketStubFields = { notes: [] };
  for (const line of caption.split(/\r?\n/)) {
    const match = /^\s*([\p{L} ]{2,12}):\s*(.+?)\s*$/u.exec(line);
    const key = match ? LABELS[match[1].trim().toLowerCase()] : undefined;
    if (match && key) {
      fields[key] = match[2];
    } else if (line.trim()) {
      fields.notes.push(line.replace(/^\s*note:\s*/i, '').trim());
    }
  }
  return fields;
};

/** "Mode: Bus\nFrom: Chania\n…" from the fields, in the order a stub reads them */
export const formatTicketStub = (fields: TicketStubFields) =>
  [
    ...(
      [
        ['Mode', fields.mode],
        ['Carrier', fields.carrier],
        ['Number', fields.number],
        ['From', fields.from],
        ['To', fields.to],
        ['Venue', fields.venue],
        ['Date', fields.date],
        ['Time', fields.time],
        ['Seat', fields.seat],
        ['Class', fields.class],
        ['Gate', fields.gate],
        ['Platform', fields.platform],
        ['Fare', fields.fare],
      ] as const
    ).flatMap(([label, value]) => (value ? [`${label}: ${value}`] : [])),
    ...fields.notes.map((note) => `Note: ${note}`),
  ].join('\n');

const parseColor = (hex: string) => {
  const value = hex.replace('#', '');
  const full = value.length <= 4 ? [...value.slice(0, 3)].map((digit) => digit + digit).join('') : value.slice(0, 6);
  return [0, 2, 4].map((index) => Number.parseInt(full.slice(index, index + 2), 16) || 0);
};

/** a color between two hex colors, e.g. paper a little lighter than the page */
export const mixColors = (a: string, b: string, share: number) => {
  const [x, y] = [parseColor(a), parseColor(b)];
  return `#${x
    .map((value, index) =>
      Math.round(value + (y[index] - value) * share)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

export type TicketStubColors = { ink: string; accent: string; page: string };

/** the rules, frames, stamp and text of a ticket stub drawn in `area` (the caption area of the layout), in pixels */
export const getTicketStub = (
  caption: string,
  area: PxRect,
  colors: TicketStubColors,
  { fontPx, dpi, fontFamily }: { fontPx: number; dpi: number; fontFamily: string },
): { decorations: PageDecoration[]; blocks: PageTextBlock[] } => {
  const fields = parseTicketStub(caption);
  const mm = (value: number) => (value * dpi) / 25.4;
  const width = area.width * 0.94;
  const height = Math.min(width / 2.25, area.height * 0.72);
  const left = area.left + (area.width - width) / 2;
  const top = area.top + (area.height - height) * 0.4;
  const main = width * 0.74;
  const stubLeft = left + main;
  const paper = mixColors(colors.page, '#ffffff', 0.55);
  const line = Math.max(1, mm(0.35));
  const radius = height * 0.05;
  const pad = height * 0.07;

  const decorations: PageDecoration[] = [];
  const blocks: PageTextBlock[] = [];
  const text = (
    value: string | undefined,
    rect: PxRect,
    size: number,
    extra: Partial<PageTextBlock> = {},
  ): PageTextBlock | undefined =>
    value
      ? { kind: 'caption', text: value, rect, fontPx: size, align: 'left', color: colors.ink, ...extra }
      : undefined;
  const push = (...items: Array<PageTextBlock | undefined>) => {
    for (const item of items) {
      if (item) {
        blocks.push(item);
      }
    }
  };
  const label = (value: string, rect: PxRect, align: PageTextBlock['align'] = 'left') =>
    text(value, rect, height * 0.055, {
      align,
      color: colors.accent,
      smallCaps: true,
      letterSpacing: 0.18,
      valign: 'bottom',
    });

  // the card, a band for the mode and the carrier, the perforation and its notches
  const card: PxRect = { left, top, width, height };
  decorations.push(
    { kind: 'frame', rect: card, color: colors.accent, width: line, radius, fill: paper },
    {
      kind: 'frame',
      rect: { left: left + line, top: top + line, width: main - line, height: height * 0.19 },
      color: colors.accent,
      width: 0,
      fill: colors.accent,
      radius: radius * 0.8,
    },
    {
      kind: 'line',
      x1: stubLeft,
      y1: top + height * 0.08,
      x2: stubLeft,
      y2: top + height * 0.92,
      color: colors.accent,
      width: line,
      dash: `${mm(1.2).toFixed(1)} ${mm(1).toFixed(1)}`,
    },
    { kind: 'circle', x: stubLeft, y: top, r: height * 0.06, color: colors.accent, width: line, fill: colors.page },
    {
      kind: 'circle',
      x: stubLeft,
      y: top + height,
      r: height * 0.06,
      color: colors.accent,
      width: line,
      fill: colors.page,
    },
  );
  const bandText = { color: colors.page, smallCaps: true, letterSpacing: 0.2, valign: 'middle' as const };
  const band: PxRect = { left: left + pad, top, width: main - 2 * pad, height: height * 0.19 };
  const mode = [fields.mode ?? (fields.venue ? 'Admission' : 'Ticket'), fields.number].filter(Boolean).join(' ');
  push(
    text(mode, { ...band, width: band.width * 0.5 }, height * 0.08, { ...bandText, bold: true }),
    text(fields.carrier, { ...band, left: band.left + band.width * 0.45, width: band.width * 0.55 }, height * 0.07, {
      ...bandText,
      align: 'right',
    }),
  );

  // from → to on a route line, or the venue
  const routeTop = top + height * 0.26;
  const nameHeight = height * 0.24;
  const nameSize = height * 0.15;
  const inner = { left: left + pad, width: main - 2 * pad };
  if (fields.from || fields.to) {
    const half = inner.width * 0.4;
    push(
      label('from', { left: inner.left, top: routeTop, width: half, height: height * 0.08 }),
      label(
        'to',
        { left: inner.left + inner.width - half, top: routeTop, width: half, height: height * 0.08 },
        'right',
      ),
      text(
        fields.from ?? '—',
        { left: inner.left, top: routeTop + height * 0.08, width: half, height: nameHeight },
        nameSize,
        {
          bold: true,
          valign: 'middle',
        },
      ),
      text(
        fields.to ?? '—',
        { left: inner.left + inner.width - half, top: routeTop + height * 0.08, width: half, height: nameHeight },
        nameSize,
        { bold: true, valign: 'middle', align: 'right' },
      ),
    );
    // the route between them: a dotted line from a dot to an arrow
    const y = routeTop + height * 0.08 + nameHeight / 2;
    const x1 = inner.left + half * 0.98;
    const x2 = inner.left + inner.width - half * 0.98;
    if (x2 - x1 > mm(6)) {
      const arrow = height * 0.035;
      decorations.push(
        { kind: 'circle', x: x1 + arrow, y, r: arrow * 0.45, color: colors.accent, width: 0, fill: colors.accent },
        {
          kind: 'line',
          x1: x1 + arrow * 2,
          y1: y,
          x2: x2 - arrow * 2,
          y2: y,
          color: colors.accent,
          width: line * 1.4,
          dash: `${(line * 1.4).toFixed(1)} ${(line * 3).toFixed(1)}`,
          cap: 'round',
        },
        {
          kind: 'path',
          d: `M${(x2 - arrow * 2.2).toFixed(1)} ${(y - arrow).toFixed(1)}L${(x2 - arrow * 0.2).toFixed(1)} ${y.toFixed(1)}L${(x2 - arrow * 2.2).toFixed(1)} ${(y + arrow).toFixed(1)}Z`,
          color: colors.accent,
          fill: colors.accent,
        },
      );
    }
  } else {
    push(
      label('admission', { left: inner.left, top: routeTop, width: inner.width, height: height * 0.08 }),
      text(
        fields.venue ?? 'Ticket',
        { left: inner.left, top: routeTop + height * 0.08, width: inner.width, height: nameHeight },
        nameSize,
        { bold: true, valign: 'middle' },
      ),
    );
  }

  // the date, time, seat and class (or gate, platform) below
  const details = (
    [
      ['date', fields.date],
      ['time', fields.time],
      ['seat', fields.seat],
      ['class', fields.class],
      ['gate', fields.gate],
      ['platform', fields.platform],
      ['fare', fields.fare],
    ] as const
  ).filter(([, value]) => value);
  const detailTop = top + height * 0.66;
  decorations.push({
    kind: 'line',
    x1: inner.left,
    y1: detailTop - height * 0.03,
    x2: inner.left + inner.width,
    y2: detailTop - height * 0.03,
    color: colors.accent,
    width: line * 0.6,
    opacity: 0.6,
  });
  const shown = details.slice(0, 4);
  const column = inner.width / Math.max(3, shown.length);
  for (const [index, [name, value]] of shown.entries()) {
    const x = inner.left + index * column;
    push(
      label(name, { left: x, top: detailTop, width: column * 0.95, height: height * 0.08 }),
      text(
        value,
        { left: x, top: detailTop + height * 0.09, width: column * 0.95, height: height * 0.16 },
        height * 0.085,
        {
          valign: 'top',
        },
      ),
    );
  }

  // the stub: the mode again, and a date stamp across the perforation
  const stubCenter = stubLeft + (width - main) / 2;
  push(
    text(
      (fields.mode ?? 'Ticket').toUpperCase(),
      { left: stubLeft + pad * 0.6, top: top + height * 0.06, width: width - main - pad * 1.2, height: height * 0.12 },
      height * 0.06,
      { align: 'center', color: colors.accent, smallCaps: true, letterSpacing: 0.25 },
    ),
    text(
      fields.seat ? `seat ${fields.seat}` : undefined,
      { left: stubLeft + pad * 0.6, top: top + height * 0.8, width: width - main - pad * 1.2, height: height * 0.12 },
      height * 0.06,
      { align: 'center', color: colors.ink, smallCaps: true, letterSpacing: 0.15 },
    ),
  );
  // the stamp: where the leg goes (or the first word of the sight) and the date
  const place = fields.to ?? fields.venue?.split(/\s+/, 1)[0] ?? fields.mode ?? '';
  const stampLines = [place.toUpperCase().slice(0, 12), fields.date ?? (fields.venue ? 'ADMIT ONE' : '')].filter(
    Boolean,
  );
  if (stampLines.length > 0) {
    decorations.push({
      kind: 'stamp',
      x: stubCenter - (width - main) * 0.06,
      y: top + height * 0.47,
      r: Math.min((width - main) * 0.42, height * 0.27),
      color: colors.accent,
      lines: stampLines,
      rotate: -14,
      opacity: 0.8,
      fontFamily,
    });
  }

  // what the document did not say, or said twice
  if (fields.notes.length > 0) {
    push(
      text(
        fields.notes.join(' · '),
        { left, top: top + height + height * 0.08, width, height: area.top + area.height - (top + height * 1.08) },
        fontPx * 0.95,
        { align: 'center', italic: true, valign: 'top', balance: true },
      ),
    );
  }
  return { decorations, blocks };
};
