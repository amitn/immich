import { FoodMealType, FoodRestaurantSource, type FoodMatchResponseDto, type FoodMealResponseDto } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';
import {
  foodPack,
  toCollectionEntriesResponse,
  toCollectionMatch,
  toCollectionVisit,
  toFoodDishesDto,
} from '$lib/collections/packs/food';
import {
  applyCollectionEntries,
  formatVisitDay,
  formatVisitPlace,
  formatVisitTime,
  getCollectionAssistantPrompt,
  getCollectionEntriesDto,
  getEntryOptions,
  getEntryRows,
  getVisitAssetIds,
  isCollectionPhotoTag,
  isOffListSubject,
  summarizeCollectionEntries,
} from '$lib/utils/collections';
import {
  foodBreadMatch,
  foodDishMatchFactory,
  foodMatchFactory,
  foodMealFactory,
  foodMenuItems,
} from '@test-data/factories/food-factory';

/** the food pack's meals and matches, as the collections see them */
const meal = (value: Partial<FoodMealResponseDto> = {}) => toCollectionVisit(foodMealFactory(value));
const match = (value: Partial<FoodMatchResponseDto> = {}) => toCollectionMatch(foodMatchFactory(value));
const subject = (value: Parameters<typeof foodDishMatchFactory>[0] = {}) =>
  toCollectionMatch(foodMatchFactory({ dishes: [foodDishMatchFactory(value)] })).subjects[0];
const bread = toCollectionMatch(foodMatchFactory({ dishes: [foodBreadMatch] })).subjects[0];
const entries = toCollectionMatch(foodMatchFactory({ items: foodMenuItems })).entries;

describe('the food pack adapters', () => {
  it('should read a meal as a visit: dishes are the subjects, menus the sources, and the menu a place source', () => {
    expect(meal()).toEqual({
      index: 0,
      start: '2025-06-14T13:05:00',
      end: '2025-06-14T14:30:00',
      day: '2025-06-14',
      type: FoodMealType.Lunch,
      city: 'Taormina',
      country: 'Italy',
      latitude: 37.85,
      longitude: 15.29,
      subjectIds: ['dish-1', 'dish-2', 'dish-3', 'dish-4'],
      sourceIds: ['menu-1', 'menu-2'],
      signIds: ['sign-1'],
      receiptIds: [],
      place: { name: 'Trattoria da Nino', source: 'sign', confidence: 0.9, assetIds: ['sign-1'] },
      candidates: [{ name: 'Da Nino', source: 'source', confidence: 0.6, assetIds: ['menu-1'] }],
      saved: [],
    });
  });

  it('should read a match: menu items are the entries, and "not on the menu" is off the list', () => {
    const result = toCollectionMatch(foodMatchFactory({ dishes: [foodBreadMatch] }));
    expect(result.entries[0]).toEqual({
      index: 0,
      name: 'Caponata',
      price: '9',
      section: 'Antipasti',
      sourceId: 'menu-1',
    });
    expect(result.subjects[0]).toEqual(expect.objectContaining({ assetIds: ['dish-4'], offList: 0.7 }));
    expect(result.noEmbedding).toEqual(['dish-4']);
  });

  it('should name the photos of a meal as /food/dishes takes them', () => {
    expect(
      toFoodDishesDto({
        place: 'Nino',
        photos: [
          { id: 'menu-1', source: true },
          { id: 'dish-1', entry: 'Caponata' },
        ],
      }),
    ).toEqual({
      restaurant: 'Nino',
      photos: [
        { id: 'menu-1', menu: true },
        { id: 'dish-1', dish: 'Caponata' },
      ],
    });
    expect(toCollectionEntriesResponse({ restaurant: 'Nino', results: [] })).toEqual({ place: 'Nino', results: [] });
  });

  it('should name the kinds of meals', () => {
    expect(foodPack.visitTypeLabel?.(FoodMealType.Dinner)).toBe('collections.food.visit_type_dinner');
  });
});

describe('isOffListSubject', () => {
  it('should mark a dish that no menu item beats "not on the menu"', () => {
    expect(isOffListSubject(bread)).toBe(true);
    expect(isOffListSubject(subject())).toBe(false);
  });

  it('should not mark a weak match without a menu to compare with', () => {
    expect(isOffListSubject(subject({ index: undefined, offMenu: undefined }))).toBe(false);
  });
});

