<script lang="ts">
  import { page } from '$app/state';
  import TreeItems from '$lib/components/shared-components/tree/TreeItems.svelte';
  import { QueryParameter } from '$lib/constants';
  import { sidebarTagsManager } from '$lib/managers/sidebar-tags-manager.svelte';
  import { Route } from '$lib/route';
  import { TreeNode } from '$lib/utils/tree-utils';
  import { mdiTag } from '@mdi/js';

  const tree = $derived(TreeNode.fromTags(sidebarTagsManager.tags ?? []));
  const active = $derived(
    page.url.pathname.startsWith(Route.tags()) ? (page.url.searchParams.get(QueryParameter.PATH) ?? '') : '',
  );
  const getLink = (path: string) => Route.tags({ path });
</script>

<div class="ps-6 text-sm">
  <TreeItems icons={{ default: mdiTag, active: mdiTag }} {tree} {active} {getLink} />
</div>
