import { OcrBoxInput, TextLine, deskewBoxes, groupLines, toTextBoxes } from 'src/utils/collections/ocr.js';
import { toTitleCase } from 'src/utils/collections/place.js';
import { ParsedSource, SourceEntry, SourceParseOptions } from 'src/utils/collections/source.js';
import { editDistance, stripAccents } from 'src/utils/collections/text.js';

/*
 * Reading the labels of botanical gardens, arboretums and zoos: the engraved accession tag of a tree ("810620 002 /
 * Castanospermum australe  Fabaceae / Moreton Bay Chestnut, Australia Chestnut / Australia, North Queensland /
 * Plowman, Timothy / Wild"), the information plaque of a zoo (the common name large, the scientific name below), and
 * the chalk label of a cultivar on a stake in a rose border ("PRIDE AND / PREJUDICE / INTRODUCED 2013 / FLORIBUNDA").
 * The entry is the species or the cultivar: its common name, its scientific name and its family, whatever OCR made of
 * handwriting ("PRETUDICE", "MADMALADE" are kept as read, for the assistant to correct).
 */

/** a species or a cultivar read on a label */
export type Taxon = {
  /** "Moreton Bay Chestnut", "Rose 'Pride and Prejudice'", "Ground cover rose" */
  common?: string;
  /** "Castanospermum australe", "Rosa" */
  scientific?: string;
  /** "Fabaceae" */
  family?: string;
  /** "Pride and Prejudice" */
  cultivar?: string;
  /** what else the label says: the kind of rose, its colour and scent, where the species comes from */
  details: string[];
  /** the garden a label names, e.g. the code of the garden on an accession tag ("Kahanu") */
  garden?: string;
};

