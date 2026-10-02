import { AssetTypeEnum, MemoryType, type MemoryResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import { goto } from '$app/navigation';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import CollageModal from '$lib/modals/CollageModal.svelte';
import HighlightVideoModal from '$lib/modals/HighlightVideoModal.svelte';
import { getMemoryCreations, makeMemoryBook } from '$lib/services/memory-creations.service';
import { handleError } from '$lib/utils/handle-error';
import { assetFactory } from '@test-data/factories/asset-factory';
import { bookDetailFactory } from '@test-data/factories/book-factory';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/utils/handle-error', () => ({ handleError: vi.fn() }));

const { flags } = vi.hoisted(() => ({ flags: { assistant: true } }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: flags, valueOrUndefined: flags } as never,
}));

const $t = ((key: string) => key) as MessageFormatter;

const memory = (types: AssetTypeEnum[] = [AssetTypeEnum.Image, AssetTypeEnum.Image]): MemoryResponseDto => ({
  id: 'memory-1',
  ownerId: 'me',
  assets: types.map((type, i) => assetFactory.build({ id: `asset-${i}`, type })),
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
  type: MemoryType.Rule,
  data: { ruleId: 'recent_trip', context: { placeLabel: 'Athens, Greece' } },
  isSaved: false,
  memoryAt: '2026-09-28T00:00:00.000Z',
});

describe('memory creations service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    flags.assistant = true;
    vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    vi.spyOn(toastManager, 'primary').mockImplementation(() => {});
    vi.spyOn(toastManager, 'success').mockImplementation(() => {});
  });

  it('should offer a video, a book and a collage of a memory with photos', () => {
    expect(getMemoryCreations($t, memory(), 'Recent trip').map(({ id, title }) => [id, title])).toEqual([
      ['video', 'memory_make_video'],
      ['book', 'memory_make_book'],
      ['collage', 'memory_make_collage'],
    ]);
  });

  it('should offer only a video of a memory of videos, and no book without the assistant', () => {
    expect(getMemoryCreations($t, memory([AssetTypeEnum.Video]), 'Videos').map(({ id }) => id)).toEqual(['video']);
    flags.assistant = false;
    expect(getMemoryCreations($t, memory(), 'Recent trip').map(({ id }) => id)).toEqual(['video', 'collage']);
  });

  it('should open the video and collage dialogs for the memory, named like its card', async () => {
    const [video, , collage] = getMemoryCreations($t, memory(), 'Recent trip to Athens, Greece');

    await video.onAction();
    expect(modalManager.show).toHaveBeenCalledWith(HighlightVideoModal, {
      memoryId: 'memory-1',
      title: 'Recent trip to Athens, Greece',
    });

    await collage.onAction();
    expect(modalManager.show).toHaveBeenCalledWith(CollageModal, {
      memoryId: 'memory-1',
      title: 'Recent trip to Athens, Greece',
    });
  });

  it('should lay out a book of the memory and open it in the editor', async () => {
    const book = bookDetailFactory.build({ id: 'book-1', title: 'Recent trip to Athens, Greece' });
    sdkMock.createBookFromMemory.mockResolvedValue({ ...book, warnings: [] });

    await makeMemoryBook($t, memory(), 'Recent trip to Athens, Greece');

    expect(sdkMock.createBookFromMemory).toHaveBeenCalledWith({
      bookFromMemoryDto: { memoryId: 'memory-1', title: 'Recent trip to Athens, Greece' },
    });
    expect(toastManager.primary).toHaveBeenCalledWith('memory_make_book_started');
    expect(goto).toHaveBeenCalledWith('/books/book-1');
  });

  it('should not open a book that could not be made', async () => {
    sdkMock.createBookFromMemory.mockRejectedValue(new Error('The memory has no photos'));

    await expect(makeMemoryBook($t, memory(), 'Recent trip')).resolves.toBeUndefined();
    expect(goto).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'errors.unable_to_create_book');
  });
});
