import { WorkflowTrigger } from '@immich/plugin-sdk';
import z from 'zod';
import { AssetType } from 'src/enum.js';

/**
 * Smart albums in plain words (#11): the structured rules the assistant fills in from a request ("screenshots from
 * 2025", "every dish from Italy"), and how they map to and from real Workflow steps of the core and gallery plugins.
 * The rule engine is the Workflows one; nothing here runs a rule on a new photo. `matchesRuleFilters` mirrors the
 * plugin filters only to preview the photos a rule would have matched in the library.
 */

const CORE = 'immich-plugin-core';
const GALLERY = 'gallery-core';

export const RuleMethod = {
  FileName: `${CORE}#assetFileFilter`,
  Type: `${CORE}#assetTypeFilter`,
  Date: `${CORE}#assetDateFilter`,
  Location: `${CORE}#assetLocationFilter`,
  Exif: `${CORE}#assetExifFilter`,
  MissingTimeZone: `${CORE}#assetMissingTimeZoneFilter`,
  TagIds: `${CORE}#assetTagFilter`,
  TagPath: `${GALLERY}#assetTagPathFilter`,
  AddToAlbums: `${CORE}#assetAddToAlbums`,
  AddTags: `${CORE}#assetAddTags`,
  Archive: `${CORE}#assetArchive`,
  Favorite: `${CORE}#assetFavorite`,
  Lock: `${CORE}#assetLock`,
  Visibility: `${CORE}#assetVisibility`,
  Webhook: `${CORE}#webhook`,
  AddToSpace: `${GALLERY}#addToSpace`,
  AddToSpaceAlbum: `${GALLERY}#addToSpaceAlbum`,
} as const;

/** the open ends of a date range: the date filter of the core plugin needs both a start and an end */
const OPEN_START = { year: 1900, month: 1, day: 1 };
const OPEN_END = { year: 9999, month: 12, day: 31 };
const EARTH_DIAMETER_KM = 12_742;
const MATCH_TYPES = ['contains', 'startsWith', 'exact', 'regex'] as const;
const CAMERA_PROPERTIES = { make: 'make', model: 'model', lens: 'lensModel' } as const;

const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'a date like 2025-01-31')
  .describe('Local date YYYY-MM-DD, inclusive');
const name = z.string().trim().min(1).max(200);

export const RuleFiltersSchema = z
  .object({
    fileName: z
      .object({
        pattern: z.string().min(1).max(200).describe('Text (or a regular expression) to find in the file name'),
        match: z.enum(MATCH_TYPES).default('contains'),
        caseSensitive: z.boolean().default(false),
      })
      .optional()
      .describe('The original file name, e.g. "screenshot"'),
    type: z.enum(['image', 'video']).optional().describe('Only photos or only videos'),
    takenFrom: DaySchema.optional().describe('Taken on or after this local date, e.g. 2025-01-01'),
    takenTo: DaySchema.optional().describe('Taken on or before this local date, e.g. 2025-12-31'),
    everyYear: z
      .boolean()
      .optional()
      .describe('Match the days of takenFrom..takenTo in any year, e.g. 2000-12-24..2000-12-26 for every Christmas'),
    place: z
      .object({ city: name.optional(), state: name.optional(), country: name.optional() })
      .optional()
      .describe('Where it was taken, by the names the library uses (e.g. country "Italy", city "Rome")'),
    near: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        radiusKm: z.number().positive().max(1000),
      })
      .optional()
      .describe('Taken within radiusKm of a point'),
    tags: z
      .array(name)
      .max(5)
      .optional()
      .describe(
        'Tags the photo must have, each including the tags under it: "Food" matches every dish of the food ' +
          'journal (Food/<place>/<dish>), "Food/Noma" the dishes of one place, "Wine" every wine',
      ),
    camera: z
      .object({ make: name.optional(), model: name.optional(), lens: name.optional() })
      .optional()
      .describe('Camera make, model and/or lens, matched as contained text, e.g. make "Apple"'),
    missingTimeZone: z
      .boolean()
      .optional()
      .describe('true: only photos without a time zone; false: only photos with one'),
    personIds: z
      .array(z.uuid())
      .max(10)
      .optional()
      .describe('People (see find_people). Not supported by workflows: the tool says so and suggests a one-off album'),
    query: z
      .string()
      .max(200)
      .optional()
      .describe('What the photos show ("at the beach"). Not supported by workflows: one-off album instead'),
    albumId: z.uuid().optional().describe('Photos of an album. Not supported by workflows'),
    favorite: z.boolean().optional().describe('Favorites. Not supported by workflows'),
  })
  .describe('What a new photo must match; every filter given must match');

