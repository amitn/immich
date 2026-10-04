import { modalManager } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import type { WebCollectionPack } from '$lib/journals/pack';
import { foodPack } from '$lib/journals/packs/food';
import JournalNameModal from '$lib/modals/JournalNameModal.svelte';
import { getAlbumCollectionActions, openCollectionNotice } from '$lib/services/journals.service';
import { albumFactory } from '@test-data/factories/album-factory';

const { flags } = vi.hoisted(() => ({
  flags: { smartSearch: true },
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: flags } as never,
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
    flags.smartSearch = true;
  });

  describe(getAlbumCollectionActions.name, () => {
    it('should name the dishes of an album with photos', async () => {
      const album = albumFactory.build({ assetCount: 12 });
      const [NameDishes] = getAlbumCollectionActions($t, album);

      expect(NameDishes.title).toBe('journals.food.name_action');
      expect(NameDishes.$if?.()).toBe(true);
      await NameDishes.onAction(NameDishes);
      expect(modalManager.show).toHaveBeenCalledWith(JournalNameModal, { pack: foodPack, album });
    });

    it('should not be offered for an empty album or without smart search', () => {
      expect(getAlbumCollectionActions($t, albumFactory.build({ assetCount: 0 }))[0].$if?.()).toBe(false);
      flags.smartSearch = false;
      expect(getAlbumCollectionActions($t, albumFactory.build({ assetCount: 3 }))[0].$if?.()).toBe(false);
    });

    it('should offer one action per pack', async () => {
      const album = albumFactory.build({ assetCount: 12 });
      const actions = getAlbumCollectionActions($t, album, [foodPack, labelsPack]);

      expect(actions.map(({ title }) => title)).toEqual(['journals.food.name_action', 'journals.labels.name_action']);
      await actions[1].onAction(actions[1]);
      expect(modalManager.show).toHaveBeenCalledWith(JournalNameModal, { pack: labelsPack, album });
    });
  });

  describe(openCollectionNotice.name, () => {
    it('should open the naming dialog of the pack on the photos of the visit', () => {
      expect(openCollectionNotice({ pack: 'food', assetIds: ['a', 'b'] })).toBe(true);
      expect(modalManager.show).toHaveBeenCalledWith(JournalNameModal, { pack: foodPack, assetIds: ['a', 'b'] });
    });

    it('should not open a pack that is unknown or not available', () => {
      const show = vi.mocked(modalManager.show);
      show.mockClear();
      expect(openCollectionNotice({ pack: 'unknown', assetIds: ['a'] })).toBe(false);
      flags.smartSearch = false;
      expect(openCollectionNotice({ pack: 'food', assetIds: ['a'] })).toBe(false);
      expect(show).not.toHaveBeenCalled();
      expect(openCollectionNotice({ pack: 'labels', assetIds: ['a'] }, () => labelsPack)).toBe(true);
      expect(show).toHaveBeenCalledWith(JournalNameModal, { pack: labelsPack, assetIds: ['a'] });
    });
  });
});
