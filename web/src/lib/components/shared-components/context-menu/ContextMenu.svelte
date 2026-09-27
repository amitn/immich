<script lang="ts">
  import { clickOutside } from '$lib/actions/click-outside';
  import { languageManager } from '$lib/managers/language-manager.svelte';
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';

  interface Props {
    isVisible?: boolean;
    direction?: 'left' | 'right';
    x?: number;
    y?: number;
    id?: string | undefined;
    ariaLabel?: string | undefined;
    ariaLabelledBy?: string | undefined;
    ariaActiveDescendant?: string | undefined;
    menuScrollView?: HTMLDivElement | undefined;
    menuElement?: HTMLUListElement | undefined;
    onClose?: (() => void) | undefined;
    /** Additional classes for the menu, e.g. its colours in dark mode */
    class?: ClassValue;
    /** The largest part of the window's height a long menu takes before it scrolls, e.g. 0.7; all of it by default */
    maxHeightFraction?: number;
    children?: Snippet;
  }

  let {
    isVisible = false,
    direction = 'right',
    x = 0,
    y = 0,
    id = undefined,
    ariaLabel = undefined,
    ariaLabelledBy = undefined,
    ariaActiveDescendant = undefined,
    menuScrollView = $bindable(),
    menuElement = $bindable(),
    onClose = undefined,
    class: className = undefined,
    maxHeightFraction = 1,
    children,
  }: Props = $props();

  const swap = (direction: string) => (direction === 'left' ? 'right' : 'left');

  const layoutDirection = $derived(languageManager.rtl ? swap(direction) : direction);
  const position = $derived.by(() => {
    if (!menuScrollView || !menuElement) {
      return { left: 0, top: 0 };
    }

    const rect = menuScrollView.getBoundingClientRect();
    const directionWidth = layoutDirection === 'left' ? rect.width : 0;

    const margin = 8;
    // a menu taller than the cap scrolls, and moves up only as far as it needs to show the capped height
    const cap = maxHeightFraction < 1 ? windowInnerHeight * maxHeightFraction : Infinity;
    const height = Math.min(menuElement.clientHeight, cap);

    const left = Math.max(margin, Math.min(windowInnerWidth - rect.width - margin, x - directionWidth));
    const top = Math.max(margin, Math.min(windowInnerHeight - height - (cap === Infinity ? 0 : margin), y));
    const maxHeight = Math.min(cap, windowInnerHeight - top - margin);

    const needScrollBar = menuElement.clientHeight > maxHeight;

    return { left, top, maxHeight, needScrollBar };
  });

  let windowInnerHeight: number = $state(0);
  let windowInnerWidth: number = $state(0);
</script>

<svelte:window bind:innerWidth={windowInnerWidth} bind:innerHeight={windowInnerHeight} />

<div
  bind:this={menuScrollView}
  class={[
    'fixed z-70 w-max max-w-75 min-w-50 immich-scrollbar rounded-lg bg-slate-100 shadow-lg duration-250 ease-in-out',
    position.needScrollBar ? 'overflow-auto' : 'overflow-hidden',
    className,
  ]}
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:max-height={isVisible ? `${position.maxHeight}px` : '0px'}
  style:transition-property="max-height"
  style:scrollbar-color="rgba(85, 86, 87, 0.408) transparent"
  use:clickOutside={{ onOutclick: onClose }}
  tabindex="-1"
>
  <ul
    {id}
    aria-activedescendant={ariaActiveDescendant ?? ''}
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledBy}
    bind:this={menuElement}
    class="flex flex-col outline-none"
    role="menu"
    tabindex="-1"
  >
    {@render children?.()}
  </ul>
</div>
