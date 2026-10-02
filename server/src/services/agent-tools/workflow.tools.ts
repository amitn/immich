import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { MapAlbumDto } from 'src/dtos/album.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { WorkflowResponseDto } from 'src/dtos/workflow.dto.js';
import { ActivityLogAction, AlbumUserRole, AssetType, Permission, SharedSpaceRole } from 'src/enum.js';
import { AssetSearchOptions } from 'src/repositories/search.repository.js';
import { ActivityLogService } from 'src/services/activity-log.service.js';
import { AlbumService } from 'src/services/album.service.js';
import { BaseService } from 'src/services/base.service.js';
import { GalleryWorkflowHostService } from 'src/services/gallery-workflow-host.service.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { WorkflowService } from 'src/services/workflow.service.js';
import { countPhotos, fingerprintWorkflow, quote, toWorkflowSnapshot } from 'src/utils/activity-log.js';
import {
  AgentTool,
  AgentToolContext,
  AgentToolResult,
  defineTool,
  toolError,
  toolJson,
} from 'src/utils/agent/tools.js';
import {
  ExplainNames,
  ParsedActions,
  RuleActions,
  RuleActionsSchema,
  RuleFilters,
  RuleFiltersSchema,
  RuleStep,
  RuleTargets,
  buildWorkflowSteps,
  explainWorkflow,
  getRuleTrigger,
  getRuleWarnings,
  getUnsupportedFilters,
  hasSupportedFilter,
  isExactInSearch,
  matchesRuleFilters,
  normalizeTag,
  parseWorkflowSteps,
  validateRule,
  withoutUnsupported,
} from 'src/utils/agent/workflow-rules.js';
import { upsertTags } from 'src/utils/tag.js';

/** photos a preview shows */
const SAMPLE_SIZE = 12;
/** photos a preview looks at when the search can't apply every filter itself */
const SCAN_LIMIT = 10_000;
const SCAN_PAGE = 500;
/** photos apply_workflow adds at most in one call */
const APPLY_LIMIT = 5000;
const CHUNK = 1000;

const RuleSchema = {
  name: z.string().trim().min(1).max(200).describe('Name of the workflow, e.g. "Screenshots 2025"'),
  description: z.string().max(2000).optional().describe('One sentence on what the workflow does'),
  filters: RuleFiltersSchema,
  actions: RuleActionsSchema,
};

const uuid = z.uuid();
const isUuid = (value: string) => uuid.safeParse(value).success;
const lower = (value: string) => value.trim().toLowerCase();
const DAY_END = 'T23:59:59';

const isOwner = (album: MapAlbumDto, auth: AuthDto) =>
  !!album.albumUsers?.some(({ user, role }) => user.id === auth.user.id && role === AlbumUserRole.Owner);

const chunks = <T>(items: T[], size = CHUNK) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** turns client errors (access, validation) into tool errors the agent can read and recover from */
const handle =
  <I>(handler: (ctx: AgentToolContext, input: I) => Promise<AgentToolResult>) =>
  async (ctx: AgentToolContext, input: I) => {
    try {
      return await handler(ctx, input);
    } catch (error) {
      if (error instanceof HttpException) {
        return toolError(error.message);
      }
      throw error;
    }
  };

type Resolved = {
  filters: RuleFilters;
  targets: RuleTargets;
  /** the ids of the filter tags for the preview search; null when a tag isn't in the library yet */
  tagIds: string[] | null;
  /** what saving creates first */
  creates: { album?: string; tags?: string[] };
  warnings: string[];
};

type Match = { count: number; exact: boolean; truncated: boolean; ids: string[] };

