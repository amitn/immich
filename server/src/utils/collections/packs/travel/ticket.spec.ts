import { findDates, findTimes, getNearestYear, separateDateTime } from 'src/utils/collections/packs/travel/dates.js';
import { isGreekLookalike, readGreekName, transliterateGreek } from 'src/utils/collections/packs/travel/greek.js';
import { getLegDescription, getLegName, parseTicket, readTicket } from 'src/utils/collections/packs/travel/ticket.js';
import { getDocumentOcr, loadFixture } from 'test/fixtures/travel/benchmark.js';

/** an OCR box of a line of text at (left, top), its width in proportion to its text */
const box = (text: string, left: number, top: number, height = 0.04, textScore = 0.95) => {
  const right = Math.min(1, left + text.length * height * 0.45);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore };
};

describe('dates', () => {
  it.each([
    ['04/10/2016 05:00', { year: 2016, month: 10, day: 4 }],
    ['BR0186/09N0V', { month: 11, day: 9 }],
    ['Date: 12NOV19', { year: 2019, month: 11, day: 12 }],
    ['4 OKT 2016', { year: 2016, month: 10, day: 4 }],
    ['4 ΟΚΤ. 2016', { year: 2016, month: 10, day: 4 }],
    ['利用日付 2019年11月11日時刻12時37分', { year: 2019, month: 11, day: 11 }],
    ['2016-10-04', { year: 2016, month: 10, day: 4 }],
    ['Oct 4, 2016', { year: 2016, month: 10, day: 4 }],
  ])('should read the date in %s', (text, expected) => {
    expect(findDates(text)[0]).toMatchObject(expected);
  });

  it('should read day and month in the order of the country', () => {
    expect(findDates('04/10/2016')[0]).toMatchObject({ month: 10, day: 4 });
    expect(findDates('04/10/2016', { order: 'mdy' })[0]).toMatchObject({ month: 4, day: 10 });
    expect(findDates('11/12 12:37', { shortOrder: 'mdy' })[0]).toMatchObject({ month: 11, day: 12 });
  });

  it.each([
    ['04/10/2016 05:00', '05:00'],
    ['IM/NIA-RPA 04/10/2016 D9:20', '09:20'],
    [separateDateTime('04/10/201618:30'), '18:30'],
    ['DASKALOGIANNHS 17.30', '17:30'],
    ['時刻12時37分', '12:37'],
    ['issued 19:12:33', '19:12'],
  ])('should read the time in %s', (text, expected) => {
    const [time] = findTimes(text);
    expect(`${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`).toBe(expected);
  });

  it('should not read prices, dates and numbers as times', () => {
    expect(findTimes('8.30€ EUR 16,20 € 5,00 04.10.2016 0945')).toEqual([]);
    expect(findTimes('Depart: OKINAWA 0945', { bareDigits: true })).toMatchObject([{ hour: 9, minute: 45 }]);
  });

  it('should give a date without a year the year of the trip', () => {
    expect(getNearestYear({ month: 11, day: 9 }, Date.UTC(2019, 10, 10))).toBe(2019);
    expect(getNearestYear({ month: 12, day: 30 }, Date.UTC(2020, 0, 2))).toBe(2019);
  });
});

describe('Greek read as Latin lookalikes', () => {
  it('should tell Greek words from English ones', () => {
    expect(isGreekLookalike('XANIA')).toBe(true);
    expect(isGreekLookalike('PEOYMNOY')).toBe(true);
    expect(isGreekLookalike('EXIT')).toBe(false);
    expect(isGreekLookalike('SOUGIA')).toBe(false);
    expect(isGreekLookalike('ZAMAPIA')).toBe(false);
    expect(isGreekLookalike('ZAMAPIA', true)).toBe(true);
  });

  it('should map lookalikes back to Greek and transliterate them', () => {
    expect(transliterateGreek('ΧΑΝΙΑ')).toBe('Chania');
    expect(transliterateGreek('ΣΟΥΓΙΑ')).toBe('Sougia');
    expect(readGreekName('XANIA')).toEqual({ name: 'Chania', lookalike: true });
    // a Σ read as E at the start of a word, before A or O
    expect(readGreekName('EAMAPIA').name).toBe('Samaria');
    expect(readGreekName('XANIA-SOUGIA').name).toBe('Chania-Sougia');
  });
});

