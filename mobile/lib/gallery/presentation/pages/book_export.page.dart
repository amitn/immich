import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/books/book_style_picker.widget.dart';
import 'package:immich_mobile/gallery/providers/book_export.provider.dart';
import 'package:immich_mobile/gallery/providers/books.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/gallery/repositories/book_api.repository.dart';
import 'package:immich_mobile/gallery/utils/book_export.dart';
import 'package:immich_mobile/gallery/utils/gallery_i18n.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:openapi/api.dart';

/// "Export as book…" of an album: the options of the web's export dialog (title, page size, style, maps, improved
/// photos), on a page of its own for a phone; the new book then opens in the book viewer
@RoutePage()
class BookExportPage extends ConsumerStatefulWidget {
  final String albumId;
  final String albumName;
  final int assetCount;

  /// The style preset chosen when the page opens, e.g. food after naming the dishes of the album (a string: the
  /// generated router does not see the API enums)
  final String? stylePreset;

  const BookExportPage({
    super.key,
    required this.albumId,
    required this.albumName,
    required this.assetCount,
    this.stylePreset,
  });

  @override
  ConsumerState<BookExportPage> createState() => _BookExportPageState();
}

class _BookExportPageState extends ConsumerState<BookExportPage> {
  late final TextEditingController _title;
  late final TextEditingController _subtitle;
  late final TextEditingController _pageCount;
  late BookExportOptions _options;
  var _creating = false;

  @override
  void initState() {
    super.initState();
    _title = TextEditingController(text: widget.albumName);
    _subtitle = TextEditingController();
    _pageCount = TextEditingController();
    _options = BookExportOptions(
      title: widget.albumName,
      style: PresetBookStyle(BookStylePreset.fromJson(widget.stylePreset) ?? defaultBookStylePreset),
    );
  }

  @override
  void dispose() {
    _title.dispose();
    _subtitle.dispose();
    _pageCount.dispose();
    super.dispose();
  }

  void _update(BookExportOptions Function(BookExportOptions options) change) =>
      setState(() => _options = change(_options));