/** Smart albums in plain words (#11): the assistant's front-end to Workflows */
@Injectable()
export class WorkflowAgentTools extends BaseService {
  getTools(): AgentTool[] {
    return [
      defineTool({
        name: 'list_workflows',
        title: 'List workflows',
        description:
          'List the workflows of the user (rules such as smart albums that run on every new photo), with each one ' +
          'summarized in plain words.',
        input: z.object({}),
        mutating: false,
        handler: handle(({ auth }) => this.listWorkflows(auth)),
      }),
      defineTool({
        name: 'explain_workflow',
        title: 'Explain workflow',
        description:
          'Explain a workflow in plain words: when it runs, what a photo must match, what happens to it, and notes ' +
          '(off, or a filter that cannot work with its trigger). Also returns its rule as filters and actions, the ' +
          'input to change it with draft_workflow and update_workflow, and steps the rule format cannot express. ' +
          'withPreview counts the photos of the library it matches now.',
        input: z.object({
          workflowId: uuid.describe('Workflow ID (see list_workflows)'),
          withPreview: z.boolean().default(false),
        }),
        mutating: false,
        handler: handle(({ auth }, input) => this.explain(auth, input)),
      }),
      defineTool({
        name: 'draft_workflow',
        title: 'Draft workflow',
        description:
          'Turn a request like "screenshots from 2025", "every dish from Italy" or "videos from Rome go to the ' +
          'Family space" into a workflow (a smart album rule that runs on every new photo), without saving it. ' +
          'Pass the request as structured filters and actions. Returns the rule in plain words, the workflow it ' +
          'would save, what saving would create, and a preview: how many of the photos of the user already match, ' +
          'with sampleIds. When a filter is not supported by workflows (people, what a photo shows, albums, ' +
          'favorites) it says so and returns a search_photos input for a one-off album instead.',
        input: z.object(RuleSchema),
        mutating: false,
        handler: handle(({ auth }, input) => this.draft(auth, input)),
      }),
      defineTool({
        name: 'save_workflow',
        title: 'Save workflow',
        description:
          'Save a workflow drafted with draft_workflow (same input), after the user approved its summary and ' +
          'preview. Creates the album or tags of its actions when they do not exist. It runs on new photos only: ' +
          'offer apply_workflow for the photos that match already.',
        input: z.object({ ...RuleSchema, enabled: z.boolean().default(true).describe('Turn it on now') }),
        mutating: true,
        handler: handle((ctx, input) => this.save(ctx, input)),
      }),
      defineTool({
        name: 'update_workflow',
        title: 'Update workflow',
        description:
          'Change a workflow: rename it, turn it on or off, or replace its filters and/or actions (the full new ' +
          'set of each, as explain_workflow returns them and draft_workflow previews them). Replacing the rule ' +
          'drops the steps the rule format cannot express only with dropOtherSteps.',
        input: z.object({
          workflowId: uuid.describe('Workflow ID'),
          name: z.string().trim().min(1).max(200).optional(),
          description: z.string().max(2000).optional(),
          enabled: z.boolean().optional(),
          filters: RuleFiltersSchema.optional(),
          actions: RuleActionsSchema.optional(),
          dropOtherSteps: z.boolean().default(false),
        }),
        mutating: true,
        handler: handle((ctx, input) => this.update(ctx, input)),
      }),
      defineTool({
        name: 'apply_workflow',
        title: 'Apply workflow to existing photos',
        description:
          'Apply the album and space actions of a saved workflow to the photos of the user that match it already ' +
          `(at most ${APPLY_LIMIT} per call): a workflow only runs on new photos. Only the user's own photos are ` +
          'added; it refuses workflows that also change photos (archive, favorite, tags).',
        input: z.object({ workflowId: uuid.describe('Workflow ID') }),
        mutating: true,
        handler: handle((ctx, input) => this.apply(ctx, input)),
      }),
    ];
  }

  private workflows() {
    return BaseService.create(WorkflowService, this);
  }

  private async listWorkflows(auth: AuthDto) {
    const workflows = await this.workflows().search(auth, {});
    const names = await this.getNames(auth);
    return toolJson({
      workflows: workflows.map((workflow) => ({
        workflowId: workflow.id,
        name: workflow.name,
        enabled: workflow.enabled,
        trigger: workflow.trigger,
        summary: explainWorkflow(workflow, names).summary,
      })),
    });
  }

  private async explain(auth: AuthDto, { workflowId, withPreview }: { workflowId: string; withPreview: boolean }) {
    const workflow = await this.workflows().get(auth, workflowId);
    const names = await this.getNames(auth);
    const explanation = explainWorkflow(workflow, names);
    const parsed = parseWorkflowSteps(workflow.steps);
    const actions = this.toActionsInput(parsed.actions, names);
    const ignored = parsed.other.filter(({ method, enabled }) => enabled !== false && names.filters.has(method));
    const { tagIds } = await this.resolveFilters(auth, parsed.filters);
    const preview = withPreview
      ? {
          ...(await this.preview(auth, parsed.filters, tagIds)),
          ...(ignored.length > 0 && { ignores: ignored.map(({ method }) => names.methods.get(method) ?? method) }),
        }
      : undefined;
    return toolJson({
      workflowId: workflow.id,
      name: workflow.name,
      description: workflow.description,
      enabled: workflow.enabled,
      trigger: workflow.trigger,
      ...explanation,
      rule: { filters: parsed.filters, actions },
      ...(parsed.other.length > 0 && {
        otherSteps: parsed.other.map((step) => ({
          method: step.method,
          title: names.methods.get(step.method) ?? step.method,
          enabled: step.enabled !== false,
        })),
      }),
      ...(preview && { preview }),
    });
  }

