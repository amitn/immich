<script lang="ts">
  import { optionClickCallbackStore, selectedIdStore } from '$lib/stores/context-menu.store';
  import { generateId } from '$lib/utils/generate-id';
  import { Icon, type IconLike } from '@immich/ui';

  type Props = {
    text: string;
    icon: IconLike;
    onClick: () => void;
  };

  const { text, icon, onClick }: Props = $props();

  const id = generateId();

  const isActive = $derived($selectedIdStore === id);

  const handleClick = () => {
    // eslint-disable-next-line unicorn/no-optional-chaining-on-undeclared-variable
    $optionClickCallbackStore?.();
    onClick();
  };
</script>

<!-- an action at the end of the Style menu (themed like the style entries), e.g. "Create with assistant…" -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<li
  {id}
  onclick={handleClick}
  onmouseover={() => ($selectedIdStore = id)}
  onmouseleave={() => ($selectedIdStore = undefined)}
  class="flex w-full cursor-pointer items-center gap-3 border-t border-gray-200 px-4 py-3 text-start text-sm font-medium text-immich-fg dark:border-neutral-700 dark:text-immich-dark-fg {isActive
    ? 'bg-slate-300 dark:bg-neutral-700'
    : 'bg-slate-100 dark:bg-neutral-900'}"
  role="menuitem"
>
  <span class="flex w-9 shrink-0 justify-center text-immich-primary dark:text-immich-dark-primary">
    <Icon {icon} size="20" aria-hidden />
  </span>
  <span>{text}</span>
</li>
