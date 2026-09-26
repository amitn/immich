import { groupLines, toTextBoxes } from 'src/utils/collections/ocr.js';
import { REDACTED, redactTravelText } from 'src/utils/collections/packs/travel/privacy.js';
import { getDocumentOcr, loadFixture } from 'test/fixtures/travel/benchmark.js';

describe(redactTravelText.name, () => {
  it.each([
    // names, as airlines print them and after labels
    ['CHEN, MEILING MS TPE-OKA', `${REDACTED} TPE-OKA`],
    ['CHEN/MEILING MS', REDACTED],
    ['SMITH JOHN MR', REDACTED],
    ['Passenger: Anna Rossi · seat 12A', `Passenger: ${REDACTED} · seat 12A`],
    ['Name: CHEN MEILING', `Name: ${REDACTED}`],
    ['PASSENGER NAME Giorgos Papadakis', `PASSENGER NAME ${REDACTED}`],
    ['Mr John Smith, seat 4C', `${REDACTED}, seat 4C`],
    ['ΟΝΟΜΑΤΕΠΩΝΥΜΟ ΓΙΩΡΓΟΣ ΠΑΠΑΔΑΚΗΣ', `ΟΝΟΜΑΤΕΠΩΝΥΜΟ ${REDACTED}`],
    // the Greek label as OCR reads it in Latin lookalikes
    ['JNOMATENNNYMO AA. DASKHOGNUNHS', `JNOMATENNNYMO ${REDACTED}`],
    ['氏名 山田太郎', `氏名 ${REDACTED}`],
    ['旅客姓名：王小明', `旅客姓名：${REDACTED}`],
    ['山田太郎様', `${REDACTED}様`],
    // booking references (PNRs) and reservation codes
    ['PNR: A41NQS', `PNR: ${REDACTED}`],
    ['Pnr： A41NQS Sqn: 100', `Pnr： ${REDACTED} Sqn: ${REDACTED}`],
    ['PNR A41NQS', `PNR ${REDACTED}`],
    ['Booking reference: XK7Q2B', `Booking reference: ${REDACTED}`],
    ['Booking ref QWERTY', `Booking ref ${REDACTED}`],
    ['A41NQS', REDACTED],
    ['Record locator Z9QX2M', `Record locator ${REDACTED}`],
    ['予約番号：K8Z2Q', `予約番号：${REDACTED}`],
    // ticket, sequence, frequent flyer numbers and SSR codes
    ['6952448946707Y/V', `${REDACTED}Y/V`],
    ['E-ticket 695 2448946707', `E-ticket ${REDACTED}`],
    ['Ticket no: 1603', `Ticket no: ${REDACTED}`],
    ['168301541', REDACTED],
    ['3035 71072', REDACTED],
    ['TPE/169', REDACTED],
    ['Seq Nbr: 100 Seat: 17B', `Seq Nbr: ${REDACTED} Seat: 17B`],
    ['SSR: BG20 MS11', `SSR: ${REDACTED}`],
    ['SSR BG20 MS11 SSR: BG20 MS11', `SSR ${REDACTED} SSR: ${REDACTED}`],
    ['FFP: BR 123456789', `FFP: ${REDACTED}`],
    ['券番号:3666', `券番号:${REDACTED}`],
    // barcode payloads and their digits
    ['M1CHEN/MEILING MS    EA41NQS TPEOKABR 0186 313Y040A0169 100', REDACTED],
    ['T000000153257', REDACTED],
    ['D000001E225', REDACTED],
    // contact details
    ['Tel: +30 28210 93052', `Tel: ${REDACTED}`],
    ['chen.meiling@example.com', REDACTED],
  ])('should hide %s', (text, expected) => {
    expect(redactTravelText(text)).toBe(expected);
  });

  it.each([
    'Flight BR186 Taipei → Okinawa, 9 Nov',
    'Flight BR0186 TPE-OKA',
    'Flight IT231 Okinawa → Taipei, 12 Nov 2019',
    'EVA Air · boarding 16:20 · TPE-OKA · seat 40A · Economy · gate B8',
    'Bus Chania → Sougia, 4 Oct 2016',
    'KTEL · departs 05:00 · bus 55 · seat 5 · 8.30 €',
    'Ferry Sougia → Sfakia, 4 Oct 2016',
    'departs 09:20? · also written: ?:30 · vessel Samaria I · ECO · 16,20 €',
    'Samaria National Park',
    'Monorail → 那覇空港',
    'Monorail from おもろまち, 11 Nov 2019',
    'bought 12:37 · 230円 · receipt',
    '沖縄都市モノレール · 270円',
    'Tel Aviv → Athens, 12 Jun 2024',
    'Train ICE 1234 München Hbf → Berlin Hbf, 3 May 2024',
    'Hotel Sun Queen · Naha day',
    'Travel/Crete, October 2016/Bus Chania → Sougia, 4 Oct 2016',
    '04/10/2016 05:00',
    '2019年11月11日時刻12時37分',
    'Gate: 43A · Boarding At: 0900 · Date: 12NOV19',
  ])('should keep the fields of the journey in %s', (text) => {
    expect(redactTravelText(text)).toBe(text);
  });

  it('should be idempotent', () => {
    for (const text of ['PNR: A41NQS', 'CHEN, MEILING MS', '6952448946707']) {
      expect(redactTravelText(redactTravelText(text))).toBe(redactTravelText(text));
    }
  });

  it('should leave no personal field in any OCR line of the real documents', () => {
    const fixture = loadFixture();
    let secrets = 0;
    for (const trip of fixture.trips) {
      for (const photo of trip.photos) {
        if (photo.kind !== 'document') {
          continue;
        }
        const lines = [photo.ocr, getDocumentOcr(photo).boxes].flatMap((boxes) =>
          groupLines(toTextBoxes(boxes, 0)).map((line) => redactTravelText(line.text)),
        );
        for (const secret of photo.personal ?? []) {
          secrets++;
          expect(
            lines.filter((line) => line.includes(secret)),
            `${trip.key} ${photo.key}`,
          ).toEqual([]);
        }
      }
    }
    // names, booking references, ticket and sequence numbers, SSR codes and barcode digits
    expect(secrets).toBeGreaterThanOrEqual(12);
  });
});