  private async draft(
    auth: AuthDto,
    input: { name: string; description?: string; filters: RuleFilters; actions: RuleActions },
  ) {
    const unsupported = getUnsupportedFilters(input.filters);
    if (unsupported.length > 0) {
      return toolJson(await this.fallback(auth, input, unsupported));
    }

    const errors = validateRule(input.filters, input.actions);
    if (errors.length > 0) {
      return toolError(`The rule is not valid: ${errors.join('; ')}`);
    }

    const resolved = await this.resolve(auth, input.filters, input.actions);
    const steps = buildWorkflowSteps(resolved.filters, resolved.targets, input.actions);
    const trigger = getRuleTrigger(resolved.filters);
    const names = await this.getNames(auth);
    for (const tag of resolved.targets.addTags ?? []) {
      names.tags?.set(tag.id, tag.value);
    }
    if (resolved.targets.space) {
      names.spaces?.set(resolved.targets.space.id, resolved.targets.space.name);
    }
    if (resolved.targets.album?.id) {
      names.albums?.set(resolved.targets.album.id, resolved.targets.album.name);
    }
    const explanation = explainWorkflow({ trigger, enabled: true, steps }, names);
    const preview = await this.preview(auth, resolved.filters, resolved.tagIds);

    return toolJson({
      supported: true,
      name: input.name,
      ...explanation,
      workflow: { trigger, steps },
      ...((resolved.creates.album || resolved.creates.tags) && { creates: resolved.creates }),
      preview,
      warnings: [...resolved.warnings, ...getRuleWarnings(resolved.filters)],
      next:
        'Show the user the summary and the preview photos and ask whether to save it; then call save_workflow ' +
        'with the same input. Afterwards offer apply_workflow for the photos that match already.',
    });
  }

  /** what to say and do when the request needs filters a workflow can't express */
  private async fallback(
    auth: AuthDto,
    input: { name: string; filters: RuleFilters; actions: RuleActions },
    unsupported: Array<{ filter: string; reason: string }>,
  ) {
    const { filters } = input;
    const supported = withoutUnsupported(filters);
    const partial =
      hasSupportedFilter(supported) && validateRule(supported, input.actions).length === 0
        ? await this.resolve(auth, supported, input.actions)
            .then(async (resolved) => {
              const trigger = getRuleTrigger(resolved.filters);
              const steps = buildWorkflowSteps(resolved.filters, resolved.targets, input.actions);
              return explainWorkflow({ trigger, enabled: true, steps }, await this.getNames(auth)).summary;
            })
            .catch(() => {})
        : undefined;
    const searchPhotos = {
      ...(filters.query && { query: filters.query }),
      ...(filters.personIds?.length && { personIds: filters.personIds }),
      ...(filters.takenFrom && { takenAfter: filters.takenFrom }),
      ...(filters.takenTo && { takenBefore: `${filters.takenTo}${DAY_END}` }),
      ...filters.place,
      ...(filters.albumId && { albumId: filters.albumId }),
      ...(filters.type && { type: filters.type }),
      ...(filters.favorite !== undefined && { isFavorite: filters.favorite }),
      ...(filters.tags?.length && { tags: filters.tags }),
    };
    const ignored = [
      filters.fileName && 'fileName',
      filters.near && 'near',
      filters.camera && 'camera',
      filters.missingTimeZone !== undefined && 'missingTimeZone',
      filters.everyYear && 'everyYear',
    ].filter(Boolean);
    return {
      supported: false,
      unsupported,
      fallback: {
        message:
          'Tell the user that a workflow can not do this, and why, and offer a one-off album of the photos that ' +
          'match now instead: search_photos with this input (look at the photos), then create_album with the ones ' +
          'the user approves. New photos will not be added to it.',
        searchPhotos,
        ...(ignored.length > 0 && { notInSearch: ignored }),
        ...((input.actions.space || input.actions.spaceAlbum) && {
          space: 'A one-off album can be added to the space from the space page.',
        }),
      },
      ...(partial && {
        partialRule: {
          summary: partial,
          note: 'A workflow can still do this much, without the unsupported filters; offer it only if it helps.',
        },
      }),
    };
  }

