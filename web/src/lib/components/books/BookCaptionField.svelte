<script lang="ts">
  import { Field, Input, Textarea } from '@immich/ui';
  import { onDestroy } from 'svelte';

  type Props = {
    label: string;
    value: string | null;
    placeholder?: string;
    maxlength: number;
    /** a textarea, saved with Ctrl+Enter or on blur; a single-line input is also saved with Enter */
    multiline?: boolean;
    disabled?: boolean;
    /** milliseconds without typing after which the text is saved */
    debounce?: number;
    /** resolves to false when saving failed, so that the text is kept to try again */
    onSave: (value: string | null) => Promise<boolean>;
  };

  const {
    label,
    value,
    placeholder,
    maxlength,
    multiline = false,
    disabled = false,
    debounce = 1500,
    onSave,
  }: Props = $props();

  const normalize = (text: string | null | undefined) => text?.trim() ?? '';

  // svelte-ignore state_referenced_locally
  let draft = $state(value ?? '');
  // the last value sent (or received), so that the same text is not saved twice
  // svelte-ignore state_referenced_locally
  let saved = normalize(value);
  let dirty = $state(false);
  let failed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  // show changes from the server (e.g. the assistant), unless the text is being edited
  $effect(() => {
    const next = normalize(value);
    if (!dirty && next !== saved) {
      saved = next;
      draft = value ?? '';
    }
  });

  const cancelTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const save = async () => {
    cancelTimer();
    const text = normalize(draft);
    if (text === saved) {
      dirty = false;
      return;
    }
    saved = text;
    const ok = await onSave(text.length > 0 ? text : null);
    failed = !ok;
    if (ok) {
      dirty = normalize(draft) !== text;
    } else {
      // try again on the next blur or Enter
      saved = normalize(value);
    }
  };

  const oninput = () => {
    dirty = true;
    cancelTimer();
    timer = setTimeout(() => void save(), debounce);
  };

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && dirty) {
      event.preventDefault();
      event.stopPropagation();
      cancelTimer();
      draft = value ?? '';
      saved = normalize(value);
      dirty = false;
      failed = false;
      return;
    }
    if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    }
  };

  const onblur = () => void save();

  // the text was saved on blur, e.g. when another photo was selected
  onDestroy(cancelTimer);
</script>

<Field {label} {disabled} invalid={failed}>
  {#if multiline}
    <Textarea bind:value={draft} {placeholder} {maxlength} rows={2} grow {oninput} {onkeydown} {onblur} />
  {:else}
    <Input bind:value={draft} {placeholder} {maxlength} {oninput} {onkeydown} {onblur} />
  {/if}
</Field>
