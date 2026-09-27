<script lang="ts">
  import { goto } from '$app/navigation';
  import { downloadBlob } from '$lib/utils';
  import {
    BOOK_STYLE_PRESET_LABEL_KEYS,
    BOOK_STYLE_PRESETS,
    isBookStylePreset,
    loadBookUserStyles,
    type BookStyleChoice,
  } from '$lib/utils/book-style';
  import { getCollageRoute, waitForThumbnail } from '$lib/utils/collage';
  import { getServerErrorMessage, handleError } from '$lib/utils/handle-error';
  import {
    BookStylePreset,
    CollageAspectRatio,
    createCollage,
    getCollageLayouts,
    renderCollage,
    type BookUserStyleResponseDto,
    type CollageDto,
    type CollageLayoutResponseDto,
  } from '@immich/sdk';
  import {
    Alert,
    Button,
    Field,
    HStack,
    Input,
    LoadingSpinner,
    Modal,
    ModalBody,
    ModalFooter,
    Select,
    Text,
    toastManager,
  } from '@immich/ui';
  import {
    mdiAlertCircleOutline,
    mdiContentSave,
    mdiDownload,
    mdiShuffleVariant,
    mdiViewDashboardOutline,
  } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    assetIds: string[];
    /** the album the photos were picked in: the collage is added to it and opens over it */
    albumId?: string;
    onClose: () => void;
  };

  const { assetIds, albumId, onClose }: Props = $props();

  /** how long the preview waits for the title to be typed */
  const PREVIEW_DELAY = 300;

  const aspectRatios = [
    { value: CollageAspectRatio.$11, key: 'collage_aspect_square' },
    { value: CollageAspectRatio.$45, key: 'collage_aspect_portrait' },
    { value: CollageAspectRatio.$916, key: 'collage_aspect_story' },
    { value: CollageAspectRatio.$169, key: 'collage_aspect_wide' },
  ] as const;

  let aspectRatio = $state<CollageAspectRatio>(CollageAspectRatio.$11);
  let title = $state('');
  let style = $state<BookStyleChoice>(BookStylePreset.Classic);
  let userStyles = $state<BookUserStyleResponseDto[]>([]);
  let layouts = $state<CollageLayoutResponseDto[]>([]);
  /** the layout the user picked; none: the one that fits the photos best */
  let chosenLayout = $state<string>();
  let previewUrl = $state<string>();
  let isLoading = $state(true);
  let errorMessage = $state<string>();
  let isSaving = $state(false);
  let isDownloading = $state(false);

  const layout = $derived(chosenLayout ?? layouts[0]?.id);
  const hasTitle = $derived(title.trim().length > 0);

  const styleOptions = $derived([
    ...BOOK_STYLE_PRESETS.map((preset) => ({
      value: preset as string,
      label: $t(BOOK_STYLE_PRESET_LABEL_KEYS[preset].name),
    })),
    ...userStyles.map((item) => ({ value: item.id, label: item.name })),
  ]);

  const layoutOptions = $derived(layouts.map((item) => ({ value: item.id, label: item.name })));

  const collageDto = $derived<CollageDto>({
    assetIds,
    aspectRatio,
    layout: chosenLayout,
    title: title.trim() || undefined,
    ...(isBookStylePreset(style) ? { stylePreset: style } : { styleId: style }),
  });

  const getMessage = (error: unknown, fallback: string) => getServerErrorMessage(error) || fallback;

  let layoutRequest = 0;
  const loadLayouts = async (dto: CollageDto) => {
    const current = ++layoutRequest;
    try {
      const result = await getCollageLayouts({ collageDto: { ...dto, layout: undefined } });
      if (current === layoutRequest) {
        layouts = result.layouts;
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_render_collage'), { notify: false });
    }
  };

  let previewRequest = 0;
  const loadPreview = async (dto: CollageDto) => {
    const current = ++previewRequest;
    isLoading = true;
    try {
      const blob = await renderCollage({ collageRenderDto: dto });
      if (current !== previewRequest) {
        return;
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      previewUrl = URL.createObjectURL(blob);
      errorMessage = undefined;
    } catch (error) {
      if (current === previewRequest) {
        errorMessage = getMessage(error, $t('errors.unable_to_render_collage'));
        handleError(error, $t('errors.unable_to_render_collage'), { notify: false });
      }
    } finally {
      if (current === previewRequest) {
        isLoading = false;
      }
    }
  };

  // the layouts are ranked for the shape of the page, which the aspect ratio and the title band change
  $effect(() => {
    void loadLayouts({ assetIds, aspectRatio, title: hasTitle ? 'title' : undefined });
  });

  // a new preview for every change, once the typing stops
  $effect(() => {
    const dto = collageDto;
    const timer = setTimeout(() => void loadPreview(dto), PREVIEW_DELAY);
    return () => clearTimeout(timer);
  });

  const selectAspectRatio = (value: CollageAspectRatio) => {
    aspectRatio = value;
    // another page shape has another best layout
    chosenLayout = undefined;
  };

  const shuffleLayout = () => {
    if (layouts.length < 2) {
      return;
    }
    const index = layouts.findIndex(({ id }) => id === layout);
    chosenLayout = layouts[(index + 1) % layouts.length].id;
  };

  const fileName = () => `${$t('collage')} ${title.trim() || new Date().toISOString().slice(0, 10)}.jpg`;

  const download = async () => {
    isDownloading = true;
    try {
      const blob = await renderCollage({ collageRenderDto: { ...collageDto, layout, full: true } });
      downloadBlob(blob, fileName());
    } catch (error) {
      handleError(error, $t('errors.unable_to_download_collage'));
    } finally {
      isDownloading = false;
    }
  };

  const save = async () => {
    isSaving = true;
    try {
      const result = await createCollage({ collageCreateDto: { ...collageDto, layout, albumId } });
      // the viewer shows the collage once its thumbnail is made
      await waitForThumbnail(result.assetId);
      toastManager.success($t('collage_saved'));
      onClose();
      await goto(getCollageRoute(result.assetId, albumId));
    } catch (error) {
      errorMessage = getMessage(error, $t('errors.unable_to_save_collage'));
      handleError(error, $t('errors.unable_to_save_collage'), { notify: false });
    } finally {
      isSaving = false;
    }
  };

  onMount(async () => {
    try {
      userStyles = await loadBookUserStyles();
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_book_styles'), { notify: false });
    }
  });

  onDestroy(() => {
    previewRequest++;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  });
</script>

<Modal title={$t('collage_make')} icon={mdiViewDashboardOutline} {onClose} size="large">
  <ModalBody>
    <div class="flex flex-col gap-5 md:flex-row">
      <div
        class="relative flex min-h-64 flex-1 items-center justify-center overflow-hidden rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
      >
        {#if errorMessage && !previewUrl}
          <Alert color="danger" icon={mdiAlertCircleOutline} title={errorMessage} />
        {:else if previewUrl}
          <img
            src={previewUrl}
            alt={$t('collage_preview')}
            class="max-h-[60vh] w-auto max-w-full object-contain shadow-md transition-opacity {isLoading
              ? 'opacity-50'
              : ''}"
            draggable="false"
          />
        {/if}
        {#if isLoading}
          <div class="absolute inset-0 flex items-center justify-center" role="status">
            <LoadingSpinner size="large" />
          </div>
        {/if}
      </div>

      <div class="flex flex-col gap-4 md:w-72">
        <Text size="small" color="muted">{$t('collage_description', { values: { count: assetIds.length } })}</Text>

        <fieldset disabled={isSaving}>
          <legend class="mb-2 text-sm font-medium">{$t('collage_aspect_ratio')}</legend>
          <div class="flex flex-wrap gap-2">
            {#each aspectRatios as item (item.value)}
              {@const checked = aspectRatio === item.value}
              <label
                class="cursor-pointer rounded-full border-2 px-3 py-1 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary {checked
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
                title={$t(item.key)}
              >
                <input
                  type="radio"
                  name="collage-aspect-ratio"
                  class="sr-only"
                  value={item.value}
                  {checked}
                  aria-label={`${item.value} ${$t(item.key)}`}
                  onchange={() => selectAspectRatio(item.value)}
                />
                {item.value}
              </label>
            {/each}
          </div>
        </fieldset>

        <Field label={$t('collage_layout')}>
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <Select value={layout} options={layoutOptions} onChange={(value: string) => (chosenLayout = value)} />
            </div>
            <Button
              size="small"
              variant="outline"
              color="secondary"
              leadingIcon={mdiShuffleVariant}
              disabled={layouts.length < 2 || isSaving}
              onclick={shuffleLayout}
            >
              {$t('collage_shuffle_layout')}
            </Button>
          </div>
        </Field>

        <Field label={$t('collage_style')}>
          <Select bind:value={style} options={styleOptions} />
        </Field>

        <Field label={$t('collage_title')}>
          <Input bind:value={title} maxlength={100} placeholder={$t('collage_title_placeholder')} />
        </Field>

        {#if errorMessage && previewUrl}
          <Alert color="danger" icon={mdiAlertCircleOutline} title={errorMessage} />
        {/if}
      </div>
    </div>
  </ModalBody>

  <ModalFooter>
    <HStack fullWidth>
      <Button shape="round" color="secondary" fullWidth onclick={onClose}>{$t('cancel')}</Button>
      <Button
        shape="round"
        color="secondary"
        fullWidth
        leadingIcon={mdiDownload}
        loading={isDownloading}
        disabled={isSaving || !previewUrl}
        onclick={download}
      >
        {$t('download')}
      </Button>
      <Button
        shape="round"
        fullWidth
        leadingIcon={mdiContentSave}
        loading={isSaving}
        disabled={isSaving || !previewUrl}
        onclick={save}
      >
        {$t('collage_save')}
      </Button>
    </HStack>
  </ModalFooter>
</Modal>
