import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:openapi/api.dart';

/// A socket stand-in: the handlers by event name, and a way to emit an event to them
class _FakeSocket {
  final handlers = <String, dynamic Function(dynamic)>{};

  Object? on(String event, dynamic Function(dynamic) handler) {
    handlers[event] = handler;
    return null;
  }

  void emit(String event, Object? data) => handlers[event]!(data);
}

Map<String, Object?> _artJob(String status, {String? resultAssetId}) => {
  'id': 'job-1',
  'sourceAssetId': 'asset-1',
  'status': status,
  'style': 'watercolor',
  'caption': null,
  'error': null,
  'resultAssetId': resultAssetId,
  'createdAt': '2026-09-01T10:00:00.000Z',
  'updatedAt': '2026-09-01T10:01:00.000Z',
};

Map<String, Object?> _highlight(String status, {String? resultAssetId}) => {
  'id': 'video-1',
  'title': 'Summer',
  'status': status,
  'format': 'landscape',
  'durationSeconds': 60,
  'progress': status == 'completed' ? 1 : 0.5,
  'warnings': <Object?>[],
  'albumId': 'album-1',
  'bookId': null,
  'memoryId': null,
  'error': null,
  'resultAssetId': resultAssetId,
  'createdAt': '2026-09-01T10:00:00.000Z',
  'updatedAt': '2026-09-01T10:01:00.000Z',
};

void main() {
  late _FakeSocket socket;
  late GalleryEventBus bus;
  late int newAssets;

  setUp(() {
    socket = _FakeSocket();
    bus = GalleryEventBus();
    newAssets = 0;
    registerGallerySocketHandlers(socket.on, bus, onNewAsset: () => newAssets++);
  });

  tearDown(() => bus.dispose());

  test('listens to the events the server emits', () {
    expect(socket.handlers.keys, unorderedEquals(GalleryServerEvent.all));
    expect(GalleryServerEvent.all, ['on_agent_update', 'on_art_job_update', 'on_highlight_update', 'on_notification']);
  });

  test('an assistant update reaches the chat, with its streamed message', () async {
    final updates = <AgentUpdateDto>[];
    final subscription = bus.agentUpdates.listen(updates.add);
    addTearDown(subscription.cancel);

    socket.emit('on_agent_update', {
      'sessionId': 'session-1',
      'status': 'running',
      'message': {
        'id': 'message-1',
        'sessionId': 'session-1',
        'role': 'agent',
        'kind': 'text',
        'content': {'text': 'Looking for **beach** photos'},
        'createdAt': '2026-09-01T10:00:00.000Z',
      },
    });
    await Future<void>.delayed(Duration.zero);

    expect(updates, hasLength(1));
    expect(updates.single.sessionId, 'session-1');
    expect(updates.single.status, AgentSessionStatus.running);
    expect(updates.single.message.orElse(null)?.content.text.orElse(null), 'Looking for **beach** photos');
  });

  test('a finished artwork syncs the new photo; a running one does not', () async {
    final jobs = <ArtJobResponseDto>[];
    final subscription = bus.artJobs.listen(jobs.add);
    addTearDown(subscription.cancel);

    socket.emit('on_art_job_update', _artJob('running'));
    socket.emit('on_art_job_update', _artJob('completed', resultAssetId: 'art-1'));
    await Future<void>.delayed(Duration.zero);

    expect(jobs.map((job) => job.status), [ArtJobStatus.running, ArtJobStatus.completed]);
    expect(newAssets, 1);
  });

  test('a finished highlight video syncs the new video', () async {
    socket.emit('on_highlight_update', _highlight('running'));
    socket.emit('on_highlight_update', _highlight('completed', resultAssetId: 'video-asset-1'));

    expect(newAssets, 1);
  });

  test('a notification arrives with its data parsed from the JSON string', () async {
    final notifications = <GalleryNotification>[];
    final subscription = bus.notifications.listen(notifications.add);
    addTearDown(subscription.cancel);

    socket.emit('on_notification', {
      'id': 'notification-1',
      'createdAt': '2026-09-01T10:00:00.000Z',
      'level': 'success',
      'type': 'Custom',
      'title': 'Your photo book is ready',
      'description': 'Download the PDF',
      'data': '{"bookId":"book-1"}',
    });
    await Future<void>.delayed(Duration.zero);

    expect(notifications.single.title, 'Your photo book is ready');
    expect(notifications.single.target, const BookNotificationTarget('book-1'));
  });

  test('a payload of an unknown shape is skipped without breaking the socket', () async {
    final updates = <AgentUpdateDto>[];
    final subscription = bus.agentUpdates.listen(updates.add);
    addTearDown(subscription.cancel);

    socket.emit('on_agent_update', 'not an object');
    socket.emit('on_agent_update', {'sessionId': 'session-1', 'status': 'idle'});
    await Future<void>.delayed(Duration.zero);

    expect(updates.map((update) => update.status), [AgentSessionStatus.idle]);
  });
}
