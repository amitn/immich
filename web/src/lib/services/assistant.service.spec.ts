import { goto } from '$app/navigation';
import { getAssistantUrlContext, openAssistant, takePendingAssistantAssets } from '$lib/services/assistant.service';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

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
});
