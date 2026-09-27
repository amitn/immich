import { BookStylePreset, FoodMealType, FoodRestaurantSource, type FoodDishesResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { foodPack } from '$lib/collections/packs/food';
import { travelPack } from '$lib/collections/packs/travel';
import { winePack } from '$lib/collections/packs/wine';
import type { CollectionMatch, CollectionVisit } from '$lib/collections/types';
import AlbumBookExportModal from '$lib/modals/AlbumBookExportModal.svelte';
import { openAssistant } from '$lib/services/assistant.service';
import { albumFactory } from '@test-data/factories/album-factory';
import { foodBreadMatch, foodMatchFactory, foodMealFactory } from '@test-data/factories/food-factory';
import CollectionNameModal from './CollectionNameModal.svelte';

const { flags, user } = vi.hoisted(() => ({
  flags: { assistant: true, smartSearch: true, restaurantLookup: false },
  user: { isAdmin: false },
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: flags } as never,
}));

vi.mock(import('$lib/managers/auth-manager.svelte'), () => ({
  authManager: { authenticated: true, user, params: {} } as never,
}));

vi.mock(import('$lib/services/assistant.service'), () => ({ openAssistant: vi.fn() }));

const saved = (restaurant: string, photos: Array<{ id: string; dish?: string; menu?: boolean }>) =>
  ({
    restaurant,
    results: photos.map(({ id, dish, menu }) => ({
      id,
      success: true,
      tag: `Food/${restaurant}/${menu ? 'Menu' : dish}`,
    })),
  }) satisfies FoodDishesResponseDto;

