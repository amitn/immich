import { AssetTypeEnum, getAssetInfo, type AlbumResponseDto, type AssetResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { goto } from '$app/navigation';
import en from '$i18n/en.json';
import { foodPack } from '$lib/journals/packs/food';
import { collectionPacks } from '$lib/journals/registry';
import { assistantCommandContext } from '$lib/managers/assistant-command-context.svelte';
import type { CommandContext, SelectionCommandContext } from '$lib/managers/command-context-manager.svelte';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import AlbumBookExportModal from '$lib/modals/AlbumBookExportModal.svelte';
import ArtisticStyleModal from '$lib/modals/ArtisticStyleModal.svelte';
import AutoEnhanceModal from '$lib/modals/AutoEnhanceModal.svelte';
import CollageModal from '$lib/modals/CollageModal.svelte';
import HighlightVideoModal from '$lib/modals/HighlightVideoModal.svelte';
import JournalNameModal from '$lib/modals/JournalNameModal.svelte';
import { albumFactory } from '@test-data/factories/album-factory';
import { assetFactory, timelineAssetFactory } from '@test-data/factories/asset-factory';
import { ASSISTANT_COMMAND_ITEMS } from './assistant-command-items';
import { COMMAND_ITEMS } from './command-items';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { mockPage, flags, viewer } = vi.hoisted(() => ({
  mockPage: {
    route: { id: '/(user)/photos/[[assetId=id]]' as string | null },
    params: {},
    url: new URL('http://localhost/photos'),
  },
  flags: { assistant: true, artisticStyles: true, smartSearch: true } as Record<string, boolean>,
  viewer: { isViewing: false, asset: undefined as unknown },
}));

vi.mock('$app/state', () => ({ page: mockPage }));

vi.mock(import('$lib/managers/auth-manager.svelte'), () => ({
  authManager: { authenticated: true, user: { id: 'me', isAdmin: false }, preferences: {} } as never,
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: flags, valueOrUndefined: flags } as never,
}));

vi.mock(import('$lib/managers/asset-viewer-manager.svelte'), () => ({
  assetViewerManager: viewer as never,
}));

vi.mock('@immich/sdk', async (original) => ({
  ...(await original<typeof import('@immich/sdk')>()),
  getAssetInfo: vi.fn(),
}));

const command = (id: string) => {
  const item = ASSISTANT_COMMAND_ITEMS.find((c) => c.id === id);
  if (!item) {
    throw new Error(`no command ${id}`);
  }
  return item;
};
const nameCommand = command('cmd:assistant_name_food');

const photo = (overrides: Partial<TimelineAsset> = {}) =>
  timelineAssetFactory.build({ ownerId: 'me', isImage: true, isVideo: false, isTrashed: false, ...overrides });

const selectionOf = (assets: TimelineAsset[]): SelectionCommandContext => {
  const owned = assets.filter(({ ownerId }) => ownerId === 'me');
  return {
    assets,
    selectedAssetIds: assets.map(({ id }) => id),
    ownedAssets: owned,
    ownedSelectedAssetIds: owned.map(({ id }) => id),
    canAddToAlbum: false,
    canAddToSpace: false,
    isAllUserOwned: owned.length === assets.length,
    isAllFavorite: false,
    isAllArchived: false,
    isAllTrashed: false,
    clearSelection: vi.fn(),
  };
};

const makeCtx = (overrides: Partial<CommandContext> = {}): CommandContext => ({
  routeId: mockPage.route.id,
  params: {},
  album: null,
  space: null,
  selection: null,
  userId: 'me',
  isAdmin: false,
  ...overrides,
});

const albumCtx = (album: AlbumResponseDto, overrides: Partial<NonNullable<CommandContext['album']>> = {}) => ({
  id: album.id,
  albumName: album.albumName,
  ownerId: 'me',
  isOwner: true,
  isEditor: true,
  isMember: true,
  raw: album,
  ...overrides,
});

/** registers an album of a space, as its page does */
const registerSpaceAlbum = (album: AlbumResponseDto, canWrite: boolean) => {
  const token = Symbol('test');
  assistantCommandContext.set({
    routeId: mockPage.route.id,
    token,
    get: () => ({ album, isOwner: false, isEditor: false, space: { id: 'space-1', canWrite } }),
  });
  return () => assistantCommandContext.clear(token);
};

