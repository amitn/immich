<script lang="ts">
  import { pluginManager } from '$lib/managers/plugin-manager.svelte';
  import { openAssistant } from '$lib/services/assistant.service';
  import { locale } from '$lib/stores/preferences.store';
  import { explainWorkflow, type WorkflowExplainNames } from '$lib/utils/workflow-explain';
  import { getAllAlbums, getAllSpaces, getAllTags, type WorkflowResponseDto } from '@immich/sdk';
  import { Button, Modal, ModalBody, ModalFooter, Text } from '@immich/ui';
  import { mdiCreationOutline, mdiTextBoxOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    workflow: WorkflowResponseDto;
    onClose: () => void;
  };

  let { workflow, onClose }: Props = $props();

  let names = $state<WorkflowExplainNames>({});

  const needs = (methods: string[]) =>
    workflow.steps.some(({ method }) => methods.some((name) => method.endsWith(name)));

  // the names of the albums, spaces and tags the steps refer to by id; until they load, the ids stand in
  const loadNames = async () => {
    const [albums, spaces, tags] = await Promise.all([
      needs(['#assetAddToAlbums']) ? getAllAlbums({}).catch(() => []) : [],
      needs(['#addToSpace', '#addToSpaceAlbum']) ? getAllSpaces().catch(() => []) : [],
      needs(['#assetAddTags', '#assetTagFilter']) ? getAllTags().catch(() => []) : [],
    ]);
    names = {
      albums: new Map(albums.map(({ id, albumName }) => [id, albumName])),
      spaces: new Map(spaces.map(({ id, name }) => [id, name])),
      tags: new Map(tags.map(({ id, value }) => [id, value])),
    };
  };

  void loadNames();

  const explanation = $derived(
    explainWorkflow($t, workflow, { ...names, methodTitle: (method) => pluginManager.getMethodLabel(method) }, $locale),
  );

  const onChange = async () => {
    onClose();
    await openAssistant({
      prompt: $t('workflow_explain_change_prompt', {
        values: { name: workflow.name ?? $t('workflow'), id: workflow.id },
      }),
    });
  };
</script>

<Modal title={workflow.name || $t('workflow')} icon={mdiTextBoxOutline} {onClose} size="medium">
  <ModalBody>
    <div class="flex flex-col gap-4" data-testid="workflow-explanation">
      <Text>{explanation.when}</Text>

      <div>
        <Text fontWeight="semi-bold">{$t('workflow_explain_if')}</Text>
        {#if explanation.conditions.length > 0}
          <ul class="ms-5 list-disc">
            {#each explanation.conditions as condition, index (index)}
              <li>{condition}</li>
            {/each}
          </ul>
        {:else}
          <Text color="muted">{$t('workflow_explain_every_photo')}</Text>
        {/if}
      </div>

      <div>
        <Text fontWeight="semi-bold">{$t('workflow_explain_then')}</Text>
        {#if explanation.actions.length > 0}
          <ul class="ms-5 list-disc">
            {#each explanation.actions as action, index (index)}
              <li>{action}</li>
            {/each}
          </ul>
        {:else}
          <Text color="muted">{$t('workflow_explain_nothing')}</Text>
        {/if}
      </div>

      {#each explanation.notes as note, index (index)}
        <Text size="small" color="warning">{note}</Text>
      {/each}
    </div>
  </ModalBody>
  <ModalFooter>
    <Button fullWidth leadingIcon={mdiCreationOutline} onclick={onChange}>{$t('workflow_explain_change')}</Button>
  </ModalFooter>
</Modal>
