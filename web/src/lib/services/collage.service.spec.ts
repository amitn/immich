import { modalManager } from '@immich/ui';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import CollageModal from '$lib/modals/CollageModal.svelte';
import { getCollageBulkAction } from '$lib/services/collage.service';
import { getCollageRoute } from '$lib/utils/collage';
import { timelineAssetFactory } from '@test-data/factories/asset-factory';

const $t = ((key: string) => key) as never;

describe('getCollageBulkAction', () => {
  afterEach(() => {
    assetMultiSelectManager.clear();
    vi.restoreAllMocks();
  });

  const select = (count: number, overrides: Record<string, unknown> = {}) =>
    assetMultiSelectManager.selectAssets(
      Array.from({ length: count }, () => timelineAssetFactory.build({ isImage: true, isVideo: false, ...overrides })),
    );

  it('should offer a collage of 2 to 9 photos', () => {
    const action = getCollageBulkAction($t);
    expect(action.title).toBe('collage_make_action');

    select(1);
    expect(action.$if?.()).toBe(false);
    select(1);
    expect(action.$if?.()).toBe(true);
    select(7);
    expect(action.$if?.()).toBe(true);
    select(1);
    expect(action.$if?.()).toBe(false);
  });

  it('should not offer a collage of videos', () => {
    select(2);
    select(1, { isImage: false, isVideo: true });
    expect(getCollageBulkAction($t).$if?.()).toBe(false);
  });

  it('should open the dialog with the selected photos and the album', async () => {
    const show = vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    select(3);
    const ids = assetMultiSelectManager.assets.map(({ id }) => id);

    await getCollageBulkAction($t, 'album-id').onAction?.(undefined as never);

    expect(show).toHaveBeenCalledWith(CollageModal, { assetIds: ids, albumId: 'album-id' });
    expect(assetMultiSelectManager.assets).toEqual([]);
  });
});

describe('getCollageRoute', () => {
  it('should open a collage over its album, or in the timeline', () => {
    expect(getCollageRoute('asset-id', 'album-id')).toBe('/albums/album-id/photos/asset-id');
    expect(getCollageRoute('asset-id')).toBe('/photos/asset-id');
  });
});