describe('ASSISTANT_COMMAND_ITEMS', () => {
  beforeEach(() => {
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    vi.mocked(goto).mockReset();
    vi.mocked(getAssetInfo).mockReset();
    viewer.isViewing = false;
    viewer.asset = undefined;
    flags.smartSearch = true;
    mockPage.route.id = '/(user)/photos/[[assetId=id]]';
  });

  afterEach(() => {
    assistantCommandContext.set(null);
    vi.restoreAllMocks();
  });

  it('should be palette commands, with ids of their own', () => {
    for (const item of ASSISTANT_COMMAND_ITEMS) {
      expect(COMMAND_ITEMS).toContain(item);
      expect(item.id).toMatch(/^cmd:assistant_[a-z0-9_]+$/);
    }
    expect(new Set(COMMAND_ITEMS.map(({ id }) => id)).size).toBe(COMMAND_ITEMS.length);
  });

  it('should have a command per collection pack', () => {
    for (const pack of collectionPacks) {
      expect(command(`cmd:assistant_name_${pack.id.replaceAll('-', '_')}`).labelKey).toBe(
        `journals.${pack.id}.name_action`,
      );
    }
  });

  it('should have English labels and descriptions', () => {
    const translate = (key: string) => {
      let node: unknown = en;
      for (const part of key.split('.')) {
        node = (node as Record<string, unknown> | undefined)?.[part];
      }
      return node;
    };
    for (const item of ASSISTANT_COMMAND_ITEMS) {
      expect(typeof translate(item.labelKey), item.labelKey).toBe('string');
      expect(typeof translate(item.descriptionKey), item.descriptionKey).toBe('string');
    }
  });

  describe('cmd:assistant_ask', () => {
    const ask = command('cmd:assistant_ask');

    it('should need the assistant', () => {
      expect(ask.featureFlag).toBe('assistant');
    });

    it('should open a chat about the selection, and end it', async () => {
      const selection = selectionOf([photo({ id: 'a' }), photo({ id: 'b', ownerId: 'someone-else' })]);
      await ask.handler(makeCtx({ selection }));
      expect(selection.clearSelection).toHaveBeenCalled();
      expect(goto).toHaveBeenCalledWith('/assistant?assetIds=a%2Cb');
    });

    it('should open a chat about the photo open in the viewer', async () => {
      viewer.isViewing = true;
      viewer.asset = assetFactory.build({ id: 'open', ownerId: 'someone-else' });
      await ask.handler(makeCtx());
      expect(goto).toHaveBeenCalledWith('/assistant?assetIds=open');
    });

    it('should open an empty chat otherwise', async () => {
      await ask.handler(makeCtx());
      expect(goto).toHaveBeenCalledWith('/assistant');
    });
  });

  describe('cmd:assistant_highlight_video', () => {
    const highlight = command('cmd:assistant_highlight_video');

    it('should make a video of the selection, the photos of others too', async () => {
      const selection = selectionOf([photo({ id: 'theirs', ownerId: 'someone-else' })]);
      const ctx = makeCtx({ selection });
      expect(highlight.isAvailable?.(ctx)).toBe(true);
      await highlight.handler(ctx);
      expect(modalManager.show).toHaveBeenCalledWith(HighlightVideoModal, { assetIds: ['theirs'] });
    });

    it('should make a video of the album when nothing is selected', async () => {
      mockPage.route.id = '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]';
      const album = albumFactory.build({ assetCount: 3 });
      const ctx = makeCtx({ album: albumCtx(album) });
      expect(highlight.isAvailable?.(ctx)).toBe(true);
      await highlight.handler(ctx);
      expect(modalManager.show).toHaveBeenCalledWith(HighlightVideoModal, {
        albumId: album.id,
        title: album.albumName,
      });
    });

    it('should not be offered without a selection or an album with photos', () => {
      expect(highlight.isAvailable?.(makeCtx())).toBe(false);
      const empty = albumFactory.build({ assetCount: 0 });
      expect(highlight.isAvailable?.(makeCtx({ album: albumCtx(empty) }))).toBe(false);
    });
  });

  describe('cmd:assistant_collage', () => {
    const collage = command('cmd:assistant_collage');

    it('should take 2 to 9 photos', () => {
      expect(collage.isAvailable?.(makeCtx({ selection: selectionOf([photo()]) }))).toBe(false);
      expect(collage.isAvailable?.(makeCtx({ selection: selectionOf([photo(), photo()]) }))).toBe(true);
    });

    it('should add the collage to an album of a space the user edits, and open it there', async () => {
      mockPage.route.id = '/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]';
      const album = albumFactory.build({ assetCount: 3 });
      const unregister = registerSpaceAlbum(album, true);
      const selection = selectionOf([photo({ id: 'a' }), photo({ id: 'b' })]);

      await collage.handler(makeCtx({ selection }));

      expect(modalManager.show).toHaveBeenCalledWith(CollageModal, {
        assetIds: ['a', 'b'],
        albumId: album.id,
        spaceId: 'space-1',
      });
      unregister();
    });
  });

  describe('cmd:assistant_name_*', () => {
    it('should not name the photos of others (#21)', () => {
      const selection = selectionOf([photo({ ownerId: 'someone-else' })]);
      expect(nameCommand.isAvailable?.(makeCtx({ selection }))).toBe(false);
    });

    it('should name a mixed selection, the others helping to read', async () => {
      const selection = selectionOf([photo({ id: 'mine' }), photo({ id: 'theirs', ownerId: 'someone-else' })]);
      const ctx = makeCtx({ selection });
      expect(nameCommand.isAvailable?.(ctx)).toBe(true);
      await nameCommand.handler(ctx);
      expect(modalManager.show).toHaveBeenCalledWith(JournalNameModal, {
        pack: foodPack,
        assetIds: ['mine', 'theirs'],
      });
    });

    it('should name the photos of the album, also of an album of a space', async () => {
      mockPage.route.id = '/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]';
      const album = albumFactory.build({ assetCount: 3 });
      const unregister = registerSpaceAlbum(album, false);

      expect(nameCommand.isAvailable?.(makeCtx())).toBe(true);
      await nameCommand.handler(makeCtx());
      expect(modalManager.show).toHaveBeenCalledWith(JournalNameModal, { pack: foodPack, album });
      unregister();
    });

    it('should ignore an album context left behind by another page', () => {
      const album = albumFactory.build({ assetCount: 3 });
      mockPage.route.id = '/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]';
      const unregister = registerSpaceAlbum(album, false);
      mockPage.route.id = '/(user)/photos/[[assetId=id]]';
      expect(nameCommand.isAvailable?.(makeCtx())).toBe(false);
      unregister();
    });

    it('should not be offered when the pack is not available', () => {
      flags.smartSearch = false;
      expect(nameCommand.isAvailable?.(makeCtx({ selection: selectionOf([photo()]) }))).toBe(false);
    });
  });

  describe.each([
    ['cmd:assistant_artistic_style', ArtisticStyleModal],
    ['cmd:assistant_auto_enhance', AutoEnhanceModal],
  ] as const)('%s', (id, modal) => {
    const copy = command(id);

    it("should work on the user's own photo open in the viewer, not on someone else's", async () => {
      viewer.isViewing = true;
      const mine = assetFactory.build({ ownerId: 'me', type: AssetTypeEnum.Image, isTrashed: false });
      viewer.asset = mine;
      expect(copy.isAvailable?.(makeCtx())).toBe(true);
      await copy.handler(makeCtx());
      expect(modalManager.show).toHaveBeenCalledWith(modal, { asset: mine });

      viewer.asset = { ...mine, ownerId: 'someone-else' } satisfies AssetResponseDto;
      expect(copy.isAvailable?.(makeCtx())).toBe(false);
    });

    it("should work on one selected photo of the user's", async () => {
      const asset = assetFactory.build({ id: 'mine' });
      vi.mocked(getAssetInfo).mockResolvedValue(asset);
      const selection = selectionOf([photo({ id: 'mine' })]);
      expect(copy.isAvailable?.(makeCtx({ selection }))).toBe(true);
      await copy.handler(makeCtx({ selection }));
      expect(modalManager.show).toHaveBeenCalledWith(modal, { asset });

      expect(copy.isAvailable?.(makeCtx({ selection: selectionOf([photo({ ownerId: 'someone-else' })]) }))).toBe(false);
      expect(copy.isAvailable?.(makeCtx({ selection: selectionOf([photo(), photo()]) }))).toBe(false);
    });
  });

  describe('cmd:assistant_album_book', () => {
    const book = command('cmd:assistant_album_book');

    it('should export the album of the page as a book', async () => {
      mockPage.route.id = '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]';
      const album = albumFactory.build({ assetCount: 3 });
      const ctx = makeCtx({ album: albumCtx(album, { isOwner: false, isEditor: false }) });
      expect(book.isAvailable?.(ctx)).toBe(true);
      await book.handler(ctx);
      expect(modalManager.show).toHaveBeenCalledWith(AlbumBookExportModal, { album });
    });

    it('should not be offered outside an album', () => {
      expect(book.isAvailable?.(makeCtx())).toBe(false);
    });
  });

  it('should start the chats that create an album and a book', async () => {
    await command('cmd:assistant_create_album').handler(makeCtx());
    await command('cmd:assistant_create_book').handler(makeCtx());
    expect(goto).toHaveBeenCalledWith(expect.stringMatching(/^\/assistant\?prompt=/));
    expect(goto).toHaveBeenCalledTimes(2);
  });
});
