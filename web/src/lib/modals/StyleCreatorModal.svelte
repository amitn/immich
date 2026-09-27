<script lang="ts">
  import { openAssistant } from '$lib/services/assistant.service';
  import { STYLE_CREATOR_EXAMPLES, getStyleCreatorRequest, type StyleCreatorTarget } from '$lib/utils/style-creator';
  import { Field, FormModal, Text, Textarea } from '@immich/ui';
  import { mdiCreationOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    /** what the style is for: a book, an album about to become a book, some photos, or a photo to turn into art */
    target: StyleCreatorTarget;
    onClose: () => void;
  };

  const { target, onClose }: Props = $props();

  const MAX_LENGTH = 500;

  let description = $state('');

  const examples = $derived(STYLE_CREATOR_EXAMPLES[target.kind].map((key) => $t(key)));

  const onSubmit = async () => {
    const text = description.trim();
    if (!text) {
      return;
    }
    onClose();
    await openAssistant(getStyleCreatorRequest($t, target, text));
  };
</script>

<FormModal
  title={target.kind === 'book' ? $t('style_creator_book_title') : $t('style_creator_art_title')}
  icon={mdiCreationOutline}
  size="medium"
  submitText={$t('style_creator_open_assistant')}
  disabled={description.trim().length === 0}
  {onClose}
  {onSubmit}
>
  <div class="flex flex-col gap-4">
    <Text size="small" color="muted">
      {target.kind === 'book' ? $t('style_creator_book_description') : $t('style_creator_art_description')}
    </Text>

    <Field label={$t('style_creator_describe')} required>
      <Textarea
        bind:value={description}
        rows={3}
        grow
        maxlength={MAX_LENGTH}
        placeholder={$t('style_creator_describe_placeholder')}
      />
    </Field>

    <div class="flex flex-col gap-2">
      <Text size="tiny" color="muted">{$t('style_creator_examples')}</Text>
      <div class="flex flex-wrap gap-2">
        {#each examples as example (example)}
          <button
            type="button"
            class="rounded-full border px-3 py-1 text-start text-xs transition-colors {description === example
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
            aria-pressed={description === example}
            onclick={() => (description = example)}
          >
            {example}
          </button>
        {/each}
      </div>
    </div>
  </div>
</FormModal>
