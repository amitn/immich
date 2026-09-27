import { modalManager, type ActionItem } from '@immich/ui';
import { mdiViewDashboardOutline } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import CollageModal from '$lib/modals/CollageModal.svelte';
import { MAX_COLLAGE_PHOTOS, MIN_COLLAGE_PHOTOS } from '$lib/utils/collage';

/** "Make a collage…" of the 2 to 9 selected photos, added to the album when made in one */
export const getCollageBulkAction = ($t: MessageFormatter, albumId?: string): ActionItem => ({
  title: $t('collage_make_action'),
  icon: mdiViewDashboardOutline,
  $if: () => {
    const { assets } = assetMultiSelectManager;
    return assets.length >= MIN_COLLAGE_PHOTOS && assets.length <= MAX_COLLAGE_PHOTOS && assets.every((a) => a.isImage);
  },
  onAction: () => {
    const assetIds = assetMultiSelectManager.assets.map(({ id }) => id);
    assetMultiSelectManager.clear();
    return modalManager.show(CollageModal, { assetIds, albumId });
  },
});