describe('getVisitAssetIds', () => {
  it('should list every photo of the meal once', () => {
    const visit = meal({ receiptIds: ['receipt-1'], signIds: ['menu-1'] });
    expect(getVisitAssetIds(visit)).toEqual(['menu-1', 'menu-2', 'dish-1', 'dish-2', 'dish-3', 'dish-4', 'receipt-1']);
  });
});

describe('getEntryRows', () => {
  it('should prefill the matches, mark the unsure ones and add the photos that could not be matched', () => {
    const rows = getEntryRows(meal(), match());

    expect(rows).toEqual([
      expect.objectContaining({ key: 'dish-1', assetIds: ['dish-1', 'dish-2'], name: 'Caponata', unsure: false }),
      expect.objectContaining({ key: 'dish-3', name: 'Pasta alla Norma', unsure: true, offList: false }),
      expect.objectContaining({ key: 'dish-4', assetIds: ['dish-4'], name: '', unsure: false, suggestions: [] }),
    ]);
    expect(rows[1].suggestions).toEqual(['Pasta alla Norma', 'Spaghetti alle vongole']);
  });

  it('should leave dishes that are not on the menu unnamed', () => {
    const rows = getEntryRows(meal(), match({ dishes: [foodBreadMatch], noEmbedding: [] }));

    expect(rows.find((row) => row.key === 'dish-4')).toEqual(
      expect.objectContaining({ name: '', offList: true, matchedName: undefined }),
    );
  });

  it('should prefer the names already saved in the food tags', () => {
    const visit = meal({
      saved: [
        { assetId: 'dish-3', restaurant: 'Trattoria da Nino', dish: 'Pasta alla Norma', menu: false },
        { assetId: 'dish-4', restaurant: 'Trattoria da Nino', dish: 'Bread', menu: false },
        { assetId: 'menu-1', restaurant: 'Trattoria da Nino', menu: true },
      ],
    });
    const rows = getEntryRows(visit, match());

    expect(rows[1]).toEqual(expect.objectContaining({ name: 'Pasta alla Norma', savedName: 'Pasta alla Norma' }));
    // a saved match is not unsure anymore
    expect(rows[1].unsure).toBe(false);
    // a saved name that is not on the menu is a free name
    expect(rows[2]).toEqual(expect.objectContaining({ name: 'Bread', offList: true }));
  });

  it('should name the dishes freely without a menu', () => {
    const rows = getEntryRows(meal(), match({ items: [], dishes: [foodBreadMatch] }));
    expect(rows.every((row) => !row.offList)).toBe(true);
  });

  it('should list every dish photo while the match is missing', () => {
    expect(getEntryRows(meal()).map(({ key }) => key)).toEqual(['dish-1', 'dish-2', 'dish-3', 'dish-4']);
  });
});

describe('getEntryOptions', () => {
  it('should offer the suggestions of the dish first, then the menu in its order', () => {
    const options = getEntryOptions(entries, { suggestions: ['Spaghetti alle vongole', 'Cannoli'] });
    expect(options.map(({ label }) => label)).toEqual([
      'Spaghetti alle vongole',
      'Cannoli',
      'Caponata',
      'Pasta alla Norma',
    ]);
    expect(options[0]).toEqual({ id: '2', label: 'Spaghetti alle vongole', value: 'Spaghetti alle vongole' });
  });
});

describe('getCollectionEntriesDto', () => {
  it('should mark the menu photos and name every photo of a dish, leaving unnamed dishes out', () => {
    const rows = getEntryRows(meal(), match());
    rows[1].name = ' Spaghetti alle vongole ';

    const { dto, skipped } = getCollectionEntriesDto(' Trattoria da Nino ', ['menu-1', 'menu-2'], rows);

    expect(dto).toEqual({
      place: 'Trattoria da Nino',
      photos: [
        { id: 'menu-1', source: true },
        { id: 'menu-2', source: true },
        { id: 'dish-1', entry: 'Caponata' },
        { id: 'dish-2', entry: 'Caponata' },
        { id: 'dish-3', entry: 'Spaghetti alle vongole' },
      ],
    });
    expect(skipped).toBe(1);
    // the food request is the same as before the collections
    expect(toFoodDishesDto(dto)).toEqual({
      restaurant: 'Trattoria da Nino',
      photos: [
        { id: 'menu-1', menu: true },
        { id: 'menu-2', menu: true },
        { id: 'dish-1', dish: 'Caponata' },
        { id: 'dish-2', dish: 'Caponata' },
        { id: 'dish-3', dish: 'Spaghetti alle vongole' },
      ],
    });
  });
});

