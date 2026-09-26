import { BadRequestException, Injectable } from '@nestjs/common';
import { LRUMap } from 'mnemonist';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  FOOD_LIMITS,
  FoodDishResult,
  FoodDishesDto,
  FoodDishesResponseDto,
  FoodMatchDto,
  FoodMatchResponseDto,
  FoodMealResponse,
  FoodMealsDto,
  FoodMealsResponseDto,
  FoodMenuItemResponse,
  FoodRestaurantCandidate,
} from 'src/dtos/food.dto.js';
import { AssetFileType, AssetType, Permission } from 'src/enum.js';
import { AssetService } from 'src/services/asset.service.js';
import { BaseService } from 'src/services/base.service.js';
import { TagService } from 'src/services/tag.service.js';
import { parseEmbedding } from 'src/utils/agent/clustering.js';
import { getDimensions } from 'src/utils/asset.util.js';
import { FOOD_PROMPT_LIST, FoodClassification, classifyFood, summarizeOcr } from 'src/utils/food/classify.js';
import { MatchOptions, matchDishes } from 'src/utils/food/match.js';
import { MealOptions, getFallbackMealNames, groupMeals, summarizeMeal } from 'src/utils/food/meals.js';
import { ParsedMenu, parseMenu } from 'src/utils/food/menu.js';
import { OcrBoxInput } from 'src/utils/food/ocr.js';
import {
  DEFAULT_LOOKUP_RADIUS,
  NearbyPlace,
  buildOverpassQuery,
  parseOverpassPlaces,
} from 'src/utils/food/overpass.js';
import { RestaurantPhoto, findRestaurantNames } from 'src/utils/food/restaurant.js';
import {
  FOOD_TAG_ROOT,
  getDishDescription,
  getDishTag,
  getMenuTag,
  getRestaurantTag,
  parseFoodTag,
} from 'src/utils/food/tags.js';
import { DEFAULT_TILE_OVERLAP, OcrPass, PixelRect, getOcrTiles, mergeOcrPasses } from 'src/utils/food/tiles.js';
import { decodeOriginal } from 'src/utils/image-decode.js';
import { isOcrEnabled, isSmartSearchEnabled } from 'src/utils/misc.js';
import { upsertTags } from 'src/utils/tag.js';

/** CLIP text embeddings of the classification prompts and menu items, by model and text */
const textEmbeddingCache = new LRUMap<string, string>(5000);
/** high-resolution OCR of menu photos, by asset and checksum; never written over the stored OCR */
const menuOcrCache = new LRUMap<string, OcrBoxInput[]>(200);

/** texts for dishes that are usually not on a menu; the best of them competes with the items as "not on the menu" */
export const OFF_MENU_PROMPTS = [
  'a photo of food',
  'a photo of a bread basket with butter',
  'a photo of a cup of coffee',
  'a photo of a small amuse-bouche',
  'a photo of chocolates and petits fours',
];

const CHUNK = 1000;
/** a menu is read in tiles as if its long edge were at most this many pixels */
const MENU_DECODE_SIZE = 4096;
/** the size of the tiles the menu is read in */
const MENU_TILE_SIZE = 1600;
/** the whole menu is read too, for text across the tiles: at most this large, with detection at this short edge */
const MENU_WHOLE_SIZE = 2048;
const MENU_WHOLE_RESOLUTION = 1280;
const MENU_MIN_RECOGNITION_SCORE = 0.6;
/** the long edge of the menu images returned to a reader */
const MENU_IMAGE_SIZE = 1440;

export const itemPrompt = (item: { name: string; description?: string }) => {
  const text = item.description ? `${item.name}: ${item.description}` : item.name;
  return `a photo of ${text.length > 200 ? text.slice(0, 200) : text}`;
};

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

const normalizeName = (name: string) =>
  name
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^\p{L}\d]/gu, '');

type FoodCandidate = {
  id: string;
  time: number;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  country: string | null;
};

