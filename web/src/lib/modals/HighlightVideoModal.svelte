<script lang="ts">
  import { highlightManager } from '$lib/managers/highlight-manager.svelte';
  import { BOOK_STYLE_PRESETS, BOOK_STYLE_PRESET_LABEL_KEYS } from '$lib/utils/book-style';
  import { handleError } from '$lib/utils/handle-error';
  import { HIGHLIGHT_DURATIONS, HIGHLIGHT_MUSIC_ACCEPT, NO_MUSIC } from '$lib/utils/highlight';
  import {
    createHighlight,
    getHighlightMusic,
    HighlightStyle,
    uploadHighlightMusic,
    type HighlightCreateDto,
    type HighlightMusicResponseDto,
  } from '@immich/sdk';
  import { Button, Field, FormModal, Input, Select, Switch, Text } from '@immich/ui';
  import { mdiMovieOpenPlayOutline, mdiUpload } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    albumId?: string;
    bookId?: string;
    assetIds?: string[];
    /** the title the dialog starts with, e.g. the name of the album */
    title?: string;
    onClose: () => void;
  };

  const { albumId, bookId, assetIds, title: initialTitle = '', onClose }: Props = $props();

  // svelte-ignore state_referenced_locally
  let title = $state(initialTitle);
  let durationSeconds = $state<number>(60);
  let style = $state<HighlightStyle>(HighlightStyle.Auto);
  let includeMaps = $state(true);
  let captions = $state(true);
  let music = $state<string>(NO_MUSIC);
  let musicList = $state<HighlightMusicResponseDto[]>([]);
  let uploading = $state(false);
  let fileInput = $state<HTMLInputElement>();

  const styleOptions = $derived([
    { value: HighlightStyle.Auto, label: $t('highlight_video_style_auto') },
    ...BOOK_STYLE_PRESETS.map((preset) => ({
      value: preset as unknown as HighlightStyle,
      label: $t(BOOK_STYLE_PRESET_LABEL_KEYS[preset].name),
    })),
  ]);

  const formatLength = (seconds: number | null) => {
    if (seconds === null) {
      return '';
    }
    const rounded = Math.round(seconds);
    return ` (${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')})`;
  };

  const musicOptions = $derived([
    { value: NO_MUSIC, label: $t('highlight_video_no_music') },
    ...musicList.map((item) => ({ value: item.id, label: `${item.name}${formatLength(item.durationSeconds)}` })),
  ]);

  onMount(async () => {
    try {
      musicList = await getHighlightMusic();
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_highlight_music'), { notify: false });
    }
  });

  const onUpload = async (event: Event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    uploading = true;
    try {
      const uploaded = await uploadHighlightMusic({ highlightMusicUploadDto: { file } });
      musicList = [uploaded, ...musicList.filter((item) => item.id !== uploaded.id)];
      music = uploaded.id;
    } catch (error) {
      handleError(error, $t('errors.unable_to_upload_highlight_music'));
    } finally {
      uploading = false;
      if (fileInput) {
        fileInput.value = '';
      }
    }
  };

  const onSubmit = async () => {
    const highlightCreateDto: HighlightCreateDto = {
      ...(albumId && { albumId }),
      ...(bookId && { bookId }),
      ...(assetIds && { assetIds }),
      title: title.trim() || undefined,
      durationSeconds,
      style,
      includeMaps,
      captions,
      music: music === NO_MUSIC ? undefined : music,
    };

    try {
      const job = await createHighlight({ highlightCreateDto });
      highlightManager.track(job);
      onClose();
    } catch (error) {
      handleError(error, $t('errors.unable_to_make_highlight_video'));
    }
  };
</script>

<FormModal
  title={$t('highlight_video_make')}
  icon={mdiMovieOpenPlayOutline}
  size="medium"
  submitText={$t('highlight_video_create')}
  disabled={uploading}
  {onClose}
  {onSubmit}
>
  <div class="flex flex-col gap-5">
    <Text size="small" color="muted">{$t('highlight_video_description')}</Text>

    <Field label={$t('highlight_video_title')}>
      <Input bind:value={title} maxlength={200} />
    </Field>

    <fieldset>
      <legend class="mb-2 text-sm font-medium">{$t('highlight_video_length')}</legend>
      <div class="flex flex-wrap gap-2">
        {#each HIGHLIGHT_DURATIONS as seconds (seconds)}
          {@const checked = durationSeconds === seconds}
          <label
            class="cursor-pointer rounded-full border-2 px-4 py-1.5 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
          >
            <input type="radio" name="highlight-length" class="sr-only" value={seconds} bind:group={durationSeconds} />
            {$t('highlight_video_seconds', { values: { seconds } })}
          </label>
        {/each}
      </div>
    </fieldset>

    <Field label={$t('highlight_video_style')} description={$t('highlight_video_style_description')}>
      <Select bind:value={style} options={styleOptions} />
    </Field>

    <Field label={$t('highlight_video_maps')} description={$t('highlight_video_maps_description')}>
      <Switch bind:checked={includeMaps} />
    </Field>

    <Field label={$t('highlight_video_captions')} description={$t('highlight_video_captions_description')}>
      <Switch bind:checked={captions} />
    </Field>

    <Field label={$t('highlight_video_music')} description={$t('highlight_video_music_description')}>
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <Select bind:value={music} options={musicOptions} />
        </div>
        <Button
          size="small"
          variant="outline"
          color="secondary"
          leadingIcon={mdiUpload}
          loading={uploading}
          onclick={() => fileInput?.click()}
        >
          {$t('highlight_video_upload_music')}
        </Button>
        <input
          bind:this={fileInput}
          type="file"
          accept={HIGHLIGHT_MUSIC_ACCEPT}
          class="hidden"
          aria-label={$t('highlight_video_upload_music')}
          onchange={onUpload}
        />
      </div>
    </Field>
  </div>
</FormModal>