describe('summarizeCollectionEntries and applyCollectionEntries', () => {
  const response = toCollectionEntriesResponse({
    restaurant: 'Trattoria da Nino',
    results: [
      { id: 'menu-1', success: true, tag: 'Food/Trattoria da Nino/Menu' },
      {
        id: 'dish-1',
        success: true,
        tag: 'Food/Trattoria da Nino/Caponata',
        description: 'Caponata · Trattoria da Nino',
      },
      { id: 'dish-3', success: false, error: 'no_permission' },
    ],
  });

  it('should count the named dishes and menus, and the failures', () => {
    expect(summarizeCollectionEntries(response, ['menu-1'])).toEqual({
      place: 'Trattoria da Nino',
      subjects: 1,
      sources: 1,
      failed: 1,
    });
  });

  it('should show the meal as named', () => {
    const visit = meal({
      restaurant: { name: 'Lunch in Taormina', source: FoodRestaurantSource.Fallback, confidence: 0, assetIds: [] },
      saved: [{ assetId: 'dish-1', restaurant: 'Old', dish: 'Old dish', menu: false }],
    });

    const updated = applyCollectionEntries(visit, response, ['menu-1']);

    expect(updated.place).toEqual(expect.objectContaining({ name: 'Trattoria da Nino', source: 'tag' }));
    expect(updated.saved).toEqual([
      { assetId: 'menu-1', place: 'Trattoria da Nino', source: true },
      { assetId: 'dish-1', place: 'Trattoria da Nino', entry: 'Caponata', source: false },
    ]);
  });
});

describe('formatting', () => {
  it('should show the local time of the meal as it was taken', () => {
    const visit = meal();
    expect(formatVisitTime(visit, 'en').replaceAll('\u{202F}', ' ')).toBe('Sat, Jun 14, 2025, 1:05 PM');
    expect(formatVisitDay(visit, 'en')).toBe('Saturday, June 14, 2025');
    expect(formatVisitPlace(visit)).toBe('Taormina, Italy');
    expect(formatVisitPlace(meal({ city: undefined, country: undefined }))).toBe('');
  });
});

describe('getCollectionAssistantPrompt', () => {
  const $t = vi.fn((key: string, options?: { values?: Record<string, unknown> }) =>
    JSON.stringify({ key, ...options?.values }),
  ) as unknown as MessageFormatter;

  it('should ask to name the dishes of the meal at the restaurant', () => {
    const prompt = JSON.parse(getCollectionAssistantPrompt($t, foodPack, meal(), ' Da Nino ', 'en'));
    expect(prompt).toEqual({
      key: 'collections.food.assistant_prompt',
      type: FoodMealType.Lunch,
      date: 'Saturday, June 14, 2025',
      place: 'Da Nino',
    });
  });

  it('should ask to find the restaurant when its name could not be read', () => {
    const visit = meal({
      restaurant: { name: 'Lunch in Taormina', source: FoodRestaurantSource.Fallback, confidence: 0, assetIds: [] },
    });
    expect(JSON.parse(getCollectionAssistantPrompt($t, foodPack, visit, 'Lunch in Taormina', 'en')).key).toBe(
      'collections.food.assistant_prompt_unknown_place',
    );
    // once the user typed the name in, the assistant gets it
    expect(JSON.parse(getCollectionAssistantPrompt($t, foodPack, visit, 'Da Nino', 'en')).key).toBe(
      'collections.food.assistant_prompt',
    );
  });
});

describe('isCollectionPhotoTag', () => {
  it('should tell the tags of dishes and menus from their restaurant', () => {
    expect(isCollectionPhotoTag('Food/Trattoria da Nino/Caponata')).toBe(true);
    expect(isCollectionPhotoTag('Food/Trattoria da Nino/Menu')).toBe(true);
    expect(isCollectionPhotoTag('Food/Trattoria da Nino')).toBe(false);
    expect(isCollectionPhotoTag('Food')).toBe(false);
    expect(isCollectionPhotoTag('Holidays/Italy/Taormina')).toBe(false);
  });

  it('should tell the tags of every pack', () => {
    const packs = [{ tagRoot: 'Food' }, { tagRoot: 'Labels' }];
    expect(isCollectionPhotoTag('Labels/Kew Gardens/Rosa canina', packs)).toBe(true);
    expect(isCollectionPhotoTag('Labels/Kew Gardens/Rosa canina')).toBe(false);
  });
});
