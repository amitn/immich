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
    /**
     * How many selected assets were dropped because the user does not own them. Off a space
     * surface a shared link can only cover the caller's own assets, so the caller narrows
     * `assetIds` and reports the remainder here rather than letting the request fail or the
     * narrowing go unnoticed.
     */
    excludedCount?: number;
    /**
     * #1018: the space this link is created from. Present only when the caller is a space
     * Owner/Editor; the server then authorizes the link against the space, so nothing is narrowed
     * out and the link covers what the space shows.
     */
    spaceId?: string;
    /**
     * #1018: how many of `assetIds` other members contributed. Drives the consent warning — those
     * photos are about to become publicly visible on someone else's behalf, so the caller is told
     * before the link exists rather than after.
     */
    contributedCount?: number;
    /** share a photo book; `hasPdf` tells whether visitors could download its PDF yet */
    book?: { id: string; hasPdf: boolean };
  }

  let { onClose, albumId, assetIds, excludedCount = 0, spaceId, contributedCount = 0, book }: Props = $props();

  let description = $state('');
  let allowDownload = $state(true);
  let allowUpload = $state(false);
  let showMetadata = $state(true);
  let password = $state('');
  let slug = $state('');
  let expiresAt = $state<string | null>(null);
  let redactFaces = $state(false);
  let redactText = $state(false);

  let type = $derived(book ? SharedLinkType.Book : albumId ? SharedLinkType.Album : SharedLinkType.Individual);

  // For a selection the caller already knows how many photos are someone else's. For an album link
  // they do not — the album's contributed share is only known server-side — so a space-scoped album
  // link always warns, with wording that claims no count.
  let showContributedWarning = $derived(
    spaceId !== undefined && (type === SharedLinkType.Album || contributedCount > 0),
  );

  const onSubmit = async () => {
    const common = {
      type,
      expiresAt,
      description,
      password,
      allowDownload,
      showMetadata,
      slug,
      redactFaces,
      redactText,
    };
    const success = await handleCreateSharedLink(
      // nobody uploads to a book, and a book is not tethered to a space
      book ? { ...common, bookId: book.id } : { ...common, albumId, assetIds, allowUpload, spaceId },
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

  {#if excludedCount > 0}
    <div class="text-sm text-gray-500 dark:text-gray-400" data-testid="shared-link-excluded-notice">
      {$t('shared_link_excludes_other_owners', { values: { count: excludedCount } })}
    </div>
  {/if}

  <!--
    #1018: publishing someone else's photo is the caller's decision to make on their behalf, so it
    is stated plainly and before the fact. Warning colours, not the muted grey of the notice above —
    that one reports a narrowing, this one reports a disclosure.
  -->
  {#if showContributedWarning}
    <div
      class="rounded-lg bg-warning/10 p-3 text-sm text-warning"
      role="status"
      data-testid="shared-link-contributed-warning"
    >
      {#if type === SharedLinkType.Album}
        {$t('shared_link_album_includes_contributed_assets')}
      {:else}
        {$t('shared_link_includes_contributed_assets', { values: { count: contributedCount } })}
      {/if}
    </div>
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
    bind:redactFaces
    bind:redactText
    shareType={type}
    isBook={type === SharedLinkType.Book}
  />

  {#if book && allowDownload && !book.hasPdf}
    <Text size="small" color="muted" class="mt-2">{$t('book_share_export_pdf_hint')}</Text>
  {/if}
</FormModal>
