import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/widgets.dart';
import 'package:intl/message_format.dart';

/// A translation looked up by a key built at runtime, e.g. a label of a journal (`journals.<pack>.<label>`) or the
/// name of a book style preset, which the generated `Translations` can only reach one getter at a time.
///
/// [fallback] when the key has no translation (easy_localization answers the key itself), e.g. a journal a newer
/// server offers that this app has no labels for.
String galleryTr(BuildContext? context, String key, {Map<String, Object>? args, String? fallback}) {
  try {
    final translated = key.tr(context: context);
    if (translated == key) {
      return fallback ?? key;
    }
    return args == null ? translated : MessageFormat(translated, locale: Intl.defaultLocale ?? 'en').format(args);
  } catch (_) {
    return fallback ?? key;
  }
}

/// Whether the app has a translation for [key]
bool galleryHasTr(BuildContext? context, String key) {
  try {
    return key.tr(context: context) != key;
  } catch (_) {
    return false;
  }
}