export const RuleActionsSchema = z
  .object({
    album: name
      .optional()
      .describe('Add the photo to this album (name or id); a new album of that name is created when saving'),
    space: name
      .optional()
      .describe('Add the photo to this shared space (name or id); needs the Editor role in the space'),
    spaceAlbum: z
      .object({ space: name.describe('Space name or id'), album: name.describe('Album name in the space') })
      .optional()
      .describe('Add the photo to an album of a shared space, created and linked to the space if needed'),
    addTags: z.array(name).max(5).optional().describe('Tag the photo with these tags (names, created if needed)'),
    archive: z.literal(true).optional().describe('Archive the photo'),
    favorite: z.literal(true).optional().describe('Mark the photo as a favorite'),
  })
  .describe('What happens to a photo that matches');

export type RuleFilters = z.infer<typeof RuleFiltersSchema>;
export type RuleActions = z.infer<typeof RuleActionsSchema>;

/** the filters a workflow can't express, with why: the assistant offers a one-off album instead */
const UNSUPPORTED: Record<string, string> = {
  personIds:
    'Workflows run when a photo is uploaded, before the faces in it are recognized, so a rule can not follow people.',
  query: 'Workflows can not tell what a photo shows (smart search), only its file name, date, place, camera and tags.',
  albumId: 'Workflows can not filter by the albums a photo is in.',
  favorite: 'Workflows can not filter by favorites: a new photo is not a favorite yet.',
};

export type UnsupportedFilter = { filter: string; reason: string };

export const getUnsupportedFilters = (filters: RuleFilters): UnsupportedFilter[] =>
  Object.entries(UNSUPPORTED)
    .filter(([key]) => {
      const value = filters[key as keyof RuleFilters];
      return value !== undefined && !(Array.isArray(value) && value.length === 0) && value !== '';
    })
    .map(([filter, reason]) => ({ filter, reason }));

const parseDay = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return;
  }
  return { year, month, day };
};

const isEmptyObject = (value?: Record<string, unknown>) =>
  !value || Object.values(value).every((child) => child === undefined);

/** the problems of a rule that make it unusable, as messages for the agent; empty when it is valid */
export const validateRule = (filters: RuleFilters, actions: RuleActions): string[] => {
  const errors: string[] = [];
  const from = filters.takenFrom ? parseDay(filters.takenFrom) : undefined;
  const to = filters.takenTo ? parseDay(filters.takenTo) : undefined;
  if (filters.takenFrom && !from) {
    errors.push(`takenFrom ${filters.takenFrom} is not a date`);
  }
  if (filters.takenTo && !to) {
    errors.push(`takenTo ${filters.takenTo} is not a date`);
  }
  if (from && to && !filters.everyYear && filters.takenFrom! > filters.takenTo!) {
    errors.push('takenFrom is after takenTo');
  }
  if (filters.everyYear && (!from || !to)) {
    errors.push('everyYear needs both takenFrom and takenTo');
  }
  if (filters.place && isEmptyObject(filters.place)) {
    errors.push('place needs a city, state or country');
  }
  if (filters.camera && isEmptyObject(filters.camera)) {
    errors.push('camera needs a make, model or lens');
  }
  if (filters.fileName?.match === 'regex') {
    try {
      new RegExp(filters.fileName.pattern);
    } catch {
      errors.push(`fileName.pattern is not a valid regular expression: ${filters.fileName.pattern}`);
    }
  }
  if (filters.tags && new Set(filters.tags.map((tag) => normalizeTag(tag).toLowerCase())).has('')) {
    errors.push('a tag is empty');
  }
  if (isEmptyObject(actions)) {
    errors.push('a workflow needs an action, e.g. album');
  }
  return errors;
};

/** what a valid rule should still be told about, e.g. that it applies to every new photo */
export const getRuleWarnings = (filters: RuleFilters): string[] => {
  const warnings: string[] = [];
  if (!hasSupportedFilter(filters)) {
    warnings.push('The rule has no filter, so it applies to every new photo and video.');
  }
  return warnings;
};

