<script lang="ts">
  import { collectionPacks } from '$lib/journals/registry';
  import { handleError } from '$lib/utils/handle-error';
  import {
    DEFAULT_SCHEDULE,
    getBrowserTimeZone,
    getWeekdayName,
    parseCron,
    routineEventKeys,
    toCron,
    type ScheduleKind,
  } from '$lib/utils/routines';
  import {
    createRoutine,
    getAllAlbums,
    RoutineApprovalMode,
    RoutineEvent,
    RoutineTriggerType,
    updateRoutine,
    type AlbumResponseDto,
    type RoutineConfigResponseDto,
    type RoutineResponseDto,
    type RoutineTriggerDto,
  } from '@immich/sdk';
  import {
    Alert,
    Field,
    FormModal,
    HelperText,
    Input,
    MultiSelect,
    NumberInput,
    Select,
    Switch,
    Text,
    Textarea,
  } from '@immich/ui';
  import { mdiRobotOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    config: RoutineConfigResponseDto;
    /** the routine to edit; a new one without */
    routine?: RoutineResponseDto;
    /** the start of a new routine, e.g. from a chat turn ("Make this a routine") */
    initial?: { name?: string; instruction?: string };
    onClose: (routine?: RoutineResponseDto) => void;
  };

  const { config, routine, initial, onClose }: Props = $props();

  // svelte-ignore state_referenced_locally
  const start = routine;
  const startSchedule = parseCron(start?.trigger.type === RoutineTriggerType.Schedule ? start.trigger.cron : undefined);

  // svelte-ignore state_referenced_locally
  let name = $state(start?.name ?? initial?.name ?? '');
  // svelte-ignore state_referenced_locally
  let instruction = $state(start?.instruction ?? initial?.instruction ?? '');
  let triggerType = $state<RoutineTriggerType>(start?.trigger.type ?? RoutineTriggerType.Schedule);
  let scheduleKind = $state<ScheduleKind>(startSchedule.kind);
  let scheduleTime = $state(startSchedule.time);
  let scheduleWeekday = $state(String(startSchedule.weekday));
  let scheduleCron = $state(startSchedule.kind === 'custom' ? startSchedule.cron : DEFAULT_SCHEDULE.cron);
  let event = $state<RoutineEvent>(start?.trigger.event ?? RoutineEvent.Upload);
  let eventTag = $state(start?.trigger.tag ?? '');
  let eventPack = $state(start?.trigger.pack ?? '');
  let sinceLastRun = $state(start?.scope.sinceLastRun ?? true);
  let days = $state<number | undefined>(start?.scope.days);
  let albumIds = $state<string[]>(start?.scope.albumIds ?? []);
  let tags = $state((start?.scope.tags ?? []).join(', '));
  let pack = $state(start?.scope.pack ?? '');
  let approvalMode = $state<RoutineApprovalMode>(start?.approvalMode ?? RoutineApprovalMode.Ask);
  let runsPerDay = $state(start?.limits.runsPerDay ?? config.defaultLimits.runsPerDay);
  let minutes = $state(start?.limits.minutes ?? config.defaultLimits.minutes);
  let toolCalls = $state(start?.limits.toolCalls ?? config.defaultLimits.toolCalls);
  let profile = $state(start?.profile ?? '');
  let enabled = $state(start?.enabled ?? true);
  let albums = $state<AlbumResponseDto[]>([]);

  const triggerOptions = $derived([
    { value: RoutineTriggerType.Schedule, label: $t('routine_trigger_schedule') },
    { value: RoutineTriggerType.Event, label: $t('routine_trigger_event') },
    { value: RoutineTriggerType.Manual, label: $t('routine_trigger_manual') },
  ]);
  const scheduleOptions = $derived([
    { value: 'daily' as ScheduleKind, label: $t('routine_schedule_daily') },
    { value: 'weekly' as ScheduleKind, label: $t('routine_schedule_weekly') },
    { value: 'custom' as ScheduleKind, label: $t('routine_schedule_custom') },
  ]);
  const weekdayOptions = $derived(
    [0, 1, 2, 3, 4, 5, 6].map((day) => ({ value: String(day), label: getWeekdayName(day, $locale ?? undefined) })),
  );
  const eventOptions = $derived(
    Object.values(RoutineEvent).map((value) => ({ value, label: $t(routineEventKeys[value]) })),
  );
  const packOptions = $derived([
    { value: '', label: $t('routine_any_journal') },
    ...collectionPacks.map((item) => ({ value: item.id, label: item.tagRoot })),
  ]);
  const profileOptions = $derived([
    { value: '', label: $t('routine_profile_default', { values: { name: config.defaultProfile } }) },
    ...config.profiles.map((value) => ({ value, label: value })),
  ]);
  const albumOptions = $derived(albums.map((album) => ({ value: album.id, label: album.albumName })));
  const approvalOptions = $derived([
    {
      value: RoutineApprovalMode.Ask,
      label: $t('routine_approval_ask'),
      description: $t('routine_approval_ask_description'),
    },
    {
      value: RoutineApprovalMode.AutoSafe,
      label: $t('routine_approval_auto_safe'),
      description: $t('routine_approval_auto_safe_description'),
    },
    {
      value: RoutineApprovalMode.DryRun,
      label: $t('routine_approval_dry_run'),
      description: $t('routine_approval_dry_run_description'),
    },
  ]);

  onMount(async () => {
    try {
      albums = await getAllAlbums({});
    } catch {
      // the albums of the scope are optional
    }
  });

  const getTrigger = (): RoutineTriggerDto => {
    if (triggerType === RoutineTriggerType.Schedule) {
      return {
        type: triggerType,
        cron: toCron({ kind: scheduleKind, time: scheduleTime, weekday: Number(scheduleWeekday), cron: scheduleCron }),
        timezone: getBrowserTimeZone(),
      };
    }
    if (triggerType === RoutineTriggerType.Event) {
      return {
        type: triggerType,
        event,
        ...(event === RoutineEvent.Tag && eventTag.trim() && { tag: eventTag.trim() }),
        ...(event === RoutineEvent.JournalVisit && eventPack && { pack: eventPack }),
      };
    }
    return { type: RoutineTriggerType.Manual };
  };

  const onSubmit = async () => {
    const tagList = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const dto = {
      name: name.trim(),
      instruction: instruction.trim(),
      trigger: getTrigger(),
      scope: {
        sinceLastRun,
        ...(days && { days }),
        ...(albumIds.length > 0 && { albumIds }),
        ...(tagList.length > 0 && { tags: tagList }),
        ...(pack && { pack }),
      },
      approvalMode,
      limits: { runsPerDay, minutes, toolCalls },
      profile: profile || null,
      enabled,
    };
    try {
      const saved = routine
        ? await updateRoutine({ id: routine.id, routineUpdateDto: dto })
        : await createRoutine({ routineCreateDto: dto });
      onClose(saved);
    } catch (error) {
      handleError(error, $t('errors.unable_to_save_routine'));
    }
  };
