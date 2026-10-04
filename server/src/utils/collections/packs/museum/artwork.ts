/**
 * The name of an artwork as the museum pack writes it: a line of an exhibition catalogue, "Title — Artist, Date,
 * Medium", e.g. "Virgin and Child — Nicolau Chanterene, 1535-1540, marble". It is the entry of the wall label, the
 * leaf of the tag `Art/<Museum>/<Title — Artist, Date, Medium>` and what the book captions and the photo
 * description are made of; the parts that are unknown are left out ("Yakshi — c. 2nd century BCE, red sandstone",
 * "Bust of a woman").
 */
export type Artwork = {
  title: string;
  artist?: string;
  date?: string;
  medium?: string;
};

/** between the title and the rest */
export const TITLE_SEPARATOR = ' — ';

/** a year of the common era, 1000 to 2099 */
const YEAR = /(?:^|[^\d])(?:1\d{3}|20\d{2})(?:[^\d]|$)/;
/** "c. 950", "circa 1760", "vers 1840" */
const CIRCA_YEAR = /\b(?:c|ca|circa|cerca|vers|env|um|around|about)\.?\s*\d{3,4}\b/i;
/** "14th century", "10th cent.", "XVe siècle", "séc. XVI", "1° quartel do séc. XVI", "2nd century B.C.E." */
const CENTURY =
  /(?:\b(?:\d{1,2}|[ivxlc]{1,5})\s*(?:st|nd|rd|th|h|na|e|er|ème|°|º|o|a)?\s*(?:century|centuries|cent\b|siècle|século|secolo|jahrhundert|jh\b)|\b(?:séc|sec|s)\.\s*[ivxlc]{1,5}\b|\b(?:siècle|século|secolo)\s+[ivxlc]{1,5}\b)/iu;
/** "B.C.E.", "C.E.", "BC", "AD", "a.C." */
const ERA = /(?:^|[\s.,(])(?:b\.?\s?c\.?(?:\s?e\.?)?|c\.\s?e\.?|a\.\s?d\.?|a\.\s?c\.|d\.\s?c\.)(?=[\s,)]|$)/i;
/** "Roman Period", "Periodo Romano", "Ming dynasty" */
const PERIOD = /\b(?:period|periodo|período|époque|epoca|época|dynasty|dinastia|dynastie)\b/iu;

/** whether a part of a name is a date, e.g. "circa 1760", "1535-1540", "14th century", "XVe siècle", "Roman Period" */
export const isDate = (text: string) =>
  YEAR.test(text) || CIRCA_YEAR.test(text) || CENTURY.test(text) || ERA.test(text) || PERIOD.test(text);

/** the words of media and materials, in the languages of the labels */
export const MEDIUM_WORDS =
  /^(?:oil|oils|huile|óleo|oleo|olio|öl|leinwand|holz|sand|tempera|têmpera|egg|acrylic|acrylique|acrílico|watercolou?r|aquarelle|aguarela|gouache|guache|pastel|charcoal|fusain|carvão|ink|encre|tinta|pencil|crayon|graphite|chalk|craie|canvas|toile|tela|panel|panneau|wood|bois|madeira|madera|legno|tavola|oak|chêne|carvalho|poplar|peuplier|walnut|noyer|mahogany|acajou|rosewood|palissandre|pau-santo|ebony|ébène|veneer|placage|plaqué|plaquée|paper|papier|papel|carta|vellum|parchment|parchemin|pergaminho|board|carton|cardboard|copper|cuivre|cobre|rame|bronze|brass|laiton|latão|iron|fer|ferro|steel|acier|silver|argent|prata|argento|gold|or|ouro|oro|gilt|gilded|doré|dorée|dorés|dourado|dorato|gilding|dorure|marble|marbre|mármore|mármol|marmo|alabaster|albâtre|alabastro|limestone|calcaire|calcário|sandstone|grès|arenito|basalt|basalte|basalto|granite|granit|granito|schist|schiste|xisto|khondalite|khondelite|chlorite|soapstone|steatite|stone|pierre|pedra|piedra|pietra|terracotta|terracota|terre|cuite|clay|argile|argila|earthenware|faience|faïence|faiança|majolica|majólica|maiolica|stoneware|porcelain|porcelaine|porcelana|porcellana|tendre|dure|soft-paste|hard-paste|ceramic|céramique|cerâmica|glazed|émaillé|vidrado|enamel|émail|esmalte|smalto|glass|verre|vidro|vetro|mosaic|mosaïque|mosaico|fresco|fresque|plaster|plâtre|gesso|stucco|stuc|wax|cire|cera|ivory|ivoire|marfim|avorio|bone|os|osso|shell|nacre|textile|silk|soie|seda|seta|wool|laine|lã|linen|lin|linho|cotton|coton|algodão|tapestry|tapisserie|tapeçaria|lacquer|laque|jade|jasper|lapis|lazuli|pietra-dura|pietre|dure|mixed|media|technique|mixte|mista|photograph|photographie|fotografia|print|gravure|etching|eau-forte|engraving|lithograph|lithographie|woodcut|tinted|teinté|teintée|carved|sculpté|polychrome|polychromed|policromado|painted|peint|pintado|chunar|red|rouge|vermelho|white|blanc|branco|black|noir|preto|grey|gris|pink|rose|green|vert|verde|glaze|biscuit|pâte|paste|leaf|feuille|folha)$/iu;

/** the words between the materials: "oil on panel", "huile sur toile", "tempera e ouro sobre madeira" */
const MEDIUM_CONNECTORS =
  /^(?:on|and|with|in|of|sur|et|avec|en|de|du|des|sobre|e|com|em|y|con|su|e|ed|auf|und|mit|&|,)$/iu;