export const normalizeTag = (value: string) =>
  value
    .trim()
    .replaceAll(/^\/+|\/+$/g, '')
    .replaceAll(/\s*\/\s*/g, '/');

const SUPPORTED_FILTER_KEYS = [
  'fileName',
  'type',
  'takenFrom',
  'takenTo',
  'place',
  'near',
  'tags',
  'camera',
  'missingTimeZone',
] as const;

export const hasSupportedFilter = (filters: RuleFilters) =>
  SUPPORTED_FILTER_KEYS.some((key) => {
    const value = filters[key];
    return value !== undefined && !(Array.isArray(value) && value.length === 0);
  });

/** the rule without the filters workflows can't express, e.g. to offer the rest as a rule of its own */
export const withoutUnsupported = (filters: RuleFilters): RuleFilters => {
  const result = { ...filters };
  for (const key of Object.keys(UNSUPPORTED)) {
    delete result[key as keyof RuleFilters];
  }
  return result;
};

/**
 * When the workflow runs: a tag filter waits for the photo to get a tag (e.g. when a journal names a dish), a date,
 * place or camera filter for the metadata of the photo (read right after the upload), anything else runs at upload.
 */
export const getRuleTrigger = (filters: RuleFilters): WorkflowTrigger => {
  if (filters.tags?.length) {
    return WorkflowTrigger.AssetTagged;
  }
  const needsMetadata =
    filters.takenFrom !== undefined ||
    filters.takenTo !== undefined ||
    filters.place !== undefined ||
    filters.near !== undefined ||
    filters.camera !== undefined ||
    filters.missingTimeZone !== undefined;
  return needsMetadata ? WorkflowTrigger.AssetMetadataExtraction : WorkflowTrigger.AssetCreate;
};

/** the albums, spaces and tags of the actions, resolved to ids (an album without an id is created by the engine) */
export type RuleTargets = {
  album?: { id: string | null; name: string };
  space?: { id: string; name: string };
  spaceAlbum?: { spaceId: string; spaceName: string; albumName: string };
  addTags?: Array<{ id: string; value: string }>;
};

export type RuleStep = { method: string; config: Record<string, unknown>; enabled: boolean };

const toDateConfig = (value: string | undefined, fallback: typeof OPEN_START) =>
  (value ? parseDay(value) : undefined) ?? fallback;

/** the steps of the workflow of a rule: its filters first (in a fixed order), then its actions */
export const buildWorkflowSteps = (filters: RuleFilters, targets: RuleTargets, actions: RuleActions): RuleStep[] => {
  const steps: RuleStep[] = [];
  const add = (method: string, config: Record<string, unknown>) => {
    steps.push({ method, config, enabled: true });
  };

  if (filters.type) {
    add(RuleMethod.Type, { allowedTypes: [filters.type === 'video' ? AssetType.Video : AssetType.Image] });
  }
  if (filters.fileName) {
    add(RuleMethod.FileName, {
      pattern: filters.fileName.pattern,
      matchType: filters.fileName.match,
      caseSensitive: filters.fileName.caseSensitive,
    });
  }
  if (filters.takenFrom !== undefined || filters.takenTo !== undefined) {
    add(RuleMethod.Date, {
      startDate: toDateConfig(filters.takenFrom, OPEN_START),
      endDate: toDateConfig(filters.takenTo, OPEN_END),
      recurring: filters.everyYear ?? false,
    });
  }
  if (filters.place || filters.near) {
    add(RuleMethod.Location, {
      ...(filters.place && {
        region: Object.fromEntries(Object.entries(filters.place).filter(([, value]) => value !== undefined)),
      }),
      ...(filters.near && {
        coordinate: {
          latitude: filters.near.latitude,
          longitude: filters.near.longitude,
          radius: filters.near.radiusKm,
        },
      }),
    });
  }
  for (const [key, property] of Object.entries(CAMERA_PROPERTIES)) {
    const pattern = filters.camera?.[key as keyof typeof CAMERA_PROPERTIES];
    if (pattern) {
      add(RuleMethod.Exif, { property, pattern, matchType: 'contains', caseSensitive: false });
    }
  }
  if (filters.missingTimeZone !== undefined) {
    add(RuleMethod.MissingTimeZone, { inverse: !filters.missingTimeZone });
  }
  for (const tag of filters.tags ?? []) {
    add(RuleMethod.TagPath, { tag: normalizeTag(tag), inverse: false });
  }

  if (targets.album) {
    add(RuleMethod.AddToAlbums, {
      albumIds: targets.album.id ? [targets.album.id] : [],
      albumName: targets.album.name,
    });
  }
  if (targets.space) {
    add(RuleMethod.AddToSpace, { spaceIds: [targets.space.id] });
  }
  if (targets.spaceAlbum) {
    add(RuleMethod.AddToSpaceAlbum, { spaceId: targets.spaceAlbum.spaceId, albumName: targets.spaceAlbum.albumName });
  }
  if (targets.addTags?.length) {
    add(RuleMethod.AddTags, { tags: targets.addTags.map(({ id }) => id) });
  }
  if (actions.archive) {
    add(RuleMethod.Archive, { inverse: false });
  }
  if (actions.favorite) {
    // the core plugin favorites unless `inverse` is set
    add(RuleMethod.Favorite, { inverse: false });
  }

  return steps;
};

