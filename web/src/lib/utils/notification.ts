import { NotificationType, type NotificationDto } from '@immich/sdk';
import { OpenQueryParam } from '$lib/constants';
import { Route } from '$lib/route';

const parseData = (data: unknown): Record<string, unknown> | undefined => {
  if (typeof data === 'string') {
    try {
      return parseData(JSON.parse(data));
    } catch {
      return undefined;
    }
  }
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
};

const getId = (data: Record<string, unknown> | undefined, key: string) => {
  const value = data?.[key];
  return typeof value === 'string' && value ? value : undefined;
};

/** where clicking a notification leads, based on the ids in its data (an object or a JSON string) */
export const getNotificationRoute = ({ type, data }: { type: NotificationDto['type']; data?: unknown }) => {
  if (type === NotificationType.ClusterGroupRequest) {
    return Route.userSettings({ isOpen: OpenQueryParam.SHARING });
  }

  const values = parseData(data);
  const albumId = getId(values, 'albumId');
  const bookId = getId(values, 'bookId');
  const assetId = getId(values, 'assetId') ?? getId(values, 'sourceAssetId');
  if (albumId) {
    return Route.viewAlbum({ id: albumId });
  }
  if (bookId) {
    return Route.viewBook({ id: bookId });
  }
  if (assetId) {
    return Route.viewAsset({ id: assetId });
  }
};
