import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';
import 'package:immich_mobile/gallery/presentation/pages/gallery_notifications.page.dart';
import 'package:immich_mobile/gallery/presentation/widgets/library/gallery_library_entries.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/providers/notifications.provider.dart';
import 'package:immich_mobile/gallery/repositories/notification_api.repository.dart';
import 'package:mocktail/mocktail.dart';

import '../../../widget_tester_extensions.dart';
import '../../gallery_test_helpers.dart';

class _MockNotificationApiRepository extends Mock implements NotificationApiRepository {}

GalleryNotification _notification(String id, String title, {Map<String, dynamic>? data, String level = 'info'}) =>
    GalleryNotification(id: id, title: title, level: level, createdAt: DateTime(2026, 9, 1, 10), data: data);

void main() {
  late _MockNotificationApiRepository repository;
  late GalleryEventBus bus;
  late FakeGalleryNavigator navigator;
  late FakeToastService toast;
  late List<(String, bool)> announced;

  setUp(() {
    repository = _MockNotificationApiRepository();
    bus = GalleryEventBus();
    navigator = FakeGalleryNavigator();
    toast = FakeToastService();
    announced = [];
    when(() => repository.markRead(any(), at: any(named: 'at'))).thenAnswer((_) async {});
  });

  tearDown(() => bus.dispose());

  Future<void> pump(WidgetTester tester, Widget widget) => tester.pumpConsumerWidget(
    widget,
    overrides: [
      ...galleryOverrides(navigator: navigator, toast: toast),
      notificationApiRepositoryProvider.overrideWithValue(repository),
      galleryUserIdProvider.overrideWithValue('user-1'),
      galleryEventBusProvider.overrideWithValue(bus),
      galleryNotificationAnnouncerProvider.overrideWithValue(
        (notification, onOpen) => announced.add((notification.title, onOpen != null)),
      ),
    ],
  );

  testWidgets('lists the unread notifications; a book notification opens the book and is read', (tester) async {
    when(() => repository.getUnread()).thenAnswer(
      (_) async => [
        _notification('n1', 'Your photo book "Sicily" is ready', data: {'bookId': 'book-1'}),
        _notification('n2', 'Your watercolor is ready', data: {'artJobId': 'j', 'assetId': 'art-1'}),
        _notification('n3', 'Backup failed', level: 'error'),
      ],
    );
    await pump(tester, const GalleryNotificationsPage());

    expect(find.text('Your photo book "Sicily" is ready'), findsOneWidget);
    expect(find.text('Backup failed'), findsOneWidget);

    await tester.tap(find.text('Your photo book "Sicily" is ready'));
    await tester.pumpAndSettle();

    expect(navigator.calls, ['book book-1']);
    verify(() => repository.markRead(['n1'], at: any(named: 'at'))).called(1);
    expect(find.text('Your photo book "Sicily" is ready'), findsNothing);
  });

  testWidgets('an artwork or video that is not synced yet says so', (tester) async {
    navigator.available = false;
    when(() => repository.getUnread()).thenAnswer(
      (_) async => [
        _notification('n2', 'Your highlight video is ready', data: {'assetId': 'video-1', 'highlightId': 'h'}),
      ],
    );
    await pump(tester, const GalleryNotificationsPage());

    await tester.tap(find.text('Your highlight video is ready'));
    await tester.pumpAndSettle();

    expect(navigator.calls, ['assets video-1 at 0']);
    expect(toast.errors, ["This isn't on this device yet. Try again in a moment."]);
  });

  testWidgets('Mark all as read empties the list', (tester) async {
    when(
      () => repository.getUnread(),
    ).thenAnswer((_) async => [_notification('n1', 'One'), _notification('n2', 'Two')]);
    await pump(tester, const GalleryNotificationsPage());

    await tester.tap(find.byKey(const Key('notifications-mark-all-read')));
    await tester.pumpAndSettle();

    verify(() => repository.markRead(['n1', 'n2'], at: any(named: 'at'))).called(1);
    expect(find.text('No notifications'), findsOneWidget);
  });

  testWidgets('a notification that arrives joins the list, counts on the bell and is announced', (tester) async {
    when(() => repository.getUnread()).thenAnswer((_) async => []);
    await pump(tester, const GalleryNotificationBell());

    expect(find.byType(Badge), findsOneWidget);
    expect(tester.widget<Badge>(find.byType(Badge)).isLabelVisible, isFalse);

    bus.addNotification({
      'id': 'n9',
      'title': 'A new photo book is ready to review: Crete',
      'level': 'info',
      'type': 'Custom',
      'createdAt': '2026-09-27T09:32:30.753Z',
      'data': '{"bookId":"book-9"}',
    });
    await tester.pumpAndSettle();

    expect(tester.widget<Badge>(find.byType(Badge)).isLabelVisible, isTrue);
    expect(find.text('1'), findsOneWidget);
    expect(announced, [('A new photo book is ready to review: Crete', true)]);

    await tester.tap(find.byKey(const Key('notifications-bell')));
    await tester.pump();
    expect(navigator.calls, ['notifications']);
  });
}
