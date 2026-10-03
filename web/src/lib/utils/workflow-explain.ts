import type { MessageFormatter } from 'svelte-i18n';

/**
 * A workflow in plain words (#11), as the assistant's explain_workflow says it: when it runs, what a photo must match
 * and what happens to it. Steps without a sentence of their own are named by the title of their plugin method.
 */

type Step = { method: string; config?: Record<string, unknown> | null; enabled?: boolean };

export type WorkflowExplainNames = {
  albums?: Map<string, string>;
  spaces?: Map<string, string>;
  tags?: Map<string, string>;
  /** the title of a plugin method, e.g. "Trigger Webhook" */
  methodTitle?: (method: string) => string;
};

export type WorkflowExplanation = {
  when: string;
  conditions: string[];
  actions: string[];
  notes: string[];
};

const CORE = 'immich-plugin-core';
const GALLERY = 'gallery-core';
const METADATA_METHODS = new Set([`${CORE}#assetDateFilter`, `${CORE}#assetLocationFilter`, `${CORE}#assetExifFilter`]);
const OPEN_START = { year: 1900, month: 1, day: 1 };
const OPEN_END = { year: 9999, month: 12, day: 31 };

type Day = { year: number; month: number; day: number };

const isDay = (value: unknown): value is Day =>
  !!value &&
  typeof value === 'object' &&
  ['year', 'month', 'day'].every((key) => typeof (value as Record<string, unknown>)[key] === 'number');

const isSameDay = (a: Day, b: Day) => a.year === b.year && a.month === b.month && a.day === b.day;

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const quoted = (value: string) => `“${value}”`;