</script>

<FormModal
  size="large"
  title={routine ? $t('routine_edit') : $t('routine_new')}
  submitText={routine ? $t('save') : $t('create')}
  icon={mdiRobotOutline}
  disabled={!name.trim() || !instruction.trim()}
  onClose={() => onClose()}
  {onSubmit}
>
  <div class="flex flex-col gap-4">
    <Field label={$t('routine_name')} required>
      <Input bind:value={name} maxlength={100} />
    </Field>

    <Field label={$t('routine_instruction')} required>
      <Textarea bind:value={instruction} placeholder={$t('routine_instruction_placeholder')} rows={4} />
    </Field>

    <Field label={$t('routine_when')}>
      <Select options={triggerOptions} bind:value={triggerType} />
    </Field>

    {#if triggerType === RoutineTriggerType.Schedule}
      <div class="grid grid-cols-1 gap-3 ps-4 sm:grid-cols-3">
        <Field label={$t('routine_schedule')}>
          <Select options={scheduleOptions} bind:value={scheduleKind} />
        </Field>
        {#if scheduleKind === 'custom'}
          <Field label={$t('routine_schedule_cron')} class="sm:col-span-2">
            <Input bind:value={scheduleCron} />
            <HelperText>{$t('routine_schedule_cron_description')}</HelperText>
          </Field>
        {:else}
          {#if scheduleKind === 'weekly'}
            <Field label={$t('routine_schedule_weekday')}>
              <Select options={weekdayOptions} bind:value={scheduleWeekday} />
            </Field>
          {/if}
          <Field label={$t('routine_schedule_time')}>
            <Input type="time" bind:value={scheduleTime} />
          </Field>
        {/if}
      </div>
    {:else if triggerType === RoutineTriggerType.Event}
      <div class="grid grid-cols-1 gap-3 ps-4 sm:grid-cols-2">
        <Field label={$t('routine_event')}>
          <Select options={eventOptions} bind:value={event} />
        </Field>
        {#if event === RoutineEvent.Tag}
          <Field label={$t('routine_event_tag_filter')}>
            <Input bind:value={eventTag} placeholder="print" />
            <HelperText>{$t('routine_event_tag_filter_description')}</HelperText>
          </Field>
        {:else if event === RoutineEvent.JournalVisit}
          <Field label={$t('routine_event_journal_filter')}>
            <Select options={packOptions} bind:value={eventPack} />
          </Field>
        {/if}
      </div>
      {#if event === RoutineEvent.Upload || event === RoutineEvent.Workflow}
        <Text size="small" color="muted" class="ps-4">{$t('routine_event_batched')}</Text>
      {/if}
    {/if}

    <fieldset class="flex flex-col gap-3">
      <legend class="mb-2 text-sm font-medium">{$t('routine_scope')}</legend>
      <Field label={$t('routine_scope_since_last_run')}>
        <Switch bind:checked={sinceLastRun} />
      </Field>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={$t('routine_scope_days')}>
          <NumberInput bind:value={days} min={1} max={3650} />
        </Field>
        <Field label={$t('routine_scope_journal')}>
          <Select options={packOptions} bind:value={pack} />
        </Field>
        <Field label={$t('routine_scope_albums')}>
          <MultiSelect options={albumOptions} bind:values={albumIds} />
        </Field>
        <Field label={$t('routine_scope_tags')}>
          <Input bind:value={tags} />
          <HelperText>{$t('routine_scope_tags_description')}</HelperText>
        </Field>
      </div>
    </fieldset>

    <fieldset class="flex flex-col gap-2" data-testid="routine-approval">
      <legend class="mb-2 text-sm font-medium">{$t('routine_approval')}</legend>
      {#each approvalOptions as option (option.value)}
        <label
          class="flex cursor-pointer gap-3 rounded-xl border p-3 {approvalMode === option.value
            ? 'border-primary bg-primary/5'
            : 'border-gray-200 dark:border-gray-700'}"
        >
          <input type="radio" name="routine-approval" value={option.value} bind:group={approvalMode} class="mt-1" />
          <span class="flex flex-col">
            <span class="text-sm font-medium">{option.label}</span>
            <span class="text-xs text-gray-600 dark:text-gray-400">{option.description}</span>
          </span>
        </label>
      {/each}
    </fieldset>

    <fieldset class="flex flex-col gap-3">
      <legend class="mb-2 text-sm font-medium">{$t('routine_limits')}</legend>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={$t('routine_limit_runs_per_day')}>
          <NumberInput bind:value={runsPerDay} min={1} max={config.maxLimits.runsPerDay} />
        </Field>
        <Field label={$t('routine_limit_minutes')}>
          <NumberInput bind:value={minutes} min={1} max={config.maxLimits.minutes} />
        </Field>
        <Field label={$t('routine_limit_tool_calls')}>
          <NumberInput bind:value={toolCalls} min={1} max={config.maxLimits.toolCalls} />
        </Field>
      </div>
      <Field label={$t('routine_profile')}>
        <Select options={profileOptions} bind:value={profile} />
      </Field>
      <Alert color="warning" size="small">{$t('routine_cost_warning')}</Alert>
    </fieldset>

    <Field label={$t('routine_enabled')}>
      <Switch bind:checked={enabled} />
    </Field>
  </div>
</FormModal>
