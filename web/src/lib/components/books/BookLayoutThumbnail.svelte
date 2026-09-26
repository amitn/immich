<script lang="ts">
  import {
    getLayoutBox,
    placeRect,
    getSlotRectsMm,
    type BookPageSize,
    type BookSpacing,
  } from '$lib/utils/book-geometry';
  import type { BookLayoutResponseDto } from '@immich/sdk';

  type Props = {
    layout: BookLayoutResponseDto;
    size: BookPageSize;
    style: BookSpacing;
    class?: string;
  };

  const { layout, size, style, class: className = '' }: Props = $props();

  const slots = $derived(getSlotRectsMm(layout, size, style));
  const box = $derived(getLayoutBox(layout, size, style));
  const map = $derived(layout.mapArea ? placeRect(layout.mapArea, box, style.gutterMm) : null);
  const text = $derived(layout.textAreas.map((area) => ({ ...area, ...placeRect(area, box, style.gutterMm) })));

  // the caption of a photo (e.g. the name of a dish) is drawn like a caption
  // TODO: compare with the SDK enum once it is regenerated with `slotCaption`
  const isCaptionArea = (kind: string) => kind === 'caption' || kind === 'slotCaption';
</script>

<!-- a schematic of the layout: photos as filled blocks, the map as a hatched block and text as lines -->
<svg
  viewBox="0 0 {size.pageWidthMm} {size.pageHeightMm}"
  class="block bg-white shadow-sm ring-1 ring-gray-300 dark:bg-gray-100 dark:ring-gray-600 {className}"
  aria-hidden="true"
>
  {#if map}
    <rect x={map.x} y={map.y} width={map.width} height={map.height} class="fill-emerald-200" />
    <path
      d="M{map.x} {map.y + map.height * 0.7} L{map.x + map.width * 0.35} {map.y + map.height * 0.35} L{map.x +
        map.width * 0.6} {map.y + map.height * 0.6} L{map.x + map.width} {map.y + map.height * 0.25}"
      class="fill-none stroke-emerald-600"
      stroke-width={Math.max(size.pageWidthMm, size.pageHeightMm) / 60}
    />
  {/if}
  {#each slots as slot, index (index)}
    <rect x={slot.x} y={slot.y} width={slot.width} height={slot.height} class="fill-gray-400" />
  {/each}
  {#each text as area, index (index)}
    {@const lineHeight = Math.min(area.height * 0.3, size.pageHeightMm / 24)}
    {@const caption = isCaptionArea(area.kind)}
    <rect
      x={area.x + area.width * 0.15}
      y={area.y + (area.height - lineHeight) / 2}
      width={area.width * (caption ? 0.7 : 0.5) + (caption ? 0 : area.width * 0.1)}
      height={lineHeight}
      rx={lineHeight / 2}
      class={caption ? 'fill-gray-300' : 'fill-gray-500'}
    />
  {/each}
</svg>