describe(readTicket.name, () => {
  it('should read a boarding pass, its table and its stub', () => {
    const ocr = [
      box('ECONOMY CLASS', 0.1, 0.18),
      box('GATE', 0.1, 0.25, 0.03),
      box('BOARDING TIME', 0.32, 0.25, 0.03),
      box('SEAT', 0.52, 0.25, 0.03),
      box('B8', 0.1, 0.3, 0.05),
      box('16:20', 0.32, 0.3, 0.05),
      box('40A', 0.52, 0.3, 0.05),
      box('DOE, JANE MS', 0.1, 0.42),
      box('TPE-OKA', 0.5, 0.42),
      box('BR0186/09NOV', 0.1, 0.5),
      box('TAIPEI', 0.45, 0.5),
      box('OKINAWA', 0.6, 0.5),
      box('TPE/169', 0.1, 0.58),
      box('6952448946707Y/V', 0.6, 0.66),
      box('EVAAIR', 0.1, 0.8),
    ];
    const ticket = readTicket(ocr);
    expect(ticket).toMatchObject({
      mode: 'flight',
      carrier: 'EVA Air',
      number: 'BR186',
      from: 'Taipei',
      to: 'Okinawa',
      fromCode: 'TPE',
      toCode: 'OKA',
      date: { month: 11, day: 9 },
      time: { hour: 16, minute: 20 },
      timeKind: 'boarding',
      seat: '40A',
      gate: 'B8',
      travelClass: 'Economy',
    });
    expect(ticket!.flags).toEqual([
      'The year is not printed (9 Nov)',
      'Only the boarding time is printed (16:20); the departure is later',
    ]);
    const parsed = parseTicket(ocr);
    expect(parsed.items.map(({ name, description }) => ({ name, description }))).toEqual([
      {
        name: 'Flight BR186 Taipei → Okinawa, 9 Nov',
        description: 'EVA Air · boarding 16:20 · TPE-OKA · seat 40A · Economy · gate B8',
      },
    ]);
    // nothing personal is read: the name, the sequence and the ticket number are not fields of the journey
    expect(JSON.stringify(parsed)).not.toMatch(/DOE|JANE|169|6952448946707/);
  });

  it('should read a Greek bus ticket printed in Greek and English, from Latin lookalikes', () => {
    const ocr = [
      box('KTEA XANIQN-PEOYMNOY A.E.', 0.25, 0.07),
      box('HMEPOMHNIA TPITH 04/10/2016 05:00', 0.2, 0.2),
      box('ROUTE', 0.2, 0.25),
      box('ANO-NPOE XANIA-EOYTIA', 0.2, 0.3),
      box('FROM-TO', 0.2, 0.35),
      box('BUS 55 PLATFORM SEAT 5', 0.15, 0.5),
      box('PASSENGER NAME', 0.13, 0.65),
    ];
    const ticket = readTicket(ocr)!;
    expect(ticket).toMatchObject({
      mode: 'bus',
      carrier: 'KTEL',
      from: 'Chania',
      to: 'Soutia',
      date: { year: 2016, month: 10, day: 4 },
      time: { hour: 5, minute: 0 },
      coach: '55',
      seat: '5',
      lookalike: true,
    });
    expect(ticket.flags).toContain('Greek print was read as Latin lookalikes: the place names may be misspelled');
    expect(getLegName(ticket)).toBe('Bus Chania → Soutia, 4 Oct 2016');
    expect(getLegDescription(ticket)).toBe('KTEL · departs 05:00 · bus 55 · seat 5');
  });

  it('should take the date of the journey, not the date of issue', () => {
    const ticket = readTicket([
      box('KTEA XANION-PEOYMNOY A.E', 0.2, 0.15),
      box('HMEPOMHNIA OPA APOMOAOTIOY', 0.2, 0.3),
      box('04/10/201618:30', 0.2, 0.35),
      box('XAAKION', 0.2, 0.43),
      box('XANIA', 0.2, 0.49),
      box('HMEPOMHNIA-OPA EKAOZHE', 0.2, 0.66),
      box('03/10/2016 19:12:33', 0.2, 0.71),
    ])!;
    expect(ticket).toMatchObject({ date: { month: 10, day: 4 }, time: { hour: 18, minute: 30 }, to: 'Chania' });
  });

  it('should flag a time written over the printed one', () => {
    const ticket = readTicket([
      box('ANENAYK A.E.', 0.28, 0.09),
      box('IM/NIA-RPA 04/10/2016 09:20', 0.28, 0.2),
      box('VESSEL SAMARIA I', 0.28, 0.28),
      box('FROM-TO SOUGIA SFAKIA', 0.28, 0.33),
      box('17.30', 0.6, 0.55, 0.1, 0.8),
    ])!;
    expect(ticket).toMatchObject({
      mode: 'ferry',
      from: 'Sougia',
      to: 'Sfakia',
      vessel: 'Samaria I',
      otherTime: '17:30',
    });
    expect(ticket.flags).toContain(
      'Another time (17:30) is written on the document, maybe by hand over the printed 09:20: check which one was used',
    );
    expect(getLegDescription(ticket)).toBe('ANENAYK · departs 09:20? · also written: 17:30 · vessel Samaria I');
  });

  it('should read a Japanese fare receipt, and flag what it does not say', () => {
    const ticket = readTicket([
      box('領収証', 0.4, 0.09, 0.1),
      box('利用日付 2019年11月11日時刻12時37分', 0.07, 0.25, 0.08),
      box('券番号:3666', 0.07, 0.36, 0.07),
      box('取引内容:乗車券類購入 金 230円', 0.07, 0.43, 0.07),
      box('伝票番号:65313 沖縄都市モノレール株式会社', 0.07, 0.61, 0.06),
      box('おもろまち01券発行', 0.66, 0.69, 0.06),
    ])!;
    expect(ticket).toMatchObject({
      mode: 'monorail',
      receipt: true,
      from: 'おもろまち',
      date: { year: 2019, month: 11, day: 11 },
      time: { hour: 12, minute: 37 },
      timeKind: 'purchase',
      fare: '230円',
    });
    expect(getLegName(ticket)).toBe('Monorail from おもろまち, 11 Nov 2019');
    expect(JSON.stringify(ticket)).not.toMatch(/3666|65313/);
  });

  it('should handle a ticket whose date was not read', () => {
    const parsed = parseTicket([
      box('(沖縄都市モノレール線)', 0.12, 0.14, 0.1),
      box('那覇空港', 0.13, 0.24, 0.2),
      box('270', 0.32, 0.41, 0.26),
      box('0482 小児140円', 0.12, 0.64, 0.1),
      box('発売当日限り有効 下車前途無効 06券', 0.12, 0.76, 0.1),
    ]);
    expect(parsed.items.map(({ name, description }) => ({ name, description }))).toEqual([
      { name: 'Monorail → 那覇空港', description: '沖縄都市モノレール · 270円' },
    ]);
    expect(parsed.warnings).toEqual([
      'No date could be read on the document (it may be printed vertically, stamped or on the other side)',
      'Where the journey starts is not printed or could not be read',
      'No time could be read',
    ]);
  });

  it('should not read a sign or a timetable as a ticket', () => {
    expect(parseTicket([box('PUBLIC BUS SERVICES', 0.6, 0.47), box('MIANEK LINES', 0.4, 0.59)]).items).toEqual([]);
    expect(
      parseTicket([
        box('E4 Path Sougia-Paleochora', 0.13, 0.26),
        box('distance 9,5km -6 hours walk', 0.13, 0.32),
        box('Emergency call: 112', 0.13, 0.46),
      ]).items,
    ).toEqual([]);
  });
});

