<script lang="ts">
  import { getBookStyleAccent, getBookStyleTheme } from '$lib/utils/book-style';
  import { BookStyleTheme, type BookStyle } from '@immich/sdk';

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
  // the food theme draws its pages like a printed menu: a hairline frame, a rule under the photos and small caps
  const food = $derived(getBookStyleTheme(style) === BookStyleTheme.Food);
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
  data-theme={food ? 'food' : undefined}
>
  {#if food}
    <span
      class="pointer-events-none absolute border"
      style:inset="{Math.max(1, margin * 0.4)}px"
      style:border-color={accent}
      style:opacity="0.6"
    ></span>
  {/if}
  <span class="flex min-h-0 flex-1" style:gap="{gutter}px">
    <span class="flex-3 rounded-[1px] bg-linear-to-br from-slate-400 to-slate-500"></span>
    <span class="flex-2 rounded-[1px] bg-linear-to-br from-slate-300 to-slate-400"></span>
  </span>
  {#if food}
    <span class="mx-auto block h-px w-1/3 shrink-0" style:background-color={accent}></span>
  {/if}
  <span
    class="block truncate leading-none {food ? 'text-center italic' : 'font-semibold'}"
    style:font-size="{Math.max(7, size / 6)}px"
    style:color={style?.textColor ?? 'currentColor'}
    style:font-family={style?.fontFamily}
    style:font-variant={food ? 'small-caps' : undefined}
    style:letter-spacing={food ? '0.08em' : undefined}
  >
    Aa
  </span>
</span>