/** "Castanospermum australe", "Hernandia moerenhoutiana", "Rosa × damascena", "Acer palmatum 'Bloodgood'" */
const SCIENTIFIC =
  /\b([A-Z][a-z]{2,})\s+(?:(?:x|×)\s+)?([a-z][a-z-]{2,})(?:\s+(?:subsp|ssp|var|f)\.\s+[a-z-]{3,})?(?:\s+['‘’][^'‘’]+['‘’])?/;

/** the Latin endings of epithets: "australe", "barteri", "kaernbachii", "fulgens" (not "poppy" or "mangosteen") */
const LATIN_EPITHET = /(?:a|e|i|us|um|is|ae|es|os|ex|ix|or|ans|ens|ys|on|ides|oides|ensis)$/;

/** a family of plants (-aceae) or animals (-idae), and the old names of the families of plants */
const FAMILY =
  /\b([A-Z][a-z]+(?:aceae|idae)|Compositae|Leguminosae|Gramineae|Palmae|Cruciferae|Labiatae|Umbelliferae|Guttiferae)\b/;

/** an accession number: "810620 002", "770473.001", "70102" */
const ACCESSION = /^\s*\d{5,7}(?:\s*[.·\-\s]\s*\d{3})?\b/;

/** the words of where a species comes from, on the tag of a botanical garden */
const PLACE_WORDS = new Set(
  (
    'islands island tropics tropical world coast mountains mountain highlands region north south east west central ' +
    'northern southern eastern western new old africa asia europe america americas oceania pacific atlantic indian ' +
    'ocean mediterranean himalaya himalayas andes amazon caribbean polynesia melanesia micronesia malesia guinea ' +
    'australia queensland victoria tasmania zealand china japan korea india nepal burma myanmar thailand vietnam laos ' +
    'cambodia malaysia borneo sumatra java indonesia philippines taiwan sri lanka madagascar mauritius seychelles ' +
    'mexico guatemala honduras nicaragua panama costa rica colombia venezuela ecuador peru bolivia brazil chile ' +
    'argentina paraguay uruguay cuba jamaica hawaii california texas florida canada alaska chile kenya tanzania ' +
    'uganda ethiopia nigeria ghana congo cameroon angola zambia zimbabwe mozambique namibia botswana morocco ' +
    'egypt algeria sudan somalia arabia iran iraq turkey greece italy spain portugal france germany britain ' +
    'england scotland ireland wales russia siberia caucasus solomon soloman society fiji samoa tonga vanuatu ' +
    'caledonia marquesas tahiti cook marianas guam native endemic cultivated cultivation garden origin'
  ).split(' '),
);

/** the words of the chalk labels of roses: their kinds, colours, scent and awards */
const ROSE_KINDS = [
  'floribunda',
  'hybrid tea',
  'climber',
  'climbing',
  'rambler',
  'shrub',
  'ground cover',
  'patio',
  'miniature',
  'english rose',
  'polyantha',
  'musk',
];
const LABEL_WORDS = new Set(
  (
    'floribunda hybrid tea climber climbing rambler shrub ground cover patio miniature english polyantha musk rose ' +
    'roses red white yellow pink cream coral apricot orange peach russet brown purple lilac mauve crimson scarlet ' +
    'blush stripes striped bicolour bicolor gold golden salmon copper amber fragrant scented scent perfumed heavy ' +
    'heavily light strong strongly slight slightly repeat flowering agm roty introduced year award of the and h'
  ).split(' '),
);

/** a word OCR read from handwriting is a word of the labels, a letter or two off ("FLORISUNDA", "CROUND") */
const isLabelWord = (word: string) => {
  const key = word.toLowerCase().replaceAll(/[^a-z]/g, '');
  if (key.length === 0) {
    return true;
  }
  if (LABEL_WORDS.has(key)) {
    return true;
  }
  return (
    key.length >= 5 &&
    LABEL_WORDS.values().some((known) => known.length >= 5 && editDistance(known, key) <= (key.length >= 8 ? 2 : 1))
  );
};

const words = (text: string) =>
  stripAccents(text)
    .toLowerCase()
    .split(/[^a-z\d]+/)
    .filter(Boolean);

const letters = (text: string) => text.replaceAll(/[^\p{L}]/gu, '').length;

/** "Australia, North Queensland", "Old World Tropics", "Solomon Islands to Society Islands" */
export const isOriginText = (text: string) => {
  const list = words(text).filter((word) => word.length >= 3 && word !== 'and');
  if (list.length === 0) {
    return false;
  }
  const strong = list.some((word) => /^(?:islands?|tropics|world)$/.test(word));
  return strong || list.every((word) => PLACE_WORDS.has(word));
};

/** "Plowman, Timothy": the collector of a tree, surname and first name */
const isCollector = (text: string) => /^\s*[A-Z][a-z]+,\s*[A-Z][a-z]+\.?\s*$/.test(text);

const isWild = (text: string) => /^\s*(?:not\s+)?[vw]ild\s*$/i.test(text);

/** the scientific name on a line, and the family printed on the same row */
const readScientific = (text: string): Pick<Taxon, 'scientific' | 'family'> => {
  const family = FAMILY.exec(text)?.[1];
  const rest = family ? text.replace(family, ' ') : text;
  const match = SCIENTIFIC.exec(rest);
  if (!match || FAMILY.test(match[1]) || !LATIN_EPITHET.test(match[2])) {
    return { ...(family && { family }) };
  }
  return { scientific: match[0].replaceAll(/\s+/g, ' ').replaceAll(/[‘’]/g, "'").trim(), ...(family && { family }) };
};

/** the common name on a line: the first of the names it lists ("Moreton Bay Chestnut. Australia Chestnut") */
const readCommon = (text: string) => {
  const [first] = text.split(/\s*[.,;/]\s+|\s*[.;]\s*$/, 1);
  const name = first.replace(/[.,;:\s]+$/, '').trim();
  return letters(name) >= 3 ? name : undefined;
};

/** the garden an accession tag names after its number: "70102 001 Kahanu Map# 3" → Kahanu */
const readGarden = (text: string) => {
  const match = /\b([A-Z][a-z]{3,})(?=\s*Map\b|\s*$)/.exec(text.replace(ACCESSION, ' ').replaceAll(/\s+/g, ' '));
  return match && !FAMILY.test(match[1]) && !isWild(match[1]) ? match[1] : undefined;
};

/** "PRIDEAND" is "PRIDE AND": the small words of cultivar names OCR ran into the word before them */
const splitRunOn = (text: string) => text.replaceAll(/\b([A-Z]{3,})(AND|OF|THE)\b/g, '$1 $2');

/**
 * A tag of a botanical garden or a zoo plaque: the scientific name (a capitalized genus and a lowercase epithet), the
 * family, and the common name: the title above the scientific name (a plaque), or the line below it (a tag)
 */
const readSpeciesLabel = (lines: TextLine[], index: number): Taxon => {
  const taxon: Taxon = { ...readScientific(lines[index].text), details: [] };
  let garden: string | undefined;
  for (const line of lines) {
    if (ACCESSION.test(line.text) || /\bMap\b/.test(line.text)) {
      garden ??= readGarden(line.text);
    }
  }
  const isFieldLine = (line: TextLine) =>
    ACCESSION.test(line.text) ||
    isWild(line.text) ||
    isCollector(line.text) ||
    isOriginText(line.text) ||
    (FAMILY.test(line.text) && letters(line.text.replace(FAMILY, '')) < 3) ||
    letters(line.text) < 3;
  for (const line of lines) {
    const family = FAMILY.exec(line.text)?.[1];
    if (!taxon.family && family) {
      taxon.family = family;
    }
  }
  // a plaque: the common name is the title above; a tag: the line below the scientific name and the family
  const above = lines.slice(0, index).filter((line) => !isFieldLine(line) && !/\bMap\b/.test(line.text));
  const title = above.toSorted((a, b) => b.height - a.height)[0];
  const below = lines.slice(index + 1).find((line) => !FAMILY.test(line.text) || letters(line.text) > 20);
  const common =
    title && title.height >= 0.9 * lines[index].height
      ? readCommon(title.text)
      : below && !isFieldLine(below) && !SCIENTIFIC.test(below.text)
        ? readCommon(below.text)
        : undefined;
  if (common) {
    taxon.common = common;
  }
  taxon.details = lines
    .filter((line) => isOriginText(line.text) || isWild(line.text))
    .map((line) => line.text.replace(/^\s*vild\s*$/i, 'Wild'));
  return { ...taxon, ...(garden && { garden }) };
};

/**
 * A chalk label of a cultivar: its name in the largest print at the top, then its kind (a floribunda, a hybrid tea),
 * its colour, its scent and its awards. A kind of rose makes it a rose, Rosa.
 */
const readCultivarLabel = (lines: TextLine[]): Taxon | undefined => {
  const readable = lines.filter((line) => letters(line.text) >= 2);
  // a line of the kind, the colour, the scent or the awards of the rose, give or take a word OCR garbled
  const isDetail = (line: TextLine) => {
    const list = line.text.split(/[\s,/&.!]+/).filter((word) => letters(word) >= 2 || /^\d{4}$/.test(word));
    const known = list.filter((word) => isLabelWord(word) || /^\d{4}$/.test(word)).length;
    return (
      known === list.length ||
      (list.length >= 2 && known >= 0.5 * list.length) ||
      /\bTEA\b/i.test(line.text) ||
      ROSE_KINDS.some((kind) => isKindLine(line.text, kind))
    );
  };
  const text = readable.map((line) => line.text).join(' ');
  const kind = ROSE_KINDS.find((known) => {
    const parts = known.split(' ');
    return parts.every((part) => text.split(/[\s,/&.!]+/).some((word) => isLabelWordFor(word, part)));
  });
  // "TEA" or "HYBRID" alone, on the label of a rose border, is a hybrid tea
  const tea =
    !kind && (/\bTEA\b/i.test(text) || text.split(/[\s,/&.!]+/).some((word) => isLabelWordFor(word, 'hybrid')))
      ? 'hybrid tea'
      : undefined;
  const rose = kind ?? tea ?? (/\brose\b|\broty\b/i.test(text) ? 'rose' : undefined);

  // the name: the first line that is not a word of the labels, and the lines of about its size below it
  const first = readable.find((line) => !isDetail(line));
  const name: string[] = [];
  for (const line of first ? readable.slice(readable.indexOf(first)) : []) {
    if (name.length === 3 || isDetail(line) || line.height < 0.85 * first!.height) {
      break;
    }
    name.push(splitRunOn(line.text.replaceAll(/['‘’"]/g, '').trim()));
  }
  const cultivar = name.length > 0 ? toTitleCase(name.join(' ').toUpperCase()) : undefined;
  // a word or two OCR read on a label of no known kind is no name
  if (!rose && (!cultivar || letters(cultivar) < 5)) {
    return;
  }
  const details = [
    ...(kind || tea ? [kind ?? tea!] : []),
    ...readable.filter((line) => isDetail(line) && !isKindText(line.text)).map((line) => line.text.toLowerCase()),
  ];
  if (!rose) {
    return { common: cultivar, cultivar, details };
  }
  const kindName = kind ?? tea ?? 'garden';
  const common = cultivar ? `Rose '${cultivar}'` : `${kindName.charAt(0).toUpperCase()}${kindName.slice(1)} rose`;
  return { common, scientific: 'Rosa', ...(cultivar && { cultivar }), details };
};

const isLabelWordFor = (word: string, known: string) => {
  const key = word.toLowerCase().replaceAll(/[^a-z]/g, '');
  return key === known || (key.length >= 5 && editDistance(known, key) <= (known.length >= 8 ? 2 : 1));
};

/** a line that names the kind of a rose: "FLORIBUNDA", "HYBRID TEA", "HYB!JD TEA AM" */
const isKindText = (text: string) =>
  /\bTEA\b/i.test(text) ||
  text.split(/[\s,/&.!]+/).some((word) => isLabelWordFor(word, 'hybrid')) ||
  ROSE_KINDS.some((kind) => isKindLine(text, kind));

const isKindLine = (text: string, kind: string) =>
  kind.split(' ').every((part) => text.split(/[\s,/&.!]+/).some((word) => isLabelWordFor(word, part)));

/** Reads the species or the cultivar of a label, and the garden it names */
export const readPlantLabel = (ocr: OcrBoxInput[], options: SourceParseOptions = {}): Taxon | undefined => {
  const boxes = toTextBoxes(deskewBoxes(ocr, options.aspectRatio ?? 1), options.minScore);
  const lines = groupLines(boxes);
  const index = lines.findIndex((line) => readScientific(line.text).scientific !== undefined);
  if (index !== -1) {
    return readSpeciesLabel(lines, index);
  }
  return readCultivarLabel(lines);
};

/**
 * The name of a species as the pack saves it: "Moreton Bay Chestnut (Castanospermum australe, Fabaceae)", "Hernandia
 * moerenhoutiana (Hernandiaceae)", "Rose 'Pride and Prejudice' (Rosa)", or the one name read
 */
export const formatTaxon = ({ common, scientific, family }: Pick<Taxon, 'common' | 'scientific' | 'family'>) => {
  const science = [scientific, family].filter(Boolean).join(', ');
  if (common && science) {
    return `${common} (${science})`;
  }
  if (scientific && family) {
    return `${scientific} (${family})`;
  }
  return common ?? scientific ?? family ?? '';
};

/** the names of a species saved by `formatTaxon` */
export const parseTaxon = (name: string): Pick<Taxon, 'common' | 'scientific' | 'family'> => {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(name.trim());
  if (!match) {
    const scientific = SCIENTIFIC.exec(name);
    return scientific && name.trim() === scientific[0] && LATIN_EPITHET.test(scientific[2])
      ? { scientific: name.trim() }
      : { common: name.trim() };
  }
  const [, outside, inside] = match;
  const parts = inside.split(/,\s*/);
  const family = parts.length > 1 && FAMILY.test(parts.at(-1)!) ? parts.pop() : undefined;
  if (parts.length === 1 && FAMILY.test(parts[0]) && !SCIENTIFIC.test(parts[0])) {
    // "Hernandia moerenhoutiana (Hernandiaceae)"
    return { scientific: outside, family: parts[0] };
  }
  return { common: outside, scientific: parts.join(', '), ...(family && { family }) };
};

/** the entry of a label: the species or the cultivar it names, with what else it says */
export const toTaxonEntry = (taxon: Taxon): SourceEntry | undefined => {
  const name = formatTaxon(taxon);
  if (letters(name) < 3) {
    return;
  }
  const details = taxon.details.filter((detail) => letters(detail) >= 3);
  return { name, ...(details.length > 0 && { description: details.join(' · ') }), column: 0, box: [0, 0, 1, 1] };
};

/** the parser of the nature pack: the species or the cultivar of a label */
export const parsePlantLabel = (ocr: OcrBoxInput[], options: SourceParseOptions = {}): ParsedSource => {
  const taxon = readPlantLabel(ocr, options);
  const entry = taxon ? toTaxonEntry(taxon) : undefined;
  return {
    items: entry ? [entry] : [],
    ...(taxon?.garden && { title: taxon.garden }),
    sections: [],
    columns: 1,
    lines: groupLines(toTextBoxes(ocr)).length,
  };
};
