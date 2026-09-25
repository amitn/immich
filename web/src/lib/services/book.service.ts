import type { AlbumResponseDto } from '@immich/sdk';
import { modalManager, type ActionItem } from '@immich/ui';
import { mdiBookOpenPageVariantOutline } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import AlbumBookExportModal from '$lib/modals/AlbumBookExportModal.svelte';

export const getAlbumBookActions = ($t: MessageFormatter, album: AlbumResponseDto) => {
  const ExportAsBook: ActionItem = {
    title: $t('book_export_album_action'),
    icon: mdiBookOpenPageVariantOutline,
    $if: () => featureFlagsManager.value.assistant && album.assetCount > 0,
    onAction: () => modalManager.show(AlbumBookExportModal, { album }),
  };

  return { ExportAsBook };
};
