import { bookStylePresets, bookStyleThemes } from 'src/dtos/book.dto.js';
import { AutoLayoutPhoto, planAutoLayout } from 'src/utils/book/auto-layout.js';
import { getCollectionTag, isPrintedTheme } from 'src/utils/book/collections.js';
import { TICKET_STUB_LAYOUT } from 'src/utils/book/layouts.js';
import { planPage } from 'src/utils/book/render.js';
import { reviewBook } from 'src/utils/book/review.js';
import { parseTicketStub } from 'src/utils/book/ticket-stub.js';
import { getCollectionTagRules } from 'src/utils/collections/pack.js';
import { getLegChapterTitle, getTicketStubPage } from 'src/utils/collections/packs/travel/book.js';
import { travelPack } from 'src/utils/collections/packs/travel/pack.js';
import { getEntryTag, getSourceTag } from 'src/utils/collections/tags.js';
import { getDocumentOcr, loadFixture } from 'test/fixtures/travel/benchmark.js';

const rules = getCollectionTagRules(travelPack);
const trip = 'Crete, October 2016';
const busLeg = 'Bus Chania → Sougia, 4 Oct 2016';
const ferryLeg = 'Ferry Sougia → Sfakia, 4 Oct 2016';
const style = bookStylePresets.travel.style;
const size = { pageWidthMm: 210, pageHeightMm: 210 };

let counter = 0;
const photo = (iso: string, values: string[], extra: Partial<AutoLayoutPhoto> = {}): AutoLayoutPhoto => {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    width: 4608,
    height: 2592,
    takenAt: new Date(`${iso}Z`).getTime(),
    score: 0.5,
    faces: [],
    isFavorite: false,
    collection: getCollectionTag(values) ?? null,
    ...extra,
  };
};

const ticket = (iso: string, entry: string, caption: string) =>
  photo(iso, [getSourceTag(rules, trip)], { sourcePage: { entry, text: caption, layout: TICKET_STUB_LAYOUT } });