  private async save(
    { auth, activity }: AgentToolContext,
    input: { name: string; description?: string; filters: RuleFilters; actions: RuleActions; enabled: boolean },
  ) {
    const unsupported = getUnsupportedFilters(input.filters);
    if (unsupported.length > 0) {
      return toolError(
        `A workflow can not do this: ${unsupported.map(({ reason }) => reason).join(' ')} Offer a one-off album ` +
          'instead (see draft_workflow).',
      );
    }
    const errors = validateRule(input.filters, input.actions);
    if (errors.length > 0) {
      return toolError(`The rule is not valid: ${errors.join('; ')}`);
    }

    const resolved = await this.resolve(auth, input.filters, input.actions);
    const created = await this.createTargets(auth, activity, resolved);
    const trigger = getRuleTrigger(resolved.filters);
    const steps = buildWorkflowSteps(resolved.filters, resolved.targets, input.actions);
    const workflow = await this.workflows().create(auth, {
      name: input.name,
      description: input.description ?? null,
      trigger,
      enabled: input.enabled,
      steps,
    });

    // the workflow as stored, which undoing compares with
    const saved = await this.workflows().get(auth, workflow.id);
    await BaseService.create(ActivityLogService, this).record(auth, activity, {
      action: ActivityLogAction.WorkflowCreate,
      summary: `Saved the workflow ${quote(input.name)}`,
      targetId: workflow.id,
      undo: { workflowId: workflow.id, fingerprint: fingerprintWorkflow(toWorkflowSnapshot(saved)) },
    });

    const names = await this.getNames(auth);
    const preview = await this.preview(auth, resolved.filters, resolved.tagIds);
    return toolJson({
      workflowId: workflow.id,
      name: workflow.name,
      enabled: workflow.enabled,
      summary: explainWorkflow(saved, names).summary,
      ...(resolved.targets.album?.id && { albumId: resolved.targets.album.id }),
      ...(created.length > 0 && { created }),
      matchingNow: preview.count,
      next:
        preview.count > 0
          ? `It runs on new photos only. Offer apply_workflow to add the ${countPhotos(preview.count)} that match already.`
          : 'It runs on new photos only.',
    });
  }

  private async update(
    { auth, activity }: AgentToolContext,
    input: {
      workflowId: string;
      name?: string;
      description?: string;
      enabled?: boolean;
      filters?: RuleFilters;
      actions?: RuleActions;
      dropOtherSteps: boolean;
    },
  ) {
    const current = await this.workflows().get(auth, input.workflowId);
    const before = toWorkflowSnapshot(current);
    const changesRule = !!(input.filters || input.actions);
    if (!changesRule && input.name === undefined && input.description === undefined && input.enabled === undefined) {
      return toolError('Nothing to change: pass a name, description, enabled, filters or actions');
    }

    let rule: { trigger: WorkflowResponseDto['trigger']; steps: RuleStep[] } | undefined;
    if (changesRule) {
      const parsed = parseWorkflowSteps(current.steps);
      if (parsed.other.length > 0 && !input.dropOtherSteps) {
        return toolError(
          `The workflow has steps a rule can not express (${parsed.other.map(({ method }) => method).join(', ')}). ` +
            'Changing its rule drops them: ask the user, then pass dropOtherSteps.',
        );
      }
      const names = await this.getNames(auth);
      const filters = input.filters ?? parsed.filters;
      const actions = input.actions ?? this.toActionsInput(parsed.actions, names);
      const unsupported = getUnsupportedFilters(filters);
      if (unsupported.length > 0) {
        return toolError(`A workflow can not do this: ${unsupported.map(({ reason }) => reason).join(' ')}`);
      }
      const errors = validateRule(filters, actions);
      if (errors.length > 0) {
        return toolError(`The rule is not valid: ${errors.join('; ')}`);
      }
      const resolved = await this.resolve(auth, filters, actions);
      await this.createTargets(auth, activity, resolved);
      rule = {
        trigger: getRuleTrigger(resolved.filters),
        steps: buildWorkflowSteps(resolved.filters, resolved.targets, actions),
      };
    }

    const updated = await this.workflows().update(auth, input.workflowId, {
      name: input.name,
      description: input.description,
      enabled: input.enabled,
      ...rule,
    });
    const after = toWorkflowSnapshot(updated);
    await BaseService.create(ActivityLogService, this).record(auth, activity, {
      action: ActivityLogAction.WorkflowUpdate,
      summary: `Changed the workflow ${quote(updated.name ?? current.name ?? 'Workflow')}`,
      targetId: updated.id,
      undo: { workflowId: updated.id, previous: before, fingerprint: fingerprintWorkflow(after) },
    });

    return toolJson({
      workflowId: updated.id,
      name: updated.name,
      enabled: updated.enabled,
      summary: explainWorkflow(updated, await this.getNames(auth)).summary,
    });
  }

