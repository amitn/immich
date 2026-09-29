import type { AlbumResponseDto } from '@immich/sdk';
import { modalManager, type ActionItem } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import { getCollectionLabel, type WebCollectionPack } from '$lib/collections/pack';
import { collectionPacks, getCollectionPack } from '$lib/collections/registry';
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

/**
 * Opens the naming dialog of a "new collection found" notification on the photos of its visit; false when its pack is
 * not in this web app, or not available (e.g. smart search was turned off since)
 */
export const openCollectionNotice = (
  notice: { pack: string; assetIds: string[] },
  getPack: (id: string) => WebCollectionPack | undefined = getCollectionPack,
) => {
  const pack = getPack(notice.pack);
  if (!pack?.isAvailable()) {
    return false;
  }
  void modalManager.show(CollectionNameModal, { pack, assetIds: notice.assetIds });
  return true;
};
