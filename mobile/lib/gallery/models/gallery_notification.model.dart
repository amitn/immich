import 'dart:convert';

import 'package:immich_mobile/gallery/utils/journals.dart';

/// What a notification is about, from the ids in its data: where tapping it leads
sealed class NotificationTarget {
  const NotificationTarget();
}

/// A photo book, e.g. a finished export or a draft made for the user
final class BookNotificationTarget extends NotificationTarget {
  final String bookId;

  const BookNotificationTarget(this.bookId);

  @override
  bool operator ==(Object other) => other is BookNotificationTarget && other.bookId == bookId;

  @override
  int get hashCode => bookId.hashCode;
}

/// A photo or video: an artwork made in an artistic style, or a highlight video
final class AssetNotificationTarget extends NotificationTarget {
  final String assetId;

  const AssetNotificationTarget(this.assetId);

  @override
  bool operator ==(Object other) => other is AssetNotificationTarget && other.assetId == assetId;

  @override
  int get hashCode => assetId.hashCode;
}

final class AlbumNotificationTarget extends NotificationTarget {
  final String albumId;

  const AlbumNotificationTarget(this.albumId);

  @override
  bool operator ==(Object other) => other is AlbumNotificationTarget && other.albumId == albumId;

  @override
  int get hashCode => albumId.hashCode;
}

/// A memory, e.g. the year in review
final class MemoryNotificationTarget extends NotificationTarget {
  final String memoryId;

  const MemoryNotificationTarget(this.memoryId);

  @override
  bool operator ==(Object other) => other is MemoryNotificationTarget && other.memoryId == memoryId;

  @override
  int get hashCode => memoryId.hashCode;
}

/// Photos with visits of a journal to name ("new meals found"): the naming page of the journal on them
final class JournalNotificationTarget extends NotificationTarget {
  final String pack;
  final List<String> assetIds;

  const JournalNotificationTarget(this.pack, this.assetIds);

  @override
  bool operator ==(Object other) =>
      other is JournalNotificationTarget && other.pack == pack && other.assetIds.join(',') == assetIds.join(',');

  @override
  int get hashCode => Object.hash(pack, assetIds.join(','));
}

/// The data of a notification: an object, or the JSON string of one (how the server stores it)
Map<String, dynamic>? parseNotificationData(Object? data) {
  if (data is String) {
    if (data.isEmpty) {
      return null;
    }
    try {
      return parseNotificationData(jsonDecode(data));
    } on FormatException {
      return null;
    }
  }
  if (data is Map) {
    return data.map((key, value) => MapEntry(key.toString(), value));
  }
  return null;
}

String? _id(Map<String, dynamic>? data, String key) {
  final value = data?[key];
  return value is String && value.isNotEmpty ? value : null;
}

/// Where tapping a notification leads, with the precedence of the web app (`getNotificationRoute`): the visits of a
/// journal to name (`collectionPack`) first, like the web's `openCollectionNotice`. The changes of an assistant turn
/// (`activityGroupId`) have no screen in the app yet, so they lead nowhere.
NotificationTarget? notificationTargetOf(Map<String, dynamic>? data) {
  if (data == null) {
    return null;
  }

  final pack = _id(data, 'collectionPack');
  final assetIds = data['assetIds'];
  if (pack != null && journalPackOf(pack) != null && assetIds is List) {
    final ids = assetIds.whereType<String>().where((id) => id.isNotEmpty).toList();
    if (ids.isNotEmpty) {
      return JournalNotificationTarget(pack, ids);
    }
  }

  if (_id(data, 'activityGroupId') != null) {
    return null;
  }

  final memoryId = _id(data, 'memoryId');
  if (memoryId != null) {
    return MemoryNotificationTarget(memoryId);
  }

  final albumId = _id(data, 'albumId');
  if (albumId != null) {
    return AlbumNotificationTarget(albumId);
  }

  final bookId = _id(data, 'bookId');
  if (bookId != null) {
    return BookNotificationTarget(bookId);
  }

  final assetId = _id(data, 'assetId') ?? _id(data, 'sourceAssetId');
  if (assetId != null) {
    return AssetNotificationTarget(assetId);
  }

  return null;
}

/// A notification of the server (`NotificationDto`), parsed by hand: the generated client expects its data to be an
/// object, but the server sends the JSON string it stores, which the generated parser drops
class GalleryNotification {
  final String id;
  final String title;
  final String? description;

  /// info, success, warning or error
  final String level;
  final DateTime createdAt;
  final DateTime? readAt;
  final Map<String, dynamic>? data;

  const GalleryNotification({
    required this.id,
    required this.title,
    required this.level,
    required this.createdAt,
    this.description,
    this.readAt,
    this.data,
  });

  NotificationTarget? get target => notificationTargetOf(data);

  bool get isRead => readAt != null;

  GalleryNotification markRead(DateTime at) => GalleryNotification(
    id: id,
    title: title,
    level: level,
    createdAt: createdAt,
    description: description,
    readAt: at,
    data: data,
  );

  static GalleryNotification? fromJson(Object? json) {
    if (json is! Map) {
      return null;
    }
    final id = json['id'];
    final title = json['title'];
    if (id is! String || title is! String) {
      return null;
    }
    final description = json['description'];
    final level = json['level'];
    return GalleryNotification(
      id: id,
      title: title,
      description: description is String && description.isNotEmpty ? description : null,
      level: level is String ? level : 'info',
      createdAt: _date(json['createdAt']) ?? DateTime.now(),
      readAt: _date(json['readAt']),
      data: parseNotificationData(json['data']),
    );
  }

  static List<GalleryNotification> listFromJson(Object? json) =>
      json is List ? json.map(fromJson).whereType<GalleryNotification>().toList() : const [];
}

DateTime? _date(Object? value) => value is String ? DateTime.tryParse(value)?.toLocal() : null;
