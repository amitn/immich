import 'package:auto_route/auto_route.dart';
import 'package:immich_mobile/routing/router.dart';

// The pages of the assistant work; router.dart imports this file, so its generated part sees them
export 'package:immich_mobile/gallery/presentation/pages/assistant.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/book_export.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/book_viewer.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/books.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/gallery_notifications.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/journal_name.page.dart';

/// The routes of the assistant work (#3), behind the app's [guards]
List<AutoRoute> galleryRoutes(List<AutoRouteGuard> guards) => [
  AutoRoute(page: AssistantRoute.page, guards: guards),
  AutoRoute(page: BooksRoute.page, guards: guards),
  AutoRoute(page: BookExportRoute.page, guards: guards),
  AutoRoute(page: BookViewerRoute.page, guards: guards),
  AutoRoute(page: GalleryNotificationsRoute.page, guards: guards),
  AutoRoute(page: JournalNameRoute.page, guards: guards),
];
