<script lang="ts">
  import BookCard from '$lib/components/books/BookCard.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { openAssistant } from '$lib/services/assistant.service';
  import { handleError } from '$lib/utils/handle-error';
  import { Button, Container, Icon, type ActionItem } from '@immich/ui';
  import { mdiBookOpenPageVariantOutline, mdiCreationOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  const books = $derived([...data.books].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

  const CreateWithAssistant: ActionItem = $derived({
    title: $t('book_create_with_assistant'),
    icon: mdiCreationOutline,
    $if: () => data.enabled,
    onAction: () => openAssistant({ prompt: $t('book_create_prompt') }),
  });

  onMount(() => {
    if (data.loadError) {
      handleError(data.loadError, $t('errors.unable_to_load_books'));
    }
  });
</script>

<UserPageLayout title={data.meta.title} actions={[CreateWithAssistant]}>
  <Container size="large" center class="px-2 pb-20">
    {#if books.length === 0}
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
      <ul class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {#each books as book (book.id)}
          <li><BookCard {book} /></li>
        {/each}
      </ul>
    {/if}
  </Container>
</UserPageLayout>