describe('CollectionNameModal component with the food pack', () => {
  const onClose = vi.fn();
  const album = albumFactory.build({ albumName: 'Sicily', assetCount: 120 });
  const lunch = foodMealFactory();
  const dinner = foodMealFactory({
    index: 1,
    start: '2025-06-14T20:30:00',
    type: FoodMealType.Dinner,
    dishIds: ['dish-5'],
    menuIds: [],
    restaurant: { name: 'Dinner in Taormina', source: FoodRestaurantSource.Fallback, confidence: 0, assetIds: [] },
    candidates: [],
  });

  const findResult = (meals = [lunch, dinner], warnings: string[] = []) => ({
    count: 120,
    truncated: false,
    foodPhotos: 7,
    meals,
    warnings,
  });

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    // show() is generic, so the spy cannot infer its result type
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    vi.spyOn(toastManager, 'success').mockImplementation(() => {});
    vi.spyOn(toastManager, 'warning').mockImplementation(() => {});
    sdkMock.getAllTags.mockResolvedValue([]);
    flags.assistant = true;
    user.isAdmin = false;
    flags.restaurantLookup = false;
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  const openLunch = async () => {
    await fireEvent.click(await screen.findByRole('button', { name: /Trattoria da Nino/ }));
    return screen.findAllByTestId('collection-entry');
  };

  it('should look for the meals of the album while loading', async () => {
    sdkMock.findMeals.mockReturnValue(new Promise(() => {}));

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });

    expect(await screen.findByText('collections.food.finding')).toBeInTheDocument();
    expect(sdkMock.findMeals).toHaveBeenCalledWith({ foodMealsDto: { albumId: album.id } });
  });

  it('should look for the meals among the selected photos', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult([]));

    render(CollectionNameModal, { props: { pack: foodPack, assetIds: ['a', 'b'], onClose } });

    expect(await screen.findByText('collections.food.no_visits_selection')).toBeInTheDocument();
    expect(sdkMock.findMeals).toHaveBeenCalledWith({ foodMealsDto: { assetIds: ['a', 'b'] } });
  });

  it('should search the first photos of a large selection, and say so', async () => {
    const assetIds = Array.from({ length: 2001 }, (_, index) => `asset-${index}`);
    sdkMock.findMeals.mockResolvedValue({ ...findResult(), count: 2000 });

    render(CollectionNameModal, { props: { pack: foodPack, assetIds, onClose } });

    expect(await screen.findByText('collections.food.truncated')).toBeInTheDocument();
    expect(sdkMock.findMeals).toHaveBeenCalledWith({ foodMealsDto: { assetIds: assetIds.slice(0, 2000) } });
  });

  it('should say when only part of a large album was searched', async () => {
    sdkMock.findMeals.mockResolvedValue({ ...findResult(), count: 5000, truncated: true });

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });

    expect(await screen.findByText('collections.food.truncated')).toBeInTheDocument();
  });

  it('should say when the album has no food photos, and why the search may be incomplete', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult([], ['Smart search is disabled']));

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });

    expect(await screen.findByText('collections.food.no_visits_album')).toBeInTheDocument();
    expect(screen.getByText('Smart search is disabled')).toBeInTheDocument();
  });

  it('should show an error and retry', async () => {
    sdkMock.findMeals.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(findResult([]));

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });

    expect(await screen.findByText('collections.food.error_find')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(await screen.findByText('collections.food.no_visits_album')).toBeInTheDocument();
  });

  it('should list the meals with their restaurant, where the name comes from and the other names read', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult());

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });

    const lunchButton = await screen.findByRole('button', { name: /Trattoria da Nino/ });
    expect(lunchButton).toHaveTextContent('collections.food.place_source_sign');
    expect(lunchButton).toHaveTextContent('collections.food.also_read');
    expect(lunchButton).toHaveTextContent('collections.food.visit_type_lunch');
    expect(lunchButton).toHaveTextContent('Taormina, Italy');
    expect(screen.getByRole('button', { name: /Dinner in Taormina/ })).toHaveTextContent(
      'collections.food.place_source_fallback',
    );
    expect(sdkMock.matchMeal).not.toHaveBeenCalled();
  });

  it('should match the dishes of a meal, marking the menu, the unsure matches and the dishes not on the menu', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult());
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory({ dishes: [...foodMatchFactory().dishes, foodBreadMatch] }));

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });
    const dishes = await openLunch();

    expect(sdkMock.matchMeal).toHaveBeenCalledWith({
      foodMatchDto: { dishIds: lunch.dishIds, menuIds: lunch.menuIds },
    });
    expect(screen.getByRole('textbox', { name: /collections\.food\.place/ })).toHaveValue('Trattoria da Nino');
    expect(screen.getAllByRole('button', { name: 'collections.food.view_source' })).toHaveLength(2);
    expect(screen.getByText('collections.food.entries_read')).toBeInTheDocument();

    expect(dishes).toHaveLength(3);
    const [caponata, norma, bread] = dishes;
    expect(within(caponata).getByRole('combobox')).toHaveValue('Caponata');
    expect(caponata).not.toHaveAttribute('data-unsure');
    expect(within(norma).getByRole('combobox')).toHaveValue('Pasta alla Norma');
    expect(norma).toHaveAttribute('data-unsure', 'true');
    expect(within(norma).getByText('collections.food.subject_unsure')).toBeInTheDocument();
    expect(bread).toHaveAttribute('data-off-list', 'true');
    expect(within(bread).getByRole('checkbox')).toBeChecked();
    expect(within(bread).getByRole('textbox')).toHaveValue('');
  });

  it('should open a menu photo large', async () => {
    sdkMock.getBaseUrl.mockReturnValue('/api');
    sdkMock.getAssetThumbnailPath.mockImplementation((id) => `/assets/${id}/thumbnail`);
    sdkMock.findMeals.mockResolvedValue(findResult());
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory());

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });
    await openLunch();
    const [first] = screen.getAllByRole('button', { name: 'collections.food.view_source' });
    await fireEvent.click(first);

    expect(first).toHaveAttribute('aria-pressed', 'true');
    const large = screen.getAllByRole('img', { name: 'collections.food.source_photo' }).at(-1)!;
    expect(large.getAttribute('src')).toContain('menu-1');
    expect(large.getAttribute('src')).toContain('size=preview');
  });

  it('should save the edited names of the meal', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult());
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory({ dishes: [...foodMatchFactory().dishes, foodBreadMatch] }));
    sdkMock.setDishNames.mockResolvedValue(
      saved('Da Nino', [
        { id: 'menu-1', menu: true },
        { id: 'menu-2', menu: true },
        { id: 'dish-1', dish: 'Caponata' },
        { id: 'dish-2', dish: 'Caponata' },
        { id: 'dish-3', dish: 'Spaghetti alle vongole' },
        { id: 'dish-4', dish: 'Bread' },
      ]),
    );

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });
    const [, norma, bread] = await openLunch();

    // another restaurant name read on the photos
    await fireEvent.click(screen.getByRole('button', { name: 'Da Nino' }));
    // another menu item
    await fireEvent.focus(within(norma).getByRole('combobox'));
    await fireEvent.click(within(norma).getByRole('option', { name: 'Spaghetti alle vongole' }));
    // a dish that is not on the menu
    await fireEvent.input(within(bread).getByRole('textbox'), { target: { value: 'Bread' } });
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(toastManager.success).toHaveBeenCalledWith('collections.food.saved'));
    expect(sdkMock.setDishNames).toHaveBeenCalledWith({
      foodDishesDto: {
        restaurant: 'Da Nino',
        photos: [
          { id: 'menu-1', menu: true },
          { id: 'menu-2', menu: true },
          { id: 'dish-1', dish: 'Caponata' },
          { id: 'dish-2', dish: 'Caponata' },
          { id: 'dish-3', dish: 'Spaghetti alle vongole' },
          { id: 'dish-4', dish: 'Bread' },
        ],
      },
    });
    expect(norma).not.toHaveAttribute('data-unsure');
    expect(screen.getAllByText('collections.food.subject_saved')).toHaveLength(3);
    // the sidebar shows the new tags
    expect(sdkMock.getAllTags).toHaveBeenCalled();
  });

  it('should leave unnamed dishes out and report the photos that could not be named', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult());
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory());
    sdkMock.setDishNames.mockResolvedValue({
      restaurant: 'Trattoria da Nino',
      results: [
        { id: 'menu-1', success: true, tag: 'Food/Trattoria da Nino/Menu' },
        { id: 'menu-2', success: true, tag: 'Food/Trattoria da Nino/Menu' },
        { id: 'dish-1', success: true, tag: 'Food/Trattoria da Nino/Caponata' },
        { id: 'dish-2', success: false, error: 'no_permission' },
        { id: 'dish-3', success: true, tag: 'Food/Trattoria da Nino/Pasta alla Norma' },
      ],
    });

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });
    await openLunch();
    expect(screen.getByText('collections.food.skipped')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(toastManager.warning).toHaveBeenCalledWith('collections.food.not_saved'));
    const photos = sdkMock.setDishNames.mock.calls[0][0].foodDishesDto.photos;
    expect(photos.map(({ id }) => id)).toEqual(['menu-1', 'menu-2', 'dish-1', 'dish-2', 'dish-3']);
  });

  it('should not save without a restaurant name', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult());
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory());

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });
    await openLunch();
    await fireEvent.input(screen.getByRole('textbox', { name: /collections\.food\.place/ }), {
      target: { value: ' - ' },
    });

    expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
  });

  it('should ask to type the name in when it could not be read', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult([dinner]));
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory({ items: [], dishes: [] }));

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });

    // a single meal opens right away
    expect(await screen.findByText('collections.food.place_unknown')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /collections\.food\.place/ })).toHaveValue('Dinner in Taormina');
    expect(screen.getByText('collections.food.no_source')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'collections.food.all_visits' })).not.toBeInTheDocument();
  });

  it('should suggest the OpenStreetMap lookup when the admin turned it on', async () => {
    flags.restaurantLookup = true;
    sdkMock.findMeals.mockResolvedValue(findResult([dinner]));
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory({ items: [], dishes: [] }));

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });

    expect(await screen.findByText('collections.food.place_unknown_lookup')).toBeInTheDocument();
  });

  it('should not show the hint when the name was read', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult([lunch]));
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory());

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });

    expect(await screen.findAllByTestId('collection-entry')).toHaveLength(3);
    expect(screen.queryByText('collections.food.place_unknown')).not.toBeInTheDocument();
  });

  it('should hand the meal to the assistant', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult([lunch]));
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory());

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });
    await screen.findAllByTestId('collection-entry');
    await fireEvent.click(screen.getByRole('button', { name: 'collections.food.ask_assistant' }));

    expect(onClose).toHaveBeenCalled();
    expect(openAssistant).toHaveBeenCalledWith({
      assetIds: ['menu-1', 'menu-2', 'dish-1', 'dish-2', 'dish-3', 'dish-4', 'sign-1'],
      prompt: 'collections.food.assistant_prompt',
    });
  });

  it('should not offer the assistant when it is disabled', async () => {
    flags.assistant = false;
    sdkMock.findMeals.mockResolvedValue(findResult([lunch]));
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory());

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });
    await screen.findAllByTestId('collection-entry');

    expect(screen.queryByRole('button', { name: 'collections.food.ask_assistant' })).not.toBeInTheDocument();
  });

  it('should show the matching error and retry', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult([lunch]));
    sdkMock.matchMeal.mockRejectedValueOnce(new Error('ML is down')).mockResolvedValue(foodMatchFactory());

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });

    expect(await screen.findByText('collections.food.error_match')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(await screen.findAllByTestId('collection-entry')).toHaveLength(3);
  });

  it('should go back to the meals and keep the edits', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult());
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory());

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });
    await openLunch();
    await fireEvent.input(screen.getByRole('textbox', { name: /collections\.food\.place/ }), {
      target: { value: 'Nino' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'collections.food.all_visits' }));
    await fireEvent.click(await screen.findByRole('button', { name: /Trattoria da Nino/ }));

    expect(screen.getByRole('textbox', { name: /collections\.food\.place/ })).toHaveValue('Nino');
    expect(sdkMock.matchMeal).toHaveBeenCalledTimes(1);
  });

  it('should offer a food book of the album after saving', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult([lunch]));
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory());
    sdkMock.setDishNames.mockResolvedValue(saved('Trattoria da Nino', [{ id: 'menu-1', menu: true }]));

    render(CollectionNameModal, { props: { pack: foodPack, album, onClose } });
    await screen.findAllByTestId('collection-entry');
    expect(screen.queryByRole('button', { name: 'collections.food.make_book' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'collections.food.make_book' }));

    expect(onClose).toHaveBeenCalled();
    expect(modalManager.show).toHaveBeenCalledWith(AlbumBookExportModal, {
      album,
      stylePreset: BookStylePreset.Food,
    });
  });

  it('should ask the assistant for a food book of the selected photos', async () => {
    sdkMock.findMeals.mockResolvedValue(findResult([lunch]));
    sdkMock.matchMeal.mockResolvedValue(foodMatchFactory());
    sdkMock.setDishNames.mockResolvedValue(saved('Trattoria da Nino', [{ id: 'menu-1', menu: true }]));

    render(CollectionNameModal, { props: { pack: foodPack, assetIds: ['a', 'b'], onClose } });
    await screen.findAllByTestId('collection-entry');
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'collections.food.make_book' }));

    expect(openAssistant).toHaveBeenCalledWith({ assetIds: ['a', 'b'], prompt: 'collections.food.book_prompt' });
  });
});

