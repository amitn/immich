import { createHash } from 'node:crypto';
import type { AssetEditActionItem } from 'src/dtos/editing.dto.js';
import type { ImageDimensions } from 'src/types.js';
import { softmax } from 'src/utils/collections/classify.js';
import { redactTravelText } from 'src/utils/collections/packs/travel/privacy.js';
import { transformPoints } from 'src/utils/transform.js';

/**
 * Redaction (#14): the regions of a photo to blur before it is shared, from the stored face boxes (faces except chosen
 * people; pets are never people) and OCR boxes (personal text, number plates, screens and documents), and the
 * decisions behind them. Regions are rectangles in fractions (0..1) of the photo as it is shown: upright, and with its
 * edits (crop, rotation, mirroring) applied when it has any. The pixels are blurred by `MediaRepository.redact*`.
 */

export const redactionKinds = ['face', 'text', 'plate', 'screen', 'manual'] as const;
export type RedactionKind = (typeof redactionKinds)[number];

export const redactionStyles = ['blur', 'pixelate'] as const;
export type RedactionStyle = (typeof redactionStyles)[number];

/**
 * Why a region is suggested, and whether it is selected by default:
 * - `unknown`: a face of nobody the library knows (selected)
 * - `person`: a face of a named person (selected, unless kept)
 * - `kept`: a face of a person to keep, or of a person in what a link shares (not selected)
 * - `notChosen`: a face of someone not among the people to blur (not selected)
 * - `personal`: text that looks personal (names, numbers, codes, contact details) (selected)
 * - `plate`: a number plate (selected)
 * - `screen`: the text of a screen (selected)
 * - `document`: the text of a document, a receipt, a card or a form (selected)
 * - `other`: other text, e.g. a sign (not selected)
 * - `manual`: drawn by the user
 */
export const redactionReasons = [
  'unknown',
  'person',
  'kept',
  'notChosen',
  'personal',
  'plate',
  'screen',
  'document',
  'other',
  'manual',
] as const;
export type RedactionReason = (typeof redactionReasons)[number];

export type RedactionRect = { x: number; y: number; width: number; height: number };

export type RedactionRegion = RedactionRect & {
  /** stable within a photo: `face:<face id>`, `text:<OCR box id>`, `screen` */
  id: string;
  kind: RedactionKind;
  reason: RedactionReason;
  /** blurred unless the user deselects it */
  selected: boolean;
  personId?: string | null;
  personName?: string | null;
  text?: string;
};

export type RedactionFace = {
  id: string;
  imageWidth: number;
  imageHeight: number;
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
  personId: string | null;
  personName: string | null;
  /** a pet's face (a pet person, or a face the pet model found): never a person to blur */
  isPet: boolean;
  /** the face identities of the face and of its person, which tell the same person across libraries */
  identityIds: string[];
};

export type RedactionOcrBox = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  x4: number;
  y4: number;
  text: string;
};

/** which people's faces to blur: everyone but `keep`, or only `only` */
export type RedactionPeople = {
  /** person ids whose faces stay (not selected) */
  keep?: Iterable<string>;
  /** when given, only the faces of these person ids are selected */
  only?: Iterable<string>;
  /** the face identities of `keep` and `only`, which match their faces in other libraries too */
  keepIdentities?: Iterable<string>;
  onlyIdentities?: Iterable<string>;
};

/** what the photo shows, from its CLIP embedding; null without one (smart search off, or not processed yet) */
export type RedactionScene = { vehicle: number; screen: number; document: number } | null;

export type RedactionOptions = {
  faces?: boolean;
  text?: boolean;
  plates?: boolean;
  screens?: boolean;
  people?: RedactionPeople;
  scene?: RedactionScene;
  /** the photo's size as shown (upright, edited), for the shape of text boxes */
  size?: ImageDimensions;
};

/** a face box is grown by this share of its size on every side, to cover the hair, the ears and the chin */
export const FACE_PADDING = 0.15;
/** a text box is grown by this share of its height on every side */
export const TEXT_PADDING = 0.2;
/** the share of the photo's size the region of a screen is grown by around its text */
export const SCREEN_PADDING = 0.03;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

