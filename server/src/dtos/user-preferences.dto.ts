import { IANAZone } from 'luxon';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import type { UserPreferences } from 'src/types.js';
import { AssetOrderSchema, UserAvatarColorSchema } from 'src/enum.js';

const AlbumsUpdateSchema = z
  .object({
    defaultAssetOrder: AssetOrderSchema.optional(),
  })
  .optional()
  .describe('Album preferences')
  .meta({ id: 'AlbumsUpdate' });

const AvatarUpdateSchema = z
  .object({
    color: UserAvatarColorSchema.optional(),
  })
  .optional()
  .meta({ id: 'AvatarUpdate' });

const MemoriesUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether memories are enabled'),
    duration: z.int().min(1).optional().describe('Memory duration in seconds'),
    sidebarWeb: z.boolean().optional().describe('Whether memories appear in web sidebar'),
    types: z
      .record(z.string(), z.boolean())
      .optional()
      .describe('Per-memory-type enable overrides, keyed by memory type'),
  })
  .optional()
  .meta({ id: 'MemoriesUpdate' });

const RatingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether ratings are enabled'),
  })
  .optional()
  .meta({ id: 'RatingsUpdate' });

const FoldersUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether folders are enabled'),
    sidebarWeb: z.boolean().optional().describe('Whether folders appear in web sidebar'),
  })
  .optional()
  .meta({ id: 'FoldersUpdate' });

const PeopleUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether people are enabled'),
    sidebarWeb: z.boolean().optional().describe('Whether people appear in web sidebar'),
    minimumFaces: z.int().min(1).optional().describe('People face threshold'),
  })
  .optional()
  .meta({ id: 'PeopleUpdate' });

const SharedLinksUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether shared links are enabled'),
    sidebarWeb: z.boolean().optional().describe('Whether shared links appear in web sidebar'),
  })
  .optional()
  .meta({ id: 'SharedLinksUpdate' });

const TagsUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether tags are enabled'),
    sidebarWeb: z.boolean().optional().describe('Whether tags appear in web sidebar'),
  })
  .optional()
  .meta({ id: 'TagsUpdate' });

const EmailNotificationsUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether email notifications are enabled'),
    albumInvite: z.boolean().optional().describe('Whether to receive email notifications for album invites'),
    albumUpdate: z.boolean().optional().describe('Whether to receive email notifications for album updates'),
  })
  .optional()
  .meta({ id: 'EmailNotificationsUpdate' });

const DownloadUpdateSchema = z
  .object({
    archiveSize: z.int().min(1).optional().describe('Maximum archive size in bytes'),
    includeEmbeddedVideos: z.boolean().optional().describe('Whether to include embedded videos in downloads'),
  })
  .optional()
  .meta({ id: 'DownloadUpdate' });

const PurchaseUpdateSchema = z
  .object({
    showSupportBadge: z.boolean().optional().describe('Whether to show support badge'),
    hideBuyButtonUntil: z.string().optional().describe('Date until which to hide buy button'),
  })
  .optional()
  .meta({ id: 'PurchaseUpdate' });

const CastUpdateSchema = z
  .object({
    gCastEnabled: z.boolean().optional().describe('Whether Google Cast is enabled'),
  })
  .optional()
  .meta({ id: 'CastUpdate' });

const RecentlyAddedUpdateSchema = z
  .object({
    sidebarWeb: z.boolean().optional().describe('Whether the recently added page appears in the web sidebar'),
  })
  .optional()
  .meta({ id: 'RecentlyAddedUpdate' });

const BookDraftsUpdateSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe('Whether photo books are drafted for the user in the background, to keep or discard'),
  })
  .optional()
  .meta({ id: 'BookDraftsUpdate' });

const AiAnswersUpdateSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe('Whether the assistant answers the questions typed in the search bar, beside the results'),
  })
  .optional()
  .meta({ id: 'AiAnswersUpdate' });

const CollectionNotificationsUpdateSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe('Whether the user is notified of new visits of the collections (meals, museum visits) to name'),
  })
  .optional()
  .meta({ id: 'CollectionNotificationsUpdate' });

