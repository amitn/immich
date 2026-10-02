import { getAssetInfo } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import type { Mock } from 'vitest';
import { goto } from '$app/navigation';
import { foodPack } from '$lib/journals/packs/food';
import type { AssistantSelectionCapabilities } from '$lib/managers/assistant-selection-capabilities';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import ArtisticStyleModal from '$lib/modals/ArtisticStyleModal.svelte';
import AutoEnhanceModal from '$lib/modals/AutoEnhanceModal.svelte';
import CollageModal from '$lib/modals/CollageModal.svelte';
import HighlightVideoModal from '$lib/modals/HighlightVideoModal.svelte';
import JournalNameModal from '$lib/modals/JournalNameModal.svelte';
import {
  getAssistantSelectionActions,
  getMultiSelectAssistantCapabilities,
  hasAssistantMenuActions,
  type AssistantSelection,
} from '$lib/services/assistant-selection.service';
import { assetFactory, timelineAssetFactory } from '@test-data/factories/asset-factory';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('@immich/sdk', async (original) => ({
  ...(await original<typeof import('@immich/sdk')>()),
  getAssetInfo: vi.fn(),
}));

const { flags } = vi.hoisted(() => ({ flags: { assistant: true, artisticStyles: true, smartSearch: true } }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: flags, valueOrUndefined: flags } as never,
}));

const $t = ((key: string) => key) as MessageFormatter;

const ALL: AssistantSelectionCapabilities = {
  canAskAssistant: true,
  canMakeCollage: true,
  canMakeHighlightVideo: true,
  canName: true,
  canArtisticStyle: true,
  canAutoEnhance: true,
};
const NONE: AssistantSelectionCapabilities = {
  canAskAssistant: false,
  canMakeCollage: false,
  canMakeHighlightVideo: false,
  canName: false,
  canArtisticStyle: false,
  canAutoEnhance: false,
};

const makeSelection = (assets: TimelineAsset[], owned = assets): AssistantSelection & { clear: Mock<() => void> } => ({
  assets,
  ownedAssets: owned,
  clear: vi.fn(),
});

