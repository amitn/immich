import type { AlbumResponseDto } from '@immich/sdk';
import { modalManager, type ActionItem } from '@immich/ui';
import { mdiSilverwareForkKnife } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import FoodDishesModal from '$lib/modals/FoodDishesModal.svelte';

// dishes are recognized by smart search; without it only menus, signs and receipts would be found
const isAvailable = () => featureFlagsManager.value.smartSearch;

export const getAlbumFoodActions = ($t: MessageFormatter, album: AlbumResponseDto) => {
  const NameDishes: ActionItem = {
    title: $t('food_name_dishes'),
    icon: mdiSilverwareForkKnife,
    $if: () => isAvailable() && album.assetCount > 0,
    onAction: () => modalManager.show(FoodDishesModal, { album }),
  };

  return { NameDishes };
};

export const getFoodBulkActions = ($t: MessageFormatter) => {
  const NameDishes: ActionItem = {
    title: $t('food_name_dishes'),
    icon: mdiSilverwareForkKnife,
    $if: () => isAvailable() && assetMultiSelectManager.isAllUserOwned,
    onAction: () => {
      const assetIds = assetMultiSelectManager.assets.map(({ id }) => id);
      assetMultiSelectManager.clear();
      return modalManager.show(FoodDishesModal, { assetIds });
    },
  };

  return { NameDishes };
};
