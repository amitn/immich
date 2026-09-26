import type { AlbumResponseDto } from '@immich/sdk';
import { modalManager, type ActionItem } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import { getCollectionLabel, type WebCollectionPack } from '$lib/collections/pack';
import { collectionPacks } from '$lib/collections/registry';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import CollectionNameModal from '$lib/modals/CollectionNameModal.svelte';

/**
 * One action per collection pack, e.g. "Name the dishes…" for food: each opens the naming dialog of its pack. A pack is
 * offered when it is available (e.g. smart search is on); which photos match it is only known once the dialog looks.
 */
const getActions = (
  $t: MessageFormatter,
  packs: readonly WebCollectionPack[],
  item: (pack: WebCollectionPack) => Omit<ActionItem, 'title' | 'icon'>,
) =>
  packs.map((pack): ActionItem => ({
    title: $t(getCollectionLabel(pack, 'name_action')),
    icon: pack.icon,
    ...item(pack),
  }));

/** Name the photos of an album with each pack */
export const getAlbumCollectionActions = (
  $t: MessageFormatter,
  album: AlbumResponseDto,
  packs: readonly WebCollectionPack[] = collectionPacks,
) =>
  getActions($t, packs, (pack) => ({
    $if: () => pack.isAvailable() && album.assetCount > 0,
    onAction: () => modalManager.show(CollectionNameModal, { pack, album }),
  }));

/** Name the selected photos with each pack */
export const getCollectionBulkActions = ($t: MessageFormatter, packs: readonly WebCollectionPack[] = collectionPacks) =>
  getActions($t, packs, (pack) => ({
    $if: () => pack.isAvailable() && assetMultiSelectManager.isAllUserOwned,
    onAction: () => {
      const assetIds = assetMultiSelectManager.assets.map(({ id }) => id);
      assetMultiSelectManager.clear();
      return modalManager.show(CollectionNameModal, { pack, assetIds });
    },
  }));
