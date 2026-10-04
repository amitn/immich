import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/books/book_crop_editor.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/books/book_layout_picker.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/books/book_page_view.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/books/book_photo_picker.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_asset_thumbnail.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_confirm_dialog.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_text_dialog.widget.dart';
import 'package:immich_mobile/gallery/providers/books.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_images.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:openapi/api.dart';

enum _SlotAction { choose, crop, caption, resetCrop, remove }

enum _PageAction { earlier, later, add, delete, web }

/// The editor of one page of a photo book, made for a phone: its layout, section title and caption, the photo of
/// each slot (replace, crop, caption, remove), and moving, adding or deleting pages. What a phone does poorly
/// (dragging photos between pages, the style, the maps) is left to the web editor, a tap away.
@RoutePage()
class BookEditorPage extends HookConsumerWidget {
  final String bookId;
  final String pageId;

  const BookEditorPage({super.key, required this.bookId, required this.pageId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.t;
    final theme = Theme.of(context);
    final viewAsync = ref.watch(bookDetailProvider(bookId));
    final layouts = ref.watch(bookLayoutsProvider).valueOrNull;
    final images = ref.watch(galleryImagesProvider);
    final navigator = ref.read(galleryNavigatorProvider);
    final currentPageId = useState(pageId);
    final busy = useState(false);

    final view = viewAsync.valueOrNull;
    final pages = view?.pages ?? const <BookPageResponseDto>[];
    final index = pages.indexWhere((page) => page.id == currentPageId.value);
    final page = index == -1 ? null : pages[index];
    final book = view?.book;
    final notifier = ref.read(bookDetailProvider(bookId).notifier);

    Future<void> run(Future<void> Function() edit, String error) async {
      if (busy.value) {
        return;
      }
      busy.value = true;
      try {
        await edit();
      } catch (_) {
        await ref.read(toastServiceProvider).error(error);
      } finally {
        if (context.mounted) {
          busy.value = false;
        }
      }
    }

    if (book == null || page == null) {
      return Scaffold(
        appBar: AppBar(title: Text(t.book_edit_pages)),
        body: Center(
          child: viewAsync.hasError ? Text(t.errors.unable_to_load_book) : const CircularProgressIndicator(),
        ),
      );
    }

    final number = index + 1;
    final ratio = book.pageWidthMm > 0 && book.pageHeightMm > 0 ? book.pageWidthMm / book.pageHeightMm : 1.0;
    final placed = page.slots.where((slot) => slot.assetId != null).length;
    final inBook = {
      for (final other in pages)
        for (final slot in other.slots)
          if (slot.assetId != null) slot.assetId!,
    };
    final layoutName = layouts?.where((layout) => layout.id == page.layout).firstOrNull?.name ?? page.layout;
    final readOnly = view!.offline;

    Future<void> changeLayout() async {
      final layout = await showBookLayoutPicker(
        context,
        placedPhotos: placed,
        currentLayout: page.layout,
        mapPage: page.map != null,
        pageRatio: ratio,
        title: t.book_change_layout,
      );
      if (layout != null && layout.id != page.layout) {
        await run(() => notifier.setLayout(page.id, layout.id), t.errors.unable_to_change_book_layout);
      }
    }

    Future<void> editText(String title, String? value, Future<void> Function(String text) save, int maxLength) async {
      final text = await showGalleryTextDialog(
        context,
        title: title,
        initialValue: value ?? '',
        maxLength: maxLength,
        multiline: maxLength > 200,
      );
      if (text != null && text != (value ?? '')) {
        await run(() => save(text), t.errors.unable_to_update_book_page);
      }
    }

    Future<void> slotActions(BookSlotResponseDto slot) async {
      final assetId = slot.assetId;
      final action = await showModalBottomSheet<_SlotAction>(
        context: context,
        showDragHandle: true,
        builder: (context) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                key: const Key('book-slot-choose'),
                leading: Icon(assetId == null ? Icons.add_photo_alternate_outlined : Icons.swap_horiz),
                title: Text(assetId == null ? t.book_add_photo : t.book_replace_photo),
                onTap: () => Navigator.of(context).pop(_SlotAction.choose),
              ),
              if (assetId != null) ...[
                ListTile(
                  key: const Key('book-slot-crop'),
                  leading: const Icon(Icons.crop),
                  title: Text(t.book_adjust_crop),
                  onTap: () => Navigator.of(context).pop(_SlotAction.crop),
                ),
                ListTile(
                  key: const Key('book-slot-caption'),
                  leading: const Icon(Icons.short_text),
                  title: Text(t.book_photo_caption),
                  subtitle: slot.caption == null ? null : Text(slot.caption!, maxLines: 1),
                  onTap: () => Navigator.of(context).pop(_SlotAction.caption),
                ),
                if (slot.crop != null)
                  ListTile(
                    key: const Key('book-slot-reset-crop'),
                    leading: const Icon(Icons.crop_free),
                    title: Text(t.book_reset_crop),
                    onTap: () => Navigator.of(context).pop(_SlotAction.resetCrop),
                  ),
                ListTile(
                  key: const Key('book-slot-remove'),
                  leading: const Icon(Icons.remove_circle_outline),
                  title: Text(t.book_remove_photo),
                  onTap: () => Navigator.of(context).pop(_SlotAction.remove),
                ),
              ],
            ],
          ),
        ),
      );
      if (!context.mounted || action == null) {
        return;
      }
      switch (action) {
        case _SlotAction.choose:
          final picked = await showBookPhotoPicker(
            context,
            title: assetId == null ? t.book_add_photo : t.book_replace_photo,
            albumId: book.albumId,
            currentAssetId: assetId,
            inBook: inBook,
          );
          if (picked != null && picked != assetId) {
            await run(() => notifier.placePhoto(page.id, slot.slot, picked), t.errors.unable_to_replace_book_photo);
          }
        case _SlotAction.crop:
          final crop = await showBookCropEditor(
            context,
            image: images.assetPreview(assetId!),
            slotRatio: slot.aspectRatio,
            crop: slot.crop,
          );
          if (crop != null) {
            await run(() => notifier.setCrop(page.id, slot.slot, crop), t.errors.unable_to_crop_book_photo);
          }
        case _SlotAction.caption:
          final text = await showGalleryTextDialog(
            context,
            title: t.book_photo_caption,
            initialValue: slot.caption ?? '',
            maxLength: 500,
            multiline: true,
          );
          if (text != null && text != (slot.caption ?? '')) {
            await run(() => notifier.setPhotoCaption(page.id, slot.slot, text), t.errors.unable_to_update_book_caption);
          }
        case _SlotAction.resetCrop:
          await run(() => notifier.setCrop(page.id, slot.slot, null), t.errors.unable_to_crop_book_photo);
        case _SlotAction.remove:
          await run(() => notifier.removePhoto(page.id, slot.slot), t.errors.unable_to_remove_book_photo);
      }
    }

    Future<void> pageAction(_PageAction action) async {
      switch (action) {
        case _PageAction.earlier:
          await run(() => notifier.movePage(page.id, index - 1), t.errors.unable_to_move_book_page);
        case _PageAction.later:
          await run(() => notifier.movePage(page.id, index + 1), t.errors.unable_to_move_book_page);
        case _PageAction.add:
          final layout = await showBookLayoutPicker(
            context,
            placedPhotos: 0,
            pageRatio: ratio,
            title: t.book_add_page_after,
          );
          if (layout != null) {
            await run(() async {
              currentPageId.value = await notifier.addPage(layout.id, position: index + 1);
            }, t.errors.unable_to_add_book_page);
          }
        case _PageAction.delete:
          final confirmed = await showGalleryConfirmDialog(
            context,
            title: t.book_delete_page,
            content: t.book_delete_page_prompt(page: number),
            confirmText: t.delete,
          );
          if (!confirmed) {
            return;
          }
          final neighbour = index + 1 < pages.length
              ? pages[index + 1].id
              : index > 0
              ? pages[index - 1].id
              : null;
          await run(() async {
            await notifier.removePage(page.id);
            if (neighbour == null) {
              if (context.mounted) {
                await Navigator.of(context).maybePop();
              }
            } else {
              currentPageId.value = neighbour;
            }
          }, t.errors.unable_to_delete_book_page);
        case _PageAction.web:
          await navigator.openBookOnWeb(book.id);
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(t.book_page_of(page: number, total: pages.length)),
        bottom: busy.value
            ? const PreferredSize(
                preferredSize: Size.fromHeight(4),
                child: LinearProgressIndicator(key: Key('book-editor-saving')),
              )
            : null,
        actions: [
          PopupMenuButton<_PageAction>(
            key: const Key('book-page-menu'),
            tooltip: t.book_page_actions(page: number),
            enabled: !busy.value,
            onSelected: (action) => unawaited(pageAction(action)),
            itemBuilder: (context) => [
              PopupMenuItem(
                key: const Key('book-page-earlier'),
                value: _PageAction.earlier,
                enabled: !readOnly && index > 0,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.arrow_back),
                  title: Text(t.book_move_page_earlier),
                ),
              ),
              PopupMenuItem(
                key: const Key('book-page-later'),
                value: _PageAction.later,
                enabled: !readOnly && index < pages.length - 1,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.arrow_forward),
                  title: Text(t.book_move_page_later),
                ),
              ),
              PopupMenuItem(
                key: const Key('book-page-add'),
                value: _PageAction.add,
                enabled: !readOnly,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.note_add_outlined),
                  title: Text(t.book_add_page_after),
                ),
              ),
              PopupMenuItem(
                key: const Key('book-page-delete'),
                value: _PageAction.delete,
                enabled: !readOnly,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.delete_outline),
                  title: Text(t.book_delete_page),
                ),
              ),
              PopupMenuItem(
                key: const Key('book-page-web'),
                value: _PageAction.web,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.open_in_browser),
                  title: Text(t.open_in_browser),
                ),
              ),
            ],
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(32, 16, 32, 8),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 360),
                child: AspectRatio(
                  aspectRatio: ratio,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      boxShadow: [BoxShadow(color: theme.colorScheme.shadow.withValues(alpha: 0.2), blurRadius: 8)],
                    ),
                    child: Image(
                      key: ValueKey('book-editor-page-${page.id}'),
                      image: images.bookPage(
                        book.id,
                        page.id,
                        size: bookPageRenderSize(context),
                        cacheKey: page.updatedAt,
                      ),
                      fit: BoxFit.contain,
                      gaplessPlayback: true,
                      semanticLabel: t.book_page_image(page: number),
                      errorBuilder: (_, _, _) => const Center(child: Icon(Icons.broken_image_outlined)),
                    ),
                  ),
                ),
              ),
            ),
          ),
          ListTile(
            key: const Key('book-page-layout'),
            enabled: !readOnly && !busy.value,
            leading: const Icon(Icons.dashboard_outlined),
            title: Text(t.book_change_layout),
            subtitle: Text(layoutName),
            onTap: () => unawaited(changeLayout()),
          ),
          ListTile(
            key: const Key('book-page-section-title'),
            enabled: !readOnly && !busy.value,
            leading: const Icon(Icons.title),
            title: Text(t.book_section_title),
            subtitle: page.sectionTitle == null ? null : Text(page.sectionTitle!),
            onTap: () => unawaited(
              editText(t.book_section_title, page.sectionTitle, (text) => notifier.setSectionTitle(page.id, text), 200),
            ),
          ),
          ListTile(
            key: const Key('book-page-caption'),
            enabled: !readOnly && !busy.value,
            leading: const Icon(Icons.notes),
            title: Text(t.book_page_caption),
            subtitle: page.caption == null ? null : Text(page.caption!, maxLines: 2, overflow: TextOverflow.ellipsis),
            onTap: () => unawaited(
              editText(t.book_page_caption, page.caption, (text) => notifier.setPageCaption(page.id, text), 2000),
            ),
          ),
          if (page.slots.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
              child: Text(t.book_edit_page_photos(page: number), style: theme.textTheme.titleSmall),
            ),
          for (final slot in page.slots)
            ListTile(
              key: ValueKey('book-slot-${slot.slot}'),
              enabled: !readOnly && !busy.value,
              leading: slot.assetId == null
                  ? SizedBox.square(
                      dimension: 56,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          border: Border.all(color: theme.colorScheme.outlineVariant),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(Icons.add_photo_alternate_outlined, color: theme.colorScheme.onSurfaceVariant),
                      ),
                    )
                  : GalleryAssetThumbnail(assetId: slot.assetId!, size: 56),
              title: Text(
                slot.assetId == null
                    ? t.book_edit_empty_slot(page: number, slot: slot.slot + 1)
                    : t.book_edit_slot(page: number, slot: slot.slot + 1),
              ),
              subtitle: slot.caption == null ? null : Text(slot.caption!, maxLines: 1, overflow: TextOverflow.ellipsis),
              trailing: const Icon(Icons.more_vert),
              onTap: () => unawaited(slotActions(slot)),
            ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            IconButton(
              key: const Key('book-editor-previous'),
              onPressed: index == 0 ? null : () => currentPageId.value = pages[index - 1].id,
              icon: const Icon(Icons.chevron_left),
            ),
            IconButton(
              key: const Key('book-editor-next'),
              onPressed: index >= pages.length - 1 ? null : () => currentPageId.value = pages[index + 1].id,
              icon: const Icon(Icons.chevron_right),
            ),
          ],
        ),
      ),
    );
  }
}
