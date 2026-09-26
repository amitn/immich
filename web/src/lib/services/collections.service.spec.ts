import { modalManager } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import type { WebCollectionPack } from '$lib/collections/pack';
import { foodPack } from '$lib/collections/packs/food';
import CollectionNameModal from '$lib/modals/CollectionNameModal.svelte';
import { getAlbumCollectionActions, getCollectionBulkActions } from '$lib/services/collections.service';
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

/** a second pack, to show that every pack gets an action of its own */
const labelsPack: WebCollectionPack = {
  ...foodPack,
  id: 'labels',
  tagRoot: 'Labels',
  isAvailable: () => true,
};

describe('collections service', () => {
  beforeEach(() => {
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    selection.clear.mockReset();
    selection.isAllUserOwned = true;
    flags.smartSearch = true;
  });

  describe(getAlbumCollectionActions.name, () => {
    it('should name the dishes of an album with photos', async () => {
      const album = albumFactory.build({ assetCount: 12 });
      const [NameDishes] = getAlbumCollectionActions($t, album);

      expect(NameDishes.title).toBe('collections.food.name_action');
      expect(NameDishes.$if?.()).toBe(true);
      await NameDishes.onAction({ action: NameDishes, event: new Event('click') });
      expect(modalManager.show).toHaveBeenCalledWith(CollectionNameModal, { pack: foodPack, album });
    });

    it('should not be offered for an empty album or without smart search', () => {
      expect(getAlbumCollectionActions($t, albumFactory.build({ assetCount: 0 }))[0].$if?.()).toBe(false);
      flags.smartSearch = false;
      expect(getAlbumCollectionActions($t, albumFactory.build({ assetCount: 3 }))[0].$if?.()).toBe(false);
    });

    it('should offer one action per pack', async () => {
      const album = albumFactory.build({ assetCount: 12 });
      const actions = getAlbumCollectionActions($t, album, [foodPack, labelsPack]);

      expect(actions.map(({ title }) => title)).toEqual([
        'collections.food.name_action',
        'collections.labels.name_action',
      ]);
      await actions[1].onAction({ action: actions[1], event: new Event('click') });
      expect(modalManager.show).toHaveBeenCalledWith(CollectionNameModal, { pack: labelsPack, album });
    });
  });

  describe(getCollectionBulkActions.name, () => {
    it('should name the dishes of the selected photos', async () => {
      const [NameDishes] = getCollectionBulkActions($t);

      expect(NameDishes.$if?.()).toBe(true);
      await NameDishes.onAction({ action: NameDishes, event: new Event('click') });
      expect(selection.clear).toHaveBeenCalled();
      expect(modalManager.show).toHaveBeenCalledWith(CollectionNameModal, { pack: foodPack, assetIds: ['a', 'b'] });
    });

    it('should only be offered for photos the user owns', () => {
      selection.isAllUserOwned = false;
      expect(getCollectionBulkActions($t)[0].$if?.()).toBe(false);
    });
  });
});
