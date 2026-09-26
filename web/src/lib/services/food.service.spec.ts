import { modalManager } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import FoodDishesModal from '$lib/modals/FoodDishesModal.svelte';
import { getAlbumFoodActions, getFoodBulkActions } from '$lib/services/food.service';
import { albumFactory } from '@test-data/factories/album-factory';

const { flags, selection } = vi.hoisted(() => ({
  flags: { smartSearch: true },
  selection: { assets: [{ id: 'a' }, { id: 'b' }], isAllUserOwned: true, clear: vi.fn() },
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: flags } as never,
}));

vi.mock(import('$lib/managers/asset-multi-select-manager.svelte'), () => ({
  assetMultiSelectManager: selection as never,
}));

const $t = ((key: string) => key) as MessageFormatter;

describe('food service', () => {
  beforeEach(() => {
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    selection.clear.mockReset();
    selection.isAllUserOwned = true;
    flags.smartSearch = true;
  });

  describe(getAlbumFoodActions.name, () => {
    it('should name the dishes of an album with photos', async () => {
      const album = albumFactory.build({ assetCount: 12 });
      const { NameDishes } = getAlbumFoodActions($t, album);

      expect(NameDishes.title).toBe('food_name_dishes');
      expect(NameDishes.$if?.()).toBe(true);
      await NameDishes.onAction({ action: NameDishes, event: new Event('click') });
      expect(modalManager.show).toHaveBeenCalledWith(FoodDishesModal, { album });
    });

    it('should not be offered for an empty album or without smart search', () => {
      expect(getAlbumFoodActions($t, albumFactory.build({ assetCount: 0 })).NameDishes.$if?.()).toBe(false);
      flags.smartSearch = false;
      expect(getAlbumFoodActions($t, albumFactory.build({ assetCount: 3 })).NameDishes.$if?.()).toBe(false);
    });
  });

  describe(getFoodBulkActions.name, () => {
    it('should name the dishes of the selected photos', async () => {
      const { NameDishes } = getFoodBulkActions($t);

      expect(NameDishes.$if?.()).toBe(true);
      await NameDishes.onAction({ action: NameDishes, event: new Event('click') });
      expect(selection.clear).toHaveBeenCalled();
      expect(modalManager.show).toHaveBeenCalledWith(FoodDishesModal, { assetIds: ['a', 'b'] });
    });

    it('should only be offered for photos the user owns', () => {
      selection.isAllUserOwned = false;
      expect(getFoodBulkActions($t).NameDishes.$if?.()).toBe(false);
    });
  });
});
