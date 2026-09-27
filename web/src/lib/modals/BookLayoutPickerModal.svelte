<script lang="ts">
  import BookLayoutPicker from '$lib/components/books/BookLayoutPicker.svelte';
  import type { BookPageSize, BookSpacing } from '$lib/utils/book-geometry';
  import type { BookLayoutResponseDto } from '@immich/sdk';
  import { Modal, ModalBody, Text } from '@immich/ui';
  import { mdiViewDashboardOutline } from '@mdi/js';

  type Props = {
    title: string;
    description?: string;
    layouts: BookLayoutResponseDto[];
    size: BookPageSize;
    style: BookSpacing;
    photoCount?: number;
    isMap?: boolean;
    current?: string;
    onClose: (layoutId?: string) => void;
  };

  const { title, description, layouts, size, style, photoCount, isMap, current, onClose }: Props = $props();
</script>

<Modal {title} icon={mdiViewDashboardOutline} size="medium" onClose={() => onClose()}>
  <ModalBody>
    <div class="flex flex-col gap-3">
      {#if description}
        <Text size="small" color="muted">{description}</Text>
      {/if}
      <BookLayoutPicker
        {layouts}
        {size}
        {style}
        {photoCount}
        {isMap}
        {current}
        onSelect={(layout) => onClose(layout.id)}
      />
    </div>
  </ModalBody>
</Modal>