describe('CollectionNameModal component with named subjects', () => {
  const onClose = vi.fn();
  const album = albumFactory.build({ albumName: 'Wine tastings' });

  const visitOf = (value: Partial<CollectionVisit>): CollectionVisit => ({
    index: 0,
    start: '2013-11-28T18:00:00',
    end: '2013-11-28T22:00:00',
    day: '2013-11-28',
    subjectIds: ['bottle-1', 'bottle-2'],
    sourceIds: [],
    signIds: [],
    receiptIds: [],
    place: { name: 'Thanksgiving 2013', source: 'fallback', confidence: 0, assetIds: [] },
    candidates: [],
    saved: [],
    ...value,
  });

  const findResult = (visit: CollectionVisit, pack: string) =>
    ({ pack, count: 2, truncated: false, photos: 2, visits: [visit], warnings: [] }) as never;

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    flags.assistant = true;
    flags.smartSearch = true;
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('should show the saved names of the bottles as their wines, not off the list, without asking for a wine list', async () => {
    const visit = visitOf({
      saved: [
        {
          assetId: 'bottle-1',
          place: 'Thanksgiving 2013',
          entry: 'Patrick Javillier · Bourgogne · 2011',
          source: false,
        },
        {
          assetId: 'bottle-2',
          place: 'Thanksgiving 2013',
          entry: 'Kudos · Willamette Valley Pinot Noir · 2012',
          source: false,
        },
      ],
    });
    // the labels read differently from the saved names, and the second bottle looks like a glass of water
    const match: CollectionMatch = {
      entries: [
        { index: 0, name: 'Patrick Javillier Bourgogne 2011' },
        { index: 1, name: 'Kudos Pinot Noir' },
      ],
      subjects: [
        {
          assetIds: ['bottle-1'],
          index: 0,
          name: 'Patrick Javillier Bourgogne 2011',
          score: 0.3,
          unsure: false,
          suggestions: [],
        },
        {
          assetIds: ['bottle-2'],
          score: 0.1,
          unsure: true,
          offList: 0.8,
          suggestions: [{ index: 1, name: 'Kudos Pinot Noir', score: 0.2 }],
        },
      ],
      noEmbedding: [],
      warnings: [],
    };
    sdkMock.findCollectionVisits.mockResolvedValue(findResult(visit, 'wine'));
    sdkMock.matchCollectionVisit.mockResolvedValue(match as never);

    render(CollectionNameModal, { props: { pack: winePack, album, onClose } });
    const [first, second] = await screen.findAllByTestId('collection-entry');

    expect(within(first).getByRole('combobox')).toHaveValue('Patrick Javillier · Bourgogne · 2011');
    expect(within(second).getByRole('combobox')).toHaveValue('Kudos · Willamette Valley Pinot Noir · 2012');
    for (const row of [first, second]) {
      expect(row).not.toHaveAttribute('data-off-list');
      expect(within(row).getByRole('checkbox')).not.toBeChecked();
      // the badge; the label of the checkbox says it too
      expect(within(row).queryByText('collections.wine.not_on_source', { selector: 'span' })).not.toBeInTheDocument();
      expect(within(row).getByText('collections.wine.subject_saved')).toBeInTheDocument();
    }
    expect(screen.queryByText('collections.wine.no_source')).not.toBeInTheDocument();
    expect(screen.getByText('collections.wine.entries_read')).toBeInTheDocument();
  });

  it('should say no label could be read when no bottle was read nor named', async () => {
    sdkMock.findCollectionVisits.mockResolvedValue(findResult(visitOf({}), 'wine'));
    sdkMock.matchCollectionVisit.mockResolvedValue({
      entries: [],
      subjects: [{ assetIds: ['bottle-1', 'bottle-2'], score: 0, unsure: false, suggestions: [] }],
      noEmbedding: [],
      warnings: [],
    } as never);

    render(CollectionNameModal, { props: { pack: winePack, album, onClose } });

    expect(await screen.findAllByTestId('collection-entry')).toHaveLength(1);
    expect(screen.getByText('collections.wine.no_source')).toBeInTheDocument();
  });

  it('should show the saved leg of a trip photo instead of "on no leg"', async () => {
    const visit = visitOf({
      subjectIds: ['photo-1'],
      sourceIds: ['ticket-1'],
      place: { name: 'Crete 2019', source: 'source', confidence: 0.8, assetIds: ['ticket-1'] },
      saved: [{ assetId: 'photo-1', place: 'Crete 2019', entry: 'Ferry · Chania → Sougia', source: false }],
    });
    sdkMock.findCollectionVisits.mockResolvedValue(findResult(visit, 'travel'));
    sdkMock.matchCollectionVisit.mockResolvedValue({
      entries: [{ index: 0, name: 'Bus · Chania → Sougia', sourceId: 'ticket-1' }],
      subjects: [{ assetIds: ['photo-1'], score: 0, unsure: false, offList: 1, suggestions: [] }],
      noEmbedding: [],
      warnings: [],
    } as never);

    render(CollectionNameModal, { props: { pack: travelPack, album, onClose } });
    const [photo] = await screen.findAllByTestId('collection-entry');

    expect(photo).not.toHaveAttribute('data-off-list');
    expect(within(photo).getByRole('checkbox')).not.toBeChecked();
    expect(within(photo).getByRole('combobox')).toHaveValue('Ferry · Chania → Sougia');
  });
});
