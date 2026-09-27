import { discardBookDraft, keepBookDraft, type AlbumResponseDto, type BookResponseDto } from '@immich/sdk';
import { modalManager, toastManager, type ActionItem } from '@immich/ui';
import { mdiBookOpenPageVariantOutline } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import AlbumBookExportModal from '$lib/modals/AlbumBookExportModal.svelte';
import { openAssistant } from '$lib/services/assistant.service';
import { handleError } from '$lib/utils/handle-error';

export const getAlbumBookActions = ($t: MessageFormatter, album: AlbumResponseDto) => {
  const ExportAsBook: ActionItem = {
    title: $t('book_export_album_action'),
    icon: mdiBookOpenPageVariantOutline,
    $if: () => featureFlagsManager.value.assistant && album.assetCount > 0,
    onAction: () => modalManager.show(AlbumBookExportModal, { album }),
  };

  return { ExportAsBook };
};

type DraftBook = Pick<BookResponseDto, 'id' | 'title'>;

/** Keeps a suggested book: it becomes one of the user's books. Returns the kept book, or undefined when it failed */
export const keepBookDraftWithToast = async ($t: MessageFormatter, book: DraftBook) => {
  try {
    const kept = await keepBookDraft({ id: book.id });
    toastManager.success($t('book_draft_kept', { values: { title: book.title } }));
    return kept;
  } catch (error) {
    handleError(error, $t('errors.unable_to_keep_book_draft'));
  }
};

/** Discards a suggested book once the user confirms: it is deleted and not suggested again */
export const discardBookDraftWithConfirm = async ($t: MessageFormatter, book: DraftBook) => {
  const confirmed = await modalManager.showDialog({
    title: $t('book_draft_discard'),
    prompt: $t('book_draft_discard_prompt', { values: { title: book.title } }),
    confirmText: $t('book_draft_discard'),
    confirmColor: 'danger',
  });
  if (!confirmed) {
    return false;
  }

  try {
    await discardBookDraft({ id: book.id });
    toastManager.primary($t('book_draft_discarded', { values: { title: book.title } }));
    return true;
  } catch (error) {
    handleError(error, $t('errors.unable_to_discard_book_draft'));
    return false;
  }
};

/** Opens the assistant with a prompt to improve a suggested book */
export const polishBookDraft = ($t: MessageFormatter, book: DraftBook) =>
  openAssistant({ prompt: $t('book_draft_polish_prompt', { values: { title: book.title, id: book.id } }) });