  Future<void> _create() async {
    final t = context.t;
    final toast = ref.read(toastServiceProvider);
    final navigator = ref.read(galleryNavigatorProvider);
    final repository = ref.read(bookApiRepositoryProvider);
    final options = BookExportOptions(
      title: _title.text,
      subtitle: _subtitle.text,
      pageSize: _options.pageSize,
      style: _options.style,
      targetPageCount: normalizeBookPageCount(_pageCount.text),
      includeMaps: _options.includeMaps,
      map: _options.map,
      illustratedMaps: _options.illustratedMaps,
      improvePhotos: _options.improvePhotos,
    );

    setState(() => _creating = true);
    final BookAutoLayoutResponseDto book;
    try {
      book = await repository.createFromAlbum(options.toDto(albumId: widget.albumId, albumName: widget.albumName));
    } catch (_) {
      if (mounted) {
        setState(() => _creating = false);
      }
      await toast.error(t.errors.unable_to_create_book);
      return;
    }

    // the books page lists it next time it is opened; the problems met while laying it out (e.g. a map style that
    // is not available) are in its review
    ref.invalidate(booksProvider);
    if (mounted) {
      setState(() => _creating = false);
      await Navigator.of(context).maybePop();
    }
    await navigator.openBook(book.id);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final theme = Theme.of(context);
    final features = ref.watch(galleryFeaturesProvider);
    final styles = ref.watch(bookStyleOptionsProvider);
    final size = bookPageSizeOf(_options.pageSize);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final empty = widget.assetCount == 0;

    Widget section(String label, {Widget? child, String? description}) => Padding(
      padding: const EdgeInsets.only(top: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 8,
        children: [
          Text(label, style: theme.textTheme.titleSmall),
          ?child,
          if (description != null) Text(description, style: muted),
        ],
      ),
    );

    return Scaffold(
      appBar: AppBar(title: Text(t.book_export_album)),
      body: AbsorbPointer(
        absorbing: _creating,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            Text(t.book_export_album_description, style: muted),
            const SizedBox(height: 16),
            TextField(
              key: const Key('book-export-title'),
              controller: _title,
              maxLength: 200,
              decoration: InputDecoration(labelText: t.book_title, border: const OutlineInputBorder()),
            ),
            TextField(
              key: const Key('book-export-subtitle'),
              controller: _subtitle,
              maxLength: 200,
              decoration: InputDecoration(
                labelText: t.book_subtitle,
                hintText: t.book_subtitle_placeholder,
                border: const OutlineInputBorder(),
              ),
            ),
            section(
              t.book_page_size,
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final option in bookPageSizes)
                    ChoiceChip(
                      key: Key('book-export-size-${option.id}'),
                      selected: option.id == size.id,
                      onSelected: (_) => _update((options) => options.copyWith(pageSize: option.id)),
                      label: Text(
                        '${_pageSizeLabel(context, option)} · '
                        '${t.book_page_size_cm(width: formatBookCm(option.widthMm), height: formatBookCm(option.heightMm))}',
                      ),
                    ),
                ],
              ),
            ),
            section(
              t.book_style,
              child: BookStylePicker(
                value: _options.style,
                options: styles.valueOrNull ?? const BookStyleOptions(),
                onChanged: (style) => _update((options) => options.copyWith(style: style)),
              ),
            ),
            section(
              t.book_target_page_count,
              description: t.book_target_page_count_description(
                pages: defaultBookPageCount(widget.assetCount),
                photos: widget.assetCount,
              ),
              child: TextField(
                key: const Key('book-export-pages'),
                controller: _pageCount,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(3)],
                decoration: InputDecoration(
                  hintText: t.book_target_page_count_placeholder,
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              key: const Key('book-export-maps'),
              contentPadding: EdgeInsets.zero,
              title: Text(t.book_include_maps),
              subtitle: Text(t.book_include_maps_description),
              value: _options.includeMaps,
              onChanged: (value) => _update((options) => options.copyWith(includeMaps: value)),
            ),
            if (_options.includeMaps) ...[
              Padding(
                padding: const EdgeInsets.only(left: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 8,
                  children: [
                    Text(t.book_map_style, style: theme.textTheme.titleSmall),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final choice in bookMapChoices)
                          ChoiceChip(
                            key: Key('book-export-map-${choice.id}'),
                            selected: choice.id == _options.map.id,
                            onSelected: choice.needsStadia && !features.bookStadiaMaps
                                ? null
                                : (_) => _update((options) => options.copyWith(map: choice)),
                            label: Text(galleryTr(context, choice.labelKey)),
                          ),
                      ],
                    ),
                    Text(_mapDescription(context, _options.map, stadia: features.bookStadiaMaps), style: muted),
                    SwitchListTile(
                      key: const Key('book-export-illustrate'),
                      contentPadding: EdgeInsets.zero,
                      title: Text(t.book_illustrate_maps),
                      subtitle: Text(
                        features.artisticStyles
                            ? t.book_illustrate_maps_description
                            : t.book_illustrate_maps_unavailable,
                      ),
                      value: features.artisticStyles && _options.illustratedMaps,
                      onChanged: features.artisticStyles
                          ? (value) => _update((options) => options.copyWith(illustratedMaps: value))
                          : null,
                    ),
                  ],
                ),
              ),
            ],
            SwitchListTile(
              key: const Key('book-export-improve'),
              contentPadding: EdgeInsets.zero,
              title: Text(t.book_improve_photos),
              subtitle: Text(t.book_improve_photos_description),
              value: _options.improvePhotos,
              onChanged: (value) => _update((options) => options.copyWith(improvePhotos: value)),
            ),
          ],
        ),
      ),
      // within reach of the thumb, like the other actions of the app
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton.icon(
            key: const Key('book-export-create'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
            onPressed: _creating || empty ? null : () => unawaited(_create()),
            icon: _creating
                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.menu_book_outlined),
            label: Text(_creating ? t.book_creating : t.book_create),
          ),
        ),
      ),
    );
  }
}

String _pageSizeLabel(BuildContext context, BookPageSize size) => switch (size) {
  BookPageSize(isSquare: true) => context.t.book_page_size_square,
  BookPageSize(isPortrait: true) => context.t.book_page_size_a4_portrait,
  _ => context.t.book_page_size_a4_landscape,
};

String _mapDescription(BuildContext context, BookMapChoice choice, {required bool stadia}) {
  final t = context.t;
  if (choice.needsStadia) {
    return stadia ? t.book_map_style_stadia_description : t.book_map_style_needs_key;
  }
  return switch (choice.style) {
    BookMapStyleOption.sketch => t.book_map_style_sketch_description,
    _ => t.book_map_style_styled_description,
  };
}