  private async apply({ auth, activity }: AgentToolContext, { workflowId }: { workflowId: string }) {
    const workflow = await this.workflows().get(auth, workflowId);
    const parsed = parseWorkflowSteps(workflow.steps);
    const names = await this.getNames(auth);
    // a step that is turned off does not run, so it does not matter here either
    const other = parsed.other.filter(({ enabled }) => enabled !== false);
    const otherFilters = other.filter(({ method }) => names.filters.has(method));
    if (otherFilters.length > 0) {
      return toolError(
        `The workflow has filters the assistant can not check on existing photos (${otherFilters.map(({ method }) => names.methods.get(method) ?? method).join(', ')}), ` +
          'so it can not be applied to them: it runs on new photos only.',
      );
    }
    const changes = [
      ...other.map(({ method }) => names.methods.get(method) ?? method),
      parsed.actions.archive && 'archive',
      parsed.actions.favorite && 'favorite',
      parsed.actions.tagIds && 'add tags',
    ].filter((change): change is string => !!change);
    if (changes.length > 0) {
      return toolError(
        `apply_workflow only adds photos to albums and spaces, and this workflow also changes photos (${changes.join(', ')}), ` +
          'which it does to new photos only.',
      );
    }

    const { tagIds } = await this.resolveFilters(auth, parsed.filters);
    const match = await this.findMatches(auth, parsed.filters, tagIds, APPLY_LIMIT);
    if (match.ids.length === 0) {
      return toolJson({ workflowId, matched: 0, message: 'No photo of the library matches the workflow yet' });
    }

    const activityLog = BaseService.create(ActivityLogService, this);
    const albumService = BaseService.create(AlbumService, this);
    const results: Array<Record<string, unknown>> = [];
    const addToAlbum = async (albumId: string, label: string) => {
      const added: string[] = [];
      let failed = 0;
      for (const ids of chunks(match.ids)) {
        const response = await albumService.addAssets(auth, albumId, { ids });
        added.push(...response.filter(({ success }) => success).map(({ id }) => id));
        failed += response.filter(({ success, error }) => !success && error !== 'duplicate').length;
      }
      if (added.length > 0) {
        await activityLog.record(auth, activity, {
          action: ActivityLogAction.AlbumAddAssets,
          summary: `Added ${countPhotos(added.length)} to ${quote(label)}`,
          targetId: albumId,
          assetIds: added,
          undo: { albumId, assetIds: added },
        });
      }
      results.push({ albumId, album: label, added: added.length, failed });
    };

    if (parsed.actions.albumIds?.length || parsed.actions.albumName) {
      const albumId =
        parsed.actions.albumIds?.[0] ?? (await this.findOrCreateAlbum(auth, activity, parsed.actions.albumName!));
      const album = await albumService.get(auth, albumId);
      await addToAlbum(albumId, album.albumName);
    }
    if (parsed.actions.spaceAlbum) {
      const { spaceId, albumName } = parsed.actions.spaceAlbum;
      const albumId = await BaseService.create(GalleryWorkflowHostService, this).resolveSpaceAlbum(
        auth,
        spaceId,
        albumName,
      );
      await addToAlbum(albumId, albumName);
    }
    for (const spaceId of parsed.actions.spaceIds ?? []) {
      const space = await this.sharedSpaceRepository.getById(spaceId);
      const existing = new Set<string>();
      for (const ids of chunks(match.ids)) {
        for (const id of await this.sharedSpaceRepository.getDirectAssetIds(spaceId, ids)) {
          existing.add(id);
        }
      }
      const added = match.ids.filter((id) => !existing.has(id));
      for (const ids of chunks(added)) {
        await BaseService.create(SharedSpaceService, this).addAssets(auth, spaceId, { assetIds: ids });
      }
      if (added.length > 0) {
        await activityLog.record(auth, activity, {
          action: ActivityLogAction.SpaceAddAssets,
          summary: `Added ${countPhotos(added.length)} to the space ${quote(space?.name ?? 'Space')}`,
          targetId: spaceId,
          assetIds: added,
          undo: { spaceId, assetIds: added },
        });
      }
      results.push({ spaceId, space: space?.name ?? null, added: added.length, alreadyIn: existing.size });
    }

    return toolJson({
      workflowId,
      matched: match.ids.length,
      ...(match.truncated && { truncated: true, note: 'More photos may match: call apply_workflow again' }),
      results,
    });
  }