/** the rectangle within the photo, or null when nothing of it is left */
export const clampRect = (rect: RedactionRect): RedactionRect | null => {
  const x1 = clamp01(rect.x);
  const y1 = clamp01(rect.y);
  const x2 = clamp01(rect.x + rect.width);
  const y2 = clamp01(rect.y + rect.height);
  if (x2 - x1 <= 0.0005 || y2 - y1 <= 0.0005) {
    return null;
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

const pad = (rect: RedactionRect, padX: number, padY: number): RedactionRect => ({
  x: rect.x - padX,
  y: rect.y - padY,
  width: rect.width + 2 * padX,
  height: rect.height + 2 * padY,
});

const boundingRect = (points: Array<{ x: number; y: number }>): RedactionRect => {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

/** the union of rectangles */
export const unionRect = (rects: RedactionRect[]): RedactionRect | null =>
  rects.length === 0
    ? null
    : boundingRect(rects.flatMap((rect) => [rect, { x: rect.x + rect.width, y: rect.y + rect.height }]));

/**
 * A rectangle of the unedited upright photo (fractions) on the photo as shown with its edits applied; `dimensions` are
 * the pixels of the unedited upright photo, in which the edits are defined
 */
export const toEditedRect = (
  rect: RedactionRect,
  edits: AssetEditActionItem[],
  dimensions: ImageDimensions,
): RedactionRect | null => {
  if (edits.length === 0) {
    return clampRect(rect);
  }
  if (!dimensions.width || !dimensions.height) {
    return null;
  }
  const { width, height } = dimensions;
  const corners = [
    { x: rect.x * width, y: rect.y * height },
    { x: (rect.x + rect.width) * width, y: rect.y * height },
    { x: (rect.x + rect.width) * width, y: (rect.y + rect.height) * height },
    { x: rect.x * width, y: (rect.y + rect.height) * height },
  ];
  const { points, currentWidth, currentHeight } = transformPoints(corners, edits, dimensions);
  if (!currentWidth || !currentHeight) {
    return null;
  }
  const box = boundingRect(points);
  return clampRect({
    x: box.x / currentWidth,
    y: box.y / currentHeight,
    width: box.width / currentWidth,
    height: box.height / currentHeight,
  });
};

/** the face's box in fractions of the (unedited, upright) photo, padded */
export const getFaceRect = (face: RedactionFace): RedactionRect | null => {
  if (face.imageWidth <= 0 || face.imageHeight <= 0) {
    return null;
  }
  const rect = {
    x: face.boundingBoxX1 / face.imageWidth,
    y: face.boundingBoxY1 / face.imageHeight,
    width: (face.boundingBoxX2 - face.boundingBoxX1) / face.imageWidth,
    height: (face.boundingBoxY2 - face.boundingBoxY1) / face.imageHeight,
  };
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return clampRect(pad(rect, rect.width * FACE_PADDING, rect.height * FACE_PADDING));
};

/** the OCR box (a quadrilateral, fractions of the unedited upright photo) as a padded rectangle */
export const getTextRect = (box: RedactionOcrBox): RedactionRect | null => {
  const rect = boundingRect([
    { x: box.x1, y: box.y1 },
    { x: box.x2, y: box.y2 },
    { x: box.x3, y: box.y3 },
    { x: box.x4, y: box.y4 },
  ]);
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const padding = Math.min(rect.width, rect.height) * TEXT_PADDING;
  return clampRect(pad(rect, padding, padding));
};

const toSet = (values?: Iterable<string>) => new Set(values);

const matches = (face: RedactionFace, ids: Set<string>, identities: Set<string>) =>
  (!!face.personId && ids.has(face.personId)) || face.identityIds.some((id) => identities.has(id));

/** whether a face is blurred, and why */
export const decideFace = (
  face: RedactionFace,
  people: RedactionPeople = {},
): Pick<RedactionRegion, 'reason' | 'selected'> => {
  const keep = toSet(people.keep);
  const keepIdentities = toSet(people.keepIdentities);
  const only = people.only === undefined ? undefined : toSet(people.only);
  const onlyIdentities = toSet(people.onlyIdentities);

  if (only) {
    return matches(face, only, onlyIdentities)
      ? { reason: face.personName ? 'person' : 'unknown', selected: true }
      : { reason: 'notChosen', selected: false };
  }
  if (matches(face, keep, keepIdentities)) {
    return { reason: 'kept', selected: false };
  }
  return { reason: face.personName ? 'person' : 'unknown', selected: true };
};

/** the face regions of a photo, in fractions of the unedited upright photo; pets are left out */
export const getFaceRegions = (faces: RedactionFace[], people?: RedactionPeople): RedactionRegion[] =>
  faces.flatMap((face) => {
    if (face.isPet) {
      return [];
    }
    const rect = getFaceRect(face);
    if (!rect) {
      return [];
    }
    return [
      {
        id: `face:${face.id}`,
        kind: 'face' as const,
        ...rect,
        ...decideFace(face, people),
        personId: face.personId,
        personName: face.personName || null,
      },
    ];
  });

// number plates

const compact = (text: string) => text.toUpperCase().replaceAll(/[\s\-·.•]/g, '');

/** number plate formats of common countries, matched on the text as OCR reads it (upper case) */
const PLATE_FORMATS: RegExp[] = [
  // UK: AB12 CDE
  /^[A-Z]{2}\d{2}\s?[A-Z]{3}$/,
  // France, Italy: AB-123-CD, AB 123 CD
  /^[A-Z]{2}[\s-]?\d{3}[\s-]?[A-Z]{2}$/,
  // Germany: B MW 1234, M-AB 123E
  /^[A-ZÄÖÜ]{1,3}[\s-][A-Z]{1,2}\s?\d{1,4}[EH]?$/,
  // Spain: 1234 BCD
  /^\d{4}\s?[B-DF-HJ-NP-TV-Z]{3}$/,
  // Netherlands, Belgium: 12-ABC-3, AB-12-CD, 1-ABC-234
  /^(?=.*\d)(?=.*[A-Z])[A-Z\d]{1,3}-[A-Z\d]{2,3}-[A-Z\d]{1,3}$/,
  // Israel: 12-345-67, 123-45-678
  /^\d{2,3}-\d{2,3}-\d{2,3}$/,
  // Poland, Czechia and others: WA 12345, 1AB 2345
  /^[A-Z\d]{2,3}\s[A-Z\d]{4,5}$/,
  // United States, Canada: 7ABC123, ABC 1234, ABC-123
  /^\d[A-Z]{3}\d{3}$/,
  /^[A-Z]{3}[\s-]?\d{3,4}$/,
  /^\d{3}[\s-]?[A-Z]{3}$/,
];

/** a plate in no known format: letters and digits, 5 to 8 of them, in up to three groups */
const GENERIC_PLATE = /^(?=(?:.*\d){2})(?=.*[A-Z])[A-Z\d]{1,4}(?:[\s-][A-Z\d]{1,4}){0,2}$/;

export type PlateMatch = 'format' | 'generic' | null;

/** whether the text of an OCR box reads like a number plate */
export const matchPlate = (text: string): PlateMatch => {
  // plates are printed in capitals, and OCR reads them so: "Open 9-17" is a sign
  if (/\p{Ll}/u.test(text)) {
    return null;
  }
  const upper = text.trim().replaceAll(/\s+/g, ' ');
  const length = compact(upper).length;
  if (length < 4 || length > 9) {
    return null;
  }
  if (PLATE_FORMATS.some((format) => format.test(upper))) {
    return 'format';
  }
  return length >= 5 && length <= 8 && GENERIC_PLATE.test(upper) ? 'generic' : null;
};

/** a plate is wider than it is tall: one line at 2:1 to 8:1, or two lines down to about 1.3:1 */
export const hasPlateShape = (rect: RedactionRect, size?: ImageDimensions) => {
  if (!size?.width || !size.height) {
    return true;
  }
  const ratio = (rect.width * size.width) / (rect.height * size.height);
  return ratio >= 1.3 && ratio <= 9;
};

/** how likely a photo shows a vehicle before a plate in no known format counts, and a known format at least */
export const PLATE_VEHICLE_GENERIC = 0.3;
export const PLATE_VEHICLE_FORMAT = 0.08;
/** how likely a photo shows a screen, or a document, before all of its text is blurred */
export const SCREEN_MIN = 0.4;
export const DOCUMENT_MIN = 0.4;

/** whether an OCR box with a plate's text is a plate, given what CLIP sees in the photo */
export const isPlate = (match: PlateMatch, scene: RedactionScene) => {
  if (!match) {
    return false;
  }
  if (!scene) {
    // without CLIP, only the known formats
    return match === 'format';
  }
  return scene.vehicle >= (match === 'format' ? PLATE_VEHICLE_FORMAT : PLATE_VEHICLE_GENERIC);
};

const PHONE = /(?<![\p{L}\d])(?:\+|00)\d[\d\s().-]{7,}\d(?!\d)|\(\d{2,4}\)\s?\d{3}[\s.-]?\d{3,4}/u;
const CARD_OR_IBAN = /(?<![\p{L}\d])(?:\d{4}[\s-]){3}\d{1,4}(?!\d)|\b[A-Z]{2}\d{2}(?:\s?[A-Z\d]{4}){3,7}\b/u;

/** text that looks personal: what the travel journal hides (names with titles, booking codes, ticket and other long numbers, e-mail addresses), phone, card and account numbers */
export const isPersonalText = (text: string) =>
  !!text.trim() && (redactTravelText(text) !== text || PHONE.test(text) || CARD_OR_IBAN.test(text));

/** the regions of the text of a photo, in fractions of the unedited upright photo */
export const getTextRegions = (
  boxes: RedactionOcrBox[],
  { text = true, plates = true, screens = true, scene = null, size }: RedactionOptions = {},
): RedactionRegion[] => {
  const isScreen = screens && !!scene && scene.screen >= SCREEN_MIN;
  const isDocument = text && !!scene && scene.document >= DOCUMENT_MIN;

  const regions: RedactionRegion[] = [];
  for (const box of boxes) {
    const rect = getTextRect(box);
    if (!rect) {
      continue;
    }
    const base = { id: `text:${box.id}`, ...rect, text: box.text };
    if (plates && hasPlateShape(rect, size) && isPlate(matchPlate(box.text), scene)) {
      regions.push({ ...base, kind: 'plate', reason: 'plate', selected: true });
      continue;
    }
    if (!text && !isScreen) {
      continue;
    }
    if (isScreen) {
      regions.push({ ...base, kind: 'text', reason: 'screen', selected: true });
    } else if (isDocument) {
      regions.push({ ...base, kind: 'text', reason: 'document', selected: true });
    } else if (isPersonalText(box.text)) {
      regions.push({ ...base, kind: 'text', reason: 'personal', selected: true });
    } else {
      regions.push({ ...base, kind: 'text', reason: 'other', selected: false });
    }
  }

  if (isScreen && boxes.length >= 2) {
    const union = unionRect(regions.filter(({ reason }) => reason === 'screen'));
    const rect = union && clampRect(pad(union, SCREEN_PADDING, SCREEN_PADDING));
    if (rect) {
      regions.push({ id: 'screen', kind: 'screen', reason: 'screen', selected: true, ...rect });
    }
  }
  return regions;
};

// what CLIP sees in the photo

export const REDACTION_PROMPTS = {
  vehicle: [
    'a photo of a car',
    'a photo of a car license plate',
    'a street with parked cars',
    'a photo of a motorcycle',
    'a photo of a truck or a van',
  ],
  screen: [
    'a photo of a computer screen',
    'a photo of a phone screen',
    'a screenshot',
    'a photo of a laptop screen showing text',
    'a photo of a tv screen',
  ],
  document: [
    'a photo of a document',
    'a photo of a letter',
    'a photo of a receipt',
    'a photo of an id card or a passport',
    'a photo of a form',
  ],
  other: [
    'a photo of people',
    'a landscape photo',
    'a photo of food',
    'a photo of a building',
    'a photo of a street sign',
    'a photo of an animal',
    'a photo of a room',
    'a photo of a menu',
  ],
} as const;

export const getRedactionPromptList = () =>
  (Object.keys(REDACTION_PROMPTS) as Array<keyof typeof REDACTION_PROMPTS>).flatMap((kind) =>
    REDACTION_PROMPTS[kind].map((text) => ({ kind, text })),
  );

/** the probability of a vehicle, a screen and a document, from the photo's similarities with `getRedactionPromptList` */
export const getRedactionScene = (similarities: number[]): RedactionScene => {
  const prompts = getRedactionPromptList();
  if (similarities.length !== prompts.length) {
    return null;
  }
  const probabilities = softmax(similarities);
  const sum = (kind: keyof typeof REDACTION_PROMPTS) =>
    prompts.reduce((total, prompt, index) => total + (prompt.kind === kind ? probabilities[index] : 0), 0);
  return { vehicle: sum('vehicle'), screen: sum('screen'), document: sum('document') };
};

// what a link blurs

/**
 * The people "in" what a link shares (an album, a book, the photos of a link): named people seen in at least two of
 * its photos, or in one when it shares three photos or fewer. Everyone else (unnamed faces, and named people seen
 * once, e.g. in the background) is blurred. People are counted by face identity when they have one, so the same
 * person in two libraries (a shared space) counts once.
 */
export const LINK_PEOPLE_MIN_PHOTOS = 2;
export const LINK_SMALL_COLLECTION = 3;

export type LinkPersonCount = { key: string; personIds: string[]; identityIds: string[]; photos: number };

export const getLinkKeptPeople = (
  counts: LinkPersonCount[],
  photoCount: number,
): Required<Pick<RedactionPeople, 'keep' | 'keepIdentities'>> => {
  const min = photoCount <= LINK_SMALL_COLLECTION ? 1 : LINK_PEOPLE_MIN_PHOTOS;
  const kept = counts.filter(({ photos }) => photos >= min);
  return {
    keep: new Set(kept.flatMap(({ personIds }) => personIds)),
    keepIdentities: new Set(kept.flatMap(({ identityIds }) => identityIds)),
  };
};

/** the regions a link blurs on a photo (unedited upright fractions): faces of people not kept, and all text */
export const getLinkRegions = (
  { faces, boxes }: { faces: RedactionFace[]; boxes: RedactionOcrBox[] },
  { redactFaces, redactText }: { redactFaces: boolean; redactText: boolean },
  people: RedactionPeople,
): RedactionRect[] => [
  ...(redactFaces ? getFaceRegions(faces, people).filter(({ selected }) => selected) : []),
  ...(redactText ? boxes.flatMap((box) => getTextRect(box) ?? []) : []),
];

/** the selected regions as plain rectangles */
export const getSelectedRects = (regions: RedactionRegion[]): RedactionRect[] =>
  regions.filter(({ selected }) => selected).map(({ x, y, width, height }) => ({ x, y, width, height }));

/** a key of what a redacted image shows: its source, its regions (rounded) and the style */
export const getRedactionKey = (source: string, rects: RedactionRect[], style: RedactionStyle) => {
  const rounded = rects
    .map(({ x, y, width, height }) => [x, y, width, height].map((value) => Math.round(value * 10_000)).join(','))
    .toSorted();
  return createHash('sha1')
    .update(`${source}\n${style}\n${rounded.join(';')}`)
    .digest('hex');
};

/** counts of the selected regions by kind, e.g. "3 faces, 1 number plate" */
export const describeRedaction = (rects: Array<{ kind?: RedactionKind }>) => {
  const counts = new Map<RedactionKind, number>();
  for (const { kind = 'manual' } of rects) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const names: Record<RedactionKind, [string, string]> = {
    face: ['face', 'faces'],
    text: ['text', 'texts'],
    plate: ['number plate', 'number plates'],
    screen: ['screen', 'screens'],
    manual: ['area', 'areas'],
  };
  return redactionKinds
    .filter((kind) => counts.has(kind))
    .map((kind) => {
      const count = counts.get(kind)!;
      return `${count} ${names[kind][count === 1 ? 0 : 1]}`;
    })
    .join(', ');
};
