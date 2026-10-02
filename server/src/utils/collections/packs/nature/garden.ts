import { OsmFilter } from 'src/utils/collections/overpass.js';
import { isOriginText, readPlantLabel } from 'src/utils/collections/packs/nature/label.js';
import { PlaceNameRules } from 'src/utils/collections/place.js';

/** words that name a garden, a zoo or a park, in the languages of their signs and labels */
export const GARDEN_WORDS =
  /(?<!\p{L})(?:gardens?|botanic|botanical|arboretum|zoo|zoological|park|reserve|sanctuary|conservatory|aquarium|jard[ií]n|jardim|jardins?|giardino|orto botanico|botanischer garten|tierpark|wildpark|hortus|kew)(?!\p{L})/iu;

/** text of labels and signs that never names the garden */
const NOT_A_NAME =
  /^(?:(?:not\s+)?wild|map|map\s*#?\s*\d*|family|origin|native|endemic|cultivated|keep off the grass|please keep to the paths|do not (?:feed|touch|pick).*|no dogs|exit|entrance|toilets?|shop|caf[eé]|tickets?|information|floribunda|hybrid tea|rose of the year|fragrant|scented|agm)$/i;

/** a line of a label: a scientific name, a family, a collector ("Plowman, Timothy") or where the species comes from */
const isLabelLine = (text: string) =>
  /\b[A-Z][a-z]{2,}\s+[a-z]{3,}\b/.test(text) ||
  /\b[A-Z][a-z]+(?:aceae|idae)\b/.test(text) ||
  /^\s*[A-Z][a-z]+,\s*[A-Z][a-z]+\s*$/.test(text) ||
  isOriginText(text);

/**
 * "70102 001 Kahanu Map# 3" → "Kahanu": the garden of an accession tag after its number; other lines without the
 * numbers printed around them
 */
export const cleanGardenLine = (text: string) =>
  text
    .replace(/^\s*\d{5,7}(?:\s*[.·\-\s]\s*\d{3})?\s*/, '')
    .replace(/\s*\bMap\b\s*#?\s*\d*\s*$/i, '')
    .trim();

/** how the name of a garden, a zoo or a park is read on its signs and labels */
export const GARDEN_NAME_RULES: PlaceNameRules = {
  words: GARDEN_WORDS,
  blocked: NOT_A_NAME,
  cleanLine: cleanGardenLine,
  isNotName: isLabelLine,
  // the garden an accession tag names: the same code on every tag of the garden
  title: (ocr) => readPlantLabel(ocr)?.garden,
  titleBonus: 0.25,
};

/** the gardens, zoos, parks and nature reserves of OpenStreetMap */
export const GARDEN_OSM_FILTERS: OsmFilter[] = [
  { key: 'leisure', values: ['garden', 'park', 'nature_reserve'] },
  { key: 'tourism', values: ['zoo', 'aquarium'] },
  { key: 'boundary', values: ['protected_area', 'national_park'] },
];
