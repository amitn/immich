import { AssetVisibility } from '@immich/sdk';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import { timelineAssetFactory } from '@test-data/factories/asset-factory';
import {
  getAssistantSelectionCapabilities,
  type AssistantCapabilityContext,
  type AssistantFeatures,
  type AssistantSelectionCapabilities,
} from './assistant-selection-capabilities';

const ME = 'me';
const ALL: AssistantFeatures = { assistant: true, artisticStyles: true };

const photo = (overrides: Partial<TimelineAsset> = {}) =>
  timelineAssetFactory.build({ ownerId: ME, isImage: true, isVideo: false, isTrashed: false, ...overrides });
const video = (overrides: Partial<TimelineAsset> = {}) => photo({ isImage: false, isVideo: true, ...overrides });
const theirs = (overrides: Partial<TimelineAsset> = {}) => photo({ ownerId: 'someone-else', ...overrides });

const ctx = (
  assets: TimelineAsset[],
  surface: Partial<Pick<AssistantCapabilityContext, 'album' | 'space'>> = {},
): AssistantCapabilityContext => ({
  selection:
    assets.length === 0
      ? null
      : {
          assets,
          selectedAssetIds: assets.map(({ id }) => id),
          ownedSelectedAssetIds: assets.filter(({ ownerId }) => ownerId === ME).map(({ id }) => id),
        },
  album: surface.album ?? null,
  space: surface.space ?? null,
});

const NONE: AssistantSelectionCapabilities = {
  canAskAssistant: false,
  canMakeCollage: false,
  canMakeHighlightVideo: false,
  canName: false,
  canArtisticStyle: false,
  canAutoEnhance: false,
};

describe(getAssistantSelectionCapabilities.name, () => {
  it('should allow nothing without a selection', () => {
    expect(getAssistantSelectionCapabilities(ctx([]), ALL)).toEqual(NONE);
  });

  it('should allow every action on one photo of the user', () => {
    expect(getAssistantSelectionCapabilities(ctx([photo()]), ALL)).toEqual({
      canAskAssistant: true,
      canMakeCollage: false,
      canMakeHighlightVideo: true,
      canName: true,
      canArtisticStyle: true,
      canAutoEnhance: true,
    });
  });

  describe('the photos of others (#21)', () => {
    it("should use another member's photo read-only: a chat and a highlight video, but no naming and no copies", () => {
      expect(getAssistantSelectionCapabilities(ctx([theirs()], { space: { id: 's', canWrite: false } }), ALL)).toEqual({
        ...NONE,
        canAskAssistant: true,
        canMakeHighlightVideo: true,
      });
    });

    it('should not make copies of the photo of others even for an editor of the space', () => {
      const caps = getAssistantSelectionCapabilities(ctx([theirs()], { space: { id: 's', canWrite: true } }), ALL);
      expect(caps.canArtisticStyle).toBe(false);
      expect(caps.canAutoEnhance).toBe(false);
      expect(caps.canName).toBe(false);
    });

    it('should name a mixed selection, like noodle shares its owned subset', () => {
      const caps = getAssistantSelectionCapabilities(ctx([photo(), theirs()]), ALL);
      expect(caps.canName).toBe(true);
      expect(caps.canMakeCollage).toBe(true);
      expect(caps.canMakeHighlightVideo).toBe(true);
    });

    it('should put the photos of others into a collage', () => {
      expect(getAssistantSelectionCapabilities(ctx([theirs(), theirs()]), ALL).canMakeCollage).toBe(true);
    });
  });

  describe('collages', () => {
    it('should take 2 to 9 photos', () => {
      const photos = (count: number) => Array.from({ length: count }, () => photo());
      expect(getAssistantSelectionCapabilities(ctx(photos(1)), ALL).canMakeCollage).toBe(false);
      expect(getAssistantSelectionCapabilities(ctx(photos(2)), ALL).canMakeCollage).toBe(true);
      expect(getAssistantSelectionCapabilities(ctx(photos(9)), ALL).canMakeCollage).toBe(true);
      expect(getAssistantSelectionCapabilities(ctx(photos(10)), ALL).canMakeCollage).toBe(false);
    });

    it('should not take videos', () => {
      expect(getAssistantSelectionCapabilities(ctx([photo(), video()]), ALL).canMakeCollage).toBe(false);
    });

    it('should add the collage to an album the user owns or edits', () => {
      const album = { id: 'album-1', isOwner: false, isEditor: true };
      expect(getAssistantSelectionCapabilities(ctx([photo(), photo()], { album }), ALL).collageAlbumId).toBe('album-1');
      expect(
        getAssistantSelectionCapabilities(ctx([photo(), photo()], { album: { ...album, isEditor: false } }), ALL)
          .collageAlbumId,
      ).toBeUndefined();
    });

    it('should add the collage to an album of a space the user edits', () => {
      const album = { id: 'album-1', isOwner: false, isEditor: false };
      const caps = getAssistantSelectionCapabilities(
        ctx([photo(), photo()], { album, space: { id: 's', canWrite: true } }),
        ALL,
      );
      expect(caps.collageAlbumId).toBe('album-1');
      expect(
        getAssistantSelectionCapabilities(ctx([photo(), photo()], { album, space: { id: 's', canWrite: false } }), ALL)
          .collageAlbumId,
      ).toBeUndefined();
    });

    it('should keep a collage of a space timeline in the timeline', () => {
      const caps = getAssistantSelectionCapabilities(
        ctx([photo(), photo()], { space: { id: 's', canWrite: true } }),
        ALL,
      );
      expect(caps.canMakeCollage).toBe(true);
      expect(caps.collageAlbumId).toBeUndefined();
    });
  });

  describe('copies', () => {
    it('should make them of one photo at a time', () => {
      const caps = getAssistantSelectionCapabilities(ctx([photo(), photo()]), ALL);
      expect(caps.canArtisticStyle).toBe(false);
      expect(caps.canAutoEnhance).toBe(false);
    });

    it('should not make them of a video', () => {
      const caps = getAssistantSelectionCapabilities(ctx([video()]), ALL);
      expect(caps.canArtisticStyle).toBe(false);
      expect(caps.canAutoEnhance).toBe(false);
    });

    it('should need an art agent for artistic styles, but not the assistant for auto enhance', () => {
      const caps = getAssistantSelectionCapabilities(ctx([photo()]), { assistant: false, artisticStyles: false });
      expect(caps.canArtisticStyle).toBe(false);
      expect(caps.canAutoEnhance).toBe(true);
      expect(caps.canAskAssistant).toBe(false);
    });
  });

  it('should offer nothing on trashed or locked photos, like the viewer', () => {
    expect(getAssistantSelectionCapabilities(ctx([photo(), photo({ isTrashed: true })]), ALL)).toEqual(NONE);
    expect(getAssistantSelectionCapabilities(ctx([photo({ visibility: AssetVisibility.Locked })]), ALL)).toEqual(NONE);
  });

  it('should take a CommandContext as it is', () => {
    const selection = ctx([photo()]).selection;
    const commandContext = {
      routeId: null,
      params: {},
      album: null,
      space: null,
      selection: { ...selection!, ownedAssets: [], canAddToAlbum: false, canAddToSpace: false } as never,
      userId: ME,
      isAdmin: false,
    };
    expect(getAssistantSelectionCapabilities(commandContext, ALL).canAutoEnhance).toBe(true);
  });
});