type StepLike = { method: string; config: Record<string, unknown> | null; enabled?: boolean };

/** the actions of a workflow as ids, as `parseWorkflowSteps` reads them */
export type ParsedActions = {
  albumIds?: string[];
  albumName?: string;
  spaceIds?: string[];
  spaceAlbum?: { spaceId: string; albumName: string };
  tagIds?: string[];
  archive?: true;
  favorite?: true;
};

export type ParsedWorkflow = {
  filters: RuleFilters;
  actions: ParsedActions;
  /** steps a rule can't express (a webhook, a disabled step, a second date filter...), kept as they are */
  other: StepLike[];
};

type DateConfig = { year: number; month: number; day: number };

const toDay = ({ year, month, day }: DateConfig) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const isOpen = (value: DateConfig, open: DateConfig) =>
  value.year === open.year && value.month === open.month && value.day === open.day;

const isDateConfig = (value: unknown): value is DateConfig =>
  !!value &&
  typeof value === 'object' &&
  ['year', 'month', 'day'].every((key) => typeof (value as Record<string, unknown>)[key] === 'number');

const asString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined);
const asStrings = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : undefined;

/**
 * Reads the steps of any workflow back into a rule, so it can be explained and edited in plain words. A step the rule
 * format can't express, or a second filter of a kind, goes to `other`.
 */
export const parseWorkflowSteps = (steps: StepLike[]): ParsedWorkflow => {
  const filters: RuleFilters = {};
  const actions: ParsedActions = {};
  const other: StepLike[] = [];

  for (const step of steps) {
    const config = step.config ?? {};
    const parsed = step.enabled !== false && parseStep(step.method, config, filters, actions);
    if (!parsed) {
      other.push(step);
    }
  }

  return { filters, actions, other };
};