describe('assistant selection service', () => {
  beforeEach(() => {
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    vi.mocked(goto).mockReset();
    flags.assistant = true;
    flags.artisticStyles = true;
    flags.smartSearch = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe(getAssistantSelectionActions.name, () => {
    it('should offer only what the capabilities allow', () => {
      const selection = makeSelection([timelineAssetFactory.build()]);
      const none = getAssistantSelectionActions($t, NONE, { selection });
      expect(hasAssistantMenuActions(none)).toBe(false);
      expect(none.AskAssistant.$if?.()).toBe(false);

      const all = getAssistantSelectionActions($t, ALL, { selection });
      expect(hasAssistantMenuActions(all)).toBe(true);
      for (const action of [
        all.AskAssistant,
        all.MakeHighlightVideo,
        all.MakeCollage,
        all.ArtisticStyle,
        all.AutoEnhance,
      ]) {
        expect(action.$if?.(), action.title).toBe(true);
      }
    });

    it('should give every pack its own title, the one the menus key their items by', () => {
      const { NameActions } = getAssistantSelectionActions($t, ALL);
      const titles = NameActions.map(({ title }) => title);
      expect(titles).toContain('journals.food.name_action');
      expect(new Set(titles).size).toBe(titles.length);
    });

    it('should not offer a pack that is not available, e.g. without smart search', () => {
      flags.smartSearch = false;
      const { NameActions } = getAssistantSelectionActions($t, ALL);
      expect(NameActions.every((action) => action.$if?.() === false)).toBe(true);
    });

    it('should ask the assistant about the selection and end it', async () => {
      const assets = [timelineAssetFactory.build(), timelineAssetFactory.build()];
      const selection = makeSelection(assets);
      const { AskAssistant } = getAssistantSelectionActions($t, ALL, { selection });

      await AskAssistant.onAction(AskAssistant);

      expect(selection.clear).toHaveBeenCalled();
      expect(goto).toHaveBeenCalledWith(
        `/assistant?assetIds=${encodeURIComponent(assets.map(({ id }) => id).join(','))}`,
      );
    });

    it('should name all of the selection: the dialog names the own photos and reads the others', async () => {
      const [mine, theirs] = [timelineAssetFactory.build(), timelineAssetFactory.build()];
      const selection = makeSelection([mine, theirs], [mine]);
      const [NameDishes] = getAssistantSelectionActions($t, ALL, { selection }).NameActions;

      await NameDishes.onAction(NameDishes);

      expect(modalManager.show).toHaveBeenCalledWith(JournalNameModal, {
        pack: foodPack,
        assetIds: [mine.id, theirs.id],
      });
    });

    it('should make a highlight video of the selection', async () => {
      const selection = makeSelection([timelineAssetFactory.build()]);
      const { MakeHighlightVideo } = getAssistantSelectionActions($t, ALL, { selection });

      await MakeHighlightVideo.onAction(MakeHighlightVideo);

      expect(modalManager.show).toHaveBeenCalledWith(HighlightVideoModal, { assetIds: [selection.assets[0].id] });
      expect(selection.clear).toHaveBeenCalled();
    });

    it('should add a collage to the album, and open it in the space of an album of a space', async () => {
      const selection = makeSelection([timelineAssetFactory.build(), timelineAssetFactory.build()]);
      const assetIds = selection.assets.map(({ id }) => id);
      const { MakeCollage } = getAssistantSelectionActions(
        $t,
        { ...ALL, collageAlbumId: 'album-1' },
        { selection, spaceId: 'space-1' },
      );

      await MakeCollage.onAction(MakeCollage);

      expect(modalManager.show).toHaveBeenCalledWith(CollageModal, {
        assetIds,
        albumId: 'album-1',
        spaceId: 'space-1',
      });
    });

    it('should keep a collage in the timeline when the album is not one the user can add to', async () => {
      const selection = makeSelection([timelineAssetFactory.build(), timelineAssetFactory.build()]);
      const { MakeCollage } = getAssistantSelectionActions($t, ALL, { selection, spaceId: 'space-1' });

      await MakeCollage.onAction(MakeCollage);

      expect(modalManager.show).toHaveBeenCalledWith(CollageModal, {
        assetIds: selection.assets.map(({ id }) => id),
        albumId: undefined,
        spaceId: undefined,
      });
    });

    it.each([
      ['ArtisticStyle', ArtisticStyleModal],
      ['AutoEnhance', AutoEnhanceModal],
    ] as const)('should open %s on the one photo selected, as the viewer does', async (name, modal) => {
      const asset = assetFactory.build();
      vi.mocked(getAssetInfo).mockResolvedValue(asset);
      const selection = makeSelection([timelineAssetFactory.build({ id: asset.id })]);
      const action = getAssistantSelectionActions($t, ALL, { selection })[name];

      await action.onAction(action);

      expect(getAssetInfo).toHaveBeenCalledWith({ id: asset.id });
      expect(modalManager.show).toHaveBeenCalledWith(modal, { asset });
      expect(selection.clear).toHaveBeenCalled();
    });
  });

  describe(getMultiSelectAssistantCapabilities.name, () => {
    it('should read the selection and its owned subset', () => {
      const [mine, theirs] = [
        timelineAssetFactory.build({ isImage: true, isTrashed: false }),
        timelineAssetFactory.build({ isImage: true, isTrashed: false }),
      ];
      const caps = getMultiSelectAssistantCapabilities({
        selection: makeSelection([mine, theirs], [mine]),
        album: { id: 'album-1', isOwner: true, isEditor: true },
      });
      expect(caps.canName).toBe(true);
      expect(caps.canMakeCollage).toBe(true);
      expect(caps.collageAlbumId).toBe('album-1');

      expect(getMultiSelectAssistantCapabilities({ selection: makeSelection([theirs], []) }).canName).toBe(false);
      expect(getMultiSelectAssistantCapabilities({ selection: makeSelection([]) }).canAskAssistant).toBe(false);
    });
  });
});