const words = (text: string) =>
  text
    .replaceAll(/[()[\]'’"“”.;:]/g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);

/** whether a text names media and materials: "Oil on panel", "Huile sur toile", "Óleo sobre madeira", "Basalt" */
export const isMedium = (text: string) => {
  const parts = words(
    text.replaceAll(/\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm|m)\b/gi, ''),
  )
    .filter((word) => !MEDIUM_CONNECTORS.test(word))
    .filter((word) => !/^\d/.test(word));
  if (parts.length === 0) {
    return false;
  }
  const known = parts.filter((word) => MEDIUM_WORDS.test(word)).length;
  return known >= Math.max(1, Math.ceil(parts.length * 0.6));
};

const clean = (text?: string) => text?.replaceAll(/\s+/g, ' ').replaceAll('/', '-').trim() || undefined;

/** "Marble" → "marble", but "MNR" or "Chunar sandstone" stay as they are after a comma */
const lowerFirst = (text: string) =>
  /^\p{Lu}\p{Ll}/u.test(text) && !/^(?:Chunar|Carrara|Pentelic|Parian)\b/.test(text)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;

const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Virgin and Child — Nicolau Chanterene, 1535-1540, marble" */
export const formatArtwork = ({ title, artist, date, medium }: Artwork) => {
  const rest = [clean(artist), clean(date), clean(medium) && lowerFirst(clean(medium)!)].filter(Boolean);
  const name = clean(title) ?? '';
  return rest.length > 0 ? `${name}${TITLE_SEPARATOR}${rest.join(', ')}` : name;
};

/**
 * Reads a name written by `formatArtwork` (or typed by someone in its spirit): the title before " — ", then the
 * artist, the date (the first part that reads as a date) and the medium (the parts after the date, or the last parts
 * that name materials). A name without " — " is a title.
 */
export const parseArtwork = (name: string): Artwork => {
  const text = name.replaceAll(/\s+/g, ' ').trim();
  const index = text.search(/\s[—–]\s|\s--\s/);
  if (index === -1) {
    return { title: text };
  }
  const title = text.slice(0, index).trim();
  const parts = text
    .slice(index + 3)
    .split(/,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  let dateIndex = parts.findIndex((part) => isDate(part) && !isMedium(part));
  let mediumIndex = parts.length;
  if (dateIndex === -1) {
    while (mediumIndex > 0 && isMedium(parts[mediumIndex - 1])) {
      mediumIndex--;
    }
    // a lone part that is a material is the medium, not the artist
    dateIndex = mediumIndex;
  } else {
    mediumIndex = dateIndex + 1;
  }
  const artist = parts.slice(0, dateIndex).join(', ');
  const date = dateIndex < parts.length && isDate(parts[dateIndex]) ? parts[dateIndex] : undefined;
  const medium = parts.slice(mediumIndex).join(', ');
  return {
    title,
    ...(artist && { artist }),
    ...(date && { date }),
    ...(medium && { medium }),
  };
};

/** "Virgin and Child · Nicolau Chanterene, 1535-1540 · Museu de Évora" */
export const describeArtwork = (entry: string, museum: string) => {
  const { title, artist, date } = parseArtwork(entry);
  const byline = [artist, date].filter(Boolean).join(', ');
  return [title, byline, museum.trim()].filter(Boolean).join(' · ');
};

/**
 * The caption of an artwork in a book, as on a gallery wall: the title on its own line, then the artist, the date and
 * the medium, e.g. "Virgin and Child\nNicolau Chanterene, 1535-1540, marble".
 */
export const captionArtwork = (entry: string) => {
  const { title, artist, date, medium } = parseArtwork(entry);
  const details = [artist, date, medium && (artist || date ? lowerFirst(medium) : upperFirst(medium))].filter(Boolean);
  return details.length > 0 ? `${title}\n${details.join(', ')}` : title;
};

/** the kind of object a medium makes, for CLIP: stone and bronze are sculpture, oil on canvas is a painting */
const getKind = (medium?: string) => {
  if (!medium) {
    return 'artwork';
  }
  if (
    /oil|huile|óleo|olio|tempera|têmpera|acryl|canvas|toile|tela|panel|panneau|madeira|tavola|fresco|fresque/i.test(
      medium,
    )
  ) {
    return 'painting';
  }
  if (
    /porcel|faïence|faience|majol|maiol|ceram|céram|cerâm|earthenware|stoneware|enamel|émail|esmalte|glass|verre/i.test(
      medium,
    )
  ) {
    return 'decorative art object';
  }
  if (/watercol|aquarel|ink|encre|pencil|crayon|chalk|craie|charcoal|fusain|paper|papier|papel/i.test(medium)) {
    return 'drawing';
  }
  if (
    /marble|marbre|mármore|stone|pierre|pedra|basalt|sandstone|grès|granit|schist|khondal|alabast|albâtre|bronze|terracott|terre cuite|limestone|calcaire|ivory|ivoire/i.test(
      medium,
    )
  ) {
    return 'sculpture';
  }
  if (/palissandre|rosewood|mahogany|acajou|veneer|placage|plaqué|peuplier|walnut|noyer/i.test(medium)) {
    return 'piece of furniture';
  }
  return 'artwork';
};

/** the CLIP text of an artwork, compared with the photos: "a photo of a painting, Virgin and Child (oil on panel)" */
export const getArtworkPrompt = (entry: { name: string; description?: string }) => {
  const { title, medium } = parseArtwork(entry.name);
  const text = medium ? `${title} (${lowerFirst(medium)})` : title;
  const kind = getKind(medium);
  return `a photo of ${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}, ${text.length > 160 ? text.slice(0, 160) : text}`;
};