  /** creates the album and the tags of the actions that don't exist yet, and records them */
  private async createTargets(auth: AuthDto, activity: AgentToolContext['activity'], resolved: Resolved) {
    const created: string[] = [];
    const { targets } = resolved;
    if (targets.album && !targets.album.id) {
      targets.album.id = await this.findOrCreateAlbum(auth, activity, targets.album.name);
      created.push(`album ${quote(targets.album.name)}`);
    }
    const missing = targets.addTags?.filter(({ id }) => id.startsWith('new:')) ?? [];
    if (missing.length > 0) {
      const tags = await upsertTags(this.tagRepository, {
        userId: auth.user.id,
        tags: missing.map(({ value }) => value),
      });
      const byValue = new Map(tags.map((tag) => [lower(tag.value), tag.id]));
      for (const tag of missing) {
        tag.id = byValue.get(lower(tag.value)) ?? tag.id;
        created.push(`tag ${quote(tag.value)}`);
      }
    }
    return created;
  }

  private async findOrCreateAlbum(auth: AuthDto, activity: AgentToolContext['activity'], name: string) {
    const albums = await this.albumRepository.getAll(auth.user.id, {});
    const existing = albums.find((album) => isOwner(album, auth) && lower(album.albumName) === lower(name));
    if (existing) {
      return existing.id;
    }
    const album = await BaseService.create(AlbumService, this).create(auth, { albumName: name });
    await BaseService.create(ActivityLogService, this).record(auth, activity, {
      action: ActivityLogAction.AlbumCreate,
      summary: `Created the album ${quote(album.albumName)} for a workflow`,
      targetId: album.id,
      undo: { albumId: album.id, name: album.albumName, description: album.description || null, assetIds: [] },
    });
    return album.id;
  }

  /** the names the workflow steps refer to by id, and which plugin methods are filters */
  private async getNames(auth: AuthDto): Promise<Required<ExplainNames> & { filters: Set<string> }> {
    const [albums, spaces, tags, methods] = await Promise.all([
      this.albumRepository.getAll(auth.user.id, {}),
      this.sharedSpaceRepository.getAllByUserId(auth.user.id),
      this.tagRepository.getAll(auth.user.id),
      this.pluginRepository.searchMethods(),
    ]);
    return {
      albums: new Map(albums.map(({ id, albumName }) => [id, albumName])),
      spaces: new Map(spaces.map(({ id, name }) => [id, name])),
      tags: new Map(tags.map(({ id, value }) => [id, value])),
      methods: new Map(methods.map((method) => [`${method.pluginName}#${method.name}`, method.title])),
      filters: new Set(
        methods
          .filter(({ uiHints }) => (uiHints as string[] | null)?.includes('Filter'))
          .map((method) => `${method.pluginName}#${method.name}`),
      ),
    };
  }

  /** the actions of a workflow as the input of draft_workflow and update_workflow */
  private toActionsInput(actions: ParsedActions, names: ExplainNames): RuleActions {
    return {
      ...((actions.albumIds?.[0] ?? actions.albumName) && { album: actions.albumIds?.[0] ?? actions.albumName }),
      ...(actions.spaceIds?.[0] && { space: actions.spaceIds[0] }),
      ...(actions.spaceAlbum && {
        spaceAlbum: { space: actions.spaceAlbum.spaceId, album: actions.spaceAlbum.albumName },
      }),
      ...(actions.tagIds && { addTags: actions.tagIds.map((id) => names.tags?.get(id) ?? id) }),
      ...(actions.archive && { archive: true as const }),
      ...(actions.favorite && { favorite: true as const }),
    };
  }

