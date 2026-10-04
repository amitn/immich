import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/providers/notifications.provider.dart';

/// The websocket hook of the assistant work: its events feed the event bus, and the notifications start listening so
/// one that arrives shows wherever the user is
void connectGallerySocket(GallerySocketOn on, Ref ref, {required void Function() onNewAsset}) {
  registerGallerySocketHandlers(on, ref.read(galleryEventBusProvider), onNewAsset: onNewAsset);
  connectGalleryNotifications(ref);
}
