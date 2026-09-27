<script lang="ts">
  import SharedLinkFormFields from '$lib/components/SharedLinkFormFields.svelte';
  import { handleCreateSharedLink } from '$lib/services/shared-link.service';
  import { SharedLinkType } from '@immich/sdk';
  import { FormModal, Text } from '@immich/ui';
  import { mdiLink } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    onClose: () => void;
    albumId?: string;
    assetIds?: string[];
    /** share a photo book; `hasPdf` tells whether visitors could download its PDF yet */
    book?: { id: string; hasPdf: boolean };
  }

  let { onClose, albumId, assetIds, book }: Props = $props();

  let description = $state('');
  let allowDownload = $state(true);
  let allowUpload = $state(false);
  let showMetadata = $state(true);
  let password = $state('');
  let slug = $state('');
  let expiresAt = $state<string | null>(null);

  let type = $derived(book ? SharedLinkType.Book : albumId ? SharedLinkType.Album : SharedLinkType.Individual);

  const onSubmit = async () => {
    const common = { type, expiresAt, description, password, allowDownload, showMetadata, slug };
    const success = await handleCreateSharedLink(
      // nobody uploads to a book
      book ? { ...common, bookId: book.id } : { ...common, albumId, assetIds, allowUpload },
    );
    if (success) {
      onClose();
    }
  };
</script>

<FormModal
  title={$t('create_link_to_share')}
  icon={mdiLink}
  size="small"
  {onClose}
  {onSubmit}
  submitText={$t('create_link')}
>
  {#if type === SharedLinkType.Album}
    <div>{$t('album_with_link_access')}</div>
  {/if}

  {#if type === SharedLinkType.Individual}
    <div>{$t('create_link_to_share_description')}</div>
  {/if}

  {#if type === SharedLinkType.Book}
    <div>{$t('book_share_description')}</div>
  {/if}

  <SharedLinkFormFields
    bind:slug
    bind:password
    bind:description
    bind:allowDownload
    bind:allowUpload
    bind:showMetadata
    bind:expiresAt
    isBook={type === SharedLinkType.Book}
  />

  {#if book && allowDownload && !book.hasPdf}
    <Text size="small" color="muted" class="mt-2">{$t('book_share_export_pdf_hint')}</Text>
  {/if}
</FormModal>
