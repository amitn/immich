import { AssetOrder, type UserPreferencesResponseDto } from '@immich/sdk';
import { Sync } from 'factory.ts';

export const preferencesFactory = Sync.makeFactory<UserPreferencesResponseDto>({
  aiAnswers: {
    enabled: true,
  },
  albums: {
    defaultAssetOrder: AssetOrder.Desc,
  },
  bookDrafts: {
    enabled: true,
  },
  collectionNotifications: {
    enabled: true,
  },
  cast: {
    gCastEnabled: false,
  },
  download: {
    archiveSize: 0,
    includeEmbeddedVideos: false,
  },
  emailNotifications: {
    albumInvite: false,
    albumUpdate: false,
    enabled: false,
  },
  folders: {
    enabled: false,
    sidebarWeb: false,
  },
  memories: {
    enabled: false,
    duration: 5,
    sidebarWeb: false,
    types: {},
  },
  memoryExclusions: {
    documents: false,
  },
  memoryNotifications: {
    memories: true,
    creations: true,
    drafts: true,
    hour: 9,
    timeZone: '',
    digest: false,
    digestDay: 7,
  },
  people: {
    enabled: false,
    sidebarWeb: false,
  },
  purchase: {
    hideBuyButtonUntil: '',
    showSupportBadge: false,
  },
  ratings: {
    enabled: false,
  },
  sharedLinks: {
    enabled: false,
    sidebarWeb: false,
  },
  tags: {
    enabled: false,
    sidebarWeb: false,
  },
  recentlyAdded: {
    sidebarWeb: false,
  },
});
