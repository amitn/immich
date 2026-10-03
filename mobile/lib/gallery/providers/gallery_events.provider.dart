import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/models/gallery_notification.model.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart';

/// The websocket events of the assistant work, as the server names them in its `ClientEventMap`
abstract final class GalleryServerEvent {
  /// A chat of the assistant changed: its status, or a message that is new or streamed (`AgentUpdateDto`)
  static const agentUpdate = 'on_agent_update';

  /// An artwork in an artistic style progressed (`ArtJobResponseDto`)
  static const artJobUpdate = 'on_art_job_update';

  /// A highlight video progressed (`HighlightJobResponseDto`)
  static const highlightUpdate = 'on_highlight_update';

  /// A notification for the user (`NotificationDto`): a book export, a draft book, an artwork, a video, …
  static const notification = 'on_notification';

  static const all = [agentUpdate, artJobUpdate, highlightUpdate, notification];
}

/// Registers a websocket handler; a tear-off of `Socket.on` fits
typedef GallerySocketOn = Object? Function(String event, dynamic Function(dynamic data) handler);

/// The assistant events of the websocket, parsed, for the screens that follow them
class GalleryEventBus {
  static final _log = Logger('GalleryEventBus');

  final _agentUpdates = StreamController<AgentUpdateDto>.broadcast();
  final _artJobs = StreamController<ArtJobResponseDto>.broadcast();
  final _highlights = StreamController<HighlightJobResponseDto>.broadcast();
  final _notifications = StreamController<GalleryNotification>.broadcast();

  Stream<AgentUpdateDto> get agentUpdates => _agentUpdates.stream;
  Stream<ArtJobResponseDto> get artJobs => _artJobs.stream;
  Stream<HighlightJobResponseDto> get highlights => _highlights.stream;
  Stream<GalleryNotification> get notifications => _notifications.stream;

  AgentUpdateDto? addAgentUpdate(Object? data) => _add(_agentUpdates, data, AgentUpdateDto.fromJson);

  ArtJobResponseDto? addArtJob(Object? data) => _add(_artJobs, data, ArtJobResponseDto.fromJson);

  HighlightJobResponseDto? addHighlight(Object? data) => _add(_highlights, data, HighlightJobResponseDto.fromJson);

  GalleryNotification? addNotification(Object? data) => _add(_notifications, data, GalleryNotification.fromJson);

  T? _add<T>(StreamController<T> controller, Object? data, T? Function(Object?) parse) {
    try {
      final value = parse(data);
      if (value != null && !controller.isClosed) {
        controller.add(value);
      }
      return value;
    } catch (error, stackTrace) {
      // a newer server may send a shape this app does not know: skip the event rather than break the socket
      _log.warning('Unable to parse a websocket event of type $T', error, stackTrace);
      return null;
    }
  }

  Future<void> dispose() async {
    await Future.wait([_agentUpdates.close(), _artJobs.close(), _highlights.close(), _notifications.close()]);
  }
}

final galleryEventBusProvider = Provider<GalleryEventBus>((ref) {
  final bus = GalleryEventBus();
  ref.onDispose(() => unawaited(bus.dispose()));
  return bus;
});

/// Listens to the assistant events of the websocket. [onNewAsset] runs when an artwork or a highlight video is done,
/// so the new photo or video is synced before a notification opens it.
void registerGallerySocketHandlers(GallerySocketOn on, GalleryEventBus bus, {required void Function() onNewAsset}) {
  on(GalleryServerEvent.agentUpdate, bus.addAgentUpdate);
  on(GalleryServerEvent.artJobUpdate, (data) {
    final job = bus.addArtJob(data);
    if (job?.status == ArtJobStatus.completed && job?.resultAssetId != null) {
      onNewAsset();
    }
  });
  on(GalleryServerEvent.highlightUpdate, (data) {
    final job = bus.addHighlight(data);
    if (job?.status == HighlightJobStatus.completed && job?.resultAssetId != null) {
      onNewAsset();
    }
  });
  on(GalleryServerEvent.notification, bus.addNotification);
}