  /** the filter tags and places as the library spells them, with the tag ids for the preview */
  private async resolveFilters(auth: AuthDto, input: RuleFilters) {
    const filters: RuleFilters = { ...input };
    const warnings: string[] = [];
    let tagIds: string[] | null = [];

    if (filters.tags?.length) {
      const tags = await this.tagRepository.getAll(auth.user.id);
      const byValue = new Map(tags.map((tag) => [lower(tag.value), tag]));
      filters.tags = filters.tags.map((value) => {
        const tag = byValue.get(lower(normalizeTag(value)));
        if (!tag) {
          warnings.push(
            `No photo has the tag ${quote(normalizeTag(value))} yet: the rule will match the photos that get it.`,
          );
          tagIds = null;
          return normalizeTag(value);
        }
        tagIds?.push(tag.id);
        return tag.value;
      });
    }

    if (filters.place) {
      const userIds = [auth.user.id];
      const [countries, states, cities] = await Promise.all([
        filters.place.country ? this.searchRepository.getCountries(userIds) : [],
        filters.place.state ? this.searchRepository.getStates(userIds, {}) : [],
        filters.place.city ? this.searchRepository.getCities(userIds, {}) : [],
      ]);
      const place = { ...filters.place };
      for (const [key, known] of [
        ['country', countries],
        ['state', states],
        ['city', cities],
      ] as const) {
        const value = place[key];
        if (!value) {
          continue;
        }
        const match = known.find((candidate) => lower(candidate) === lower(value));
        if (match) {
          place[key] = match;
        } else {
          warnings.push(
            `No photo was taken in a ${key} called ${quote(value)}. The rule matches the place names of the ` +
              `library exactly${key === 'country' && countries.length > 0 ? `, e.g. ${countries.slice(0, 8).join(', ')}` : ''}.`,
          );
        }
      }
      filters.place = place;
    }

    return { filters, tagIds, warnings };
  }

  /** the albums, spaces and tags of a rule, and its filters as the library spells them */
  private async resolve(auth: AuthDto, input: RuleFilters, actions: RuleActions): Promise<Resolved> {
    const { filters, tagIds, warnings } = await this.resolveFilters(auth, input);
    const targets: RuleTargets = {};
    const creates: Resolved['creates'] = {};

    if (actions.album) {
      targets.album = await this.resolveAlbum(auth, actions.album);
      if (!targets.album.id) {
        creates.album = targets.album.name;
      }
    }
    if (actions.space) {
      targets.space = await this.resolveSpace(auth, actions.space);
    }
    if (actions.spaceAlbum) {
      const space = await this.resolveSpace(auth, actions.spaceAlbum.space);
      targets.spaceAlbum = { spaceId: space.id, spaceName: space.name, albumName: actions.spaceAlbum.album };
    }
    if (actions.addTags?.length) {
      const tags = await this.tagRepository.getAll(auth.user.id);
      const byValue = new Map(tags.map((tag) => [lower(tag.value), tag]));
      const byId = new Map(tags.map((tag) => [tag.id, tag]));
      targets.addTags = actions.addTags.map((value) => {
        const tag = byId.get(value) ?? byValue.get(lower(normalizeTag(value)));
        return tag
          ? { id: tag.id, value: tag.value }
          : { id: `new:${normalizeTag(value)}`, value: normalizeTag(value) };
      });
      const missing = targets.addTags.filter(({ id }) => id.startsWith('new:')).map(({ value }) => value);
      if (missing.length > 0) {
        creates.tags = missing;
      }
    }

    return { filters, targets, tagIds, creates, warnings };
  }

  private async resolveAlbum(auth: AuthDto, value: string): Promise<{ id: string | null; name: string }> {
    const albums = await this.albumRepository.getAll(auth.user.id, {});
    const album = isUuid(value)
      ? albums.find(({ id }) => id === value)
      : (albums.find((candidate) => isOwner(candidate, auth) && lower(candidate.albumName) === lower(value)) ??
        albums.find((candidate) => lower(candidate.albumName) === lower(value)));
    if (!album) {
      if (isUuid(value)) {
        throw new BadRequestException(`Album ${value} not found`);
      }
      return { id: null, name: value.trim() };
    }
    const allowed = await this.checkAccess({ auth, permission: Permission.AlbumAssetCreate, ids: [album.id] });
    if (!allowed.has(album.id)) {
      throw new BadRequestException(
        `The user can not add photos to the album ${quote(album.albumName)} (it is someone else's and they are not an ` +
          'editor): pick another album or a new name',
      );
    }
    return { id: album.id, name: album.albumName };
  }

