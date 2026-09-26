import { BadRequestException, Injectable } from '@nestjs/common';
import { LRUMap } from 'mnemonist';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  COLLECTION_LIMITS,
  CollectionEntriesDto,
  CollectionEntriesResponseDto,
  CollectionEntryResponse,
  CollectionEntryResult,
  CollectionMatchDto,
  CollectionMatchResponseDto,
  CollectionPackResponseDto,
  CollectionPlaceCandidate,
  CollectionSavedEntry,
  CollectionVisitResponse,
  CollectionVisitsDto,
  CollectionVisitsResponseDto,
} from 'src/dtos/collection.dto.js';
import { AssetFileType, AssetType, Permission } from 'src/enum.js';
import { AssetService } from 'src/services/asset.service.js';
import { BaseService } from 'src/services/base.service.js';
import { TagService } from 'src/services/tag.service.js';
import { parseEmbedding } from 'src/utils/agent/clustering.js';
import { getDimensions } from 'src/utils/asset.util.js';
import {
  Classification,
  CollectionPrompt,
  classifyPhoto,
  getPromptList,
  scoreText,
  summarizeText,
} from 'src/utils/collections/classify.js';
import { AssignResult, DEFAULT_MATCH_OPTIONS, EntryCandidate, matchSubjects } from 'src/utils/collections/match.js';
import { OcrBoxInput } from 'src/utils/collections/ocr.js';
import {
  DEFAULT_LOOKUP_RADIUS,
  NearbyPlace,
  buildOverpassQuery,
  parseOverpassPlaces,
} from 'src/utils/collections/overpass.js';
import {
  CollectionPack,
  CollectionSourcePage,
  getCollectionMessages,
  getCollectionTagRules,
  redactText,
} from 'src/utils/collections/pack.js';
import { PlaceCandidate, PlacePhoto, findPlaceNames } from 'src/utils/collections/place.js';
import { getCollectionPack, getCollectionPacks } from 'src/utils/collections/registry.js';
import {
  FocusRect,
  ParsedSource,
  chooseReading,
  chooseSourceOcr,
  combineSourceOcr,
  getEntriesFocus,
  getTitlePrompt,
  mergeSourceEntries,
} from 'src/utils/collections/source.js';
import {
  getEntryTag,
  getSourceTag,
  getTagPlaceName,
  getTagPrefix,
  parseCollectionTag,
} from 'src/utils/collections/tags.js';
import { DEFAULT_TILE_OVERLAP, OcrPass, PixelRect, getOcrTiles, mergeOcrPasses } from 'src/utils/collections/tiles.js';
import {
  LINKED_PLACE_MINUTES,
  LinkedPlacePhoto,
  VisitOptions,
  findLinkedPlace,
  getFallbackVisitNames,
  groupVisits,
  summarizeVisit,
} from 'src/utils/collections/visits.js';
import { decodeOriginal } from 'src/utils/image-decode.js';
import { isOcrEnabled, isSmartSearchEnabled } from 'src/utils/misc.js';
import { upsertTags } from 'src/utils/tag.js';

/** what tools say instead of showing a private source, see `CollectionService.getPrivateSourceIds` */
export const PRIVATE_SOURCE_NOTE =
  'Not shown: travel documents and other private sources carry names and booking references. read_source gives ' +
  'their redacted text.';

/** what book renders for the assistant say about the private sources they blur */
export const PRIVATE_SOURCE_BLURRED =
  'Blurred: travel documents and other private sources carry names and booking references. Use a ticket-stub page ' +
  'instead of their photo.';

/** CLIP text embeddings of the classification prompts and entries, by model and text */
const textEmbeddingCache = new LRUMap<string, string>(5000);
/** high-resolution OCR of source photos, by asset and checksum; never written over the stored OCR */
const sourceOcrCache = new LRUMap<string, OcrBoxInput[]>(200);

const CHUNK = 1000;
/** a source is read in tiles as if its long edge were at most this many pixels */
const SOURCE_DECODE_SIZE = 4096;
/** the size of the tiles the source is read in */
const SOURCE_TILE_SIZE = 1600;
/** the whole source is read too, for text across the tiles: at most this large, with detection at this short edge */
const SOURCE_WHOLE_SIZE = 2048;
const SOURCE_WHOLE_RESOLUTION = 1280;
const SOURCE_MIN_RECOGNITION_SCORE = 0.6;
/** the long edge of the source images returned to a reader */
const SOURCE_IMAGE_SIZE = 1440;

const unique = <T>(values: T[]) => [...new Set(values)];

const roundCoordinate = (value: number) => Math.round(value * 100_000) / 100_000;

const chunks = <T>(values: T[], size = CHUNK) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

