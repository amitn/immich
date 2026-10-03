import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';

void main() {
  group('parseNotificationData', () {
    test('reads the JSON string the server stores', () {
      expect(parseNotificationData('{"bookId":"book-1"}'), {'bookId': 'book-1'});
    });

    test('reads an object', () {
      expect(parseNotificationData({'assetId': 'asset-1'}), {'assetId': 'asset-1'});
    });

    test('ignores anything else', () {
      expect(parseNotificationData('not json'), isNull);
      expect(parseNotificationData(''), isNull);
      expect(parseNotificationData(null), isNull);
      expect(parseNotificationData(42), isNull);
    });
  });

  group('notificationTargetOf', () {
    test('a book export or a draft book opens the book', () {
      expect(notificationTargetOf({'bookId': 'book-1'}), const BookNotificationTarget('book-1'));
    });

    test('a finished artwork opens the artwork, a failed one its source photo', () {
      expect(
        notificationTargetOf({'artJobId': 'job-1', 'assetId': 'art-1', 'sourceAssetId': 'photo-1'}),
        const AssetNotificationTarget('art-1'),
      );
      expect(
        notificationTargetOf({'artJobId': 'job-1', 'sourceAssetId': 'photo-1'}),
        const AssetNotificationTarget('photo-1'),
      );
    });

    test('a highlight video opens the video', () {
      expect(
        notificationTargetOf({'assetId': 'video-1', 'highlightId': 'job-1', 'format': 'portrait'}),
        const AssetNotificationTarget('video-1'),
      );
    });

    test('a failed highlight video leads nowhere', () {
      expect(notificationTargetOf({'highlightId': 'job-1'}), isNull);
    });

    test('follows the precedence of the web: memory, album, book, then photo', () {
      expect(
        notificationTargetOf({'memoryId': 'memory-1', 'bookId': 'book-1', 'albumId': 'album-1'}),
        const MemoryNotificationTarget('memory-1'),
      );
      expect(
        notificationTargetOf({'albumId': 'album-1', 'bookId': 'book-1', 'assetId': 'asset-1'}),
        const AlbumNotificationTarget('album-1'),
      );
      expect(notificationTargetOf({'bookId': 'book-1', 'assetId': 'asset-1'}), const BookNotificationTarget('book-1'));
    });

    test('the changes of an assistant turn and the journal notices have no screen in the app', () {
      expect(notificationTargetOf({'activityGroupId': 'group-1', 'albumId': 'album-1'}), isNull);
      expect(
        notificationTargetOf({
          'collectionPack': 'food',
          'assetIds': <String>['a'],
        }),
        isNull,
      );
    });

    test('ignores empty and non-string ids', () {
      expect(notificationTargetOf({'bookId': '', 'assetId': 42}), isNull);
      expect(notificationTargetOf(null), isNull);
    });
  });

  group('GalleryNotification.fromJson', () {
    test('parses a notification of the server', () {
      final notification = GalleryNotification.fromJson({
        'id': 'notification-1',
        'createdAt': '2026-09-01T10:00:00.000Z',
        'level': 'info',
        'type': 'Custom',
        'title': 'A new photo book is ready to review: Crete',
        'description': 'Your trip to Crete',
        'data': '{"bookId":"book-1"}',
        'readAt': null,
      })!;

      expect(notification.id, 'notification-1');
      expect(notification.description, 'Your trip to Crete');
      expect(notification.isRead, isFalse);
      expect(notification.createdAt, DateTime.utc(2026, 9, 1, 10).toLocal());
      expect(notification.target, const BookNotificationTarget('book-1'));
    });

    test('skips what is not a notification', () {
      expect(GalleryNotification.fromJson({'id': 'x'}), isNull);
      expect(GalleryNotification.fromJson('x'), isNull);
      expect(
        GalleryNotification.listFromJson([
          {'id': 'x'},
          'y',
        ]),
        isEmpty,
      );
    });

    test('marks a notification read', () {
      final notification = GalleryNotification(
        id: 'n',
        title: 't',
        level: 'info',
        createdAt: DateTime(2026),
      ).markRead(DateTime(2026, 2));

      expect(notification.isRead, isTrue);
    });
  });
}
