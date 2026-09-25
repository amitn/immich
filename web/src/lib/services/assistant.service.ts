import { AssetTypeEnum, AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import { modalManager, type ActionItem } from '@immich/ui';
import { mdiCreationOutline, mdiPaletteOutline } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { goto } from '$app/navigation';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import ArtisticStyleModal from '$lib/modals/ArtisticStyleModal.svelte';
import { Route } from '$lib/route';

/** Above this many assets the ids are handed over in memory instead of in the URL */
const MAX_URL_ASSET_IDS = 40;

let pendingContext: { assetIds: string[] } | undefined;

export type AssistantContext = {
  assetIds: string[];
  prompt: string;
};

/** Open the assistant for a new chat with the given assets and/or a prefilled prompt */
export const openAssistant = async ({ assetIds = [], prompt }: { assetIds?: string[]; prompt?: string } = {}) => {
  if (assetIds.length > MAX_URL_ASSET_IDS) {
    pendingContext = { assetIds };
    await goto(Route.assistant({ prompt }));
    return;
  }

  pendingContext = undefined;
  await goto(Route.assistant({ assetIds, prompt }));
};

/** Read (and consume) the context passed to the assistant page by the URL or by openAssistant */
export const takeAssistantContext = (url: URL): AssistantContext => {
  const fromUrl = (url.searchParams.get('assetIds') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const fromMemory = pendingContext?.assetIds ?? [];
  pendingContext = undefined;

  return {
    assetIds: [...new Set([...fromUrl, ...fromMemory])],
    prompt: url.searchParams.get('prompt') ?? '',
  };
};

export const getAssistantBulkActions = ($t: MessageFormatter) => {
  const AskAssistant: ActionItem = {
    title: $t('ask_assistant'),
    icon: mdiCreationOutline,
    $if: () => featureFlagsManager.value.assistant,
    onAction: async () => {
      const assetIds = assetMultiSelectManager.assets.map(({ id }) => id);
      assetMultiSelectManager.clear();
      await openAssistant({ assetIds });
    },
  };

  return { AskAssistant };
};

export const getAssistantAssetActions = ($t: MessageFormatter, asset: AssetResponseDto) => {
  const isOwner = authManager.authenticated && authManager.user.id === asset.ownerId;
  const isUsable = !asset.isTrashed && asset.visibility !== AssetVisibility.Locked;

  const AskAssistant: ActionItem = {
    title: $t('ask_assistant'),
    icon: mdiCreationOutline,
    $if: () => isUsable && featureFlagsManager.value.assistant,
    onAction: () => openAssistant({ assetIds: [asset.id] }),
  };

  const ArtisticStyle: ActionItem = {
    title: $t('artistic_style'),
    icon: mdiPaletteOutline,
    $if: () => isOwner && isUsable && asset.type === AssetTypeEnum.Image && featureFlagsManager.value.artisticStyles,
    onAction: () => modalManager.show(ArtisticStyleModal, { asset }),
  };

  return { AskAssistant, ArtisticStyle };
};