const MemoryExclusionsUpdateSchema = z
  .object({
    documents: z
      .boolean()
      .optional()
      .describe(
        'Whether screenshots, receipts and documents (the classification and journal tags that mark them) are left out of the memories and of what is made of them',
      ),
  })
  .optional()
  .meta({ id: 'MemoryExclusionsUpdate' });

const MemoryNotificationsUpdateSchema = z
  .object({
    memories: z
      .boolean()
      .optional()
      .describe(
        'Whether the user is notified of a memory of the day (at most one notification a day, with the drafts)',
      ),
    creations: z
      .boolean()
      .optional()
      .describe('Whether the user is notified when a video, a book or an artwork they asked for is ready'),
    drafts: z
      .boolean()
      .optional()
      .describe(
        'Whether the user is notified of a suggested photo book waiting to be kept or discarded (at most one notification a day, with the memories)',
      ),
    hour: z
      .int()
      .min(0)
      .max(23)
      .optional()
      .describe(
        'The hour of the day (0-23, in timeZone) from which the notification of the day and the digest are sent',
      ),
    timeZone: z
      .string()
      .max(64)
      .refine((zone) => zone === '' || IANAZone.isValidZone(zone), { error: 'Unknown time zone' })
      .optional()
      .describe("The IANA time zone of hour, e.g. Europe/London; the server's when empty"),
    digest: z
      .boolean()
      .optional()
      .describe("Whether the user gets a weekly email of the week's memories, waiting drafts and new journal visits"),
    digestDay: z.int().min(1).max(7).optional().describe('The day of the week of the digest, 1 (Monday) to 7 (Sunday)'),
  })
  .optional()
  .meta({ id: 'MemoryNotificationsUpdate' });

const UserPreferencesUpdateSchema = z
  .object({
    aiAnswers: AiAnswersUpdateSchema,
    albums: AlbumsUpdateSchema,
    avatar: AvatarUpdateSchema,
    bookDrafts: BookDraftsUpdateSchema,
    cast: CastUpdateSchema,
    collectionNotifications: CollectionNotificationsUpdateSchema,
    download: DownloadUpdateSchema,
    emailNotifications: EmailNotificationsUpdateSchema,
    folders: FoldersUpdateSchema,
    memories: MemoriesUpdateSchema,
    memoryExclusions: MemoryExclusionsUpdateSchema,
    memoryNotifications: MemoryNotificationsUpdateSchema,
    people: PeopleUpdateSchema,
    purchase: PurchaseUpdateSchema,
    ratings: RatingsUpdateSchema,
    sharedLinks: SharedLinksUpdateSchema,
    tags: TagsUpdateSchema,
    recentlyAdded: RecentlyAddedUpdateSchema,
  })
  .meta({ id: 'UserPreferencesUpdateDto' });

const AlbumsResponseSchema = z
  .object({
    defaultAssetOrder: AssetOrderSchema,
  })
  .meta({ id: 'AlbumsResponse' });

const FoldersResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether folders are enabled'),
    sidebarWeb: z.boolean().describe('Whether folders appear in web sidebar'),
  })
  .meta({ id: 'FoldersResponse' });

const MemoriesResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether memories are enabled'),
    duration: z.int().describe('Memory duration in seconds'),
    sidebarWeb: z.boolean().describe('Whether memories appear in web sidebar'),
    types: z.record(z.string(), z.boolean()).describe('Per-memory-type enable map, keyed by memory type'),
  })
  .meta({ id: 'MemoriesResponse' });

const PeopleResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether people are enabled'),
    sidebarWeb: z.boolean().describe('Whether people appear in web sidebar'),
    minimumFaces: z.int().min(1).optional().describe('People face threshold'),
  })
  .meta({ id: 'PeopleResponse' });

const RatingsResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether ratings are enabled'),
  })
  .meta({ id: 'RatingsResponse' });

const SharedLinksResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether shared links are enabled'),
    sidebarWeb: z.boolean().describe('Whether shared links appear in web sidebar'),
  })
  .meta({ id: 'SharedLinksResponse' });

const TagsResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether tags are enabled'),
    sidebarWeb: z.boolean().describe('Whether tags appear in web sidebar'),
  })
  .meta({ id: 'TagsResponse' });

const EmailNotificationsResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether email notifications are enabled'),
    albumInvite: z.boolean().describe('Whether to receive email notifications for album invites'),
    albumUpdate: z.boolean().describe('Whether to receive email notifications for album updates'),
  })
  .meta({ id: 'EmailNotificationsResponse' });

