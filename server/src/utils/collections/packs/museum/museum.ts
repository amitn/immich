import { OsmFilter } from 'src/utils/collections/overpass.js';
import { PlaceNameRules } from 'src/utils/collections/place.js';

/** words that name a museum or a gallery, in the languages of the labels and signs */
export const MUSEUM_WORDS =
  /(?:museum|museo|musei|musée|musee|museu|muzeum|múzeum|galler(?:y|ies|ia|ie)|galerie|galería|galeria|pinacoteca|pinakothek|kunsthalle|kunsthaus|(?<!\p{L})(?:fondation|foundation|fundação|fundación|fondazione|stiftung|art centre|art center|arts centre|centro de arte|centre d'art)(?!\p{L}))/iu;

/**
 * Text on museum signs and labels that doesn't name the museum: directions, rules, rooms and departments, and the
 * credit lines of labels ("Dépôt du Musée du Louvre" names the lender, not the museum the photo was taken in).
 */
const NOT_A_NAME =
  /^(?:exit|entrance|entrada|entrée|sortie|ausgang|eingang|uscita|ingresso|saída|toilets?|wc|shop|boutique|museum shop|café|cafe|tickets?|billetterie|bilheteira|biglietteria|information|audio ?guide|no photos?|no flash|do not touch|ne pas toucher|não tocar|please do not touch|room \d+|sala \d+|salle \d+|saal \d+|gallery \d+|level -?\d+|floor \d+|archa?eology|archéologie|arqueologia|archeologia|sculptures?|paintings?|ceramics?|decorative arts|antiquities|antiquités|welcome|bienvenue|bem-vindo|benvenuti|open|opened|closed)$/i;

/** a credit line of a label, or text with a year: the museum a work was lent by, or when */
const CREDIT =
  /^(?:d[ée]p[ôo]t|dons?|legs|achat|acquis|acquired|purchased|gift|bequest|on loan|lent|pr[êe]t|fonds|colec?[çcg][ãa]o|cole[cç]{1,2}[ãa]o|collection|collezione|sammlung|proveniente|provenant|from|courtesy)\b/iu;

/**
 * "Agen, Musée des Beaux-Arts -Acquis en juin 2017-N°d'inv: 2017.2.1" → "Musée des Beaux-Arts, Agen": the name of a
 * museum before the rest of a credit line, after the city it is printed with
 */
export const cleanMuseumLine = (text: string) => {
  const name = text
    .split(/\s[-–—]|[-–—]\s|\s?N[°º]|\s\(/, 1)[0]
    .replace(/[.,;:\s]+$/, '')
    .trim();
  const cityFirst = /^([\p{Lu}][\p{L}' -]+),\s*((?:mus[ée]e|museum|museo|museu|galerie|gallery|galleria)\b.+)$/iu.exec(
    name,
  );
  return cityFirst ? `${cityFirst[2]}, ${cityFirst[1]}` : name;
};

/** how the name of a museum is read on its signs, wall labels and tickets */
export const MUSEUM_NAME_RULES: PlaceNameRules = {
  words: MUSEUM_WORDS,
  blocked: NOT_A_NAME,
  cleanLine: cleanMuseumLine,
  isNotName: (text) => CREDIT.test(text) || /\b\d{4}\b/.test(text),
  sourceNameNeedsWord: true,
};

/** the museums and galleries of OpenStreetMap: tourism=museum|gallery, amenity=arts_centre */
export const MUSEUM_OSM_FILTERS: OsmFilter[] = [
  { key: 'tourism', values: ['museum', 'gallery'] },
  { key: 'amenity', values: ['arts_centre'] },
];