  /** a space the user can add photos to: adding needs the Editor role, as the workflow host enforces */
  private async resolveSpace(auth: AuthDto, value: string) {
    const spaces = await this.sharedSpaceRepository.getAllByUserId(auth.user.id);
    const space = spaces.find(({ id, name }) => id === value || lower(name) === lower(value));
    if (!space) {
      const known = spaces.map(({ name }) => quote(name)).join(', ') || 'none';
      throw new BadRequestException(`Space ${quote(value)} not found. The spaces of the user: ${known}`);
    }
    const member = await this.sharedSpaceRepository.getMember(space.id, auth.user.id);
    if (!member || ![SharedSpaceRole.Owner, SharedSpaceRole.Editor].includes(member.role as SharedSpaceRole)) {
      throw new BadRequestException(
        `The user is a viewer of the space ${quote(space.name)}: adding photos to it needs the Editor role`,
      );
    }
    return { id: space.id, name: space.name };
  }

  /** the photos of the user a rule matches now: a count and samples */
  private async preview(auth: AuthDto, filters: RuleFilters, tagIds: string[] | null) {
    const match = await this.findMatches(auth, filters, tagIds, SAMPLE_SIZE);
    return {
      count: match.count,
      ...(match.truncated && { atLeast: true }),
      exact: match.exact,
      sampleIds: match.ids,
      note:
        "Only the user's own photos count: a workflow runs on the photos the user uploads. Newest first." +
        (match.truncated ? ` Only the newest ${SCAN_LIMIT} candidates were checked.` : ''),
    };
  }

  /**
   * The photos of the user a rule matches now, newest first: the search applies what it can (type, place, tags, a
   * wider date range, the file name), then `matchesRuleFilters` checks each photo as the plugins would.
   */
  private async findMatches(
    auth: AuthDto,
    filters: RuleFilters,
    tagIds: string[] | null,
    maxIds: number,
  ): Promise<Match> {
    if (tagIds === null) {
      return { count: 0, exact: true, truncated: false, ids: [] };
    }

    const exact = isExactInSearch(filters);
    const options = this.toSearchOptions(auth, filters, tagIds, !exact);
    if (exact) {
      const [{ total }, { items }] = await Promise.all([
        this.searchRepository.searchStatistics(options),
        this.searchRepository.searchMetadata({ page: 1, size: maxIds }, { ...options, orderDirection: 'desc' }),
      ]);
      return { count: Number(total), exact, truncated: false, ids: items.map(({ id }) => id) };
    }

    const ids: string[] = [];
    let count = 0;
    let scanned = 0;
    let page = 1;
    let hasNextPage = true;
    while (hasNextPage && scanned < SCAN_LIMIT) {
      const result = await this.searchRepository.searchMetadata(
        { page, size: SCAN_PAGE },
        { ...options, orderDirection: 'desc' },
      );
      for (const asset of result.items) {
        if (!matchesRuleFilters(asset, filters)) {
          continue;
        }

        count++;
        if (ids.length < maxIds) {
          ids.push(asset.id);
        }
      }
      scanned += result.items.length;
      hasNextPage = result.hasNextPage;
      page++;
    }

    return { count, exact: !hasNextPage, truncated: hasNextPage, ids };
  }

  private toSearchOptions(
    auth: AuthDto,
    filters: RuleFilters,
    tagIds: string[],
    withExif: boolean,
  ): AssetSearchOptions {
    const day = 24 * 60 * 60 * 1000;
    const from = filters.takenFrom && !filters.everyYear ? new Date(`${filters.takenFrom}T00:00:00Z`) : undefined;
    const to = filters.takenTo && !filters.everyYear ? new Date(`${filters.takenTo}${DAY_END}Z`) : undefined;
    const fileName = filters.fileName && filters.fileName.match !== 'regex' ? filters.fileName.pattern : undefined;
    return {
      userIds: [auth.user.id],
      visibility: 'timeline-or-archive',
      withExif,
      ...(filters.type && { type: filters.type === 'video' ? AssetType.Video : AssetType.Image }),
      ...(filters.place?.country && { country: filters.place.country }),
      ...(filters.place?.state && { state: filters.place.state }),
      ...(filters.place?.city && { city: filters.place.city }),
      ...(tagIds.length > 0 && { tagIds }),
      // the search compares the instant a photo was taken, the plugin its local time: up to a day apart
      ...(from && { takenAfter: new Date(from.getTime() - 2 * day) }),
      ...(to && { takenBefore: new Date(to.getTime() + 2 * day) }),
      ...(fileName && { originalFileName: fileName }),
    };
  }
}
