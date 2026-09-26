import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { CollectionPlaceCandidate } from 'src/dtos/collection.dto.js';
import {
  FOOD_LIMITS,
  FoodDishesDto,
  FoodDishesResponseDto,
  FoodMatchDto,
  FoodMatchResponseDto,
  FoodMealResponse,
  FoodMealsDto,
  FoodMealsResponseDto,
  FoodRestaurantCandidate,
} from 'src/dtos/food.dto.js';
import { BaseService } from 'src/services/base.service.js';
import { CollectionService, NearbyPlaces, PlaceLookupInput, SourceReading } from 'src/services/collection.service.js';
import { NearbyPlace } from 'src/utils/collections/overpass.js';
import { getCollectionTagRules } from 'src/utils/collections/pack.js';
import { MealType, foodPack } from 'src/utils/collections/packs/food/pack.js';
import { PlaceCandidate } from 'src/utils/collections/place.js';
import { getTagPlaceName } from 'src/utils/collections/tags.js';

const FOOD = foodPack.id;
const FOOD_TAGS = getCollectionTagRules(foodPack);

/** a place name as the food API names where it was read: the menu is the source of a meal */
const toRestaurant = <T extends { source: PlaceCandidate['source'] | CollectionPlaceCandidate['source'] }>(
  candidate: T,
) => ({ ...candidate, source: candidate.source === 'source' ? ('menu' as const) : candidate.source });

export type MenuReading = Omit<SourceReading, 'place'> & {
  restaurant: Array<Omit<PlaceCandidate, 'source'> & { source: 'sign' | 'menu' | 'receipt' }>;
};

export type NearbyRestaurants =
  | { enabled: false; message: string }
  | {
      enabled: true;
      latitude: number;
      longitude: number;
      radius: number;
      places: Array<Omit<NearbyPlace, 'type'> & { amenity: string }>;
    };

/**
 * Food photos: finds meals, reads menus, matches dishes with menu items and names them with food tags. The food API
 * of the collections engine (see `CollectionService`) with the food pack, in the words of food: meals, dishes, menus
 * and restaurants.
 */
@Injectable()
export class FoodService extends BaseService {
  private get collections() {
    return BaseService.create(CollectionService, this);
  }

  async findMeals(auth: AuthDto, dto: FoodMealsDto): Promise<FoodMealsResponseDto> {
    const result = await this.collections.findVisits(auth, FOOD, dto);
    return {
      count: result.count,
      truncated: result.truncated,
      foodPhotos: result.photos,
      meals: result.visits.map((visit): FoodMealResponse => ({
        index: visit.index,
        start: visit.start,
        end: visit.end,
        day: visit.day,
        type: visit.type as MealType,
        ...(visit.city && { city: visit.city }),
        ...(visit.country && { country: visit.country }),
        dishIds: visit.subjectIds,
        menuIds: visit.sourceIds,
        signIds: visit.signIds,
        receiptIds: visit.receiptIds,
        ...(visit.latitude !== undefined && { latitude: visit.latitude, longitude: visit.longitude }),
        restaurant: toRestaurant(visit.place) as FoodRestaurantCandidate,
        candidates: visit.candidates.map((candidate) => toRestaurant(candidate) as FoodRestaurantCandidate),
        saved: visit.saved.map(({ assetId, place, entry, source }) => ({
          assetId,
          restaurant: place,
          ...(entry !== undefined && { dish: entry }),
          menu: source,
        })),
      })),
      warnings: result.warnings,
    };
  }

  /**
   * Reads the items of a menu photo. With `highResolution` (the default when OCR is enabled) the original is read
   * again in overlapping tiles at full resolution, since the stored OCR runs on a small preview and misses small or
   * thin print; the result is cached, not stored.
   */
  async readMenu(auth: AuthDto, id: string, options: { highResolution?: boolean } = {}): Promise<MenuReading> {
    const { place, ...reading } = await this.collections.readSource(auth, FOOD, id, options);
    return { ...reading, restaurant: place.map((candidate) => toRestaurant(candidate)) };
  }

  /**
   * Images of a menu photo for a reader: the preview, and with `zoom` the original cut in two (or four) overlapping
   * parts at a readable resolution, for small print.
   */
  getMenuImages(auth: AuthDto, id: string, options: { zoom?: boolean } = {}): Promise<Buffer[]> {
    return this.collections.getSourceImages(auth, id, options);
  }

  async matchMeal(auth: AuthDto, dto: FoodMatchDto): Promise<FoodMatchResponseDto> {
    const result = await this.collections.matchVisit(auth, FOOD, {
      subjectIds: dto.dishIds,
      sourceIds: dto.menuIds,
      entries: dto.items,
    });
    return {
      items: result.entries.map(({ sourceId, ...entry }) => ({ ...entry, ...(sourceId && { menuId: sourceId }) })),
      ...(result.ordered && { ordered: result.ordered }),
      dishes: result.subjects.map(({ offList, suggestions, ...subject }) => ({
        ...subject,
        ...(offList !== undefined && { offMenu: offList }),
        suggestions,
      })),
      noEmbedding: result.noEmbedding,
      warnings: result.warnings,
    };
  }

  /** Named restaurants, cafés and bars near a meal on OpenStreetMap, when the admin enabled the lookup */
  async lookupRestaurants(auth: AuthDto, input: PlaceLookupInput): Promise<NearbyRestaurants> {
    const result: NearbyPlaces = await this.collections.lookupPlaces(auth, FOOD, input);
    if (!result.enabled) {
      return result;
    }
    return {
      ...result,
      places: result.places.map(({ type, name, ...place }) => ({ name, amenity: type, ...place })),
    };
  }

  /**
   * Names food photos: each gets the tag `Food/<Restaurant>/<Dish>` (or `Food/<Restaurant>/Menu`), replacing the
   * food tag it had, and a dish photo without a description gets "Dish · Restaurant". Running it again with the same
   * names changes nothing.
   */
  async setDishNames(auth: AuthDto, dto: FoodDishesDto): Promise<FoodDishesResponseDto> {
    if (!/[\p{L}\d]/u.test(getTagPlaceName(FOOD_TAGS, dto.restaurant))) {
      throw new BadRequestException('The restaurant needs a name');
    }
    for (const photo of dto.photos) {
      if (photo.menu !== true && !photo.dish?.trim()) {
        throw new BadRequestException(`Photo ${photo.id} needs a dish name, or menu: true`);
      }
    }
    if (new Set(dto.photos.map(({ id }) => id)).size > FOOD_LIMITS.photos) {
      throw new BadRequestException(`At most ${FOOD_LIMITS.photos} photos at once`);
    }
    const { place, results } = await this.collections.saveEntries(auth, FOOD, {
      place: dto.restaurant,
      photos: dto.photos.map(({ id, dish, menu }) => ({
        id,
        ...(dish !== undefined && { entry: dish }),
        ...(menu !== undefined && { source: menu }),
      })),
    });
    return { restaurant: place, results };
  }
}
