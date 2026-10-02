<script lang="ts">
  import BurstReview from '$lib/components/bursts/BurstReview.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<UserPageLayout title={data.meta.title} scrollbar={true}>
  <BurstReview albumId={data.albumId} />
</UserPageLayout>