export const explainWorkflow = (
  $t: MessageFormatter,
  workflow: { trigger: string; enabled: boolean; steps: Step[] },
  names: WorkflowExplainNames = {},
  locale?: string,
): WorkflowExplanation => {
  const formatDay = ({ year, month, day }: Day, withYear = true) =>
    new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(locale, {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      ...(withYear && { year: 'numeric' }),
    });

  const nameOf = (map: Map<string, string> | undefined, id: unknown, kind: 'album' | 'space' | 'tag') => {
    const name = typeof id === 'string' ? map?.get(id) : undefined;
    return name ? quoted(name) : $t('workflow_explain_unknown', { values: { kind } });
  };

  const title = (method: string) => names.methodTitle?.(method) ?? method;

  const condition = (method: string, config: Record<string, unknown>): string | undefined => {
    switch (method) {
      case `${CORE}#assetFileFilter`: {
        if (config.usePath === true) {
          return;
        }
        return $t('workflow_explain_condition_file_name', {
          values: { match: String(config.matchType ?? 'contains'), pattern: String(config.pattern ?? '') },
        });
      }
      case `${CORE}#assetTypeFilter`: {
        const types = strings(config.allowedTypes);
        if (types.length !== 1 || !['IMAGE', 'VIDEO'].includes(types[0])) {
          return;
        }
        return $t('workflow_explain_condition_type', { values: { type: types[0] } });
      }
      case `${CORE}#assetDateFilter`: {
        const { startDate: start, endDate: end } = config;
        if (!isDay(start) || !isDay(end)) {
          return;
        }
        const recurring = config.recurring === true;
        const kind = recurring
          ? 'recurring'
          : isSameDay(start, OPEN_START)
            ? 'before'
            : isSameDay(end, OPEN_END)
              ? 'after'
              : start.year === end.year && start.month === 1 && start.day === 1 && end.month === 12 && end.day === 31
                ? 'year'
                : 'between';
        return $t('workflow_explain_condition_date', {
          values: {
            kind,
            start: kind === 'year' ? String(start.year) : formatDay(start, !recurring),
            end: formatDay(end, !recurring),
          },
        });
      }
      case `${CORE}#assetLocationFilter`: {
        const region = (config.region ?? {}) as Record<string, unknown>;
        const place = [region.city, region.state, region.country].filter(
          (part): part is string => typeof part === 'string' && part.length > 0,
        );
        const coordinate = config.coordinate as Record<string, unknown> | undefined;
        const parts: string[] = [];
        if (place.length > 0) {
          parts.push($t('workflow_explain_condition_place', { values: { place: place.join(', ') } }));
        }
        if (typeof coordinate?.latitude === 'number' && typeof coordinate.longitude === 'number') {
          parts.push(
            $t('workflow_explain_condition_near', {
              values: {
                radius: Number(coordinate.radius ?? 0),
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
              },
            }),
          );
        }
        return parts.length > 0 ? parts.join(', ') : undefined;
      }
      case `${CORE}#assetExifFilter`: {
        const match = String(config.matchType ?? 'contains');
        if (
          !['make', 'model', 'lensModel'].includes(String(config.property)) ||
          !['contains', 'exact'].includes(match)
        ) {
          return;
        }
        return $t('workflow_explain_condition_camera', {
          values: { property: String(config.property), match, pattern: String(config.pattern ?? '') },
        });
      }
      case `${CORE}#assetMissingTimeZoneFilter`: {
        return $t('workflow_explain_condition_time_zone', { values: { inverse: String(config.inverse === true) } });
      }
      case `${GALLERY}#assetTagPathFilter`: {
        return $t('workflow_explain_condition_tag', {
          values: { inverse: String(config.inverse === true), tag: String(config.tag ?? '') },
        });
      }
      case `${CORE}#assetTagFilter`: {
        const tags = strings(config.tags).map((id) => nameOf(names.tags, id, 'tag'));
        return $t('workflow_explain_condition_tags', {
          values: { matching: String(config.matching ?? 'all'), tags: tags.join(', ') },
        });
      }
    }
  };

  const action = (method: string, config: Record<string, unknown>): string | undefined => {
    switch (method) {
      case `${CORE}#assetAddToAlbums`: {
        const albumIds = strings(config.albumIds);
        if (albumIds.length === 0) {
          return typeof config.albumName === 'string' && config.albumName
            ? $t('workflow_explain_action_album_by_name', { values: { album: config.albumName } })
            : undefined;
        }
        return $t('workflow_explain_action_album', {
          values: { album: albumIds.map((id) => nameOf(names.albums, id, 'album')).join(', ') },
        });
      }
      case `${GALLERY}#addToSpace`: {
        return $t('workflow_explain_action_space', {
          values: {
            space: strings(config.spaceIds)
              .map((id) => nameOf(names.spaces, id, 'space'))
              .join(', '),
          },
        });
      }
      case `${GALLERY}#addToSpaceAlbum`: {
        return $t('workflow_explain_action_space_album', {
          values: { album: String(config.albumName ?? ''), space: nameOf(names.spaces, config.spaceId, 'space') },
        });
      }
      case `${CORE}#assetAddTags`: {
        return $t('workflow_explain_action_add_tags', {
          values: {
            tags: strings(config.tags)
              .map((id) => nameOf(names.tags, id, 'tag'))
              .join(', '),
          },
        });
      }
      case `${CORE}#assetArchive`: {
        return $t('workflow_explain_action_archive', { values: { inverse: String(config.inverse === true) } });
      }
      case `${CORE}#assetFavorite`: {
        return $t('workflow_explain_action_favorite', { values: { inverse: String(config.inverse === true) } });
      }
      case `${CORE}#assetLock`: {
        return $t('workflow_explain_action_lock', { values: { inverse: String(config.inverse === true) } });
      }
      case `${CORE}#webhook`: {
        return $t('workflow_explain_action_webhook', { values: { url: String(config.url ?? '') } });
      }
    }
  };

  const conditions: string[] = [];
  const actions: string[] = [];
  for (const step of workflow.steps) {
    const config = step.config ?? {};
    const off = (text: string) =>
      step.enabled === false ? $t('workflow_explain_step_off', { values: { text } }) : text;
    const asCondition = condition(step.method, config);
    if (asCondition !== undefined) {
      conditions.push(off(asCondition));
      continue;
    }
    const asAction = action(step.method, config);
    if (asAction !== undefined) {
      actions.push(off(asAction));
      continue;
    }
    // a step without a sentence of its own: a filter unless it is known to be an action
    const isFilter = step.method.endsWith('Filter');
    const text = isFilter
      ? $t('workflow_explain_condition_step', { values: { step: title(step.method) } })
      : $t('workflow_explain_action_step', { values: { step: title(step.method) } });
    (isFilter ? conditions : actions).push(off(text));
  }

  const notes: string[] = [];
  if (!workflow.enabled) {
    notes.push($t('workflow_explain_note_disabled'));
  }
  if (workflow.trigger === 'AssetCreate' && workflow.steps.some(({ method }) => METADATA_METHODS.has(method))) {
    notes.push($t('workflow_explain_note_upload'));
  }

  return {
    when: $t('workflow_explain_when', { values: { trigger: workflow.trigger } }),
    conditions,
    actions,
    notes,
  };
};