const parseStep = (method: string, config: Record<string, unknown>, filters: RuleFilters, actions: ParsedActions) => {
  switch (method) {
    case RuleMethod.Type: {
      const types = asStrings(config.allowedTypes);
      if (filters.type || types?.length !== 1 || ![AssetType.Image, AssetType.Video].includes(types[0] as AssetType)) {
        return false;
      }
      filters.type = types[0] === AssetType.Video ? 'video' : 'image';
      return true;
    }
    case RuleMethod.FileName: {
      const pattern = asString(config.pattern);
      const match = (config.matchType ?? 'contains') as (typeof MATCH_TYPES)[number];
      if (filters.fileName || !pattern || config.usePath === true || !MATCH_TYPES.includes(match)) {
        return false;
      }
      filters.fileName = { pattern, match, caseSensitive: config.caseSensitive === true };
      return true;
    }
    case RuleMethod.Date: {
      const { startDate, endDate } = config;
      if (filters.takenFrom || filters.takenTo || !isDateConfig(startDate) || !isDateConfig(endDate)) {
        return false;
      }
      if (!isOpen(startDate, OPEN_START)) {
        filters.takenFrom = toDay(startDate);
      }
      if (!isOpen(endDate, OPEN_END)) {
        filters.takenTo = toDay(endDate);
      }
      if (config.recurring === true) {
        filters.everyYear = true;
      }
      return true;
    }
    case RuleMethod.Location: {
      if (filters.place || filters.near) {
        return false;
      }
      const region = (config.region ?? {}) as Record<string, unknown>;
      const place = {
        ...(asString(region.city) && { city: asString(region.city) }),
        ...(asString(region.state) && { state: asString(region.state) }),
        ...(asString(region.country) && { country: asString(region.country) }),
      };
      if (Object.keys(place).length > 0) {
        filters.place = place;
      }
      const coordinate = config.coordinate as Record<string, unknown> | undefined;
      if (
        typeof coordinate?.latitude === 'number' &&
        typeof coordinate.longitude === 'number' &&
        typeof coordinate.radius === 'number'
      ) {
        filters.near = { latitude: coordinate.latitude, longitude: coordinate.longitude, radiusKm: coordinate.radius };
      }
      return true;
    }
    case RuleMethod.Exif: {
      const key = Object.entries(CAMERA_PROPERTIES).find(([, property]) => property === config.property)?.[0] as
        keyof typeof CAMERA_PROPERTIES | undefined;
      const pattern = asString(config.pattern);
      const isContains = (config.matchType ?? 'contains') === 'contains' && config.caseSensitive !== true;
      if (!key || !pattern || !isContains || filters.camera?.[key]) {
        return false;
      }
      filters.camera = { ...filters.camera, [key]: pattern };
      return true;
    }
    case RuleMethod.MissingTimeZone: {
      if (filters.missingTimeZone !== undefined) {
        return false;
      }
      filters.missingTimeZone = config.inverse !== true;
      return true;
    }
    case RuleMethod.TagPath: {
      const tag = asString(config.tag);
      if (!tag || config.inverse === true) {
        return false;
      }
      filters.tags = [...(filters.tags ?? []), tag];
      return true;
    }
    case RuleMethod.AddToAlbums: {
      const albumIds = asStrings(config.albumIds) ?? [];
      if (actions.albumIds || actions.albumName || albumIds.length > 1) {
        return false;
      }
      actions.albumIds = albumIds;
      if (asString(config.albumName)) {
        actions.albumName = asString(config.albumName);
      }
      return albumIds.length > 0 || !!actions.albumName;
    }
    case RuleMethod.AddToSpace: {
      const spaceIds = asStrings(config.spaceIds);
      if (actions.spaceIds || spaceIds?.length !== 1) {
        return false;
      }
      actions.spaceIds = spaceIds;
      return true;
    }
    case RuleMethod.AddToSpaceAlbum: {
      const spaceId = asString(config.spaceId);
      const albumName = asString(config.albumName);
      if (actions.spaceAlbum || !spaceId || !albumName) {
        return false;
      }
      actions.spaceAlbum = { spaceId, albumName };
      return true;
    }
    case RuleMethod.AddTags: {
      const tagIds = asStrings(config.tags);
      if (actions.tagIds || !tagIds?.length) {
        return false;
      }
      actions.tagIds = tagIds;
      return true;
    }
    case RuleMethod.Archive: {
      if (config.inverse === true || actions.archive) {
        return false;
      }
      actions.archive = true;
      return true;
    }
    case RuleMethod.Favorite: {
      if (config.inverse === true || actions.favorite) {
        return false;
      }
      actions.favorite = true;
      return true;
    }
    default: {
      return false;
    }
  }
};

/** the names of the albums, spaces and tags a workflow refers to by id */
export type ExplainNames = {
  albums?: Map<string, string>;
  spaces?: Map<string, string>;
  tags?: Map<string, string>;
  /** the title of a plugin method, for the steps that have no plain-words sentence */
  methods?: Map<string, string>;
};