export type MenuReading = ParsedMenu & {
  assetId: string;
  /** where the text was read: tiles of the original at full resolution, or the OCR stored for the photo */
  ocr: 'tiles' | 'stored' | 'none';
  restaurant: FoodRestaurantCandidate[];
  warnings: string[];
  previewPath: string | null;
  width: number;
  height: number;
};

export type NearbyRestaurants =
  | { enabled: false; message: string }
  | { enabled: true; latitude: number; longitude: number; radius: number; places: NearbyPlace[] };

/** Food photos: finds meals, reads menus, matches dishes with menu items and names them with food tags. */
@Injectable()
export class FoodService extends BaseService {
  async findMeals(auth: AuthDto, dto: FoodMealsDto): Promise<FoodMealsResponseDto> {
    const { candidates, truncated } = await this.getCandidates(auth, dto);
    const warnings: string[] = [];
    const { classifications, ocr, noEmbedding } = await this.classify(candidates, warnings);
    if (noEmbedding > 0 && noEmbedding < candidates.length) {
      warnings.push(`${noEmbedding} photos have not been through smart search yet and can only be found by their text`);
    }

    const classified = candidates.flatMap((candidate) => {
      const classification = classifications.get(candidate.id);
      return classification && classification.kind !== 'other' ? [{ ...candidate, kind: classification.kind }] : [];
    });
    // videos have embeddings of their thumbnail too, but only photos are named
    const images = await this.getImageIds(classified.map(({ id }) => id));
    const food = classified.filter(({ id }) => images.has(id));

    const options: Partial<MealOptions> = {
      ...(dto.maxGapMinutes !== undefined && { maxGapMinutes: dto.maxGapMinutes }),
      ...(dto.maxDistanceMeters !== undefined && { maxDistanceMeters: dto.maxDistanceMeters }),
    };
    const groups = groupMeals(food, options);
    const saved = await this.getSavedTags(groups.flat().map(({ id }) => id));

    const meals = groups.map((group, index) => {
      const summary = summarizeMeal(group);
      const ids = new Set(group.map(({ id }) => id));
      const mealSaved = saved.filter(({ assetId }) => ids.has(assetId));
      const photos: RestaurantPhoto[] = group.flatMap((photo) =>
        photo.kind === 'dish' || !ocr.has(photo.id)
          ? []
          : [{ assetId: photo.id, kind: photo.kind, ocr: ocr.get(photo.id)! }],
      );
      const candidates = findRestaurantNames(photos);
      const tagged = this.getTaggedRestaurant(mealSaved);
      return { index, summary, saved: mealSaved, candidates, restaurant: tagged ?? candidates[0] };
    });

    const unnamed = meals.filter(({ restaurant }) => !restaurant);
    const fallbacks = getFallbackMealNames(unnamed.map(({ summary }) => summary));

    return {
      count: candidates.length,
      truncated,
      foodPhotos: food.length,
      meals: meals.map(({ index, summary, saved, candidates, restaurant }): FoodMealResponse => {
        const { gps, ...rest } = summary;
        return {
          index,
          ...rest,
          ...(gps && { latitude: gps[0], longitude: gps[1] }),
          restaurant: restaurant ?? {
            name: fallbacks[unnamed.findIndex((meal) => meal.index === index)],
            source: 'fallback',
            confidence: 0,
            assetIds: [],
          },
          candidates: candidates.filter((candidate) => candidate !== restaurant),
          saved,
        };
      }),
      warnings,
    };
  }