const DownloadResponseSchema = z
  .object({
    archiveSize: z.int().describe('Maximum archive size in bytes'),
    includeEmbeddedVideos: z.boolean().describe('Whether to include embedded videos in downloads'),
  })
  .meta({ id: 'DownloadResponse' });

const PurchaseResponseSchema = z
  .object({
    showSupportBadge: z.boolean().describe('Whether to show support badge'),
    hideBuyButtonUntil: z.string().describe('Date until which to hide buy button'),
  })
  .meta({ id: 'PurchaseResponse' });

const CastResponseSchema = z
  .object({
    gCastEnabled: z.boolean().describe('Whether Google Cast is enabled'),
  })
  .meta({ id: 'CastResponse' });

const RecentlyAddedResponseSchema = z
  .object({
    sidebarWeb: z.boolean().describe('Whether the recently added page appears in the web sidebar'),
  })
  .meta({ id: 'RecentlyAddedResponse' });

const BookDraftsResponseSchema = z
  .object({
    enabled: z.boolean().describe('Whether photo books are drafted for the user in the background, to keep or discard'),
  })
  .meta({ id: 'BookDraftsResponse' });

const CollectionNotificationsResponseSchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether the user is notified of new visits of the collections (meals, museum visits) to name'),
  })
  .meta({ id: 'CollectionNotificationsResponse' });

const MemoryExclusionsResponseSchema = z
  .object({
    documents: z
      .boolean()
      .describe(
        'Whether screenshots, receipts and documents (the classification and journal tags that mark them) are left out of the memories and of what is made of them',
      ),
  })
  .meta({ id: 'MemoryExclusionsResponse' });

const MemoryNotificationsResponseSchema = z
  .object({
    memories: z
      .boolean()
      .describe(
        'Whether the user is notified of a memory of the day (at most one notification a day, with the drafts)',
      ),
    creations: z
      .boolean()
      .describe('Whether the user is notified when a video, a book or an artwork they asked for is ready'),
    drafts: z
      .boolean()
      .describe(
        'Whether the user is notified of a suggested photo book waiting to be kept or discarded (at most one notification a day, with the memories)',
      ),
    hour: z
      .int()
      .describe(
        'The hour of the day (0-23, in timeZone) from which the notification of the day and the digest are sent',
      ),
    timeZone: z.string().describe("The IANA time zone of hour, e.g. Europe/London; the server's when empty"),
    digest: z
      .boolean()
      .describe("Whether the user gets a weekly email of the week's memories, waiting drafts and new journal visits"),
    digestDay: z.int().describe('The day of the week of the digest, 1 (Monday) to 7 (Sunday)'),
  })
  .meta({ id: 'MemoryNotificationsResponse' });

const AiAnswersResponseSchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether the assistant answers the questions typed in the search bar, beside the results'),
  })
  .meta({ id: 'AiAnswersResponse' });

const UserPreferencesResponseSchema = z
  .object({
    aiAnswers: AiAnswersResponseSchema,
    albums: AlbumsResponseSchema,
    folders: FoldersResponseSchema,
    memories: MemoriesResponseSchema,
    people: PeopleResponseSchema,
    ratings: RatingsResponseSchema,
    sharedLinks: SharedLinksResponseSchema,
    tags: TagsResponseSchema,
    emailNotifications: EmailNotificationsResponseSchema,
    download: DownloadResponseSchema,
    purchase: PurchaseResponseSchema,
    cast: CastResponseSchema,
    recentlyAdded: RecentlyAddedResponseSchema,
    bookDrafts: BookDraftsResponseSchema,
    collectionNotifications: CollectionNotificationsResponseSchema,
    memoryExclusions: MemoryExclusionsResponseSchema,
    memoryNotifications: MemoryNotificationsResponseSchema,
  })
  .meta({ id: 'UserPreferencesResponseDto' });

export class UserPreferencesUpdateDto extends createZodDto(UserPreferencesUpdateSchema) {}
export class UserPreferencesResponseDto extends createZodDto(UserPreferencesResponseSchema) {}

export const mapPreferences = (preferences: UserPreferences): UserPreferencesResponseDto => {
  return preferences;
};
