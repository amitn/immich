import type { BookStyle } from 'src/dtos/book.dto.js';
import type { ClassifyRules, CollectionPrompts } from 'src/utils/collections/classify.js';
import type { MatchOptions } from 'src/utils/collections/match.js';
import type { OsmFilter } from 'src/utils/collections/overpass.js';
import type { PlaceNameRules } from 'src/utils/collections/place.js';
import type { SourceEntry, SourceParser } from 'src/utils/collections/source.js';
import type { CollectionTagRules } from 'src/utils/collections/tags.js';
import type { FallbackVisit, VisitOptions } from 'src/utils/collections/visits.js';

/**
 * A collection pack: everything a theme of the collections engine knows about its domain, as plain data and pure
 * functions (no dependency injection). The engine (`src/utils/collections/*`, `CollectionService`) finds the photos of
 * a pack in a library, groups them into visits, reads the text-source photos into entries, matches the subject photos
 * with the entries and saves the names as tags `<tagRoot>/<Place>/<Entry>` (and `<tagRoot>/<Place>/<sourceLeaf>` on a
 * source photo), which photo books read back to lay out a chapter per visit. Food is the first pack
 * (`src/utils/collections/packs/food/pack.ts`): subjects are dishes, the source is the menu, the place the
 * restaurant, the entries the menu items, and visits are meals.
 */
export type CollectionPack = {
  /** lowercase letters, digits and dashes, e.g. food: the pack in URLs (`/collections/food/...`), tools and i18n keys */
  id: string;
  /** e.g. Food */
  title: string;
  /**
   * what the pack is for, for the agent choosing a pack, e.g. "restaurant meals: photos of dishes and drinks, matched
   * with the items of the menu"
   */
  description: string;
  /** the first level of the pack's tags, e.g. Food; unique among the packs */
  tagRoot: string;
  /** the leaf that marks a photo of the source instead of an entry, e.g. Menu */
  sourceLeaf: string;
  /** the words of the domain, used in messages, tool results and reviews */
  names: CollectionNames;

  /** CLIP prompts for each kind of photo: subject, source, sign, receipt and other (see `classify.ts`) */
  prompts: CollectionPrompts;
  /** the scores a photo needs to be each kind, and optionally how its text is scored */
  classify: ClassifyRules & {
    /** words of receipts or tickets, with the global flag, e.g. total, VAT, cash */
    receiptWords?: RegExp;
  };

  source: {
    /** reads the entries of a source photo from its OCR (tiled at full resolution by the engine) */
    parse: SourceParser;
    /** the CLIP text of an entry, compared with the subject photos, e.g. "a photo of Caponata: eggplant, capers" */
    prompt: (entry: Pick<SourceEntry, 'name' | 'description'>) => string;
    /** fewer entries than this read on a source is worth a warning, default 3 */
    minEntries?: number;
  };

  place: PlaceNameRules & {
    /** the name of a visit whose place can't be read, e.g. "Dinner in Taormina" */
    fallbackName: (visit: FallbackVisit) => string;
    /** the OpenStreetMap features of the pack's places, for the lookup the admin may enable; none: never looked up */
    lookup?: { filters: OsmFilter[] };
  };

  visits: {
    /** how photos are grouped into visits by time and place */
    options: VisitOptions;
    /** the kind of a visit from its local time in ms, e.g. Breakfast, Lunch or Dinner */
    type?: (time: number) => string;
  };

  match: {
    /** the matcher's settings, over `DEFAULT_MATCH_OPTIONS`; `order` says whether the source order applies */
    options?: Partial<MatchOptions>;
    /** CLIP texts of subjects that are usually not on the source; the best of them is "off the list" */
    offListPrompts: string[];
  };

  /** the description a subject photo gets when it has none, e.g. "Caponata · Trattoria da Nino" */
  describe: (entry: string, place: string) => string;

  book: {
    /** the style preset of the pack's books; its id is a `BookStylePreset`, e.g. food */
    preset: CollectionBookPreset;
    /** a theme of its own; the preset's style names it */
    theme?: CollectionBookTheme;
    /** the caption of an entry photo in a book, e.g. the name of the dish */
    caption: (entry: string, place: string) => string;
    /** the checks `review_book` runs on books with the pack's photos */
    review: { unnamedEntries: boolean; missingSourcePage: boolean };
  };

  agent: {
    /** a line of the assistant's instructions: when and how to use the collection tools with this pack */
    instructions: string;
  };

  /** messages of the engine in the words of the pack, over the defaults made from `names` */
  messages?: Partial<CollectionMessages>;

  privacy?: {
    /**
     * runs on every text read on the photos (entries, titles, place names) before it is returned, stored or matched,
     * e.g. to hide booking codes and passenger names
     */
    redact?: (text: string) => string;
    /**
     * whether read_source shows the source photos to the assistant, default true; off for pages whose private text
     * the redaction can't hide from an image (a boarding pass)
     */
    sourceImages?: boolean;
  };
};

export type CollectionNames = {
  /** e.g. dish, dishes */
  subject: string;
  subjects: string;
  /** e.g. menu, menus */
  source: string;
  sources: string;
  /** e.g. restaurant */
  place: string;
  /** e.g. menu item, menu items */
  entry: string;
  entries: string;
  /** e.g. meal, meals */
  visit: string;
  visits: string;
};

