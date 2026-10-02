import { AssetTypeEnum, MemoryType, type MemoryResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import HighlightVideoModal from '$lib/modals/HighlightVideoModal.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import MemoryCreationMenuOptions from './MemoryCreationMenuOptions.svelte';

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: { assistant: true }, valueOrUndefined: { assistant: true } } as never,
}));

const memory: MemoryResponseDto = {
  id: 'memory-1',
  ownerId: 'me',
  assets: [assetFactory.build({ id: 'photo', type: AssetTypeEnum.Image })],
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
  type: MemoryType.Rule,
  data: { ruleId: 'recent_trip', context: { placeLabel: 'Athens, Greece' } },
  isSaved: false,
  memoryAt: '2026-09-28T00:00:00.000Z',
};

describe('MemoryCreationMenuOptions', () => {
  beforeEach(() => {
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
  });

  it('should offer a video, a book and a collage of the memory', () => {
    render(MemoryCreationMenuOptions, { props: { memory } });

    expect(screen.getByText('memory_make_video')).toBeInTheDocument();
    expect(screen.getByText('memory_make_book')).toBeInTheDocument();
    expect(screen.getByText('memory_make_collage')).toBeInTheDocument();
  });

  it('should name the video after the card', async () => {
    render(MemoryCreationMenuOptions, { props: { memory } });

    await fireEvent.click(screen.getByText('memory_make_video'));

    // svelte-i18n echoes the key in tests: the card title of a recent trip
    expect(modalManager.show).toHaveBeenCalledWith(HighlightVideoModal, {
      memoryId: 'memory-1',
      title: 'memory_recent_trip_title',
    });
  });
});
