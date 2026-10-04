import { AssetTypeEnum } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';
import { goto } from '$app/navigation';
import {
  getAssistantAssetActions,
  getAssistantUrlContext,
  openAssistant,
  takePendingAssistantAssets,
} from '$lib/services/assistant.service';
import { assetFactory } from '@test-data/factories/asset-factory';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { user } = vi.hoisted(() => ({ user: { id: 'me' } }));

vi.mock(import('$lib/managers/auth-manager.svelte'), () => ({
  authManager: { authenticated: true, user, params: {} } as never,
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: { assistant: true, artisticStyles: true } } as never,
}));

const ids = (count: number) => Array.from({ length: count }, (_, i) => `asset-${i}`);

describe('assistant service', () => {
  beforeEach(() => {
    vi.mocked(goto).mockReset();
    takePendingAssistantAssets();
  });

  describe(getAssistantUrlContext.name, () => {
    it('should read asset ids and the prompt', () => {
      const url = new URL('https://example.com/assistant?assetIds=a%2Cb%2C%2Ca&prompt=Hello');
      expect(getAssistantUrlContext(url)).toEqual({ assetIds: ['a', 'b'], prompt: 'Hello' });
    });

    it('should default to an empty context', () => {
      expect(getAssistantUrlContext(new URL('https://example.com/assistant'))).toEqual({ assetIds: [], prompt: '' });
    });
  });

  describe(openAssistant.name, () => {
    it('should pass a small selection in the URL', async () => {
      await openAssistant({ assetIds: ['a', 'b'] });

      expect(goto).toHaveBeenCalledWith('/assistant?assetIds=a%2Cb');
      expect(takePendingAssistantAssets()).toEqual([]);
    });

    it('should hand a large selection over in memory', async () => {
      await openAssistant({ assetIds: ids(100), prompt: 'Make an album' });

      expect(goto).toHaveBeenCalledWith('/assistant?prompt=Make%20an%20album');
      expect(takePendingAssistantAssets()).toHaveLength(100);
      expect(takePendingAssistantAssets()).toEqual([]);
    });

    it('should open an empty chat', async () => {
      await openAssistant();
      expect(goto).toHaveBeenCalledWith('/assistant');
    });
  });

  describe(getAssistantAssetActions.name, () => {
    const $t = ((key: string) => key) as unknown as MessageFormatter;
    const shown = (ownerId: string) => {
      const asset = assetFactory.build({ ownerId, type: AssetTypeEnum.Image, isTrashed: false });
      const actions = getAssistantAssetActions($t, asset);
      return Object.entries(actions)
        .filter(([, action]) => action.$if?.() ?? true)
        .map(([name]) => name);
    };

    it('should offer the copies of a photo to its owner', () => {
      expect(shown('me')).toEqual(['AskAssistant', 'ArtisticStyle', 'AutoEnhance', 'Redact']);
    });

    it("should not offer copies of someone else's photo, e.g. of a shared space", () => {
      expect(shown('another-member')).toEqual(['AskAssistant']);
    });
  });
});