const parseDate = (value?: string) => {
  if (value === undefined) {
    return;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Invalid date: ${value}`);
  }
  return date;
};

/** the prompt list of each pack, in the order the similarities are computed */
const promptLists = new WeakMap<CollectionPack, CollectionPrompt[]>();
const getPrompts = (pack: CollectionPack) => {
  let prompts = promptLists.get(pack);
  if (!prompts) {
    prompts = getPromptList(pack.prompts);
    promptLists.set(pack, prompts);
  }
  return prompts;
};

type Candidate = {
  id: string;
  time: number;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  country: string | null;
};

export type SourceReading = ParsedSource & {
  assetId: string;
  /** where the text was read: tiles of the original at full resolution, or the OCR stored for the photo */
  ocr: 'tiles' | 'stored' | 'none';
  /** candidates for the name of the place, read on the source */
  place: PlaceCandidate[];
  warnings: string[];
  previewPath: string | null;
  width: number;
  height: number;
};

export type NearbyPlaces =
  | { enabled: false; message: string }
  | { enabled: true; latitude: number; longitude: number; radius: number; places: NearbyPlace[] };

export type PlaceLookupInput = { assetIds?: string[]; latitude?: number; longitude?: number; radius?: number };

/**
 * The collections engine: finds the photos of a pack (e.g. food) in a library and groups them into visits, reads the
 * sources (menus) into entries, matches the subjects (dishes) with the entries and saves their names as the pack's
 * tags. Every method takes the id of a pack, see `src/utils/collections/pack.ts`.
 */
@Injectable()
export class CollectionService extends BaseService {
  getPacks(): CollectionPackResponseDto[] {
    return getCollectionPacks().map((pack) => ({
      id: pack.id,
      title: pack.title,
      description: pack.description,
      tagRoot: pack.tagRoot,
      sourceLeaf: pack.sourceLeaf,
      names: { ...pack.names },
      bookStylePreset: pack.book.preset.id,
      placeLookup: !!pack.place.lookup,
    }));
  }

  requirePack(id: string): CollectionPack {
    const pack = getCollectionPack(id);
    if (!pack) {
      throw new BadRequestException(
        `Unknown collection pack "${id}". Packs: ${getCollectionPacks()
          .map((item) => item.id)
          .join(', ')}`,
      );
    }
    return pack;
  }

  async findVisits(auth: AuthDto, packId: string, dto: CollectionVisitsDto): Promise<CollectionVisitsResponseDto> {
    const pack = this.requirePack(packId);
    const messages = getCollectionMessages(pack);
    const { candidates, truncated } = await this.getCandidates(auth, dto);
    const warnings: string[] = [];
    const { classifications, ocr, noEmbedding } = await this.classify(pack, candidates, warnings);
    if (noEmbedding > 0 && noEmbedding < candidates.length) {
      warnings.push(messages.noEmbedding(noEmbedding));
    }

    const classified = candidates.flatMap((candidate) => {
      const classification = classifications.get(candidate.id);
      return classification && classification.kind !== 'other' ? [{ ...candidate, kind: classification.kind }] : [];
    });
    // videos have embeddings of their thumbnail too, but only photos are named
    const images = await this.getImageIds(classified.map(({ id }) => id));
    const found = classified.filter(({ id }) => images.has(id));

    const options: Partial<VisitOptions> = {
      ...pack.visits.options,
      ...(dto.maxGapMinutes !== undefined && { maxGapMinutes: dto.maxGapMinutes }),
      ...(dto.maxDistanceMeters !== undefined && { maxDistanceMeters: dto.maxDistanceMeters }),
    };
    const groups = groupVisits(found, options);
    const saved = await this.getSavedTags(
      pack,
      groups.flat().map(({ id }) => id),
    );
    // the places other packs named at the same time, e.g. the restaurant of a Food meal the wines were poured at
    const linked = await this.getLinkedPlaces(auth, pack, groups);

    const visits = groups.map((group, index) => {
      const summary = summarizeVisit(group, pack.visits.type);
      const ids = new Set(group.map(({ id }) => id));
      const visitSaved = saved.filter(({ assetId }) => ids.has(assetId));
      const photos: PlacePhoto[] = group.flatMap((photo) =>
        photo.kind === 'subject' || !ocr.has(photo.id)
          ? []
          : [{ assetId: photo.id, kind: photo.kind, ocr: ocr.get(photo.id)! }],
      );
      const candidates = this.redactPlaces(pack, findPlaceNames(photos, pack.place));
      const tagged = this.getTaggedPlace(visitSaved);
      return { index, summary, saved: visitSaved, candidates, place: tagged ?? linked[index] ?? candidates[0] };
    });

    const unnamed = visits.filter(({ place }) => !place);
    const fallbacks = getFallbackVisitNames(
      unnamed.map(({ summary }) => summary),
      pack.place.fallbackName,
    );

    return {
      pack: pack.id,
      count: candidates.length,
      truncated,
      photos: found.length,
      visits: visits.map(({ index, summary, saved, candidates, place }): CollectionVisitResponse => {
        const { gps, ...rest } = summary;
        return {
          index,
          ...rest,
          ...(gps && { latitude: gps[0], longitude: gps[1] }),
          place: place ?? {
            name: fallbacks[unnamed.findIndex((visit) => visit.index === index)],
            source: 'fallback',
            confidence: 0,
            assetIds: [],
          },
          candidates: candidates.filter((candidate) => candidate !== place),
          saved,
        };
      }),
      warnings,
    };
  }

  /**
   * Reads the entries of a source photo. With `highResolution` (the default when OCR is enabled) the original is read
   * again in overlapping tiles at full resolution, since the stored OCR runs on a small preview and misses small or
   * thin print; the result is cached, not stored.
   */
  async readSource(
    auth: AuthDto,
    packId: string,
    id: string,
    { highResolution = true }: { highResolution?: boolean } = {},
  ): Promise<SourceReading> {
    const pack = this.requirePack(packId);
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });
    return this.getSourceReading(pack, id, highResolution);
  }

  /**
   * The page a pack typesets from the text of a source photo in books (see `CollectionPack.book.sourcePage`), e.g.
   * the ingredients and steps of a recipe of `place`, or the fields of a ticket, read at full resolution when OCR is
   * enabled (cached like `readSource`) and redacted; undefined for a pack without it. The caller checks access to the
   * photo.
   */
  async getSourcePage(packId: string, id: string, place: string): Promise<CollectionSourcePage | undefined> {
    const pack = getCollectionPack(packId);
    const asset = pack?.book.sourcePage ? await this.assetRepository.getById(id, { exifInfo: true }) : undefined;
    if (!pack?.book.sourcePage || !asset || asset.deletedAt) {
      return;
    }
    const stored = await this.ocrRepository.getByAssetId(id);
    let boxes: OcrBoxInput[] = stored;
    const { machineLearning } = await this.getConfig({ withCache: true });
    const exifInfo = asset.exifInfo;
    if (isOcrEnabled(machineLearning) && asset.type === AssetType.Image && exifInfo) {
      try {
        const detailed = await this.getDetailedOcr({ ...asset, exifInfo });
        boxes = chooseSourceOcr(stored, detailed) === 'tiles' ? detailed : stored;
      } catch (error) {
        this.logger.warn(`Unable to read ${pack.names.source} ${id} at full resolution: ${error}`);
      }
    }
    const { width, height } = exifInfo ? getDimensions(exifInfo) : { width: 0, height: 0 };
    const page = pack.book.sourcePage.read(boxes, { aspectRatio: width && height ? width / height : undefined, place });
    return page
      ? { text: redactText(pack, page.text), ...(page.entry && { entry: redactText(pack, page.entry) }) }
      : undefined;
  }

  /**
   * Images of a source photo for a reader: the preview, and with `zoom` the original cut in two (or four) overlapping
   * parts at a readable resolution, for small print, or with `focus` the part of the original where its entries are
   * (a bottle's label, see `getEntriesFocus`).
   */
  async getSourceImages(
    auth: AuthDto,
    id: string,
    { zoom = false, focus }: { zoom?: boolean; focus?: FocusRect } = {},
  ): Promise<Buffer[]> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });
    const asset = await this.assetRepository.getById(id, { exifInfo: true, files: true });
    if (!asset || asset.deletedAt) {
      throw new BadRequestException('Asset not found');
    }
    const previewPath = asset.files?.find((file) => file.type === AssetFileType.Preview)?.path;
    const images: Buffer[] = [];
    if (previewPath) {
      images.push(await this.mediaRepository.resizeToJpeg(previewPath, zoom ? 1024 : SOURCE_IMAGE_SIZE));
    }
    if (!zoom || asset.type !== AssetType.Image || !asset.exifInfo) {
      return images;
    }

    const { image } = await this.getConfig({ withCache: true });
    const decoded = await decodeOriginal(
      this.mediaRepository,
      { originalPath: asset.originalPath, originalFileName: asset.originalFileName, exifInfo: asset.exifInfo },
      image,
    );
    const { width, height } = decoded.info;
    const parts = focus
      ? [{ x: focus.x * width, y: focus.y * height, width: focus.width * width, height: focus.height * height }]
      : getOcrTiles(width, height, { tileSize: Math.max(width, height) / 2, overlap: 0.08 });
    if (parts.length === 0) {
      return images;
    }
    images.push(
      ...(await this.mediaRepository.getJpegCrops(decoded, parts, { maxSize: SOURCE_IMAGE_SIZE, quality: 85 })),
    );
    return images;
  }

  /**
   * The crops of where the entries are read on each photo, e.g. the label of each bottle of a pack whose subjects
   * carry their source, for a contact sheet the assistant can read; photos where nothing was read have none. The
   * readings are cached, so this reads again what `matchVisit` read.
   */
  async getEntryCrops(auth: AuthDto, packId: string, ids: string[], maxSize = 720): Promise<Map<string, Buffer>> {
    const pack = this.requirePack(packId);
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids });
    const { image } = await this.getConfig({ withCache: true });
    const crops = new Map<string, Buffer>();
    await mapLimit(unique(ids), 2, async (id) => {
      try {
        const reading = await this.getSourceReading(pack, id, true);
        const focus = getEntriesFocus(reading.items);
        const asset = focus ? await this.assetRepository.getById(id, { exifInfo: true }) : undefined;
        if (!focus || !asset || asset.type !== AssetType.Image || !asset.exifInfo) {
          return;
        }
        const decoded = await decodeOriginal(
          this.mediaRepository,
          { originalPath: asset.originalPath, originalFileName: asset.originalFileName, exifInfo: asset.exifInfo },
          image,
        );
        const { width, height } = decoded.info;
        const rect = {
          x: focus.x * width,
          y: focus.y * height,
          width: focus.width * width,
          height: focus.height * height,
        };
        const [crop] = await this.mediaRepository.getJpegCrops(decoded, [rect], { maxSize, quality: 85 });
        crops.set(id, crop);
      } catch (error) {
        this.logger.warn(`Unable to crop the ${pack.names.entry} of ${id}: ${error}`);
      }
    });
    return crops;
  }

  async matchVisit(auth: AuthDto, packId: string, dto: CollectionMatchDto): Promise<CollectionMatchResponseDto> {
    const pack = this.requirePack(packId);
    const messages = getCollectionMessages(pack);
    const subjectIds = unique(dto.subjectIds);
    const sourceIds = unique(dto.sourceIds ?? []).filter((id) => !subjectIds.includes(id));
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [...subjectIds, ...sourceIds] });

    const warnings: string[] = [];
    let entries: CollectionEntryResponse[];
    // where each entry is in the order of the source (e.g. the courses of a menu), and whether it has a price
    let courses: Array<Pick<EntryCandidate, 'course' | 'priced'>>;
    if (dto.entries && dto.entries.length > 0) {
      entries = dto.entries.map(({ name, description }, index) => {
        const text = description?.trim() ? redactText(pack, description.trim()) : undefined;
        return { index, name: redactText(pack, name.trim()), ...(text && { description: text }) };
      });
      // entries passed in are in the order they were read; the matcher only follows it when the photos do
      courses = entries.map((_, index) => ({ course: index }));
    } else {
      const readings = await mapLimit(sourceIds, 2, (id) => this.getSourceReading(pack, id, true));
      for (const reading of readings) {
        warnings.push(...reading.warnings);
      }
      const merged = mergeSourceEntries(await this.chooseReadings(pack, readings, subjectIds, warnings));
      entries = merged.map(({ sourceId, item }, index) => ({
        index,
        name: item.name,
        ...(item.description && { description: item.description }),
        ...(item.price && { price: item.price }),
        ...(item.section && { section: item.section }),
        sourceId,
      }));
      courses = merged.map(({ item, course }) => ({ course, priced: item.price !== undefined }));
    }
    // a pack whose subjects carry their source (a bottle's label) needs no other
    if (entries.length === 0 && (sourceIds.length > 0 || !pack.source.onSubjects)) {
      warnings.push(sourceIds.length > 0 ? messages.noEntriesRead : messages.noSource);
    }

    const { machineLearning } = await this.getConfig({ withCache: true });
    const rows = await this.assetJobRepository.getForAgent(subjectIds, auth.user.id);
    const stored = await this.searchRepository.getEmbeddings(rows.map(({ id }) => id));
    const embeddings = new Map(stored.map(({ assetId, embedding }) => [assetId, parseEmbedding(embedding)]));
    const photos = rows
      .filter((row) => embeddings.has(row.id))
      .map((row) => ({ id: row.id, time: row.localDateTime.getTime(), embedding: embeddings.get(row.id)! }));
    const noEmbedding = subjectIds.filter((id) => !embeddings.has(id));

    let entryEmbeddings: Float32Array[] = [];
    let baselines: Float32Array[] = [];
    if (!isSmartSearchEnabled(machineLearning)) {
      warnings.push(messages.cannotMatch);
    } else if (entries.length > 0 && photos.length > 0) {
      const entryTexts = await this.encodeTexts(entries.map((entry) => pack.source.prompt(entry)));
      const baselineTexts = await this.encodeTexts(pack.match.offListPrompts);
      entryEmbeddings = entryTexts.map((text) => parseEmbedding(text));
      baselines = baselineTexts.map((text) => parseEmbedding(text));
    }

    const {
      matches,
      ordered,
      entries: added = [],
    }: AssignResult = pack.match.assign
      ? await this.assignSubjects(pack, rows, embeddings, entries, courses, entryEmbeddings, baselines)
      : matchSubjects(
          photos,
          entryEmbeddings.length === entries.length
            ? entryEmbeddings.map((embedding, index) => ({ embedding, ...courses[index] }))
            : [],
          { ...pack.match.options, baselines },
        );
    // the entries the pack read on the subjects themselves, e.g. the label of each bottle
    for (const entry of added) {
      const description = entry.description ? redactText(pack, entry.description) : undefined;
      entries.push({
        index: entries.length,
        name: redactText(pack, entry.name),
        ...(description && { description }),
        ...(entry.sourceId && { sourceId: entry.sourceId }),
      });
    }
    if (pack.source.onSubjects && entries.length === 0 && matches.length > 0) {
      warnings.push(messages.noSource);
    }

    return {
      entries,
      ...(ordered && { ordered }),
      subjects: matches.map((match) => ({
        assetIds: match.ids,
        ...(match.item !== undefined && { index: match.item, name: entries[match.item].name }),
        score: match.score,
        unsure: match.unsure,
        ...(match.shared && { shared: true }),
        ...(match.offList !== undefined && { offList: match.offList }),
        suggestions: match.suggestions.map(({ item, score }) => ({ index: item, name: entries[item].name, score })),
      })),
      noEmbedding,
      warnings: unique(warnings),
    };
  }

  /**
   * The pack's own assignment of the subjects to the entries (e.g. by time, for the legs of a trip), with the text read
   * on the subject photos and the capture times of the source photos; photos without an embedding take part too
   */
  private async assignSubjects(
    pack: CollectionPack,
    rows: Array<{ id: string; localDateTime: Date }>,
    embeddings: Map<string, Float32Array>,
    entries: CollectionEntryResponse[],
    courses: Array<Pick<EntryCandidate, 'course' | 'priced'>>,
    entryEmbeddings: Float32Array[],
    baselines: Float32Array[],
  ) {
    const ocr = new Map<string, OcrBoxInput[]>();
    for (const chunk of chunks(rows.map(({ id }) => id))) {
      for (const { assetId, ...box } of await this.ocrRepository.getByAssetIds(chunk)) {
        ocr.set(assetId, [...(ocr.get(assetId) ?? []), box]);
      }
    }
    // the subjects that carry their source (a bottle's label) are read at full resolution, with the words only the
    // stored OCR has
    const boxes = pack.source.onSubjects
      ? new Map(
          await mapLimit(
            rows,
            2,
            async ({ id }) => [id, await this.getSubjectOcr(pack, id, ocr.get(id) ?? [])] as const,
          ),
        )
      : undefined;
    const sourceIds = unique(entries.flatMap(({ sourceId }) => (sourceId ? [sourceId] : [])));
    const sources = sourceIds.length > 0 ? await this.assetRepository.getByIds(sourceIds) : [];
    const sourceTimes = new Map(sources.map((source) => [source.id, source.localDateTime.getTime()]));
    return pack.match.assign!(
      rows.map((row) => ({
        id: row.id,
        time: row.localDateTime.getTime(),
        embedding: embeddings.get(row.id) ?? new Float32Array(0),
        ...(ocr.has(row.id) && {
          text: redactText(
            pack,
            ocr
              .get(row.id)!
              .map(({ text }) => text)
              .join('\n'),
          ),
        }),
        ...(boxes?.has(row.id) && { ocr: boxes.get(row.id)! }),
      })),
      entries.map((entry, index) => ({
        name: entry.name,
        ...(entry.description && { description: entry.description }),
        ...courses[index],
        ...(entryEmbeddings.length === entries.length && { embedding: entryEmbeddings[index] }),
        ...(entry.sourceId && sourceTimes.has(entry.sourceId) && { sourceTime: sourceTimes.get(entry.sourceId) }),
      })),
      { ...DEFAULT_MATCH_OPTIONS, ...pack.match.options, baselines, suggestions: 3 },
    );
  }

  /**
   * The OCR of a subject photo that carries its source (a bottle's label): the tiled full-resolution reading with the
   * words of the stored OCR it missed (see `combineSourceOcr`), cached like the sources; the stored OCR when OCR is
   * disabled, the photo is not an image, or the reading fails
   */
  private async getSubjectOcr(pack: CollectionPack, id: string, stored: OcrBoxInput[]): Promise<OcrBoxInput[]> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isOcrEnabled(machineLearning)) {
      return stored;
    }
    const asset = await this.assetRepository.getById(id, { exifInfo: true });
    const exifInfo = asset?.exifInfo;
    if (!asset || asset.deletedAt || asset.type !== AssetType.Image || !exifInfo) {
      return stored;
    }
    try {
      return combineSourceOcr(stored, await this.getDetailedOcr({ ...asset, exifInfo }));
    } catch (error) {
      this.logger.warn(`Unable to read ${pack.names.subject} ${id} at full resolution: ${error}`);
      return stored;
    }
  }

  /** Named places of the pack (e.g. restaurants) near a visit on OpenStreetMap, when the admin enabled the lookup */
  async lookupPlaces(auth: AuthDto, packId: string, input: PlaceLookupInput): Promise<NearbyPlaces> {
    const pack = this.requirePack(packId);
    const messages = getCollectionMessages(pack);
    const { food } = await this.getConfig({ withCache: true });
    if (!pack.place.lookup) {
      return {
        enabled: false,
        message: `The ${pack.names.place} of a ${pack.names.visit} is never looked up: ask the user for its name.`,
      };
    }
    if (!food.openStreetMap.enabled) {
      return { enabled: false, message: messages.lookupDisabled };
    }

    let latitude = input.latitude;
    let longitude = input.longitude;
    if ((latitude === undefined || longitude === undefined) && input.assetIds?.length) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: input.assetIds });
      const rows = await this.assetJobRepository.getForAgent(unique(input.assetIds), auth.user.id);
      const located = rows.filter(
        (row) =>
          typeof row.latitude === 'number' && typeof row.longitude === 'number' && (row.latitude || row.longitude),
      );
      if (located.length > 0) {
        latitude = located.reduce((sum, row) => sum + row.latitude!, 0) / located.length;
        longitude = located.reduce((sum, row) => sum + row.longitude!, 0) / located.length;
      }
    }
    if (latitude === undefined || longitude === undefined) {
      throw new BadRequestException(messages.noLocation);
    }

    const radius = input.radius ?? DEFAULT_LOOKUP_RADIUS;
    const point = { latitude, longitude };
    const { filters } = pack.place.lookup;
    const response = await this.mapRepository.queryOverpass(
      food.openStreetMap.overpassUrl,
      buildOverpassQuery(point, filters, radius),
    );
    return {
      enabled: true,
      latitude: roundCoordinate(latitude),
      longitude: roundCoordinate(longitude),
      radius,
      places: parseOverpassPlaces(response, point, filters).slice(0, 15),
    };
  }

  /**
   * Names the photos of a visit: each gets the tag `<Root>/<Place>/<Entry>` (or `<Root>/<Place>/<SourceLeaf>`),
   * replacing the tag of the pack it had, and a subject photo without a description gets the pack's description,
   * e.g. "Dish · Restaurant". Running it again with the same names changes nothing.
   */
  async saveEntries(auth: AuthDto, packId: string, dto: CollectionEntriesDto): Promise<CollectionEntriesResponseDto> {
    const pack = this.requirePack(packId);
    const rules = getCollectionTagRules(pack);
    const prefix = getTagPrefix(rules);
    const place = getTagPlaceName(rules, redactText(pack, dto.place));
    if (!/[\p{L}\d]/u.test(place)) {
      throw new BadRequestException(getCollectionMessages(pack).placeNeedsName);
    }

    const sourceLeaf = pack.sourceLeaf.toLowerCase();
    const byId = new Map<string, { entry?: string; source: boolean }>();
    for (const photo of dto.photos) {
      const entry = photo.entry?.trim();
      const source = photo.source === true || entry?.toLowerCase() === sourceLeaf;
      if (!source && !entry) {
        throw new BadRequestException(`Photo ${photo.id} needs an entry, or source: true`);
      }
      byId.set(photo.id, source ? { source } : { entry: redactText(pack, entry!), source });
    }
    const ids = byId.keys().toArray();
    if (ids.length > COLLECTION_LIMITS.photos) {
      throw new BadRequestException(`At most ${COLLECTION_LIMITS.photos} photos at once`);
    }

    const allowed = await this.checkAccess({ auth, permission: Permission.AssetUpdate, ids });
    const results = new Map<string, CollectionEntryResult>();
    const targets: string[] = [];
    for (const id of ids) {
      if (allowed.has(id)) {
        targets.push(id);
      } else {
        results.set(id, { id, success: false, error: 'no_permission' });
      }
    }

    const tagValues = new Map(
      targets.map((id) => {
        const { entry, source } = byId.get(id)!;
        return [id, source ? getSourceTag(rules, place) : getEntryTag(rules, place, entry!)];
      }),
    );
    const tags = await upsertTags(this.tagRepository, {
      userId: auth.user.id,
      tags: unique(tagValues.values().toArray()),
    });
    const tagIds = new Map(tags.map((tag) => [tag.value, tag.id]));

    // the tags of the pack the photos had: different ones are removed, so a photo has a single tag of the pack
    const assetTags = await this.tagRepository.getAssetTagsByPrefix(targets, prefix);
    const existing = assetTags.filter(({ value }) => parseCollectionTag(rules, value));
    const tagService = BaseService.create(TagService, this);
    const removals = new Map<string, string[]>();
    const previous = new Map<string, string[]>();
    for (const { assetId, tagId, value } of existing) {
      if (value === tagValues.get(assetId)) {
        continue;
      }
      removals.set(tagId, [...(removals.get(tagId) ?? []), assetId]);
      previous.set(assetId, [...(previous.get(assetId) ?? []), value]);
    }
    for (const [tagId, assetIds] of removals) {
      await tagService.removeAssets(auth, tagId, { ids: assetIds });
    }

    const additions = new Map<string, string[]>();
    for (const [id, value] of tagValues) {
      const tagId = tagIds.get(value)!;
      additions.set(tagId, [...(additions.get(tagId) ?? []), id]);
    }
    for (const [tagId, assetIds] of additions) {
      const added = await tagService.addAssets(auth, tagId, { ids: assetIds });
      for (const { id, success, error } of added) {
        if (!success && error !== 'duplicate') {
          results.set(id, { id, success: false, error: error ?? 'unknown' });
        }
      }
    }

    // descriptions: only set on subject photos that have none, or still have the one an earlier run wrote
    const rows = await this.assetJobRepository.getForAgent(targets, auth.user.id);
    const descriptions = new Map(rows.map((row) => [row.id, row.description ?? '']));
    const assetService = BaseService.create(AssetService, this);
    for (const id of targets) {
      if (results.has(id)) {
        continue;
      }
      const { entry, source } = byId.get(id)!;
      const result: CollectionEntryResult = {
        id,
        success: true,
        tag: tagValues.get(id),
        ...(previous.has(id) && { previousTags: previous.get(id) }),
      };
      if (!source) {
        const current = descriptions.get(id)?.trim() ?? '';
        const written = (previous.get(id) ?? []).flatMap((value) => {
          const tag = parseCollectionTag(rules, value);
          return tag?.kind === 'entry' ? [pack.describe(tag.entry, tag.place)] : [];
        });
        const description = pack.describe(entry!, place);
        if ((current === '' || written.includes(current)) && current !== description) {
          await assetService.update(auth, id, { description });
          result.description = description;
        }
      }
      results.set(id, result);
    }

    return { place, results: ids.map((id) => results.get(id)!) };
  }

  /**
   * The reading of each source that fits the subjects best, when its parser read more than one (the neighbouring
   * recipes of a cookbook page): the title the subject photos look most like, by CLIP (the mean of the best third of
   * the photos, as the finished dish looks more like it than the steps do)
   */
  private async chooseReadings(
    pack: CollectionPack,
    readings: SourceReading[],
    subjectIds: string[],
    warnings: string[],
  ): Promise<SourceReading[]> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (readings.every((reading) => !reading.alternatives?.length) || !isSmartSearchEnabled(machineLearning)) {
      return readings;
    }
    const stored = await this.searchRepository.getEmbeddings(subjectIds);
    const photos = stored.map(({ embedding }) => parseEmbedding(embedding));
    if (photos.length === 0) {
      return readings;
    }
    const titles = unique(
      readings.flatMap((reading) =>
        [reading, ...(reading.alternatives ?? [])].flatMap(({ title }) => (title ? [title] : [])),
      ),
    );
    const embeddings = await this.encodeTexts(titles.map((title) => getTitlePrompt(title)));
    const vectors = new Map(titles.map((title, index) => [title, parseEmbedding(embeddings[index])]));
    const fit = (title: string) => {
      const text = vectors.get(title)!;
      const similarities = photos
        .map((photo) => photo.reduce((sum, value, index) => sum + value * text[index], 0))
        .toSorted((a, b) => b - a);
      const best = similarities.slice(0, Math.max(1, Math.ceil(similarities.length / 3)));
      return best.reduce((sum, value) => sum + value, 0) / best.length;
    };
    return readings.map((reading) => {
      const chosen = chooseReading(reading, fit);
      if (chosen.alternatives?.length) {
        const others = chosen.alternatives.flatMap(({ title }) => (title ? [title] : []));
        warnings.push(
          `The ${pack.names.source} photo also shows ${others.join(', ')}: the ${pack.names.entries} of ` +
            `${chosen.title} fit the photos best`,
        );
      }
      return chosen;
    });
  }

  /**
   * The photos among `ids` that are sources of a pack that keeps them from the assistant (`privacy.sourceImages` off,
   * e.g. travel documents, which carry names and booking references): tagged as its sources, or read as one by their
   * text (the OCR stored for them, scored as the pack scores the text of its sources). Tools that return images leave
   * them out or blur them.
   */
  async getPrivateSourceIds(ids: string[]): Promise<Set<string>> {
    const packs = getCollectionPacks().filter((pack) => pack.privacy?.sourceImages === false);
    const found = new Set<string>();
    if (packs.length === 0 || ids.length === 0) {
      return found;
    }
    for (const pack of packs) {
      const rules = getCollectionTagRules(pack);
      for (const chunk of chunks(unique(ids))) {
        for (const { assetId, value } of await this.tagRepository.getAssetTagsByPrefix(chunk, getTagPrefix(rules))) {
          if (parseCollectionTag(rules, value)?.kind === 'source') {
            found.add(assetId);
          }
        }
      }
    }
    const rest = unique(ids).filter((id) => !found.has(id));
    const ocr = new Map<string, OcrBoxInput[]>();
    for (const chunk of chunks(rest)) {
      for (const { assetId, ...box } of await this.ocrRepository.getByAssetIds(chunk)) {
        ocr.set(assetId, [...(ocr.get(assetId) ?? []), box]);
      }
    }
    for (const [id, boxes] of ocr) {
      const isSource = packs.some((pack) => {
        const summary = summarizeText(boxes, {
          parse: pack.source.parse,
          receiptWords: pack.classify.receiptWords,
          placeWords: pack.place.words,
        });
        return (pack.classify.scoreText ?? scoreText)(summary).source >= pack.classify.thresholds.source;
      });
      if (isSource) {
        found.add(id);
      }
    }
    return found;
  }

  private redactPlaces<T extends { name: string }>(pack: CollectionPack, candidates: T[]): T[] {
    return pack.privacy?.redact
      ? candidates.map((candidate) => ({ ...candidate, name: redactText(pack, candidate.name) }))
      : candidates;
  }

  /**
   * The place each visit takes from the tags of the pack's linked packs (see `CollectionPack.place.linkedPacks`): the
   * place of most of their photos taken during the visit, e.g. the restaurant of the Food meal the wines were poured
   * at, as a tag (the name is already the user's); undefined for a visit without any
   */
  private async getLinkedPlaces(
    auth: AuthDto,
    pack: CollectionPack,
    groups: Array<Array<{ id: string; time: number }>>,
  ): Promise<Array<CollectionPlaceCandidate | undefined>> {
    const others = (pack.place.linkedPacks ?? []).flatMap((id) => getCollectionPack(id) ?? []);
    if (others.length === 0 || groups.length === 0) {
      return [];
    }
    // local times are within a day of the times the photos are searched by
    const day = 24 * 60 * 60 * 1000;
    const margin = day + LINKED_PLACE_MINUTES * 60_000;
    const ranges: Array<{ from: number; to: number }> = [];
    for (const group of groups.toSorted((a, b) => a[0].time - b[0].time)) {
      const from = group[0].time - margin;
      const to = group.at(-1)!.time + margin;
      const last = ranges.at(-1);
      if (last && from <= last.to) {
        last.to = Math.max(last.to, to);
      } else {
        ranges.push({ from, to });
      }
    }
    const pages = await mapLimit(ranges, 2, ({ from, to }) =>
      this.assetJobRepository.getForAgentEvents({
        userIds: [auth.user.id],
        viewingUserId: auth.user.id,
        takenAfter: new Date(from),
        takenBefore: new Date(to),
        limit: COLLECTION_LIMITS.candidates,
      }),
    );
    const times = new Map(pages.flat().map((row) => [row.id, row.localDateTime.getTime()]));
    const photos: LinkedPlacePhoto[] = [];
    for (const other of others) {
      const rules = getCollectionTagRules(other);
      for (const chunk of chunks(times.keys().toArray())) {
        for (const { assetId, value } of await this.tagRepository.getAssetTagsByPrefix(chunk, getTagPrefix(rules))) {
          const tag = parseCollectionTag(rules, value);
          if (tag) {
            photos.push({ id: assetId, time: times.get(assetId)!, place: tag.place });
          }
        }
      }
    }
    return groups.map((group) => {
      const place = findLinkedPlace({ start: group[0].time, end: group.at(-1)!.time }, photos);
      return place
        ? {
            name: redactText(pack, getTagPlaceName(getCollectionTagRules(pack), place.name)),
            source: 'tag',
            confidence: 0.9,
            assetIds: place.assetIds.slice(0, 20),
          }
        : undefined;
    });
  }

  private getTaggedPlace(saved: CollectionSavedEntry[]): CollectionPlaceCandidate | undefined {
    const counts = new Map<string, string[]>();
    for (const { place, assetId } of saved) {
      counts.set(place, [...(counts.get(place) ?? []), assetId]);
    }
    const [best] = [...counts].toSorted((a, b) => b[1].length - a[1].length);
    return best ? { name: best[0], source: 'tag', confidence: 1, assetIds: best[1] } : undefined;
  }

  private async getImageIds(assetIds: string[]) {
    const ids = new Set<string>();
    for (const chunk of chunks(assetIds)) {
      for (const asset of await this.assetRepository.getByIds(chunk)) {
        if (asset.type === AssetType.Image && !asset.deletedAt) {
          ids.add(asset.id);
        }
      }
    }
    return ids;
  }

  private async getSavedTags(pack: CollectionPack, assetIds: string[]): Promise<CollectionSavedEntry[]> {
    const rules = getCollectionTagRules(pack);
    const saved: CollectionSavedEntry[] = [];
    for (const chunk of chunks(assetIds)) {
      for (const { assetId, value } of await this.tagRepository.getAssetTagsByPrefix(chunk, getTagPrefix(rules))) {
        const tag = parseCollectionTag(rules, value);
        if (tag) {
          saved.push({
            assetId,
            place: tag.place,
            ...(tag.kind === 'entry' && { entry: tag.entry }),
            source: tag.kind === 'source',
          });
        }
      }
    }
    return saved;
  }

  private async getCandidates(auth: AuthDto, dto: CollectionVisitsDto) {
    if (!dto.albumId && !dto.assetIds?.length && !dto.takenAfter && !dto.takenBefore) {
      throw new BadRequestException('Give an album, photos or a date range');
    }

    if (dto.assetIds?.length) {
      const ids = unique(dto.assetIds);
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids });
      const rows = await this.assetJobRepository.getForAgent(ids, auth.user.id);
      const candidates: Candidate[] = rows
        .filter((row) => row.type === AssetType.Image)
        .map((row) => ({
          id: row.id,
          time: row.localDateTime.getTime(),
          latitude: row.latitude,
          longitude: row.longitude,
          city: row.city,
          country: row.country,
        }));
      return { candidates, truncated: false };
    }

    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    }
    const rows = await this.assetJobRepository.getForAgentEvents({
      userIds: dto.albumId ? undefined : [auth.user.id],
      viewingUserId: auth.user.id,
      albumId: dto.albumId,
      takenAfter: parseDate(dto.takenAfter),
      takenBefore: parseDate(dto.takenBefore),
      limit: COLLECTION_LIMITS.candidates + 1,
    });
    const candidates: Candidate[] = rows.slice(0, COLLECTION_LIMITS.candidates).map((row) => ({
      id: row.id,
      time: row.localDateTime.getTime(),
      latitude: row.latitude,
      longitude: row.longitude,
      city: row.city,
      country: row.country,
    }));
    return { candidates, truncated: rows.length > COLLECTION_LIMITS.candidates };
  }

  /** the kind of every candidate, from its CLIP embedding and its stored OCR */
  private async classify(pack: CollectionPack, candidates: Candidate[], warnings: string[]) {
    const ids = candidates.map(({ id }) => id);
    const { machineLearning } = await this.getConfig({ withCache: true });
    const messages = getCollectionMessages(pack);
    const prompts = getPrompts(pack);

    const similarities = new Map<string, number[]>();
    if (isSmartSearchEnabled(machineLearning)) {
      const embeddings = await this.encodeTexts(prompts.map(({ text }) => text));
      for (const chunk of chunks(ids)) {
        for (const row of await this.searchRepository.getEmbeddingSimilarities(chunk, embeddings)) {
          similarities.set(row.assetId, row.similarities);
        }
      }
    } else {
      warnings.push(messages.smartSearchDisabled);
    }
    if (!isOcrEnabled(machineLearning)) {
      warnings.push(messages.ocrDisabled);
    }

    const ocr = new Map<string, OcrBoxInput[]>();
    for (const chunk of chunks(ids)) {
      for (const { assetId, ...box } of await this.ocrRepository.getByAssetIds(chunk)) {
        ocr.set(assetId, [...(ocr.get(assetId) ?? []), box]);
      }
    }

    const textRules = {
      parse: pack.source.parse,
      receiptWords: pack.classify.receiptWords,
      placeWords: pack.place.words,
    };
    const classifications = new Map<string, Classification>();
    for (const id of ids) {
      const boxes = ocr.get(id);
      classifications.set(
        id,
        classifyPhoto(pack.classify, prompts, {
          similarities: similarities.get(id),
          ocr: boxes ? summarizeText(boxes, textRules) : undefined,
        }),
      );
    }

    return {
      classifications,
      ocr,
      noEmbedding: isSmartSearchEnabled(machineLearning) ? ids.filter((id) => !similarities.has(id)).length : 0,
    };
  }

  /** CLIP text embeddings (pgvector text) of the texts, cached by model */
  private async encodeTexts(texts: string[]) {
    const { machineLearning } = await this.getConfig({ withCache: true });
    const modelName = machineLearning.clip.modelName;
    return mapLimit(texts, 4, async (text) => {
      const key = `${modelName}\n${text}`;
      let embedding = textEmbeddingCache.get(key);
      if (!embedding) {
        embedding = await this.machineLearningRepository.encodeText(text, { modelName });
        textEmbeddingCache.set(key, embedding);
      }
      return embedding;
    });
  }

  private async getSourceReading(pack: CollectionPack, id: string, highResolution: boolean): Promise<SourceReading> {
    const messages = getCollectionMessages(pack);
    const asset = await this.assetRepository.getById(id, { exifInfo: true, files: true });
    if (!asset || asset.deletedAt) {
      throw new BadRequestException('Asset not found');
    }
    const previewPath =
      asset.files?.find((file) => file.type === AssetFileType.Preview && !file.isEdited)?.path ??
      asset.files?.find((file) => file.type === AssetFileType.Preview)?.path ??
      null;
    const { width, height } = asset.exifInfo ? getDimensions(asset.exifInfo) : { width: 0, height: 0 };
    const aspectRatio = width && height ? width / height : undefined;

    const warnings: string[] = [];
    const stored = await this.ocrRepository.getByAssetId(id);
    let boxes: OcrBoxInput[] = stored;
    let source: SourceReading['ocr'] = stored.length > 0 ? 'stored' : 'none';

    const { machineLearning } = await this.getConfig({ withCache: true });
    const exifInfo = asset.exifInfo;
    if (highResolution && isOcrEnabled(machineLearning) && asset.type === AssetType.Image && exifInfo) {
      try {
        const detailed = await this.getDetailedOcr({ ...asset, exifInfo });
        if (pack.source.onSubjects) {
          // a label: every word counts, the ones only the stored OCR read too
          boxes = combineSourceOcr(stored, detailed);
          source = 'tiles';
        } else if (chooseSourceOcr(stored, detailed) === 'tiles') {
          boxes = detailed;
          source = 'tiles';
        }
      } catch (error) {
        this.logger.warn(`Unable to read ${pack.names.source} ${id} at full resolution: ${error}`);
        warnings.push(messages.tilesFailed);
      }
    }

    const parsed = this.redactSource(pack, pack.source.parse(boxes, { aspectRatio }));
    if (parsed.items.length < (pack.source.minEntries ?? 3)) {
      warnings.push(messages.fewEntries);
    }
    // what the parser could not read, or found ambiguous
    warnings.push(...(parsed.warnings ?? []));
    return {
      ...parsed,
      assetId: id,
      ocr: source,
      place: this.redactPlaces(pack, findPlaceNames([{ assetId: id, kind: 'source', ocr: boxes }], pack.place)),
      warnings,
      previewPath,
      width,
      height,
    };
  }

  /** the text of a source reading as the pack lets it out: redacted, when it hides private text */
  private redactSource(pack: CollectionPack, parsed: ParsedSource): ParsedSource {
    if (!pack.privacy?.redact) {
      return parsed;
    }
    const redact = (text: string) => redactText(pack, text);
    return {
      ...parsed,
      items: parsed.items.map((item) => ({
        ...item,
        name: redact(item.name),
        ...(item.description !== undefined && { description: redact(item.description) }),
        ...(item.section !== undefined && { section: redact(item.section) }),
      })),
      ...(parsed.title !== undefined && { title: redact(parsed.title) }),
      sections: parsed.sections.map((section) => redact(section)),
      ...(parsed.warnings && { warnings: parsed.warnings.map((warning) => redact(warning)) }),
      ...(parsed.alternatives && {
        alternatives: parsed.alternatives.map((alternative) => this.redactSource(pack, alternative)),
      }),
    };
  }

  /** OCR of the original at full resolution: the whole photo and overlapping tiles, merged */
  private async getDetailedOcr(asset: {
    id: string;
    checksum: Buffer;
    originalPath: string;
    originalFileName: string;
    exifInfo: Parameters<typeof decodeOriginal>[1]['exifInfo'];
  }): Promise<OcrBoxInput[]> {
    const { machineLearning, image } = await this.getConfig({ withCache: true });
    const key = `${asset.id}:${asset.checksum.toString('hex')}:${machineLearning.ocr.modelName}`;
    const cached = sourceOcrCache.get(key);
    if (cached) {
      return cached;
    }

    const decoded = await decodeOriginal(
      this.mediaRepository,
      { originalPath: asset.originalPath, originalFileName: asset.originalFileName, exifInfo: asset.exifInfo },
      image,
    );
    const { width, height } = decoded.info;
    // very large photos are read as if they were SOURCE_DECODE_SIZE pixels wide: the tiles are scaled down to that
    const scale = Math.min(1, SOURCE_DECODE_SIZE / Math.max(width, height));
    const whole = { x: 0, y: 0, width, height };
    const tiles = getOcrTiles(width * scale, height * scale, { tileSize: SOURCE_TILE_SIZE }).map((tile) => ({
      x: tile.x / scale,
      y: tile.y / scale,
      width: tile.width / scale,
      height: tile.height / scale,
    }));

    const passes: OcrPass[] = [];
    const read = async (rect: PixelRect, maxSize: number, maxResolution: number) => {
      const [jpeg] = await this.mediaRepository.getJpegCrops(decoded, [rect], { maxSize });
      const fit = Math.min(1, maxSize / Math.max(rect.width, rect.height));
      const shortSide = Math.round(Math.min(rect.width, rect.height) * fit);
      const output = await this.machineLearningRepository.ocr(jpeg, {
        ...machineLearning.ocr,
        // thin print reads with less confidence; the parsers still drop what is below MIN_TEXT_SCORE
        minRecognitionScore: Math.min(machineLearning.ocr.minRecognitionScore, SOURCE_MIN_RECOGNITION_SCORE),
        maxResolution: Math.max(machineLearning.ocr.maxResolution, Math.min(maxResolution, shortSide)),
      });
      passes.push({ rect, output });
    };

    // one pass at a time: each tile is a full detection at a high resolution
    await read(whole, SOURCE_WHOLE_SIZE, SOURCE_WHOLE_RESOLUTION);
    for (const tile of tiles) {
      await read(tile, Math.ceil(SOURCE_TILE_SIZE * (1 + DEFAULT_TILE_OVERLAP)), SOURCE_TILE_SIZE);
    }

    const merged = mergeOcrPasses(width, height, passes);
    sourceOcrCache.set(key, merged);
    return merged;
  }
}
