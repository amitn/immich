import { ActivityLogAction, ActivityLogSource, type ActivityLogResponseDto } from '@immich/sdk';
import {
  mdiBookOpenPageVariantOutline,
  mdiBookPlusOutline,
  mdiBrush,
  mdiCameraBurst,
  mdiContentCopy,
  mdiEyeOffOutline,
  mdiImageAlbum,
  mdiImageMinus,
  mdiImagePlus,
  mdiLinkVariant,
  mdiPalette,
  mdiTagOutline,
  mdiTrashCanOutline,
  mdiVideoOutline,
} from '@mdi/js';
import type { Translations } from 'svelte-i18n';
import { Route } from '$lib/route';

const icons: Record<ActivityLogAction, string> = {
  [ActivityLogAction.AlbumCreate]: mdiImageAlbum,
  [ActivityLogAction.AlbumAddAssets]: mdiImagePlus,
  [ActivityLogAction.AlbumRemoveAssets]: mdiImageMinus,
  [ActivityLogAction.AssetCopy]: mdiContentCopy,
  [ActivityLogAction.AssetCreate]: mdiImagePlus,
  [ActivityLogAction.ArtworkCreate]: mdiBrush,
  [ActivityLogAction.ArtStyleCreate]: mdiPalette,
  [ActivityLogAction.BookCreate]: mdiBookPlusOutline,
  [ActivityLogAction.BookEdit]: mdiBookOpenPageVariantOutline,
  [ActivityLogAction.BookDraftKeep]: mdiBookPlusOutline,
  [ActivityLogAction.BookDraftDiscard]: mdiTrashCanOutline,
  [ActivityLogAction.BookStyleCreate]: mdiPalette,
  [ActivityLogAction.BurstCleanup]: mdiCameraBurst,
  [ActivityLogAction.CollectionEntries]: mdiTagOutline,
  [ActivityLogAction.HighlightCreate]: mdiVideoOutline,
  [ActivityLogAction.MemoryExclusionChange]: mdiEyeOffOutline,
  [ActivityLogAction.SharedLinkCreate]: mdiLinkVariant,
};

export const getActivityIcon = (action: ActivityLogAction) => icons[action] ?? mdiContentCopy;

const actionKeys: Record<ActivityLogAction, Translations> = {
  [ActivityLogAction.AlbumCreate]: 'activity_log_action_album_create',
  [ActivityLogAction.AlbumAddAssets]: 'activity_log_action_album_add_assets',
  [ActivityLogAction.AlbumRemoveAssets]: 'activity_log_action_album_remove_assets',
  [ActivityLogAction.AssetCopy]: 'activity_log_action_asset_copy',
  [ActivityLogAction.AssetCreate]: 'activity_log_action_asset_create',
  [ActivityLogAction.ArtworkCreate]: 'activity_log_action_artwork_create',
  [ActivityLogAction.ArtStyleCreate]: 'activity_log_action_art_style_create',
  [ActivityLogAction.BookCreate]: 'activity_log_action_book_create',
  [ActivityLogAction.BookEdit]: 'activity_log_action_book_edit',
  [ActivityLogAction.BookDraftKeep]: 'activity_log_action_book_draft_keep',
  [ActivityLogAction.BookDraftDiscard]: 'activity_log_action_book_draft_discard',
  [ActivityLogAction.BookStyleCreate]: 'activity_log_action_book_style_create',
  [ActivityLogAction.BurstCleanup]: 'activity_log_action_burst_cleanup',
  [ActivityLogAction.CollectionEntries]: 'activity_log_action_journal_entries',
  [ActivityLogAction.HighlightCreate]: 'activity_log_action_highlight_create',
  [ActivityLogAction.MemoryExclusionChange]: 'activity_log_action_memory_exclusion_change',
  [ActivityLogAction.SharedLinkCreate]: 'activity_log_action_shared_link_create',
};

/** the i18n key of the name of a kind of change, e.g. "Photos added to an album" */
export const getActivityActionKey = (action: ActivityLogAction) => actionKeys[action];

export const activityActions = Object.values(ActivityLogAction);

/** the album or book a change is about, while it still exists */
export const getActivityTargetRoute = ({ action, targetId, undoneAt }: ActivityLogResponseDto) => {
  if (!targetId) {
    return;
  }
  switch (action) {
    case ActivityLogAction.AlbumCreate: {
      return undoneAt ? undefined : Route.viewAlbum({ id: targetId });
    }
    case ActivityLogAction.AlbumAddAssets:
    case ActivityLogAction.AlbumRemoveAssets: {
      return Route.viewAlbum({ id: targetId });
    }
    case ActivityLogAction.BookCreate: {
      return undoneAt ? undefined : Route.viewBook({ id: targetId });
    }
    case ActivityLogAction.BookEdit:
    case ActivityLogAction.BookDraftKeep: {
      return Route.viewBook({ id: targetId });
    }
    case ActivityLogAction.BookDraftDiscard: {
      return undoneAt ? Route.viewBook({ id: targetId }) : undefined;
    }
    default: {
      return;
    }
  }
};

export const isAssistantChange = ({ source }: ActivityLogResponseDto) => source === ActivityLogSource.Assistant;

/** consecutive changes of the same group (a chat turn, or one action in the web app) */
export const groupActivity = (items: ActivityLogResponseDto[]) => {
  const groups: Array<{ groupId: string; items: ActivityLogResponseDto[] }> = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last?.groupId === item.groupId) {
      last.items.push(item);
    } else {
      groups.push({ groupId: item.groupId, items: [item] });
    }
  }
  return groups;
};