describe('the travel pack in books', () => {
  it('should have a Travel style that looks printed', () => {
    expect(bookStylePresets.travel).toMatchObject({ name: 'Travel', style: { theme: 'travel' } });
    expect(bookStyleThemes).toContain('travel');
    expect(isPrintedTheme('travel')).toBe(true);
  });

  it('should title a leg with its route, its mode and date, and the trip', () => {
    expect(getLegChapterTitle(busLeg, trip)).toBe('Chania → Sougia · Bus, 4 Oct 2016 · Crete, October 2016');
    expect(getLegChapterTitle('Flight BR186 Taipei → Okinawa, 9 Nov', 'Okinawa, November 2019')).toBe(
      'Taipei → Okinawa · Flight BR186, 9 Nov · Okinawa, November 2019',
    );
    expect(getLegChapterTitle('Monorail from おもろまち, 11 Nov 2019', 'Okinawa')).toBe(
      'From おもろまち · Monorail, 11 Nov 2019 · Okinawa',
    );
    expect(getLegChapterTitle('Monorail → 旭橋', 'Okinawa')).toBe('To 旭橋 · Monorail · Okinawa');
    expect(getLegChapterTitle('Samaria National Park, 4 Oct 2016', trip)).toBe(
      'Samaria National Park · 4 Oct 2016 · Crete, October 2016',
    );
    expect(getLegChapterTitle('Chania day', trip)).toBe('Chania day · Crete, October 2016');
  });

  it('should typeset the real documents as ticket stubs, with nothing personal on them', () => {
    const fixture = loadFixture();
    const stubs = fixture.trips.flatMap((item) =>
      item.photos
        .filter(({ kind }) => kind === 'document')
        .map((document) => {
          const page = getTicketStubPage(getDocumentOcr(document).boxes, {
            aspectRatio: document.width! / document.height!,
          });
          for (const secret of [...(document.personal ?? []), ...(document.serials ?? [])]) {
            expect(JSON.stringify(page)).not.toContain(secret);
          }
          return page;
        }),
    );
    expect(stubs.every(Boolean)).toBe(true);
    expect(stubs.find((stub) => stub?.entry === 'Flight BR186 Taipei → Okinawa, 9 Nov')?.text).toBe(
      [
        'Mode: Flight',
        'Carrier: EVA Air',
        'Number: BR186',
        'From: Taipei',
        'To: Okinawa',
        'Date: 9 Nov',
        'Time: 16:20 boarding',
        'Seat: 40A',
        'Class: Economy',
        'Gate: B8',
      ].join('\n'),
    );
    expect(parseTicketStub(stubs.find((stub) => stub?.entry?.startsWith('Ferry'))!.text)).toMatchObject({
      mode: 'Ferry',
      from: 'Sougia',
      to: 'Sfakia',
      time: '09:20',
      notes: ['Also written on the ticket: ?:30'],
    });
  });

  it('should lay out a chapter per leg, opened by its ticket stub, and never print a document', () => {
    counter = 0;
    const photos = [
      photo('2016-10-04T03:40:00', [getEntryTag(rules, trip, busLeg)]),
      photo('2016-10-04T03:51:00', [getEntryTag(rules, trip, busLeg)]),
      photo('2016-10-04T06:48:00', [getEntryTag(rules, trip, busLeg)]),
      photo('2016-10-04T06:53:00', [getEntryTag(rules, trip, busLeg)]),
      photo('2016-10-04T13:11:00', [getEntryTag(rules, trip, ferryLeg)]),
      photo('2016-10-04T13:18:00', [getEntryTag(rules, trip, ferryLeg)]),
      photo('2016-10-04T13:19:00', [getEntryTag(rules, trip, ferryLeg)]),
      // the tickets were photographed that evening
      ticket('2016-10-04T20:44:00', busLeg, 'Mode: Bus\nCarrier: KTEL\nFrom: Chania\nTo: Sougia\nDate: 4 Oct 2016'),
      ticket('2016-10-04T20:41:00', ferryLeg, 'Mode: Ferry\nFrom: Sougia\nTo: Sfakia\nDate: 4 Oct 2016'),
    ];
    const tickets = new Set(photos.slice(-2).map(({ id }) => id));

    const plan = planAutoLayout(photos, { size, style, includeMaps: false });

    expect(plan.sections.map(({ title, place }) => ({ title, place }))).toEqual([
      { title: 'Chania → Sougia · Bus, 4 Oct 2016 · Crete, October 2016', place: trip },
      { title: 'Sougia → Sfakia · Ferry, 4 Oct 2016 · Crete, October 2016', place: trip },
    ]);
    const stubs = plan.pages.filter(({ layout }) => layout === TICKET_STUB_LAYOUT);
    expect(stubs.map(({ sectionTitle, caption, slots }) => ({ sectionTitle, caption, slots }))).toEqual([
      { sectionTitle: plan.sections[0].title, caption: photos[7].sourcePage!.text, slots: [] },
      { sectionTitle: plan.sections[1].title, caption: photos[8].sourcePage!.text, slots: [] },
    ]);
    expect(plan.pages.flatMap(({ slots }) => slots.map(({ assetId }) => assetId)).some((id) => tickets.has(id))).toBe(
      false,
    );
    // the legs name the chapters, not the photos
    expect(plan.pages.flatMap(({ slots }) => slots.map(({ caption }) => caption)).filter(Boolean)).toEqual([]);

    // the stub is drawn from its caption: a card, a route line and a stamp, and no photo
    const page = plan.pages.find(({ layout }) => layout === TICKET_STUB_LAYOUT)!;
    const planned = planPage(
      { pageWidthMm: 210, pageHeightMm: 210, title: 'Crete', subtitle: null, style, coverAssetId: null },
      { layout: page.layout, sectionTitle: page.sectionTitle!, caption: page.caption!, background: null, assets: [] },
      { dpi: 100, mode: 'review', sources: new Map() },
    );
    expect(planned.slots).toEqual([]);
    expect(planned.decorations.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['frame', 'line', 'stamp']));
    expect(planned.text.map(({ text }) => text)).toEqual(expect.arrayContaining(['Chania', 'Sougia', 'KTEL']));
    expect(planned.spec.overlay).toContain('rotate(-14');
  });

  it('should review the legs without photos, the photos without a document and the documents without a date', () => {
    counter = 0;
    const photos = [
      photo('2016-10-04T06:48:00', [getEntryTag(rules, trip, busLeg)]),
      photo('2016-10-06T11:00:00', [getEntryTag(rules, trip, 'Paleochora day')]),
      ticket('2016-10-04T20:44:00', busLeg, 'Mode: Bus\nFrom: Chania\nTo: Sougia\nDate: 4 Oct 2016'),
      ticket('2016-10-04T20:45:00', 'Samaria National Park', 'Venue: Samaria National Park'),
    ];
    const review = reviewBook({
      size,
      style,
      pages: [
        { layout: TICKET_STUB_LAYOUT, caption: photos[2].sourcePage!.text, assets: [] },
        { layout: 'single', assets: [{ slot: 0, assetId: photos[0].id, crop: null }] },
        { layout: 'single', assets: [{ slot: 0, assetId: photos[1].id, crop: null }] },
        { layout: 'single', assets: [{ slot: 0, assetId: photos[3].id, crop: null }] },
      ],
      photos,
    });
    const messages = review.issues.map(({ severity, type, message }) => ({ severity, type, message }));
    expect(messages).toEqual(
      expect.arrayContaining([
        {
          severity: 'high',
          type: 'missing-menu-page',
          message: expect.stringMatching(/^Page 4 prints the photo of a travel document/),
        },
        {
          severity: 'low',
          type: 'empty-slot',
          message: expect.stringMatching(/^The leg Samaria National Park has a travel document but no photos/),
        },
        {
          severity: 'low',
          type: 'missing-captions',
          message: expect.stringMatching(/^The travel document of Samaria National Park has no date/),
        },
        {
          severity: 'low',
          type: 'missing-menu-page',
          message: expect.stringMatching(/^Page 3 shows photos of Paleochora day, which no travel document covers/),
        },
      ]),
    );
  });
});
