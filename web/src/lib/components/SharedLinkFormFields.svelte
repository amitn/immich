<script lang="ts">
  import SharedLinkExpiration from '$lib/components/SharedLinkExpiration.svelte';
  import { SharedLinkType } from '@immich/sdk';
  import { Field, HelperText, Input, PasswordInput, Switch, Text } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    slug: string;
    password: string;
    description: string;
    allowDownload: boolean;
    allowUpload: boolean;
    showMetadata: boolean;
    expiresAt: string | null;
    /** a link to a photo book: visitors can't upload, and download the PDF, which carries no photo metadata */
    isBook?: boolean;
    /** (#14) blur, for visitors, the faces of people not in what the link shares */
    redactFaces?: boolean;
    /** (#14) blur, for visitors, the text and number plates of the photos */
    redactText?: boolean;
    /** what the link shares, for the wording of the redaction options */
    shareType?: SharedLinkType;
  };

  let {
    slug = $bindable(),
    password = $bindable(),
    description = $bindable(),
    allowDownload = $bindable(),
    allowUpload = $bindable(),
    showMetadata = $bindable(),
    expiresAt = $bindable(),
    isBook = false,
    redactFaces = $bindable(false),
    redactText = $bindable(false),
    shareType,
  }: Props = $props();

  const redactFacesLabel = $derived(
    shareType === SharedLinkType.Book
      ? $t('shared_link_redact_faces_book')
      : shareType === SharedLinkType.Album
        ? $t('shared_link_redact_faces_album')
        : $t('shared_link_redact_faces'),
  );

  $effect(() => {
    if (!isBook && !showMetadata && allowDownload) {
      allowDownload = false;
    }
  });
</script>

<div class="mt-4 flex flex-col gap-4">
  <div>
    <Field label={$t('shared_link_custom_url_title')} description={$t('shared_link_custom_url_description')}>
      <Input bind:value={slug} autocomplete="off" />
      {#if slug.includes('/')}
        <HelperText class="text-warning">{$t('shared_link_custom_url_warning')}</HelperText>
      {/if}
    </Field>
    {#if slug}
      <Text size="tiny" color="muted" class="pt-2 break-all">/s/{encodeURIComponent(slug)}</Text>
    {/if}
  </div>

  <Field label={$t('password')} description={$t('shared_link_password_description')}>
    <PasswordInput bind:value={password} autocomplete="new-password" />
  </Field>

  <Field label={$t('description')}>
    <Input bind:value={description} autocomplete="off" />
  </Field>

  <SharedLinkExpiration bind:expiresAt />
  {#if isBook}
    <!-- what a book's web book tells of its photos: their file names (as the images' text) and the dates -->
    <Field label={$t('book_share_show_photo_details')} description={$t('book_share_show_photo_details_description')}>
      <Switch bind:checked={showMetadata} />
    </Field>
  {:else}
    <Field label={$t('show_metadata')}>
      <Switch bind:checked={showMetadata} />
    </Field>
  {/if}

  {#if isBook}
    <Field label={$t('book_share_allow_pdf_download')}>
      <Switch bind:checked={allowDownload} />
    </Field>
  {:else}
    <Field label={$t('allow_public_user_to_download')} disabled={!showMetadata}>
      <Switch bind:checked={allowDownload} />
    </Field>

    <Field label={$t('allow_public_user_to_upload')}>
      <Switch bind:checked={allowUpload} />
    </Field>
  {/if}

  <!-- (#14) blurred when served through the link; the photos themselves are not changed -->
  <Field label={redactFacesLabel} description={$t('shared_link_redact_faces_description')}>
    <Switch bind:checked={redactFaces} />
  </Field>

  <Field label={$t('shared_link_redact_text')} description={$t('shared_link_redact_text_description')}>
    <Switch bind:checked={redactText} />
  </Field>

  {#if redactFaces || redactText}
    <Text size="small" color="muted" data-testid="shared-link-redact-note">
      {isBook ? $t('shared_link_redact_note_book') : $t('shared_link_redact_note')}
    </Text>
  {/if}
</div>
