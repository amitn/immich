<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import OrientationReview from '$lib/components/orientation/OrientationReview.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<UserPageLayout title={data.meta.title} scrollbar={true}>
  <OrientationReview suggestions={data.suggestions} fixed={data.fixed} />
</UserPageLayout>
