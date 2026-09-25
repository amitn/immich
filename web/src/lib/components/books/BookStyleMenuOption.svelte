<script lang="ts">
  import BookStyleSwatch from '$lib/components/books/BookStyleSwatch.svelte';
  import { optionClickCallbackStore, selectedIdStore } from '$lib/stores/context-menu.store';
  import { generateId } from '$lib/utils/generate-id';
  import type { BookStyle } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCheck } from '@mdi/js';

  type Props = {
    name: string;
    description?: string;
    style?: BookStyle;
    pageWidthMm?: number;
    /** The style of the book */
    checked?: boolean;
    /** Shown for information only, e.g. the custom style */
    disabled?: boolean;
    onClick?: () => void;
  };

  const { name, description, style, pageWidthMm, checked = false, disabled = false, onClick }: Props = $props();

  const id = generateId();

  const isActive = $derived($selectedIdStore === id);

  const handleClick = () => {
    // eslint-disable-next-line unicorn/no-optional-chaining-on-undeclared-variable
    $optionClickCallbackStore?.();
    if (!disabled) {
      onClick?.();
    }
  };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<li
  {id}
  onclick={handleClick}
  onmouseover={() => ($selectedIdStore = id)}
  onmouseleave={() => ($selectedIdStore = undefined)}
  class="flex w-full items-center gap-3 px-4 py-2 text-start text-sm font-medium text-immich-fg dark:text-immich-dark-bg {disabled
    ? 'cursor-default'
    : 'cursor-pointer'} {isActive ? 'bg-slate-300' : 'bg-slate-100'}"
  role="menuitemradio"
  aria-checked={checked}
  aria-disabled={disabled || undefined}
>
  <BookStyleSwatch {style} {pageWidthMm} size={36} />
  <span class="flex min-w-0 grow flex-col">
    <span class={checked ? 'text-immich-primary' : ''}>{name}</span>
    {#if description}
      <span class="max-w-56 text-xs font-normal text-gray-500">{description}</span>
    {/if}
  </span>
  <span class="size-4.5 shrink-0 text-immich-primary">
    {#if checked}
      <Icon icon={mdiCheck} size="18" aria-hidden />
    {/if}
  </span>
</li>
