import {
  cleanActName,
  cleanSong,
  getUnnamedSetlistName,
  isDateText,
  isSetlistMarker,
  isUnnamedSetlist,
  parseConcertSource,
  readConcertSource,
  readTime,
  readWeekday,
} from 'src/utils/collections/packs/concerts/lineup.js';

const box = (text: string, left: number, top: number, height = 0.03, width?: number) => {
  const right = Math.min(1, left + (width ?? text.length * height * 0.5));
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.97 };
};

/** lines one below the other */
const lines = (texts: string[], { left = 0.15, top = 0.1, height = 0.03, gap = 0.015 } = {}) =>
  texts.map((text, index) => box(text, left, top + index * (height + gap), height));

describe('concert sources', () => {
  it('should read starts, days, dates and markers', () => {
    expect(readTime('20H10')).toBe('20:10');
    expect(readTime('22:0O -BRONKO YOTTE')).toBe('22:00');
    expect(readTime('SALADS - 21')).toBeUndefined();
    expect(readTime('INTRODUCED 2013')).toBeUndefined();
    expect(readWeekday('DIJOUS / JUEVES / THURSDAY')).toBe(4);
    expect(readWeekday('DISSABTE / SÁBADO')).toBe(6);
    expect(readWeekday('HAD TEN DOLLAZ')).toBeUndefined();
    expect(isDateText('FRIDAY FEB 17 2023')).toBe(true);
    expect(isDateText('MARCHT')).toBe(true);
    expect(isDateText('3/7/19')).toBe(true);
    expect(isDateText('OUT OF SIGHT')).toBe(false);
    expect(isDateText('OCT OFSIGHT')).toBe(false);
    expect(isSetlistMarker('---INTERLUDE')).toBe(true);
    expect(isSetlistMarker('ENCORE:')).toBe(true);
    expect(isSetlistMarker('INTERLUDES OF LOVE')).toBe(false);
  });

  it('should write act names and songs in title case, keeping initials', () => {
    expect(cleanActName('KALI UCHIS')).toBe('Kali Uchis');
    expect(cleanActName('TIM HECKER 8 KONOYO ENS')).toBe('Tim Hecker & Konoyo Ens');
    expect(cleanActName('MEUKO! MEUKO! (Live)')).toBe('Meuko! Meuko!');
    expect(cleanActName('DTSQ')).toBe('DTSQ');
    expect(cleanActName('PULL&BEAR')).toBe('Pull&Bear');
    expect(cleanActName('SIDNEY Gih')).toBe('Sidney Gih');
    expect(cleanActName('The Beths')).toBe('The Beths');
    expect(cleanSong('1) STRFKR - 24')).toBe('Strfkr - 24');
    expect(cleanSong('---INTERLUDE')).toBe('Interlude');
  });

  it('should read the line-up of a stage banner, by day', () => {
    const ocr = [
      box('NIGHT PRO', 0.34, 0.25, 0.06),
      box('DIJOUS / JUEVES / THURSDAY', 0.34, 0.4, 0.018),
      box('DISSABTE / SABADO / SATURDAY', 0.58, 0.4, 0.018),
      box('19:20 - BELAU', 0.34, 0.43, 0.018),
      box('17:30 - BONISH', 0.58, 0.43, 0.018),
      box('20:20 - MALIHINI', 0.34, 0.46, 0.018),
      box('19:30 - DTSQ', 0.58, 0.46, 0.018),
      box('23:25 - P POSTMAN FEAT. EMERGENCY TIARA,', 0.34, 0.49, 0.018),
      box('00:00 - F5', 0.58, 0.49, 0.018),
      box('DARKO & MAHKENNA', 0.34, 0.51, 0.018),
    ];
    const source = readConcertSource(ocr);
    expect(source.kind).toBe('line-up');
    expect(source.title).toBe('Night Pro');
    expect(source.acts.map(({ name, weekday, time, stage }) => ({ name, weekday, time, stage }))).toEqual([
      { name: 'Belau', weekday: 4, time: '19:20', stage: 'Night Pro' },
      { name: 'Bonish', weekday: 6, time: '17:30', stage: 'Night Pro' },
      { name: 'Malihini', weekday: 4, time: '20:20', stage: 'Night Pro' },
      { name: 'DTSQ', weekday: 6, time: '19:30', stage: 'Night Pro' },
      { name: 'P Postman Feat. Emergency Tiara, Darko & Mahkenna', weekday: 4, time: '23:25', stage: 'Night Pro' },
      { name: 'F5', weekday: 6, time: '00:00', stage: 'Night Pro' },
    ]);
    expect(parseConcertSource(ocr).items[3]).toEqual(
      expect.objectContaining({ name: 'DTSQ', description: 'Saturday 19:30 · Night Pro', section: 'Saturday' }),
    );
  });

  it('should read a board of stage times: the act, its start and its stage', () => {
    const row = (act: string, time: string, stage: string, top: number) => [
      box(act, 0.48, top, 0.014),
      box(time, 0.6, top, 0.014),
      box(stage, 0.66, top, 0.014),
    ];
    const ocr = [
      box('LOTUS', 0.64, 0.15, 0.026),
      ...row('NATHY PELUSO', '19H40', 'PULL&BEAR', 0.21),
      ...row('SHELLAC', '20H25', 'RAY-BAN', 0.23),
      ...row('KALI UCHIS', '20H45', 'SEAT', 0.25),
      box('ON THE', 0.53, 0.54, 0.045),
      box('MOVE', 0.53, 0.58, 0.057),
    ];
    const { items } = parseConcertSource(ocr);
    expect(items.map(({ name, description }) => ({ name, description }))).toEqual([
      { name: 'Nathy Peluso', description: '19:40 · Pull&Bear' },
      { name: 'Shellac', description: '20:25 · Ray-Ban' },
      { name: 'Kali Uchis', description: '20:45 · Seat' },
    ]);
  });

  it('should read a setlist: the band and the acts billed with it, the date, the city, the venue and the songs', () => {
    const ocr = lines([
      'SIDNEY GISH w/ THE BETHS',
      'FRIDAY FEB 17 2023',
      'SEATTLE WASHINGTON · NEUMOS',
      '1) STRFKR - 24',
      '2) SIDEWALK - 3',
      '3) RAT - 23',
      '4) SALADS - 21',
    ]);
    const source = readConcertSource(ocr);
    expect(source).toEqual(
      expect.objectContaining({
        kind: 'setlist',
        date: 'Friday Feb 17 2023',
        city: 'Seattle Washington',
        venue: 'Neumos',
        songs: ['Strfkr - 24', 'Sidewalk - 3', 'Rat - 23', 'Salads - 21'],
      }),
    );
    expect(parseConcertSource(ocr).items.map(({ name, description }) => ({ name, description }))).toEqual([
      { name: 'Sidney Gish', description: 'setlist · 4 songs' },
      { name: 'The Beths', description: 'with Sidney Gish' },
    ]);
  });

  it('should read the band of a typed setlist headed with the city and the date', () => {
    const ocr = lines(['CHERRY GLAZERR - SEATTLE - MARCH 7', 'OHIO', 'HAD TEN DOLLAZ', '---INTERLUDE', 'TOLD YOU']);
    const source = readConcertSource(ocr);
    expect(source.acts.map(({ name, setlist }) => ({ name, setlist }))).toEqual([
      { name: 'Cherry Glazerr', setlist: 'own' },
    ]);
    expect(source.city).toBe('Seattle');
    expect(source.songs).toEqual(['Ohio', 'Had Ten Dollaz', 'Interlude', 'Told You']);
    expect(parseConcertSource(ocr).items[0].description).toBe('setlist · 3 songs');
  });

  it('should give a setlist of songs only a placeholder act, and read no act on a few stacked words', () => {
    const songs = [
      'FUTURE ME',
      'KNEES DEEP',
      'OUT OF SIGHT',
      'PASSING RAIN',
      'BEST LEFT',
      'SILENCE',
      'EXPERT',
      'YAABOL',
    ];
    const parsed = parseConcertSource(lines(songs, { gap: 0.06 }));
    expect(parsed.items.map(({ name }) => name)).toEqual(['(setlist: Future Me, Knees Deep …)']);
    expect(parsed.warnings).toEqual([expect.stringContaining('names no act')]);
    expect(isUnnamedSetlist(getUnnamedSetlistName(['Ohio', 'Told You', 'Daddi']))).toBe(true);
    expect(parseConcertSource(lines(['PRIMA', 'VERA', 'SOUND', 'BARCELONA 2019', 'SEAT'])).items).toEqual([]);
  });
});