export type WorkflowExplanation = {
  /** the whole rule in one paragraph */
  summary: string;
  when: string;
  conditions: string[];
  actions: string[];
  /** e.g. that the workflow is off, or that a filter can't work with its trigger */
  notes: string[];
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const formatDate = ({ year, month, day }: DateConfig, withYear = true) =>
  `${day} ${MONTHS[month - 1] ?? month}${withYear ? ` ${year}` : ''}`;

const quoted = (value: unknown) => `"${String(value)}"`;

const TRIGGER_WORDS: Record<string, string> = {
  [WorkflowTrigger.AssetCreate]: 'When a photo or video is uploaded',
  [WorkflowTrigger.AssetMetadataExtraction]:
    'When the date, place and camera of a new photo or video are read (right after it is uploaded)',
  [WorkflowTrigger.AssetTagged]: 'When a photo or video gets a tag (e.g. when a journal names it)',
};

const TYPE_WORDS: Record<string, string> = {
  [AssetType.Image]: 'a photo',
  [AssetType.Video]: 'a video',
  [AssetType.Audio]: 'an audio file',
  [AssetType.Other]: 'another kind of file',
};

const MATCH_WORDS: Record<string, string> = {
  contains: 'contains',
  startsWith: 'starts with',
  exact: 'is',
  regex: 'matches the pattern',
};

const nameOf = (names: Map<string, string> | undefined, id: unknown, kind: string) => {
  const value = typeof id === 'string' ? names?.get(id) : undefined;
  return value ? quoted(value) : `${kind === 'album' ? 'an' : 'a'} ${kind} that no longer exists`;
};

const explainDate = (config: Record<string, unknown>) => {
  const { startDate, endDate } = config;
  if (!isDateConfig(startDate) || !isDateConfig(endDate)) {
    return 'it was taken in a date range';
  }
  if (config.recurring === true) {
    return `it was taken between ${formatDate(startDate, false)} and ${formatDate(endDate, false)} of any year`;
  }
  const openStart = isOpen(startDate, OPEN_START);
  const openEnd = isOpen(endDate, OPEN_END);
  if (openStart && openEnd) {
    return 'it has any date';
  }
  if (openStart) {
    return `it was taken on or before ${formatDate(endDate)}`;
  }
  if (openEnd) {
    return `it was taken on or after ${formatDate(startDate)}`;
  }
  const isWholeYear =
    startDate.year === endDate.year &&
    startDate.month === 1 &&
    startDate.day === 1 &&
    endDate.month === 12 &&
    endDate.day === 31;
  return isWholeYear
    ? `it was taken in ${startDate.year}`
    : `it was taken between ${formatDate(startDate)} and ${formatDate(endDate)}`;
};

const explainLocation = (config: Record<string, unknown>) => {
  const region = (config.region ?? {}) as Record<string, unknown>;
  const parts = [region.city, region.state, region.country].filter((part) => asString(part));
  const coordinate = config.coordinate as Record<string, unknown> | undefined;
  const sentences: string[] = [];
  if (parts.length > 0) {
    sentences.push(`it was taken in ${parts.join(', ')}`);
  }
  if (typeof coordinate?.latitude === 'number' && typeof coordinate.longitude === 'number') {
    sentences.push(
      `it was taken within ${String(coordinate.radius ?? 0)} km of ${coordinate.latitude}, ${coordinate.longitude}`,
    );
  }
  return sentences.length > 0 ? sentences.join(' and ') : 'it was taken anywhere';
};

const explainCondition = (method: string, config: Record<string, unknown>, names: ExplainNames) => {
  switch (method) {
    case RuleMethod.FileName: {
      const target = config.usePath === true ? 'its path on the server' : 'its file name';
      const match = MATCH_WORDS[String(config.matchType ?? 'contains')] ?? 'contains';
      const caseNote = config.caseSensitive === true ? ' (same case)' : '';
      return `${target} ${match} ${quoted(config.pattern)}${caseNote}`;
    }
    case RuleMethod.Type: {
      const words = (asStrings(config.allowedTypes) ?? []).map((type) => TYPE_WORDS[type] ?? type.toLowerCase());
      return words.length > 0 ? `it is ${words.join(' or ')}` : 'it is of no type';
    }
    case RuleMethod.Date: {
      return explainDate(config);
    }
    case RuleMethod.Location: {
      return explainLocation(config);
    }
    case RuleMethod.Exif: {
      const property = String(config.property ?? 'metadata');
      const label = property === 'lensModel' ? 'lens' : property === 'make' ? 'camera make' : `camera ${property}`;
      const match = MATCH_WORDS[String(config.matchType ?? 'contains')] ?? 'contains';
      return `its ${label} ${match} ${quoted(config.pattern)}`;
    }
    case RuleMethod.MissingTimeZone: {
      return config.inverse === true ? 'it has a time zone' : 'it has no time zone';
    }
    case RuleMethod.TagPath: {
      return config.inverse === true
        ? `it has no tag ${quoted(config.tag)} or under it`
        : `it has the tag ${quoted(config.tag)} or a tag under it`;
    }
    case RuleMethod.TagIds: {
      const tags = (asStrings(config.tags) ?? []).map((id) => nameOf(names.tags, id, 'tag'));
      const matching = String(config.matching ?? 'all');
      if (matching === 'none') {
        return `it has none of the tags ${tags.join(', ')}`;
      }
      return `it has ${matching === 'any' ? 'any' : 'all'} of the tags ${tags.join(', ')}`;
    }
  }
};

const explainAction = (method: string, config: Record<string, unknown>, names: ExplainNames) => {
  switch (method) {
    case RuleMethod.AddToAlbums: {
      const albumIds = asStrings(config.albumIds) ?? [];
      if (albumIds.length > 0) {
        return `add it to the album${albumIds.length > 1 ? 's' : ''} ${albumIds.map((id) => nameOf(names.albums, id, 'album')).join(', ')}`;
      }
      return config.albumName
        ? `add it to the album ${quoted(config.albumName)} (created if there is none)`
        : 'add it to no album';
    }
    case RuleMethod.AddToSpace: {
      const spaceIds = asStrings(config.spaceIds) ?? [];
      return `add it to the shared space${spaceIds.length > 1 ? 's' : ''} ${spaceIds.map((id) => nameOf(names.spaces, id, 'space')).join(', ')}`;
    }
    case RuleMethod.AddToSpaceAlbum: {
      return `add it to the album ${quoted(config.albumName)} of the shared space ${nameOf(names.spaces, config.spaceId, 'space')} (created there if needed)`;
    }
    case RuleMethod.AddTags: {
      const tags = (asStrings(config.tags) ?? []).map((id) => nameOf(names.tags, id, 'tag'));
      return `tag it ${tags.join(', ')}`;
    }
    case RuleMethod.Archive: {
      return config.inverse === true ? 'take it out of the archive' : 'archive it';
    }
    case RuleMethod.Favorite: {
      return config.inverse === true ? 'remove it from the favorites' : 'mark it as a favorite';
    }
    case RuleMethod.Lock: {
      return config.inverse === true ? 'take it out of the locked folder' : 'move it to the locked folder';
    }
    case RuleMethod.Visibility: {
      return `set its visibility to ${String(config.visibility)}`;
    }
    case RuleMethod.Webhook: {
      return `send it to ${String(config.url ?? 'a web address')}`;
    }
  }
};

const METADATA_METHODS = new Set<string>([RuleMethod.Date, RuleMethod.Location, RuleMethod.Exif]);

const joinWords = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** A workflow in plain words: when it runs, what a photo must match and what happens to it */
export const explainWorkflow = (
  workflow: { trigger: string; enabled: boolean; steps: StepLike[] },
  names: ExplainNames = {},
): WorkflowExplanation => {
  const when = TRIGGER_WORDS[workflow.trigger] ?? `When ${workflow.trigger}`;
  const conditions: string[] = [];
  const actions: string[] = [];
  const notes: string[] = [];

  for (const step of workflow.steps) {
    const config = step.config ?? {};
    const condition = explainCondition(step.method, config, names);
    const action = condition === undefined ? explainAction(step.method, config, names) : undefined;
    const title = names.methods?.get(step.method) ?? step.method;
    const off = step.enabled === false ? ' (this step is turned off)' : '';
    if (condition !== undefined) {
      conditions.push(condition + off);
    } else if (action === undefined) {
      actions.push(`run the step ${quoted(title)}${off}`);
    } else {
      actions.push(action + off);
    }
  }

  if (!workflow.enabled) {
    notes.push('The workflow is turned off, so it does nothing until it is turned on.');
  }
  if (actions.length === 0) {
    notes.push('It has no action, so it changes nothing.');
  }
  if (
    workflow.trigger === WorkflowTrigger.AssetCreate &&
    workflow.steps.some((step) => METADATA_METHODS.has(step.method))
  ) {
    notes.push(
      'It runs at upload, before the date, place and camera of the photo are read: a rule with these filters ' +
        'should run when the metadata is read instead.',
    );
  }

  const condition = conditions.length > 0 ? `, if ${joinWords(conditions)}` : '';
  const summary = `${when}${condition}: ${actions.length > 0 ? joinWords(actions) : 'nothing happens'}.`;
  return { summary, when, conditions, actions, notes };
};

/** the facts of a photo the preview checks a rule against, as the workflow reads them */
export type RuleAsset = {
  originalFileName: string;
  type: string;
  localDateTime: Date | string;
  exifInfo?: {
    city?: string | null;
    state?: string | null;
    country?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    make?: string | null;
    model?: string | null;
    lensModel?: string | null;
    timeZone?: string | null;
  } | null;
};

const matchText = (value: string, pattern: string, match: string, caseSensitive: boolean) => {
  const text = caseSensitive ? value : value.toLowerCase();
  const target = caseSensitive ? pattern : pattern.toLowerCase();
  switch (match) {
    case 'startsWith': {
      return text.startsWith(target);
    }
    case 'exact': {
      return text === target;
    }
    case 'regex': {
      return new RegExp(target, caseSensitive ? '' : 'i').test(value);
    }
    default: {
      return text.includes(target);
    }
  }
};

const matchesDate = (taken: Date, filters: RuleFilters) => {
  const from = toDateConfig(filters.takenFrom, OPEN_START);
  const to = toDateConfig(filters.takenTo, OPEN_END);
  // as the core plugin (which runs in UTC): the local date-time of the photo against midnights of the range
  const start = new Date(Date.UTC(from.year, from.month - 1, from.day));
  const end = new Date(Date.UTC(to.year, to.month - 1, to.day + 1));
  if (filters.everyYear) {
    start.setUTCFullYear(taken.getUTCFullYear());
    end.setUTCFullYear(taken.getUTCFullYear());
    if (end < start) {
      if (taken > end) {
        end.setUTCFullYear(end.getUTCFullYear() + 1);
      } else {
        start.setUTCFullYear(start.getUTCFullYear() - 1);
      }
    }
  }
  return taken >= start && taken < end;
};

const distanceKm = (latitude: number, longitude: number, near: NonNullable<RuleFilters['near']>) => {
  const deg = Math.PI / 180;
  const delta = Math.asin(
    Math.sqrt(
      Math.pow(Math.sin((latitude * deg - near.latitude * deg) / 2), 2) +
        Math.cos(latitude * deg) *
          Math.cos(near.latitude * deg) *
          Math.pow(Math.sin((longitude * deg - near.longitude * deg) / 2), 2),
    ),
  );
  return EARTH_DIAMETER_KM * delta;
};

/**
 * Whether a photo matches the filters of a rule as the plugins check them, except the tags, which the preview search
 * already applies. Only for previews: the workflow engine runs the rule itself on new photos.
 */
export const matchesRuleFilters = (asset: RuleAsset, filters: RuleFilters): boolean => {
  const exif = asset.exifInfo ?? {};
  if (filters.type && asset.type !== (filters.type === 'video' ? AssetType.Video : AssetType.Image)) {
    return false;
  }
  if (
    filters.fileName &&
    !matchText(asset.originalFileName, filters.fileName.pattern, filters.fileName.match, filters.fileName.caseSensitive)
  ) {
    return false;
  }
  if (
    (filters.takenFrom !== undefined || filters.takenTo !== undefined) &&
    !matchesDate(new Date(asset.localDateTime), filters)
  ) {
    return false;
  }
  const place = filters.place ?? {};
  if (
    (place.country && place.country !== exif.country) ||
    (place.state && place.state !== exif.state) ||
    (place.city && place.city !== exif.city)
  ) {
    return false;
  }
  if (filters.near) {
    if (typeof exif.latitude !== 'number' || typeof exif.longitude !== 'number') {
      return false;
    }
    if (distanceKm(exif.latitude, exif.longitude, filters.near) > filters.near.radiusKm) {
      return false;
    }
  }
  for (const [key, property] of Object.entries(CAMERA_PROPERTIES)) {
    const pattern = filters.camera?.[key as keyof typeof CAMERA_PROPERTIES];
    const value = exif[property];
    if (pattern && (value === null || value === undefined || !matchText(value, pattern, 'contains', false))) {
      return false;
    }
  }
  return filters.missingTimeZone === undefined || !!exif.timeZone !== filters.missingTimeZone;
};

/** filters the preview search applies exactly, so the photos it finds need no further check */
export const isExactInSearch = (filters: RuleFilters) =>
  !filters.fileName &&
  filters.takenFrom === undefined &&
  filters.takenTo === undefined &&
  !filters.near &&
  !filters.camera &&
  filters.missingTimeZone === undefined;
