import { getAssetInfo, type AssetResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import {
  mdiAutoFix,
  mdiBookOpenPageVariantOutline,
  mdiCreationOutline,
  mdiImageAlbum,
  mdiMovieOpenPlayOutline,
  mdiPaletteOutline,
  mdiViewDashboardOutline,
} from '@mdi/js';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { getCollectionLabel, type WebCollectionPack } from '$lib/journals/pack';
import { collectionPacks } from '$lib/journals/registry';
import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
import { assistantCommandContext, type AssistantAlbumContext } from '$lib/managers/assistant-command-context.svelte';
import {
  getAssistantSelectionCapabilities,
  type AssistantSelectionCapabilities,
} from '$lib/managers/assistant-selection-capabilities';
import type { CommandContext } from '$lib/managers/command-context-manager.svelte';
import type { CommandItem } from '$lib/managers/command-items';
import AlbumBookExportModal from '$lib/modals/AlbumBookExportModal.svelte';
import ArtisticStyleModal from '$lib/modals/ArtisticStyleModal.svelte';
import AutoEnhanceModal from '$lib/modals/AutoEnhanceModal.svelte';
import CollageModal from '$lib/modals/CollageModal.svelte';
import HighlightVideoModal from '$lib/modals/HighlightVideoModal.svelte';
import JournalNameModal from '$lib/modals/JournalNameModal.svelte';
import { getAssistantFeatures } from '$lib/services/assistant-selection.service';
import { getAssistantAssetActions, openAssistant } from '$lib/services/assistant.service';
import { getAlbumBookActions } from '$lib/services/book.service';
import { isEnabled } from '$lib/utils';
import { handleError } from '$lib/utils/handle-error';

/**
 * The assistant's actions as Search Palette commands, each the one command of its action: it works on the selection
 * when there is one, and otherwise on the photo open in the viewer or the album of the page. They follow the same
 * rules as the selection bars (`getAssistantSelectionCapabilities`) and the viewer (`getAssistantAssetActions`): the
 * photos of others are read-only (#21).
 */

/** the album of the page: a regular album (noodle's album context) or an album of a space (ours) */
const getAlbum = (ctx: CommandContext): AssistantAlbumContext | null => {
  const album = assistantCommandContext.getAlbum();
  if (album) {
    return album;
  }
  return ctx.album ? { album: ctx.album.raw, isOwner: ctx.album.isOwner, isEditor: ctx.album.isEditor } : null;
};

const getCapabilities = (ctx: CommandContext): AssistantSelectionCapabilities => {
  const album = getAlbum(ctx);
  return getAssistantSelectionCapabilities(
    {
      selection: ctx.selection,
      album: album ? { id: album.album.id, isOwner: album.isOwner, isEditor: album.isEditor } : null,
      space: album?.space ?? ctx.space,
    },
    getAssistantFeatures(),
  );
};

/** the photo open in the viewer, when there is no selection */
const getViewedAsset = (ctx: CommandContext): AssetResponseDto | undefined =>
  !ctx.selection && assetViewerManager.isViewing ? assetViewerManager.asset : undefined;

const getViewerActions = (asset: AssetResponseDto) => getAssistantAssetActions(get(t), asset);

const takeSelection = (ctx?: CommandContext) => {
  const assetIds = ctx?.selection?.selectedAssetIds ?? [];
  ctx?.selection?.clearSelection();
  return assetIds;
};

/** the album of the page, when it has photos and nothing is selected */
const getWholeAlbum = (ctx: CommandContext) => {
  const album = ctx.selection ? null : getAlbum(ctx);
  return album && album.album.assetCount > 0 ? album : null;
};

const openCopyDialog = async (
  ctx: CommandContext | undefined,
  modal: typeof ArtisticStyleModal | typeof AutoEnhanceModal,
) => {
  if (!ctx) {
    return;
  }
  const viewed = getViewedAsset(ctx);
  if (viewed) {
    return modalManager.show(modal, { asset: viewed });
  }
  const [assetId] = ctx.selection?.selectedAssetIds ?? [];
  if (!assetId) {
    return;
  }
  try {
    const asset = await getAssetInfo({ id: assetId });
    ctx.selection?.clearSelection();
    return modalManager.show(modal, { asset });
  } catch (error) {
    handleError(error, get(t)('errors.failed_to_load_asset'));
  }
};

const getNameCommand = (pack: WebCollectionPack): CommandItem => ({
  id: `cmd:assistant_name_${pack.id.replaceAll('-', '_')}`,
  labelKey: getCollectionLabel(pack, 'name_action'),
  descriptionKey: 'cmdk_cmd_assistant_name_description',
  icon: pack.icon,
  // the pack last: it reads the feature flags, which only matter once there is something to name
  isAvailable: (ctx) =>
    (ctx.selection ? getCapabilities(ctx).canName : getWholeAlbum(ctx) !== null) && pack.isAvailable(),
  handler: (ctx) => {
    if (!ctx) {
      return;
    }
    const album = getWholeAlbum(ctx);
    if (album) {
      return modalManager.show(JournalNameModal, { pack, album: album.album });
    }
    // all of the selection: the dialog names the user's own photos, the others help to read the names
    return modalManager.show(JournalNameModal, { pack, assetIds: takeSelection(ctx) });
  },
});

export const ASSISTANT_COMMAND_ITEMS: readonly CommandItem[] = [
  {
    id: 'cmd:assistant_ask',
    labelKey: 'ask_assistant',
    descriptionKey: 'cmdk_cmd_assistant_ask_description',
    icon: mdiCreationOutline,
    featureFlag: 'assistant',
    handler: (ctx) => {
      if (ctx?.selection) {
        const assetIds = getCapabilities(ctx).canAskAssistant ? ctx.selection.selectedAssetIds : [];
        ctx.selection.clearSelection();
        return openAssistant({ assetIds });
      }
      const viewed = ctx ? getViewedAsset(ctx) : undefined;
      const attach = viewed && isEnabled(getViewerActions(viewed).AskAssistant);
      return openAssistant({ assetIds: attach ? [viewed.id] : [] });
    },
  },
  {
    id: 'cmd:assistant_highlight_video',
    labelKey: 'highlight_video_make_action',
    descriptionKey: 'cmdk_cmd_assistant_highlight_video_description',
    icon: mdiMovieOpenPlayOutline,
    isAvailable: (ctx) => (ctx.selection ? getCapabilities(ctx).canMakeHighlightVideo : getWholeAlbum(ctx) !== null),
    handler: (ctx) => {
      if (!ctx) {
        return;
      }
      const album = getWholeAlbum(ctx);
      if (album) {
        return modalManager.show(HighlightVideoModal, { albumId: album.album.id, title: album.album.albumName });
      }
      return modalManager.show(HighlightVideoModal, { assetIds: takeSelection(ctx) });
    },
  },
  {
    id: 'cmd:assistant_collage',
    labelKey: 'collage_make_action',
    descriptionKey: 'cmdk_cmd_assistant_collage_description',
    icon: mdiViewDashboardOutline,
    isAvailable: (ctx) => getCapabilities(ctx).canMakeCollage,
    handler: (ctx) => {
      if (!ctx) {
        return;
      }
      const { collageAlbumId } = getCapabilities(ctx);
      const spaceId = collageAlbumId ? getAlbum(ctx)?.space?.id : undefined;
      return modalManager.show(CollageModal, { assetIds: takeSelection(ctx), albumId: collageAlbumId, spaceId });
    },
  },
  ...collectionPacks.map((pack) => getNameCommand(pack)),
  {
    id: 'cmd:assistant_artistic_style',
    labelKey: 'artistic_style',
    descriptionKey: 'cmdk_cmd_assistant_artistic_style_description',
    icon: mdiPaletteOutline,
    featureFlag: 'artisticStyles',
    isAvailable: (ctx) => {
      const viewed = getViewedAsset(ctx);
      return viewed ? isEnabled(getViewerActions(viewed).ArtisticStyle) : getCapabilities(ctx).canArtisticStyle;
    },
    handler: (ctx) => openCopyDialog(ctx, ArtisticStyleModal),
  },
  {
    id: 'cmd:assistant_auto_enhance',
    labelKey: 'auto_enhance',
    descriptionKey: 'cmdk_cmd_assistant_auto_enhance_description',
    icon: mdiAutoFix,
    isAvailable: (ctx) => {
      const viewed = getViewedAsset(ctx);
      return viewed ? isEnabled(getViewerActions(viewed).AutoEnhance) : getCapabilities(ctx).canAutoEnhance;
    },
    handler: (ctx) => openCopyDialog(ctx, AutoEnhanceModal),
  },
  {
    id: 'cmd:assistant_album_book',
    labelKey: 'book_export_album_action',
    descriptionKey: 'cmdk_cmd_assistant_album_book_description',
    icon: mdiBookOpenPageVariantOutline,
    featureFlag: 'assistant',
    isAvailable: (ctx) => {
      const album = getAlbum(ctx);
      return !!album && isEnabled(getAlbumBookActions(get(t), album.album).ExportAsBook);
    },
    handler: (ctx) => {
      const album = ctx ? getAlbum(ctx) : null;
      return album ? modalManager.show(AlbumBookExportModal, { album: album.album }) : undefined;
    },
  },
  {
    id: 'cmd:assistant_create_album',
    labelKey: 'cmdk_cmd_assistant_create_album_label',
    descriptionKey: 'cmdk_cmd_assistant_create_album_description',
    icon: mdiImageAlbum,
    featureFlag: 'assistant',
    handler: () => openAssistant({ prompt: get(t)('album_create_prompt') }),
  },
  {
    id: 'cmd:assistant_create_book',
    labelKey: 'cmdk_cmd_assistant_create_book_label',
    descriptionKey: 'cmdk_cmd_assistant_create_book_description',
    icon: mdiBookOpenPageVariantOutline,
    featureFlag: 'assistant',
    handler: () => openAssistant({ prompt: get(t)('book_create_prompt') }),
  },
];
