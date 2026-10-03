import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

/// The user's notifications (`/notifications`), read by hand: their data is a JSON string the generated parser drops
class NotificationApiRepository {
  final ApiService _apiService;

  const NotificationApiRepository(this._apiService);

  // Resolved on each call: ApiService.setEndpoint() swaps the API client on login
  NotificationsApi get _api => NotificationsApi(_apiService.serverInfoApi.apiClient);

  /// The unread notifications, the newest first
  Future<List<GalleryNotification>> getUnread() async {
    final response = await _api.getNotificationsWithHttpInfo(unread: true);
    if (response.statusCode >= 400) {
      throw ApiException(response.statusCode, response.body);
    }
    final notifications = GalleryNotification.listFromJson(jsonDecode(response.body));
    return notifications..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  Future<void> markRead(List<String> ids, {DateTime? at}) => _api.updateNotifications(
    NotificationUpdateAllDto(ids: ids, readAt: Optional.present((at ?? DateTime.now()).toUtc())),
  );
}

final notificationApiRepositoryProvider = Provider<NotificationApiRepository>(
  (ref) => NotificationApiRepository(ref.watch(apiServiceProvider)),
);
