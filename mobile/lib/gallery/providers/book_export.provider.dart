import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/repositories/book_api.repository.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart';

/// The styles the export dialog offers: the style of each preset (for its swatch), and the user's own styles
class BookStyleOptions {
  final Map<BookStylePreset, BookStyle> presetStyles;
  final List<BookUserStyleResponseDto> userStyles;

  const BookStyleOptions({this.presetStyles = const {}, this.userStyles = const []});
}

final _log = Logger('BookStyleOptions');

/// The presets rarely change and the user's styles do (the assistant saves new ones), so both are fetched each time
/// the dialog opens. Either may fail: the choice of a preset still works without its swatch
final bookStyleOptionsProvider = FutureProvider.autoDispose<BookStyleOptions>((ref) async {
  final repository = ref.watch(bookApiRepositoryProvider);
  var presetStyles = const <BookStylePreset, BookStyle>{};
  var userStyles = const <BookUserStyleResponseDto>[];
  try {
    presetStyles = {for (final preset in await repository.getStylePresets()) preset.id: preset.style};
  } catch (error, stackTrace) {
    _log.warning('Unable to load the book style presets', error, stackTrace);
  }
  try {
    userStyles = await repository.getUserStyles();
  } catch (error, stackTrace) {
    _log.warning('Unable to load the book styles of the user', error, stackTrace);
  }
  return BookStyleOptions(presetStyles: presetStyles, userStyles: userStyles);
});