export type CollectionBookPreset = {
  /** a `BookStylePreset` id, e.g. food */
  id: string;
  name: string;
  description: string;
  /** a short description for the list of presets in the API, e.g. "a printed menu: warm paper, ..." */
  summary: string;
  style: Required<BookStyle>;
};

export type CollectionBookTheme = {
  /** a `BookStyleTheme` id, e.g. food */
  id: string;
  /** for the list of themes in the API */
  summary: string;
  /** how the renderer draws it: printed is the look of a printed menu (hairline frame, small caps, ornaments) */
  look: 'printed';
};

export type CollectionMessages = {
  /** smart search is disabled when the photos are classified */
  smartSearchDisabled: string;
  /** OCR is disabled when the photos are classified */
  ocrDisabled: string;
  /** some photos have no CLIP embedding yet */
  noEmbedding: (count: number) => string;
  /** the tiled OCR failed */
  tilesFailed: string;
  /** a source photo gave few entries */
  fewEntries: string;
  /** no entries were read on the source photos of a visit */
  noEntriesRead: string;
  /** a visit has no source photo */
  noSource: string;
  /** smart search is disabled when subjects are matched */
  cannotMatch: string;
  /** the place given to save the entries has no name */
  placeNeedsName: string;
  /** the photos have no location to look the place up */
  noLocation: string;
  /** the lookup is disabled by the admin */
  lookupDisabled: string;
};

/** what the tags of a pack look like: `<tagRoot>/<Place>/<Entry>` and `<tagRoot>/<Place>/<sourceLeaf>` */
export const getCollectionTagRules = (
  pack: Pick<CollectionPack, 'tagRoot' | 'sourceLeaf' | 'names'>,
): CollectionTagRules => ({
  tagRoot: pack.tagRoot,
  sourceLeaf: pack.sourceLeaf,
  subject: pack.names.subject,
});

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** the engine's messages in the words of a pack */
export const getCollectionMessages = (pack: Pick<CollectionPack, 'names' | 'messages'>): CollectionMessages => {
  const { subjects, source, sources, place, entries } = pack.names;
  return {
    smartSearchDisabled: `Smart search is disabled: ${subjects} cannot be recognized, only ${sources} by their text`,
    ocrDisabled: `OCR is disabled: ${sources} are recognized by their look only`,
    noEmbedding: (count) =>
      `${count} photos have not been through smart search yet and can only be found by their text`,
    tilesFailed: `The ${source} could not be read at full resolution; the items come from the stored OCR`,
    fewEntries: `Few ${entries} could be read: look at the ${source} image and read the items yourself`,
    noEntriesRead: `No ${entries} could be read: look at the ${source} yourself and pass its items, or name the ${subjects} from what you see`,
    noSource: `No ${source}: name the ${subjects} from what you see`,
    cannotMatch: `Smart search is disabled, so ${subjects} cannot be matched with ${entries}`,
    placeNeedsName: `The ${place} needs a name`,
    noLocation: `The photos have no location: ask the user for the name of the ${place}`,
    lookupDisabled:
      'The OpenStreetMap lookup is disabled in the server settings (Food > OpenStreetMap). Ask the user for the ' +
      `name of the ${place} instead.`,
    ...pack.messages,
  };
};

/** "Meal on 2024-06-12" for a pack without kinds of visits: the visit and the city, or the day */
export const getDefaultFallbackName = (names: Pick<CollectionNames, 'visit'>) => (visit: FallbackVisit) =>
  visit.city ? `${capitalize(names.visit)} in ${visit.city}` : `${capitalize(names.visit)} on ${visit.day}`;

/** the text a pack lets out of the engine: redacted, when the pack hides private text */
export const redactText = (pack: Pick<CollectionPack, 'privacy'>, text: string) =>
  pack.privacy?.redact ? pack.privacy.redact(text) : text;

const PACK_ID = /^[a-z][\da-z-]*$/;
const TAG_NAME = /^[^/]+$/;

/** the problems of a pack that would break the engine or collide with other packs; empty when it is valid */
export const validateCollectionPack = (pack: CollectionPack, others: readonly CollectionPack[] = []) => {
  const errors: string[] = [];
  if (!PACK_ID.test(pack.id)) {
    errors.push(`id "${pack.id}" must be lowercase letters, digits and dashes`);
  }
  if (!TAG_NAME.test(pack.tagRoot) || !TAG_NAME.test(pack.sourceLeaf)) {
    errors.push('the tag root and the source leaf cannot contain "/"');
  }
  if (pack.prompts.subject.length === 0 || pack.prompts.other.length === 0) {
    errors.push('a pack needs subject and other prompts');
  }
  if (pack.match.offListPrompts.length === 0) {
    errors.push('a pack needs off-list prompts');
  }
  for (const other of others) {
    if (other === pack) {
      continue;
    }
    if (other.id === pack.id) {
      errors.push(`id "${pack.id}" is taken`);
    }
    if (other.tagRoot.toLowerCase() === pack.tagRoot.toLowerCase()) {
      errors.push(`tag root "${pack.tagRoot}" is taken by ${other.id}`);
    }
    if (other.book.preset.id === pack.book.preset.id) {
      errors.push(`book preset "${pack.book.preset.id}" is taken by ${other.id}`);
    }
    if (pack.book.theme && other.book.theme?.id === pack.book.theme.id) {
      errors.push(`book theme "${pack.book.theme.id}" is taken by ${other.id}`);
    }
  }
  return errors;
};
