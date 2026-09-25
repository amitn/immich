<script lang="ts">
  import { TooltipProvider } from '@immich/ui';
  import type { ComponentProps } from 'svelte';
  import BookPage from './+page.svelte';

  interface Props {
    data: ComponentProps<typeof BookPage>['data'];
  }

  let { data }: Props = $props();
</script>

<TooltipProvider>
  <BookPage {data} />
</TooltipProvider>
