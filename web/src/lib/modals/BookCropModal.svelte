<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import {
    cropFromView,
    MAX_CROP_ZOOM,
    panView,
    toCropImageStyle,
    viewFromCrop,
    type CropView,
  } from '$lib/utils/book-geometry';
  import { AssetMediaSize, type NormalizedRect } from '@immich/sdk';
  import { Button, HStack, IconButton, LoadingSpinner, Modal, ModalBody, ModalFooter, Text } from '@immich/ui';
  import { mdiCrop, mdiMagnifyMinusOutline, mdiMagnifyPlusOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    assetId: string;
    crop: NormalizedRect | null;
    /** width / height of the slot on the page */
    slotAspect: number;
    /** resolves with the crop to save, null to reset it to the default crop, or nothing to cancel */
    onClose: (result?: { crop: NormalizedRect | null }) => void;
  };

  const { assetId, crop, slotAspect, onClose }: Props = $props();

  const ZOOM_STEP = 0.25;
  const PAN_STEP = 0.05;

  let imageAspect = $state(0);
  let loadFailed = $state(false);
  let view = $state<CropView>({ zoom: 1, centerX: 0.5, centerY: 0.5 });
  let frame = $state<HTMLElement>();
  let drag: { x: number; y: number; pointerId: number } | undefined;

  const current = $derived(cropFromView(view, imageAspect, slotAspect));
  const zoomPercent = $derived(Math.round(view.zoom * 100));

  const onLoad = (event: Event) => {
    const image = event.currentTarget as HTMLImageElement;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      imageAspect = image.naturalWidth / image.naturalHeight;
      view = viewFromCrop(crop, imageAspect, slotAspect);
    }
  };

  const setZoom = (zoom: number) => {
    view = { ...view, zoom: Math.min(Math.max(zoom, 1), MAX_CROP_ZOOM) };
  };

  const pan = (x: number, y: number) => {
    view = panView(view, { x, y }, imageAspect, slotAspect);
  };

  const onpointerdown = (event: PointerEvent) => {
    if (!imageAspect) {
      return;
    }
    drag = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    frame?.setPointerCapture?.(event.pointerId);
  };

  const onpointermove = (event: PointerEvent) => {
    if (!drag || !frame || drag.pointerId !== event.pointerId) {
      return;
    }
    const { width, height } = frame.getBoundingClientRect();
    if (width > 0 && height > 0) {
      // dragging the photo moves the crop the other way
      pan(-(event.clientX - drag.x) / width, -(event.clientY - drag.y) / height);
    }
    drag = { ...drag, x: event.clientX, y: event.clientY };
  };

  const onpointerup = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) {
      frame?.releasePointerCapture?.(event.pointerId);
      drag = undefined;
    }
  };

  const onwheel = (event: WheelEvent) => {
    if (!imageAspect) {
      return;
    }
    event.preventDefault();
    setZoom(view.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  };

  const onkeydown = (event: KeyboardEvent) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-PAN_STEP, 0],
      ArrowRight: [PAN_STEP, 0],
      ArrowUp: [0, -PAN_STEP],
      ArrowDown: [0, PAN_STEP],
    };
    const move = moves[event.key];
    if (move) {
      pan(...move);
    } else if (event.key === '+' || event.key === '=') {
      setZoom(view.zoom + ZOOM_STEP);
    } else if (event.key === '-') {
      setZoom(view.zoom - ZOOM_STEP);
    } else {
      return;
    }
    // keep the book viewer from turning the page
    event.preventDefault();
    event.stopPropagation();
  };

  const stopArrowKeys = (event: KeyboardEvent) => {
    if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
      event.stopPropagation();
    }
  };
</script>

<Modal title={$t('book_crop_photo')} icon={mdiCrop} size="medium" onClose={() => onClose()}>
  <ModalBody>
    <div class="flex flex-col items-center gap-4">
      <!-- a pan and zoom surface: it takes the pointer, the wheel and the arrow keys (see the help text) -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        bind:this={frame}
        class="relative w-full max-w-md touch-none overflow-hidden rounded-md bg-gray-100 outline-offset-2 select-none focus-visible:outline-2 focus-visible:outline-primary dark:bg-gray-800 {imageAspect
          ? 'cursor-move'
          : ''}"
        style:aspect-ratio={slotAspect}
        style:max-height="55vh"
        role="application"
        tabindex="0"
        aria-label={$t('book_crop_area')}
        aria-describedby="book-crop-help"
        {onpointerdown}
        {onpointermove}
        {onpointerup}
        onpointercancel={onpointerup}
        {onwheel}
        {onkeydown}
      >
        {#if loadFailed}
          <div class="absolute inset-0 flex items-center justify-center p-4">
            <Text size="small" color="muted">{$t('errors.unable_to_load_book_photo')}</Text>
          </div>
        {:else if !imageAspect}
          <div class="absolute inset-0 flex items-center justify-center"><LoadingSpinner /></div>
        {/if}
        <img
          src={getAssetMediaUrl({ id: assetId, size: AssetMediaSize.Preview })}
          alt={$t('book_crop_preview')}
          draggable="false"
          class="absolute max-w-none {imageAspect ? '' : 'invisible'}"
          style={imageAspect ? toCropImageStyle(current) : undefined}
          onload={onLoad}
          onerror={() => (loadFailed = true)}
        />
      </div>

      <Text id="book-crop-help" size="small" color="muted" class="text-center">{$t('book_crop_help')}</Text>

      <HStack gap={2} class="w-full max-w-md">
        <IconButton
          variant="ghost"
          color="secondary"
          shape="round"
          icon={mdiMagnifyMinusOutline}
          aria-label={$t('book_crop_zoom_out')}
          disabled={!imageAspect || view.zoom <= 1}
          onclick={() => setZoom(view.zoom - ZOOM_STEP)}
        />
        <input
          type="range"
          class="flex-1 accent-primary"
          min="1"
          max={MAX_CROP_ZOOM}
          step="0.01"
          value={view.zoom}
          disabled={!imageAspect}
          aria-label={$t('book_crop_zoom')}
          aria-valuetext={`${zoomPercent}%`}
          oninput={(event) => setZoom(Number(event.currentTarget.value))}
          onkeydown={stopArrowKeys}
        />
        <IconButton
          variant="ghost"
          color="secondary"
          shape="round"
          icon={mdiMagnifyPlusOutline}
          aria-label={$t('book_crop_zoom_in')}
          disabled={!imageAspect || view.zoom >= MAX_CROP_ZOOM}
          onclick={() => setZoom(view.zoom + ZOOM_STEP)}
        />
      </HStack>
    </div>
  </ModalBody>
  <ModalFooter>
    <HStack fullWidth>
      <Button color="secondary" shape="round" fullWidth onclick={() => onClose({ crop: null })}>
        {$t('book_reset_crop')}
      </Button>
      <Button color="secondary" shape="round" fullWidth onclick={() => onClose()}>{$t('cancel')}</Button>
      <Button shape="round" fullWidth disabled={!imageAspect} onclick={() => onClose({ crop: current })}>
        {$t('save')}
      </Button>
    </HStack>
  </ModalFooter>
</Modal>
