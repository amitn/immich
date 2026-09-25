<script lang="ts">
  import { renderMarkdown } from '$lib/utils/markdown';

  type Props = {
    text?: string;
    class?: string;
  };

  const { text, class: className = '' }: Props = $props();

  const html = $derived(renderMarkdown(text));
</script>

<div class="assistant-markdown text-sm/6 wrap-break-word {className}">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized with DOMPurify in renderMarkdown -->
  {@html html}
</div>

<style>
  .assistant-markdown :global(> * + *) {
    margin-top: 0.75em;
  }

  .assistant-markdown :global(h1),
  .assistant-markdown :global(h2),
  .assistant-markdown :global(h3),
  .assistant-markdown :global(h4) {
    font-weight: 600;
    line-height: 1.3;
  }

  .assistant-markdown :global(h1) {
    font-size: 1.25rem;
  }

  .assistant-markdown :global(h2) {
    font-size: 1.125rem;
  }

  .assistant-markdown :global(h3),
  .assistant-markdown :global(h4) {
    font-size: 1rem;
  }

  .assistant-markdown :global(ul) {
    list-style: disc;
    padding-inline-start: 1.5em;
  }

  .assistant-markdown :global(ol) {
    list-style: decimal;
    padding-inline-start: 1.5em;
  }

  .assistant-markdown :global(li + li) {
    margin-top: 0.25em;
  }

  .assistant-markdown :global(a) {
    color: var(--color-primary, currentColor);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .assistant-markdown :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.85em;
    padding: 0.1em 0.35em;
    border-radius: 0.25rem;
    background-color: rgb(127 127 127 / 0.15);
  }

  .assistant-markdown :global(pre) {
    overflow-x: auto;
    padding: 0.75em 1em;
    border-radius: 0.5rem;
    background-color: rgb(127 127 127 / 0.12);
  }

  .assistant-markdown :global(pre code) {
    padding: 0;
    background: none;
  }

  .assistant-markdown :global(blockquote) {
    padding-inline-start: 0.75em;
    border-inline-start: 3px solid rgb(127 127 127 / 0.4);
    opacity: 0.85;
  }

  .assistant-markdown :global(table) {
    display: block;
    overflow-x: auto;
    border-collapse: collapse;
  }

  .assistant-markdown :global(th),
  .assistant-markdown :global(td) {
    padding: 0.25em 0.75em;
    border: 1px solid rgb(127 127 127 / 0.3);
    text-align: start;
  }

  .assistant-markdown :global(hr) {
    border-color: rgb(127 127 127 / 0.3);
  }
</style>
