import { NotificationType } from '@immich/sdk';
import { getNotificationRoute } from '$lib/utils/notification';

describe('getNotificationRoute', () => {
  it('should open the album of album notifications', () => {
    expect(getNotificationRoute({ type: NotificationType.AlbumInvite, data: '{"albumId":"album-1"}' })).toBe(
      '/albums/album-1',
    );
  });

  it('should open the book of book exports', () => {
    expect(getNotificationRoute({ type: NotificationType.Custom, data: '{"bookId":"book-1"}' })).toBe('/books/book-1');
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

  it('should ignore notifications without a target', () => {
    expect(getNotificationRoute({ type: NotificationType.Custom })).toBeUndefined();
    expect(getNotificationRoute({ type: NotificationType.Custom, data: 'not json' })).toBeUndefined();
    expect(getNotificationRoute({ type: NotificationType.Custom, data: '{"assetId":42}' })).toBeUndefined();
  });
});
