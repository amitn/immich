<script lang="ts">
  import { page } from '$app/state';
  import TreeItems from '$lib/components/shared-components/tree/TreeItems.svelte';
  import { sidebarTagsManager } from '$lib/managers/sidebar-tags-manager.svelte';
  import { getActiveTagPath, getTagPathLink } from '$lib/utils/tag-links';
  import { TreeNode } from '$lib/utils/tree-utils';
  import { mdiTag } from '@mdi/js';

  const tags = $derived(sidebarTagsManager.tags ?? []);
  const tree = $derived(TreeNode.fromTags(tags));
  // a tag opens the timeline filtered by it (and its sub-tags), like the Tags row of Explore
  const active = $derived(getActiveTagPath(page.url, tags));
  const getLink = (path: string) => getTagPathLink(tags, path);
</script>

<div class="ps-6 text-sm">
  <TreeItems icons={{ default: mdiTag, active: mdiTag }} {tree} {active} {getLink} />
</div>
