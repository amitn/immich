import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_asset_thumbnail.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_before_after.widget.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_confirm_dialog.widget.dart';
import 'package:immich_mobile/gallery/providers/art.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_images.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:openapi/api.dart';

/// "Artistic style…" of a photo of the user's: a style (or a prompt of their own), then the artwork being made with
/// its progress, then the photo before and after. The artwork is a new photo stacked with the original
@RoutePage()
class ArtisticStylePage extends ConsumerStatefulWidget {
  final String assetId;

  const ArtisticStylePage({super.key, required this.assetId});

  @override
  ConsumerState<ArtisticStylePage> createState() => _ArtisticStylePageState();
}

class _ArtisticStylePageState extends ConsumerState<ArtisticStylePage> {
  /// How often a result whose preview is not ready yet is asked for again, like the web's
  static const _previewRetries = 15;
  static const _previewRetryDelay = Duration(seconds: 2);

  final _prompt = TextEditingController();
  final _caption = TextEditingController();
  var _previewAttempt = 0;
  Timer? _previewRetry;

  @override
  void initState() {
    super.initState();
    _prompt.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _prompt.dispose();
    _caption.dispose();
    _previewRetry?.cancel();
    super.dispose();
  }

  /// The preview of a new artwork is made after it: ask for it again a few times
  void _retryPreview() {
    if (_previewRetry != null || _previewAttempt >= _previewRetries) {
      return;
    }
    _previewRetry = Timer(_previewRetryDelay, () {
      if (mounted) {
        setState(() {
          _previewRetry = null;
          _previewAttempt++;
        });
      }
    });
  }

  Future<void> _generate(ArtController controller) async {
    final error = context.t.errors.unable_to_create_art_job;
    try {
      await controller.start(prompt: _prompt.text, caption: _caption.text);
    } catch (_) {
      await ref.read(toastServiceProvider).error(error);
    }
  }