  /**
   * Reads the items of a menu photo. With `highResolution` (the default when OCR is enabled) the original is read
   * again in overlapping tiles at full resolution, since the stored OCR runs on a small preview and misses small or
   * thin print; the result is cached, not stored.
   */
  async readMenu(auth: AuthDto, id: string, { highResolution = true }: { highResolution?: boolean } = {}) {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });
    return this.getMenuReading(id, highResolution);
  }

  /**
   * Images of a menu photo for a reader: the preview, and with `zoom` the original cut in two (or four) overlapping
   * parts at a readable resolution, for small print.
   */
  async getMenuImages(auth: AuthDto, id: string, { zoom = false }: { zoom?: boolean } = {}): Promise<Buffer[]> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });
    const asset = await this.assetRepository.getById(id, { exifInfo: true, files: true });
    if (!asset || asset.deletedAt) {
      throw new BadRequestException('Asset not found');
    }
    const previewPath = asset.files?.find((file) => file.type === AssetFileType.Preview)?.path;
    const images: Buffer[] = [];
    if (previewPath) {
      images.push(await this.mediaRepository.resizeToJpeg(previewPath, zoom ? 1024 : MENU_IMAGE_SIZE));
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
    const parts = getOcrTiles(width, height, { tileSize: Math.max(width, height) / 2, overlap: 0.08 });
    if (parts.length === 0) {
      return images;
    }
    images.push(
      ...(await this.mediaRepository.getJpegCrops(decoded, parts, { maxSize: MENU_IMAGE_SIZE, quality: 85 })),
    );
    return images;
  }

  async matchMeal(auth: AuthDto, dto: FoodMatchDto): Promise<FoodMatchResponseDto> {
    const dishIds = unique(dto.dishIds);
    const menuIds = unique(dto.menuIds ?? []).filter((id) => !dishIds.includes(id));
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [...dishIds, ...menuIds] });

    const warnings: string[] = [];
    let items: FoodMenuItemResponse[];
    if (dto.items && dto.items.length > 0) {
      items = dto.items.map(({ name, description }, index) => ({
        index,
        name: name.trim(),
        ...(description?.trim() && { description: description.trim() }),
      }));
    } else {
      const readings = await mapLimit(menuIds, 2, (id) => this.getMenuReading(id, true));
      const seen = new Set<string>();
      items = [];
      for (const reading of readings) {
        warnings.push(...reading.warnings);
        for (const item of reading.items) {
          const key = normalizeName(item.name);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          items.push({
            index: items.length,
            name: item.name,
            ...(item.description && { description: item.description }),
            ...(item.price && { price: item.price }),
            ...(item.section && { section: item.section }),
            menuId: reading.assetId,
          });
        }
      }
    }
    if (items.length === 0) {
      warnings.push(
        menuIds.length > 0
          ? 'No menu items could be read: look at the menu yourself and pass its items, or name the dishes from what you see'
          : 'No menu: name the dishes from what you see',
      );
    }

    const { machineLearning } = await this.getConfig({ withCache: true });
    const rows = await this.assetJobRepository.getForAgent(dishIds, auth.user.id);
    const stored = await this.searchRepository.getEmbeddings(rows.map(({ id }) => id));
    const embeddings = new Map(stored.map(({ assetId, embedding }) => [assetId, parseEmbedding(embedding)]));
    const photos = rows
      .filter((row) => embeddings.has(row.id))
      .map((row) => ({ id: row.id, time: row.localDateTime.getTime(), embedding: embeddings.get(row.id)! }));
    const noEmbedding = dishIds.filter((id) => !embeddings.has(id));

    let itemEmbeddings: Float32Array[] = [];
    let baselines: Float32Array[] = [];
    if (!isSmartSearchEnabled(machineLearning)) {
      warnings.push('Smart search is disabled, so dishes cannot be matched with menu items');
    } else if (items.length > 0 && photos.length > 0) {
      const itemTexts = await this.encodeTexts(items.map((item) => itemPrompt(item)));
      const baselineTexts = await this.encodeTexts(OFF_MENU_PROMPTS);
      itemEmbeddings = itemTexts.map((text) => parseEmbedding(text));
      baselines = baselineTexts.map((text) => parseEmbedding(text));
    }

    const matches = matchDishes(
      photos,
      itemEmbeddings.length === items.length ? itemEmbeddings.map((embedding) => ({ embedding })) : [],
      { baselines } satisfies Partial<MatchOptions> & { baselines: Float32Array[] },
    );

    return {
      items,
      dishes: matches.map((match) => ({
        assetIds: match.ids,
        ...(match.item !== undefined && { index: match.item, name: items[match.item].name }),
        score: match.score,
        unsure: match.unsure,
        ...(match.shared && { shared: true }),
        ...(match.offMenu !== undefined && { offMenu: match.offMenu }),
        suggestions: match.suggestions.map(({ item, score }) => ({ index: item, name: items[item].name, score })),
      })),
      noEmbedding,
      warnings: unique(warnings),
    };
  }

  /** Named restaurants, cafés and bars near a meal on OpenStreetMap, when the admin enabled the lookup */
  async lookupRestaurants(
    auth: AuthDto,
    input: { assetIds?: string[]; latitude?: number; longitude?: number; radius?: number },
  ): Promise<NearbyRestaurants> {
    const { food } = await this.getConfig({ withCache: true });
    if (!food.openStreetMap.enabled) {
      return {
        enabled: false,
        message:
          'The OpenStreetMap lookup is disabled in the server settings (Food > OpenStreetMap). Ask the user for the name of the restaurant instead.',
      };
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
      throw new BadRequestException('The photos have no location: ask the user for the name of the restaurant');
    }

    const radius = input.radius ?? DEFAULT_LOOKUP_RADIUS;
    const point = { latitude, longitude };
    const response = await this.mapRepository.queryOverpass(
      food.openStreetMap.overpassUrl,
      buildOverpassQuery(point, radius),
    );
    return {
      enabled: true,
      latitude: roundCoordinate(latitude),
      longitude: roundCoordinate(longitude),
      radius,
      places: parseOverpassPlaces(response, point).slice(0, 15),
    };
  }

  /**
   * Names food photos: each gets the tag `Food/<Restaurant>/<Dish>` (or `Food/<Restaurant>/Menu`), replacing the
   * food tag it had, and a dish photo without a description gets "Dish · Restaurant". Running it again with the same
   * names changes nothing.
   */
  async setDishNames(auth: AuthDto, dto: FoodDishesDto): Promise<FoodDishesResponseDto> {
    const restaurant = getRestaurantTag(dto.restaurant).slice(FOOD_TAG_ROOT.length + 1);
    if (!restaurant) {
      throw new BadRequestException('The restaurant needs a name');
    }

    const byId = new Map<string, { dish?: string; menu: boolean }>();
    for (const photo of dto.photos) {
      const dish = photo.dish?.trim();
      const menu = photo.menu === true || dish?.toLowerCase() === 'menu';
      if (!menu && !dish) {
        throw new BadRequestException(`Photo ${photo.id} needs a dish name, or menu: true`);
      }
      byId.set(photo.id, menu ? { menu } : { dish, menu });
    }
    const ids = byId.keys().toArray();
    if (ids.length > FOOD_LIMITS.photos) {
      throw new BadRequestException(`At most ${FOOD_LIMITS.photos} photos at once`);
    }

    const allowed = await this.checkAccess({ auth, permission: Permission.AssetUpdate, ids });
    const results = new Map<string, FoodDishResult>();
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
        const { dish, menu } = byId.get(id)!;
        return [id, menu ? getMenuTag(restaurant) : getDishTag(restaurant, dish!)];
      }),
    );
    const tags = await upsertTags(this.tagRepository, {
      userId: auth.user.id,
      tags: unique(tagValues.values().toArray()),
    });
    const tagIds = new Map(tags.map((tag) => [tag.value, tag.id]));

    // the food tags the photos had: different ones are removed, so a photo has a single food tag
    const assetTags = await this.tagRepository.getAssetTagsByPrefix(targets, `${FOOD_TAG_ROOT}/`);
    const existing = assetTags.filter(({ value }) => parseFoodTag(value));
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

    // descriptions: only set on dish photos that have none, or still have the one an earlier run wrote
    const rows = await this.assetJobRepository.getForAgent(targets, auth.user.id);
    const descriptions = new Map(rows.map((row) => [row.id, row.description ?? '']));
    const assetService = BaseService.create(AssetService, this);
    for (const id of targets) {
      if (results.has(id)) {
        continue;
      }
      const { dish, menu } = byId.get(id)!;
      const result: FoodDishResult = {
        id,
        success: true,
        tag: tagValues.get(id),
        ...(previous.has(id) && { previousTags: previous.get(id) }),
      };
      if (!menu) {
        const current = descriptions.get(id)?.trim() ?? '';
        const written = (previous.get(id) ?? []).flatMap((value) => {
          const tag = parseFoodTag(value);
          return tag?.kind === 'dish' ? [getDishDescription(tag.restaurant, tag.dish)] : [];
        });
        const description = getDishDescription(restaurant, dish!);
        if ((current === '' || written.includes(current)) && current !== description) {
          await assetService.update(auth, id, { description });
          result.description = description;
        }
      }
      results.set(id, result);
    }

    return { restaurant, results: ids.map((id) => results.get(id)!) };
  }

  private getTaggedRestaurant(saved: FoodMealResponse['saved']): FoodRestaurantCandidate | undefined {
    const counts = new Map<string, string[]>();
    for (const { restaurant, assetId } of saved) {
      counts.set(restaurant, [...(counts.get(restaurant) ?? []), assetId]);
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

  private async getSavedTags(assetIds: string[]): Promise<FoodMealResponse['saved']> {
    const saved: FoodMealResponse['saved'] = [];
    for (const chunk of chunks(assetIds)) {
      for (const { assetId, value } of await this.tagRepository.getAssetTagsByPrefix(chunk, `${FOOD_TAG_ROOT}/`)) {
        const tag = parseFoodTag(value);
        if (tag) {
          saved.push({
            assetId,
            restaurant: tag.restaurant,
            ...(tag.kind === 'dish' && { dish: tag.dish }),
            menu: tag.kind === 'menu',
          });
        }
      }
    }
    return saved;
  }

  private async getCandidates(auth: AuthDto, dto: FoodMealsDto) {
    if (!dto.albumId && !dto.assetIds?.length && !dto.takenAfter && !dto.takenBefore) {
      throw new BadRequestException('Give an album, photos or a date range');
    }

    if (dto.assetIds?.length) {
      const ids = unique(dto.assetIds);
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids });
      const rows = await this.assetJobRepository.getForAgent(ids, auth.user.id);
      const candidates: FoodCandidate[] = rows
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
      limit: FOOD_LIMITS.candidates + 1,
    });
    const candidates: FoodCandidate[] = rows.slice(0, FOOD_LIMITS.candidates).map((row) => ({
      id: row.id,
      time: row.localDateTime.getTime(),
      latitude: row.latitude,
      longitude: row.longitude,
      city: row.city,
      country: row.country,
    }));
    return { candidates, truncated: rows.length > FOOD_LIMITS.candidates };
  }

  /** the kind of every candidate, from its CLIP embedding and its stored OCR */
  private async classify(candidates: FoodCandidate[], warnings: string[]) {
    const ids = candidates.map(({ id }) => id);
    const { machineLearning } = await this.getConfig({ withCache: true });

    const similarities = new Map<string, number[]>();
    if (isSmartSearchEnabled(machineLearning)) {
      const prompts = await this.encodeTexts(FOOD_PROMPT_LIST.map(({ text }) => text));
      for (const chunk of chunks(ids)) {
        for (const row of await this.searchRepository.getEmbeddingSimilarities(chunk, prompts)) {
          similarities.set(row.assetId, row.similarities);
        }
      }
    } else {
      warnings.push(
        'Smart search is disabled: dishes cannot be recognized, only menus, signs and receipts by their text',
      );
    }
    if (!isOcrEnabled(machineLearning)) {
      warnings.push('OCR is disabled: menus, signs and receipts are recognized by their look only');
    }

    const ocr = new Map<string, OcrBoxInput[]>();
    for (const chunk of chunks(ids)) {
      for (const { assetId, ...box } of await this.ocrRepository.getByAssetIds(chunk)) {
        ocr.set(assetId, [...(ocr.get(assetId) ?? []), box]);
      }
    }

    const classifications = new Map<string, FoodClassification>();
    for (const id of ids) {
      const boxes = ocr.get(id);
      classifications.set(
        id,
        classifyFood({ similarities: similarities.get(id), ocr: boxes ? summarizeOcr(boxes) : undefined }),
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

  private async getMenuReading(id: string, highResolution: boolean): Promise<MenuReading> {
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
    let source: MenuReading['ocr'] = stored.length > 0 ? 'stored' : 'none';

    const { machineLearning } = await this.getConfig({ withCache: true });
    const exifInfo = asset.exifInfo;
    if (highResolution && isOcrEnabled(machineLearning) && asset.type === AssetType.Image && exifInfo) {
      try {
        const detailed = await this.getDetailedOcr({ ...asset, exifInfo });
        // keep the stored reading when the tiles somehow read less
        if (parseMenu(detailed, { aspectRatio }).items.length >= parseMenu(stored, { aspectRatio }).items.length) {
          boxes = detailed;
          source = 'tiles';
        }
      } catch (error) {
        this.logger.warn(`Unable to read menu ${id} at full resolution: ${error}`);
        warnings.push('The menu could not be read at full resolution; the items come from the stored OCR');
      }
    }

    const menu = parseMenu(boxes, { aspectRatio });
    if (menu.items.length < 3) {
      warnings.push('Few menu items could be read: look at the menu image and read the items yourself');
    }
    return {
      ...menu,
      assetId: id,
      ocr: source,
      restaurant: findRestaurantNames([{ assetId: id, kind: 'menu', ocr: boxes }]),
      warnings,
      previewPath,
      width,
      height,
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
    const cached = menuOcrCache.get(key);
    if (cached) {
      return cached;
    }

    const decoded = await decodeOriginal(
      this.mediaRepository,
      { originalPath: asset.originalPath, originalFileName: asset.originalFileName, exifInfo: asset.exifInfo },
      image,
    );
    const { width, height } = decoded.info;
    // very large photos are read as if they were MENU_DECODE_SIZE pixels wide: the tiles are scaled down to that
    const scale = Math.min(1, MENU_DECODE_SIZE / Math.max(width, height));
    const whole = { x: 0, y: 0, width, height };
    const tiles = getOcrTiles(width * scale, height * scale, { tileSize: MENU_TILE_SIZE }).map((tile) => ({
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
        // thin print reads with less confidence; the menu parser still drops what is below MIN_TEXT_SCORE
        minRecognitionScore: Math.min(machineLearning.ocr.minRecognitionScore, MENU_MIN_RECOGNITION_SCORE),
        maxResolution: Math.max(machineLearning.ocr.maxResolution, Math.min(maxResolution, shortSide)),
      });
      passes.push({ rect, output });
    };

    // one pass at a time: each tile is a full detection at a high resolution
    await read(whole, MENU_WHOLE_SIZE, MENU_WHOLE_RESOLUTION);
    for (const tile of tiles) {
      await read(tile, Math.ceil(MENU_TILE_SIZE * (1 + DEFAULT_TILE_OVERLAP)), MENU_TILE_SIZE);
    }

    const merged = mergeOcrPasses(width, height, passes);
    menuOcrCache.set(key, merged);
    return merged;
  }
}