describe('the real documents', () => {
  const fixture = loadFixture();
  const legs = fixture.trips.flatMap((trip) =>
    trip.photos
      .filter(({ kind }) => kind === 'document')
      .map((photo) => {
        const { boxes } = getDocumentOcr(photo);
        return [
          `${trip.key.slice(0, 5)} ${photo.key}`,
          parseTicket(boxes, { aspectRatio: photo.width! / photo.height! }).items[0]?.name,
        ];
      }),
  );

  it('should read one leg on each', () => {
    expect(Object.fromEntries(legs)).toEqual({
      'crete 16': 'Bus Choa Akion → Chania, 4 Oct 2016',
      'crete 15': 'Ferry Sougia → Sfakia, 4 Oct 2016',
      'crete 05': 'Bus Chania → Soutia, 4 Oct 2016',
      'crete 11': 'Samaria National Park',
      'okina 01': 'Flight BR186 Taipei → Okinawa, 9 Nov',
      'okina 21': 'おきなわ',
      'okina 26': 'Monorail → 那覇空港',
      'okina 25': 'Monorail from おもろまち, 11 Nov 2019',
      'okina 28': 'Flight IT231 Okinawa → Taipei, 12 Nov 2019',
      'okina 27': 'Monorail → 旭橋',
    });
  });
});