  Future<void> _delete(ArtController controller, ArtStyleDto style) async {
    final t = context.t;
    final confirmed = await showGalleryConfirmDialog(
      context,
      title: t.art_style_delete,
      content: t.art_style_delete_prompt(name: style.name),
      confirmText: t.delete,
    );
    if (!confirmed) {
      return;
    }
    final toast = ref.read(toastServiceProvider);
    try {
      await controller.deleteStyle(style);
      await toast.success(t.art_style_deleted(name: style.name));
    } catch (_) {
      await toast.error(t.errors.unable_to_delete_art_style);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final provider = artProvider(widget.assetId);
    final state = ref.watch(provider);
    final controller = ref.read(provider.notifier);
    final images = ref.watch(galleryImagesProvider);
    final navigator = ref.read(galleryNavigatorProvider);
    final job = state.job;

    Widget body;
    List<Widget> actions;
    switch (state.phase) {
      case ArtPhase.select:
        final styles = state.styles;
        final selected = state.selected;
        final custom = styles != null && state.style == null;
        final canGenerate = !state.starting && styles != null && (!custom || _prompt.text.trim().isNotEmpty);
        body = ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            Row(
              spacing: 12,
              children: [
                GalleryAssetThumbnail(assetId: widget.assetId, size: 64, semanticLabel: t.art_source_photo),
                Expanded(child: Text(t.art_description, style: muted)),
              ],
            ),
            const SizedBox(height: 16),
            Text(t.art_choose_style, style: theme.textTheme.titleSmall),
            if (styles == null)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              )
            else ...[
              RadioGroup<String?>(
                groupValue: state.style,
                onChanged: controller.choose,
                child: Column(
                  children: [
                    for (final style in styles.where((style) => !style.owned))
                      RadioListTile<String?>(
                        key: ValueKey('art-style-${style.id}'),
                        contentPadding: EdgeInsets.zero,
                        value: style.id,
                        title: Text(style.name),
                        subtitle: Text(style.description),
                      ),
                    RadioListTile<String?>(
                      key: const ValueKey('art-style-custom'),
                      contentPadding: EdgeInsets.zero,
                      value: null,
                      title: Text(t.art_custom_style),
                      subtitle: Text(t.art_custom_style_description),
                    ),
                    if (styles.any((style) => style.owned)) ...[
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(t.art_your_styles, style: theme.textTheme.labelLarge),
                        ),
                      ),
                      for (final style in styles.where((style) => style.owned))
                        RadioListTile<String?>(
                          key: ValueKey('art-style-${style.id}'),
                          contentPadding: EdgeInsets.zero,
                          value: style.id,
                          title: Text(style.name),
                          subtitle: Text(style.description),
                          secondary: IconButton(
                            key: ValueKey('art-style-delete-${style.id}'),
                            tooltip: t.art_style_delete_named(name: style.name),
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () => unawaited(_delete(controller, style)),
                          ),
                        ),
                    ],
                  ],
                ),
              ),
              if (selected != null && selected.usesCaption) ...[
                const SizedBox(height: 12),
                TextField(
                  key: const Key('art-caption'),
                  controller: _caption,
                  maxLength: 80,
                  decoration: InputDecoration(
                    labelText: t.art_caption,
                    helperText: t.art_caption_description,
                    hintText: t.art_caption_placeholder,
                    border: const OutlineInputBorder(),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              TextField(
                key: const Key('art-prompt'),
                controller: _prompt,
                minLines: 2,
                maxLines: 5,
                maxLength: 5000,
                decoration: InputDecoration(
                  labelText: custom ? t.art_prompt : t.art_prompt_optional,
                  helperText: t.art_prompt_description,
                  helperMaxLines: 2,
                  hintText: t.art_prompt_placeholder,
                  border: const OutlineInputBorder(),
                ),
              ),
              Text(t.art_privacy_note, style: muted),
            ],
          ],
        );
        actions = [
          FilledButton.icon(
            key: const Key('art-generate'),
            onPressed: canGenerate ? () => unawaited(_generate(controller)) : null,
            icon: state.starting
                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.brush_outlined),
            label: Text(t.art_generate),
          ),
        ];
      case ArtPhase.running:
        body = Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              spacing: 12,
              children: [
                GalleryAssetThumbnail(assetId: widget.assetId, size: 160, semanticLabel: t.art_source_photo),
                const SizedBox(height: 8),
                const LinearProgressIndicator(),
                Text(
                  job?.status == ArtJobStatus.pending ? t.art_status_pending : t.art_status_running,
                  style: theme.textTheme.titleMedium,
                  textAlign: TextAlign.center,
                ),
                if (state.startedAt != null) _Elapsed(since: state.startedAt!),
                Text(t.art_duration_hint, style: muted, textAlign: TextAlign.center),
              ],
            ),
          ),
        );
        actions = [
          OutlinedButton(
            key: const Key('art-close'),
            onPressed: () => unawaited(Navigator.of(context).maybePop()),
            child: Text(t.art_close_and_continue),
          ),
        ];
      case ArtPhase.done:
        final resultId = job!.resultAssetId!;
        body = Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: GalleryBeforeAfter(
                before: images.assetPreview(widget.assetId),
                after: images.assetPreview(resultId, cacheKey: _previewAttempt == 0 ? null : 'r$_previewAttempt'),
                onAfterError: _retryPreview,
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(t.art_done_description, style: muted, textAlign: TextAlign.center),
            ),
          ],
        );
        actions = [
          OutlinedButton(onPressed: controller.again, child: Text(t.art_try_again)),
          FilledButton.icon(
            key: const Key('art-open'),
            onPressed: () async {
              await Navigator.of(context).maybePop();
              await navigator.openAssets([resultId]);
            },
            icon: const Icon(Icons.open_in_new),
            label: Text(t.open),
          ),
        ];
      case ArtPhase.failed:
        final error = job?.error;
        body = Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              spacing: 12,
              children: [
                Icon(Icons.error_outline, size: 48, color: theme.colorScheme.error),
                Text(t.art_failed, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
                Text(error == null || error.isEmpty ? t.art_failed_no_output : error, textAlign: TextAlign.center),
              ],
            ),
          ),
        );
        actions = [
          OutlinedButton(onPressed: () => unawaited(Navigator.of(context).maybePop()), child: Text(t.close)),
          FilledButton(key: const Key('art-try-again'), onPressed: controller.again, child: Text(t.art_try_again)),
        ];
    }

    return Scaffold(
      appBar: AppBar(title: Text(t.artistic_style_title)),
      body: body,
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Row(
            spacing: 8,
            children: [for (final action in actions) Expanded(child: SizedBox(height: 52, child: action))],
          ),
        ),
      ),
    );
  }
}

/// "Elapsed: 1:05", ticking
class _Elapsed extends StatefulWidget {
  final DateTime since;

  const _Elapsed({required this.since});

  @override
  State<_Elapsed> createState() => _ElapsedState();
}

class _ElapsedState extends State<_Elapsed> {
  late final Timer _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final elapsed = DateTime.now().difference(widget.since);
    final seconds = elapsed.inSeconds.remainder(60).toString().padLeft(2, '0');
    return Text(context.t.art_elapsed(time: '${elapsed.inMinutes}:$seconds'));
  }
}
