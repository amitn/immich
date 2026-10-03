import { NotificationType } from '@immich/sdk';
import { getCollectionNotice, getNotificationRoute } from '$lib/utils/notification';

describe('getNotificationRoute', () => {
  it('should open the album of album notifications', () => {
    expect(getNotificationRoute({ type: NotificationType.AlbumInvite, data: '{"albumId":"album-1"}' })).toBe(
      '/albums/album-1',
    );
  });

  it('should open the book of book exports', () => {
    expect(getNotificationRoute({ type: NotificationType.Custom, data: '{"bookId":"book-1"}' })).toBe('/books/book-1');
  });

  it('should open the year in review of its notification, rather than its book (#12)', () => {
    expect(
      getNotificationRoute({
        type: NotificationType.Custom,
        data: '{"memoryId":"memory-1","year":2025,"bookId":"book-1"}',
      }),
    ).toBe('/memories/memory-1');
  });

  it('should open the asset of a notification', () => {
    expect(
      getNotificationRoute({
        type: NotificationType.Custom,
        data: { artJobId: 'job-1', assetId: 'art-1', sourceAssetId: 'photo-1' },
      }),
    ).toBe('/photos/art-1');
  });

  it('should fall back to the source photo of a failed art job', () => {
    expect(
      getNotificationRoute({ type: NotificationType.Custom, data: '{"artJobId":"job-1","sourceAssetId":"photo-1"}' }),
    ).toBe('/photos/photo-1');
  });

  it('should open the sharing settings for cluster group requests', () => {
    expect(getNotificationRoute({ type: NotificationType.ClusterGroupRequest })).toContain('/user-settings');
  });

  it('should open the changes of a chat turn in the activity log', () => {
    expect(
      getNotificationRoute({
        type: NotificationType.Custom,
        data: '{"activityGroupId":"turn-1","sessionId":"chat-1"}',
      }),
    ).toBe('/activity?group=turn-1');
  });

  it('should ignore notifications without a target', () => {
    expect(getNotificationRoute({ type: NotificationType.Custom })).toBeUndefined();
    expect(getNotificationRoute({ type: NotificationType.Custom, data: 'not json' })).toBeUndefined();
    expect(getNotificationRoute({ type: NotificationType.Custom, data: '{"assetId":42}' })).toBeUndefined();
  });
});

describe('getCollectionNotice', () => {
  it('should read the pack and the photos of a new journal visit', () => {
    expect(
      getCollectionNotice({ data: '{"collectionPack":"food","assetIds":["a","b"],"visitKey":"2026-09-26|Dinner|"}' }),
    ).toEqual({ pack: 'food', assetIds: ['a', 'b'] });
    expect(getCollectionNotice({ data: { collectionPack: 'museum', assetIds: ['a', 7, ''] } })).toEqual({
      pack: 'museum',
      assetIds: ['a'],
    });
  });

  it('should ignore other notifications', () => {
    expect(getCollectionNotice({ data: '{"bookId":"book-1"}' })).toBeUndefined();
    expect(getCollectionNotice({ data: '{"collectionPack":"food","assetIds":[]}' })).toBeUndefined();
    expect(getCollectionNotice({ data: 'not json' })).toBeUndefined();
    expect(getCollectionNotice({})).toBeUndefined();
  });

  it('should not open a page for a new journal visit, which opens its naming dialog instead', () => {
    expect(
      getNotificationRoute({ type: NotificationType.Custom, data: '{"collectionPack":"food","assetIds":["a"]}' }),
    ).toBeUndefined();
  });
});
