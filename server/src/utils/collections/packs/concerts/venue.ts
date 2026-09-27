import { OsmFilter } from 'src/utils/collections/overpass.js';
import { isDateText, readConcertSource, readWeekday } from 'src/utils/collections/packs/concerts/lineup.js';
import { PlaceNameRules } from 'src/utils/collections/place.js';

/** words that name a music venue or a festival, in the languages of tickets, posters and signs */
export const VENUE_WORDS =
  /(?<!\p{L})(?:festival|festivals|fest|festa|fiesta|club|hall|arena|theat(?:re|er)|teatro|th[eé][aâ]tre|ballroom|stadium|stadion|estadio|amphitheat(?:re|er)|auditorium|auditori|opera|music venue|lounge|tavern|pub|cabaret|coliseum|colosseum|pavilion|bowl|palais|palau|palacio|sala|salle|konzerthaus|philharmonie|philharmonic|concert hall|live house)(?!\p{L})/iu;

/** text of tickets, setlists and line-ups that never names the venue */
const NOT_A_NAME =
  /^(?:set ?list|encore|interlude|intermission|line-?up|main stage|stage \d+|tickets?|admission|general admission|ga|doors(?: open)?|all ages|sold out|on the move|thanks?(?: you)?.*|merch|guest ?list|vip|backstage|access all areas|aaa|crew|artist|photo pass|wristband)$/i;

/** a row of a line-up ("20:20 - MALIHINI"), a day heading or a date is no venue */
const TIMED = /(?<![\d:])(?:[01]?\d|2[0-3])\s?[:hH.]\s?[0-5][\dOo](?!\d)/;

/**
 * "SEATTLE WASHINGTON · NEUMOS" → "NEUMOS", "@ The Showbox" → "The Showbox": the venue of a setlist header after its
 * city; other lines as printed
 */
export const cleanVenueLine = (text: string) => {
  const parts = text.split(/\s*[·•@|]\s*|\s+at\s+/i);
  return (parts.length > 1 ? parts.at(-1)! : text).replace(/[.,;:\s]+$/, '').trim();
};

/** how the name of a venue or festival is read on its signs, tickets, posters and setlists */
export const VENUE_NAME_RULES: PlaceNameRules = {
  words: VENUE_WORDS,
  blocked: NOT_A_NAME,
  cleanLine: cleanVenueLine,
  isNotName: (text) => TIMED.test(text) || isDateText(text) || readWeekday(text) !== undefined,
  // the venue a setlist names in its header
  title: (ocr) => readConcertSource(ocr).venue,
  titleBonus: 0.35,
};

/** the music venues, clubs, theatres and stadiums of OpenStreetMap */
export const VENUE_OSM_FILTERS: OsmFilter[] = [
  { key: 'amenity', values: ['music_venue', 'nightclub', 'theatre', 'concert_hall', 'events_venue', 'arts_centre'] },
  { key: 'leisure', values: ['stadium', 'bandstand'] },
];
