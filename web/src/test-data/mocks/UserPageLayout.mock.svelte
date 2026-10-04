<script lang="ts">
  interface Props {
    leading?: import('svelte').Snippet;
    buttons?: import('svelte').Snippet;
    children?: import('svelte').Snippet;
  }

  let { leading, buttons, children }: Props = $props();
</script>

<section>
  {@render leading?.()}
  {@render buttons?.()}
  {@render children?.()}
</section>
