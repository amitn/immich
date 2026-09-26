import { BookStylePreset, FoodMealType, FoodRestaurantSource, type FoodDishesResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { foodPack } from '$lib/collections/packs/food';
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
