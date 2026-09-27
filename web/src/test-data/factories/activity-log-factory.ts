import { faker } from '@faker-js/faker';
import { ActivityLogAction, ActivityLogSource, type ActivityLogResponseDto } from '@immich/sdk';
import { Sync } from 'factory.ts';

export const activityLogFactory = Sync.makeFactory<ActivityLogResponseDto>({
  id: Sync.each(() => faker.string.uuid()),
  source: ActivityLogSource.Assistant,
  sessionId: Sync.each(() => faker.string.uuid()),
  toolName: 'add_to_album',
  action: ActivityLogAction.AlbumAddAssets,
  summary: 'Added 3 photos to “Sicily”',
  targetId: Sync.each(() => faker.string.uuid()),
  assetIds: [],
  groupId: Sync.each(() => faker.string.uuid()),
  createdAt: '2026-09-27T10:00:00.000Z',
  undoneAt: null,
  undoneBy: null,
  canUndo: true,
  canRedo: false,
});
