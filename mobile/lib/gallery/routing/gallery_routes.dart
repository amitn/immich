import 'package:auto_route/auto_route.dart';
import 'package:immich_mobile/routing/router.dart';

// The pages of the assistant work; router.dart imports this file, so its generated part sees them
export 'package:immich_mobile/gallery/presentation/pages/artistic_style.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/assistant.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/auto_enhance.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/book_editor.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/book_export.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/book_viewer.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/books.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/gallery_notifications.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/highlight_video.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/journal_name.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/routine_run.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/routines_inbox.page.dart';
export 'package:immich_mobile/gallery/presentation/pages/tags.page.dart';

/// The routes of the assistant work (#3), behind the app's [guards]
List<AutoRoute> galleryRoutes(List<AutoRouteGuard> guards) => [
  AutoRoute(page: ArtisticStyleRoute.page, guards: guards),
  AutoRoute(page: AssistantRoute.page, guards: guards),
  AutoRoute(page: AutoEnhanceRoute.page, guards: guards),
  AutoRoute(page: BooksRoute.page, guards: guards),
  AutoRoute(page: BookExportRoute.page, guards: guards),
  AutoRoute(page: BookEditorRoute.page, guards: guards),
  AutoRoute(page: BookViewerRoute.page, guards: guards),
  AutoRoute(page: GalleryNotificationsRoute.page, guards: guards),
  AutoRoute(page: HighlightVideoRoute.page, guards: guards),
  AutoRoute(page: JournalNameRoute.page, guards: guards),
  AutoRoute(page: RoutineRunRoute.page, guards: guards),
  AutoRoute(page: RoutinesInboxRoute.page, guards: guards),
  AutoRoute(page: TagsRoute.page, guards: guards),
];
