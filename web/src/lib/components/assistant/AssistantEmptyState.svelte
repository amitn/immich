<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiCreationOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    hasContext?: boolean;
    onPick: (prompt: string) => void;
  };

  const { hasContext = false, onPick }: Props = $props();

  const examples = $derived(
    hasContext
      ? [
          $t('assistant_example_watercolor'),
          $t('assistant_example_album_from_selection'),
          $t('assistant_example_crop_square'),
          $t('assistant_example_describe'),
        ]
      : [
          $t('assistant_example_beach_album'),
          $t('assistant_example_italy_book'),
          $t('assistant_example_watercolor'),
          $t('assistant_example_best_of_year'),
        ],
  );
</script>

<div class="mx-auto flex max-w-xl flex-col items-center gap-6 py-10 text-center">
  <div class="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
    <Icon icon={mdiCreationOutline} size="30" aria-hidden />
  </div>
  <div class="flex flex-col gap-2">
    <h2 class="text-xl font-medium">{$t('assistant_empty_title')}</h2>
    <p class="text-sm text-gray-600 dark:text-gray-400">
      {hasContext ? $t('assistant_empty_description_with_photos') : $t('assistant_empty_description')}
    </p>
  </div>
  <ul class="grid w-full gap-2 sm:grid-cols-2" aria-label={$t('assistant_example_prompts')}>
    {#each examples as example (example)}
      <li>
        <button
          type="button"
          class="size-full rounded-xl border border-gray-200 px-4 py-3 text-start text-sm transition-colors hover:border-primary hover:bg-primary/5 focus-visible:border-primary dark:border-gray-700"
          onclick={() => onPick(example)}
        >
          {example}
        </button>
      </li>
    {/each}
  </ul>
</div>
