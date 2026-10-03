import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/widgets/common/gallery_before_after.widget.dart';
import 'package:immich_mobile/gallery/providers/enhance.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_images.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:openapi/api.dart';

/// "Auto enhance" of a photo of the user's: a strength, the photo before and after it (rendered by the server side
/// by side), what it corrects, and the enhanced copy saved next to the original, then compared with it
@RoutePage()
class AutoEnhancePage extends ConsumerWidget {
  final String assetId;

  const AutoEnhancePage({super.key, required this.assetId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.t;
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final provider = enhanceProvider(assetId);
    final state = ref.watch(provider);
    final controller = ref.read(provider.notifier);
    final images = ref.watch(galleryImagesProvider);
    final navigator = ref.read(galleryNavigatorProvider);
    final result = state.result;
    final analysis = state.analysis;

    Future<void> save() async {
      final error = t.errors.unable_to_enhance_photo;
      try {
        await controller.save();
      } catch (_) {
        await ref.read(toastServiceProvider).error(error);
      }
    }

    final preview = result != null
        ? GalleryBeforeAfter(before: images.assetPreview(assetId), after: images.assetPreview(result.id))
        : Stack(
            fit: StackFit.expand,
            children: [
              ColoredBox(
                color: Colors.black,
                child: InteractiveViewer(
                  maxScale: 5,
                  child: AnimatedOpacity(
                    opacity: state.analyzing ? 0.4 : 1,
                    duration: const Duration(milliseconds: 200),
                    child: Image(
                      key: ValueKey('enhance-preview-${state.strength}'),
                      image: images.enhancePreview(assetId, state.strength),
                      fit: BoxFit.contain,
                      gaplessPlayback: true,
                      semanticLabel: t.auto_enhance_preview,
                      errorBuilder: (_, _, _) =>
                          const Center(child: Icon(Icons.broken_image_outlined, color: Colors.white54)),
                    ),
                  ),
                ),
              ),
              if (state.analyzing) const Center(child: CircularProgressIndicator()),
            ],
          );

    return Scaffold(
      appBar: AppBar(title: Text(t.auto_enhance)),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(flex: 3, child: preview),
          Expanded(
            flex: 2,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              children: [
                if (result != null)
                  Text(t.auto_enhance_done, style: theme.textTheme.bodyMedium)
                else ...[
                  Text(t.auto_enhance_description, style: muted),
                  const SizedBox(height: 12),
                  Text(t.auto_enhance_strength, style: theme.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  SegmentedButton<EnhanceStrength>(
                    key: const Key('enhance-strength'),
                    segments: [
                      ButtonSegment(value: EnhanceStrength.subtle, label: Text(t.auto_enhance_strength_subtle)),
                      ButtonSegment(value: EnhanceStrength.normal, label: Text(t.auto_enhance_strength_normal)),
                      ButtonSegment(value: EnhanceStrength.strong, label: Text(t.auto_enhance_strength_strong)),
                    ],
                    selected: {state.strength},
                    onSelectionChanged: state.saving
                        ? null
                        : (selection) => unawaited(controller.analyze(selection.first)),
                  ),
                  const SizedBox(height: 12),
                  if (state.failed && analysis == null)
                    Text(t.errors.unable_to_load_enhance_preview, style: TextStyle(color: theme.colorScheme.error))
                  else if (analysis != null && !analysis.needed)
                    Text(t.auto_enhance_nothing_to_do, style: theme.textTheme.bodyMedium)
                  else if (analysis != null)
                    for (final correction in analysis.corrections)
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(Icons.check, color: theme.colorScheme.primary),
                        title: Text(correction.description),
                        subtitle: Text(correction.reason),
                      ),
                ],
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: SizedBox(
            height: 52,
            child: result != null
                ? FilledButton.icon(
                    key: const Key('enhance-open'),
                    onPressed: () async {
                      await Navigator.of(context).maybePop();
                      await navigator.openAssets([result.id]);
                    },
                    icon: const Icon(Icons.open_in_new),
                    label: Text(t.open),
                  )
                : FilledButton.icon(
                    key: const Key('enhance-save'),
                    onPressed: state.canSave ? () => unawaited(save()) : null,
                    icon: state.saving
                        ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.auto_fix_high),
                    label: Text(t.auto_enhance_save),
                  ),
          ),
        ),
      ),
    );
  }
}
