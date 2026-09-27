<script lang="ts">
  import { getBookStyleAccent, getBookStyleLook } from '$lib/utils/book-style';
  import type { BookStyle } from '@immich/sdk';

  type Props = {
    /** Unknown while the presets load: a neutral page is shown */
    style?: BookStyle;
    /** Width of the page in pixels */
    size?: number;
    /** Page width in millimeters, to draw the margin to scale */
    pageWidthMm?: number;
  };

  const { style, size = 56, pageWidthMm = 210 }: Props = $props();

  // margins are a few percent of the page: exaggerate them a little so the difference shows at this size
  const margin = $derived(style ? Math.max(1, ((style.marginMm * 1.5) / pageWidthMm) * size) : size * 0.1);
  const gutter = $derived(style ? Math.max(1, ((style.gutterMm * 1.5) / pageWidthMm) * size) : size * 0.04);
  // the printed look (food, wine, cookbook, travel) draws pages like a printed menu: a hairline frame, a rule under
  // the photos and small caps; the gallery look shows the photos whole on the page, with a museum label below
  const look = $derived(getBookStyleLook(style));
  const printed = $derived(look === 'printed');
  const gallery = $derived(look === 'gallery');
  // the mounted look (kids' art) shows a drawing on a white mat, taped to the page, with a handwritten label
  const mounted = $derived(look === 'mounted');
  const accent = $derived(getBookStyleAccent(style));
</script>

<span
  class="relative flex shrink-0 flex-col rounded-sm border border-gray-300 shadow-sm dark:border-gray-600 {style
    ? ''
    : 'animate-pulse bg-gray-100 dark:bg-gray-800'}"
  style:width="{size}px"
  style:height="{size}px"
  style:padding="{margin}px"
  style:gap="{gutter}px"
  style:background-color={style?.background}
  aria-hidden="true"
  data-look={style ? look : undefined}
>
  {#if printed}
    <span
      class="pointer-events-none absolute border"
      style:inset="{Math.max(1, margin * 0.4)}px"
      style:border-color={accent}
      style:opacity="0.6"
    ></span>
  {/if}
  {#if mounted}
    <span class="flex min-h-0 flex-1 items-center justify-center">
      <span class="relative block h-3/4 w-3/5 bg-white shadow-sm" style:padding="{Math.max(1, size / 28)}px">
        <span class="block size-full bg-linear-to-br from-amber-300 to-sky-400"></span>
        <span class="absolute -top-0.5 left-1/2 block h-1 w-1/2 -translate-x-1/2 -rotate-3 bg-yellow-200/80" data-tape
        ></span>
      </span>
    </span>
    <span
      class="block shrink-0 truncate text-center leading-none"
      style:font-size="{Math.max(6, size / 8)}px"
      style:color={accent ?? 'currentColor'}
      style:font-family={style?.fontFamily}
    >
      Aa
    </span>
  {:else if gallery}
    <!-- one photo shown whole, never cropped, with space around it -->
    <span class="flex min-h-0 flex-1 items-center justify-center">
      <span class="block h-3/4 w-3/5 rounded-[1px] bg-linear-to-br from-slate-400 to-slate-500"></span>
    </span>
    <span class="flex shrink-0 flex-col items-start gap-px" style:padding-inline="20%">
      <span
        class="block truncate leading-none italic"
        style:font-size="{Math.max(6, size / 8)}px"
        style:color={style?.textColor ?? 'currentColor'}
        style:font-family={style?.fontFamily}
      >
        Aa
      </span>
      <span class="block h-px w-2/3" style:background-color={accent}></span>
    </span>
  {:else}
    <span class="flex min-h-0 flex-1" style:gap="{gutter}px">
      <span class="flex-3 rounded-[1px] bg-linear-to-br from-slate-400 to-slate-500"></span>
      <span class="flex-2 rounded-[1px] bg-linear-to-br from-slate-300 to-slate-400"></span>
    </span>
    {#if printed}
      <span class="mx-auto block h-px w-1/3 shrink-0" style:background-color={accent}></span>
    {/if}
    <span
      class="block truncate leading-none {printed ? 'text-center italic' : 'font-semibold'}"
      style:font-size="{Math.max(7, size / 6)}px"
      style:color={style?.textColor ?? 'currentColor'}
      style:font-family={style?.fontFamily}
      style:font-variant={printed ? 'small-caps' : undefined}
      style:letter-spacing={printed ? '0.08em' : undefined}
    >
      Aa
    </span>
  {/if}
</span>
