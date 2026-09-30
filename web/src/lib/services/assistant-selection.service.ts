import { getAssetInfo } from '@immich/sdk';
import { modalManager, type ActionItem } from '@immich/ui';
import {
  mdiAutoFix,
  mdiCreationOutline,
  mdiMovieOpenPlayOutline,
  mdiPaletteOutline,
  mdiViewDashboardOutline,
} from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { getCollectionLabel } from '$lib/collections/pack';
import { collectionPacks } from '$lib/collections/registry';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import {
  getAssistantSelectionCapabilities,
  type AssistantCapabilityContext,
  type AssistantFeatures,
  type AssistantSelectionCapabilities,
} from '$lib/managers/assistant-selection-capabilities';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import ArtisticStyleModal from '$lib/modals/ArtisticStyleModal.svelte';
import AutoEnhanceModal from '$lib/modals/AutoEnhanceModal.svelte';
import CollageModal from '$lib/modals/CollageModal.svelte';
import CollectionNameModal from '$lib/modals/CollectionNameModal.svelte';
import HighlightVideoModal from '$lib/modals/HighlightVideoModal.svelte';
import { openAssistant } from '$lib/services/assistant.service';
import { isEnabled } from '$lib/utils';
import { handleError } from '$lib/utils/handle-error';

export const getAssistantFeatures = (): AssistantFeatures => {
  const flags = featureFlagsManager.valueOrUndefined;
  return { assistant: !!flags?.assistant, artisticStyles: !!flags?.artisticStyles };
};

/** the selection the actions work on: the page's multi-select manager */
export type AssistantSelection = { assets: TimelineAsset[]; ownedAssets: TimelineAsset[]; clear: () => void };

/** The capabilities of a multi-selection, on the timeline, an album or an album of a space */
export const getMultiSelectAssistantCapabilities = ({
  album = null,
  space = null,
  selection = assetMultiSelectManager,
}: Partial<Pick<AssistantCapabilityContext, 'album' | 'space'>> & {
  selection?: AssistantSelection;
} = {}): AssistantSelectionCapabilities => {
  const { assets, ownedAssets } = selection;
  return getAssistantSelectionCapabilities(
    {
      selection:
        assets.length === 0
          ? null
          : {
              assets,
              selectedAssetIds: assets.map(({ id }) => id),
              ownedSelectedAssetIds: ownedAssets.map(({ id }) => id),
            },
      album,
      space,
    },
    getAssistantFeatures(),
  );
};

/**
 * The assistant's actions on a selection of photos, each once: in the selection bar of the timeline, of an album and
 * of a space (noodle's `SelectionToolbar`), gated by `getAssistantSelectionCapabilities` only. `AskAssistant` is a
 * button of the bar, the others go in its ⋮ menu (`AssistantSelectionMenuItems`).
 */
export const getAssistantSelectionActions = (
  $t: MessageFormatter,
  caps: AssistantSelectionCapabilities,
  { selection = assetMultiSelectManager, spaceId }: { selection?: AssistantSelection; spaceId?: string } = {},
) => {
  /** the selected photos, handed to the dialog; the selection ends as it opens */
  const takeSelection = () => {
    const assetIds = selection.assets.map(({ id }) => id);
    selection.clear();
    return assetIds;
  };

  /** a copy (an artwork, an enhanced copy) of the one photo selected, like the viewer's */
  const openCopyDialog = async (modal: typeof ArtisticStyleModal | typeof AutoEnhanceModal) => {
    const [selected] = selection.assets;
    if (!selected) {
      return;
    }
    try {
      const asset = await getAssetInfo({ id: selected.id });
      selection.clear();
      await modalManager.show(modal, { asset });
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_asset'));
    }
  };

  const AskAssistant: ActionItem = {
    title: $t('ask_assistant'),
    icon: mdiCreationOutline,
    $if: () => caps.canAskAssistant,
    onAction: () => openAssistant({ assetIds: takeSelection() }),
  };

  /**
   * One per pack, e.g. "Name the dishes…": the dialog names the user's own photos, and the photos of others help to
   * read the names (#21), like a menu a friend photographed. A pack is offered when it is available (e.g. smart search
   * is on); which photos match it is only known once the dialog looks.
   */
  const NameActions = collectionPacks.map((pack): ActionItem => ({
    title: $t(getCollectionLabel(pack, 'name_action')),
    icon: pack.icon,
    $if: () => caps.canName && pack.isAvailable(),
    onAction: () => modalManager.show(CollectionNameModal, { pack, assetIds: takeSelection() }),
  }));

  const MakeHighlightVideo: ActionItem = {
    title: $t('highlight_video_make_action'),
    icon: mdiMovieOpenPlayOutline,
    $if: () => caps.canMakeHighlightVideo,
    onAction: () => modalManager.show(HighlightVideoModal, { assetIds: takeSelection() }),
  };

  /** "Make a collage…" of the 2 to 9 selected photos, added to the album when made in one the user can add to */
  const MakeCollage: ActionItem = {
    title: $t('collage_make_action'),
    icon: mdiViewDashboardOutline,
    $if: () => caps.canMakeCollage,
    onAction: () =>
      modalManager.show(CollageModal, {
        assetIds: takeSelection(),
        albumId: caps.collageAlbumId,
        spaceId: caps.collageAlbumId ? spaceId : undefined,
      }),
  };

  const ArtisticStyle: ActionItem = {
    title: $t('artistic_style'),
    icon: mdiPaletteOutline,
    $if: () => caps.canArtisticStyle,
    onAction: () => openCopyDialog(ArtisticStyleModal),
  };

  // local image processing, so it does not depend on the assistant being configured
  const AutoEnhance: ActionItem = {
    title: $t('auto_enhance'),
    icon: mdiAutoFix,
    $if: () => caps.canAutoEnhance,
    onAction: () => openCopyDialog(AutoEnhanceModal),
  };

  return { AskAssistant, NameActions, MakeHighlightVideo, MakeCollage, ArtisticStyle, AutoEnhance };
};

export type AssistantSelectionActions = ReturnType<typeof getAssistantSelectionActions>;

/** Whether any action of the ⋮ menu is offered, for a bar that has no menu of its own otherwise */
export const hasAssistantMenuActions = ({
  NameActions,
  MakeHighlightVideo,
  MakeCollage,
  ArtisticStyle,
  AutoEnhance,
}: AssistantSelectionActions) =>
  [...NameActions, MakeHighlightVideo, MakeCollage, ArtisticStyle, AutoEnhance].some((action) => isEnabled(action));
