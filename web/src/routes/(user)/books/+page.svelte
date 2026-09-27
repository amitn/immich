<script lang="ts">
  import BookCard from '$lib/components/books/BookCard.svelte';
  import BookDraftCard from '$lib/components/books/BookDraftCard.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ManageBookStylesModal from '$lib/modals/ManageBookStylesModal.svelte';
  import { openAssistant } from '$lib/services/assistant.service';
  import { discardBookDraftWithConfirm, keepBookDraftWithToast } from '$lib/services/book.service';
  import { handleError } from '$lib/utils/handle-error';
  import type { BookDraftResponseDto, BookResponseDto } from '@immich/sdk';
  import { Button, Icon, modalManager, type ActionItem } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline, mdiCreationOutline, mdiPaletteSwatchOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  // kept drafts join the books, and kept or discarded drafts leave the suggestions, without reloading the page
  let kept = $state<BookResponseDto[]>([]);
  let handled = $state<string[]>([]);
  let busyDraft = $state<string>();

  const books = $derived(
    [...data.books, ...kept.filter((book) => data.books.every((other) => other.id !== book.id))].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
  );
  const drafts = $derived(data.drafts.filter((draft) => !handled.includes(draft.id)));

  const handleKeep = async (draft: BookDraftResponseDto) => {
    busyDraft = draft.id;
    try {
      const book = await keepBookDraftWithToast($t, draft.book);
      if (book) {
        kept = [...kept, book];
        handled = [...handled, draft.id];
      }
    } finally {
      busyDraft = undefined;
    }
  };

  const handleDiscard = async (draft: BookDraftResponseDto) => {
    busyDraft = draft.id;
    try {
      if (await discardBookDraftWithConfirm($t, draft.book)) {
        handled = [...handled, draft.id];
      }
    } finally {
      busyDraft = undefined;
    }
  };

  const CreateWithAssistant: ActionItem = $derived({
    title: $t('book_create_with_assistant'),
    icon: mdiCreationOutline,
    $if: () => data.enabled,
    onAction: () => openAssistant({ prompt: $t('book_create_prompt') }),
  });

  const ManageStyles: ActionItem = $derived({
    title: $t('book_style_manage'),
    icon: mdiPaletteSwatchOutline,
    onAction: () => modalManager.show(ManageBookStylesModal, {}),
  });

  onMount(() => {
    if (data.loadError) {
      handleError(data.loadError, $t('errors.unable_to_load_books'));
    }
  });
</script>

<UserPageLayout title={data.meta.title} actions={[CreateWithAssistant, ManageStyles]}>
  <div class="pb-20">
    {#if drafts.length > 0}
      <section class="mt-4" aria-labelledby="book-drafts-title" data-testid="book-drafts">
        <div class="flex flex-col gap-0.5">
          <h2 id="book-drafts-title" class="text-lg font-medium">{$t('book_drafts_title')}</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">{$t('book_drafts_description')}</p>
        </div>
        <ul class="-mx-2 mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {#each drafts as draft (draft.id)}
            <li>
              <BookDraftCard
                {draft}
                busy={busyDraft === draft.id}
                onKeep={(draft) => void handleKeep(draft)}
                onDiscard={(draft) => void handleDiscard(draft)}
              />
            </li>
          {/each}
        </ul>
      </section>
      {#if books.length > 0}
        <h2 class="mt-8 text-lg font-medium">{$t('book_your_books')}</h2>
      {/if}
    {/if}
    {#if books.length === 0 && drafts.length > 0}
      <!-- the suggestions fill the page -->
    {:else if books.length === 0}
      <div class="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center">
        <div class="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon icon={mdiBookOpenPageVariantOutline} size="32" aria-hidden />
        </div>
        <h2 class="text-lg font-medium">{$t('book_empty_title')}</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400">{$t('book_empty_description')}</p>
        {#if data.enabled}
          <Button
            shape="round"
            leadingIcon={mdiCreationOutline}
            onclick={() => openAssistant({ prompt: $t('book_create_prompt') })}
          >
            {$t('book_create_with_assistant')}
          </Button>
        {/if}
      </div>
    {:else}
      <!-- the cards have their own padding (for the hover background): pull them out so the covers line up with the
           page title -->
      <ul class="-mx-2 mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {#each books as book (book.id)}
          <li><BookCard {book} /></li>
        {/each}
      </ul>
    {/if}
  </div>
</UserPageLayout>
