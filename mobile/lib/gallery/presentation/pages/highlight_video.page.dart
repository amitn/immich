import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_navigator.provider.dart';
import 'package:immich_mobile/gallery/providers/highlight.provider.dart';
import 'package:immich_mobile/gallery/repositories/highlight_api.repository.dart';
import 'package:immich_mobile/gallery/utils/book_export.dart';
import 'package:immich_mobile/gallery/utils/gallery_i18n.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:openapi/api.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// The file name of a highlight video, like the web's: its title, "-vertical" for the 9:16 one
String highlightFileName(String title, HighlightFormat format) {
  final name = title
      .replaceAll(RegExp(r'[^\p{L}\p{N} _-]+', unicode: true), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return '${name.isEmpty ? 'Highlights' : name}${format == HighlightFormat.vertical ? '-vertical' : ''}.mp4';
}

/// Hands a rendered video to the system share sheet (messages, stories, save to files). Behind a provider so tests
/// can catch it.
typedef HighlightVideoSharer = Future<void> Function(String fileName, Uint8List bytes);

final highlightVideoSharerProvider = Provider<HighlightVideoSharer>(
  (ref) => (fileName, bytes) async {
    final directory = await getTemporaryDirectory();
    final file = File('${directory.path}/$fileName');
    await file.writeAsBytes(bytes, flush: true);
    await Share.shareXFiles([XFile(file.path, mimeType: 'video/mp4')]);
  },
);

/// "Make a highlight video…" of an album, photos or a memory: its length, shape (landscape, or vertical 9:16 for
/// stories and messages), style, maps, captions and music; then its progress, and the video to share or open
@RoutePage()
class HighlightVideoPage extends ConsumerStatefulWidget {
  final String? albumId;
  final List<String> assetIds;
  final String? memoryId;
  final String? title;

  /// Vertical 9:16 at first, e.g. the vertical video of a memory
  final bool vertical;

  const HighlightVideoPage({
    super.key,
    this.albumId,
    this.assetIds = const [],
    this.memoryId,
    this.title,
    this.vertical = false,
  });

  @override
  ConsumerState<HighlightVideoPage> createState() => _HighlightVideoPageState();
}

class _HighlightVideoPageState extends ConsumerState<HighlightVideoPage> {
  late final TextEditingController _title = TextEditingController(text: widget.title ?? '');
  late HighlightOptions _options = HighlightOptions(
    format: widget.vertical ? HighlightFormat.vertical : HighlightFormat.landscape,
  );

  HighlightSource get _source => widget.albumId != null
      ? HighlightSource.album(widget.albumId!)
      : widget.memoryId != null
      ? HighlightSource.memory(widget.memoryId!)
      : HighlightSource.assets(widget.assetIds);

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  void _update(HighlightOptions options) => setState(() => _options = options);

  HighlightOptions _with({
    int? durationSeconds,
    HighlightFormat? format,
    HighlightStyle? style,
    bool? includeMaps,
    bool? captions,
    String? Function()? music,
  }) => HighlightOptions(
    title: _title.text,
    durationSeconds: durationSeconds ?? _options.durationSeconds,
    format: format ?? _options.format,
    style: style ?? _options.style,
    includeMaps: includeMaps ?? _options.includeMaps,
    captions: captions ?? _options.captions,
    music: music == null ? _options.music : music(),
  );

  Future<void> _make(HighlightController controller) async {
    final error = context.t.errors.unable_to_make_highlight_video;
    try {
      await controller.start(_with());
    } catch (_) {
      await ref.read(toastServiceProvider).error(error);
    }
  }

  Future<void> _cancel(HighlightController controller) async {
    final error = context.t.errors.unable_to_cancel_highlight_video;
    try {
      await controller.cancel();
      if (mounted) {
        await Navigator.of(context).maybePop();
      }
    } catch (_) {
      await ref.read(toastServiceProvider).error(error);
    }
  }

  Future<void> _share(HighlightController controller, HighlightJobResponseDto job, String assetId) async {
    final error = context.t.errors.unable_to_share_highlight_video;
    final sharer = ref.read(highlightVideoSharerProvider);
    controller.setSharing(true);
    try {
      final bytes = await ref.read(highlightApiRepositoryProvider).downloadVideo(assetId);
      await sharer(highlightFileName(job.title, job.format), bytes);
    } catch (_) {
      await ref.read(toastServiceProvider).error(error);
    } finally {
      if (mounted) {
        controller.setSharing(false);
      }
    }
  }

  String _styleLabel(HighlightStyle style) {
    if (style == HighlightStyle.auto) {
      return context.t.highlight_video_style_auto;
    }
    final preset = BookStylePreset.fromJson(style.toJson());
    return preset == null ? style.toString() : galleryTr(context, bookStylePresetLabelKeys(preset).name);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final provider = highlightProvider(_source);
    final state = ref.watch(provider);
    final controller = ref.read(provider.notifier);
    final navigator = ref.read(galleryNavigatorProvider);
    final job = state.job;
    final resultAssetId = state.resultAssetId;

    Widget section(String label, Widget child, {String? description}) => Padding(
      padding: const EdgeInsets.only(top: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 8,
        children: [
          Text(label, style: theme.textTheme.titleSmall),
          if (description != null) Text(description, style: muted),
          child,
        ],
      ),
    );

    Widget body;
    List<Widget> actions;
    if (job == null) {
      final music = state.music;
      body = ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Text(t.highlight_video_description, style: muted),
          const SizedBox(height: 16),
          TextField(
            key: const Key('highlight-title'),
            controller: _title,
            maxLength: 200,
            decoration: InputDecoration(labelText: t.highlight_video_title, border: const OutlineInputBorder()),
          ),
          section(
            t.highlight_video_length,
            Wrap(
              spacing: 8,
              children: [
                for (final seconds in highlightDurations)
                  ChoiceChip(
                    key: ValueKey('highlight-length-$seconds'),
                    selected: _options.durationSeconds == seconds,
                    onSelected: (_) => _update(_with(durationSeconds: seconds)),
                    label: Text(t.highlight_video_seconds(seconds: seconds)),
                  ),
              ],
            ),
          ),
          section(
            t.highlight_video_format,
            description: t.highlight_video_format_description,
            SegmentedButton<HighlightFormat>(
              key: const Key('highlight-format'),
              segments: [
                ButtonSegment(
                  value: HighlightFormat.landscape,
                  icon: const Icon(Icons.crop_landscape),
                  label: Text(t.highlight_video_format_landscape),
                ),
                ButtonSegment(
                  value: HighlightFormat.vertical,
                  icon: const Icon(Icons.crop_portrait),
                  label: Text(t.highlight_video_format_vertical),
                ),
              ],
              selected: {_options.format},
              onSelectionChanged: (selection) => _update(_with(format: selection.first)),
            ),
          ),
          section(
            t.highlight_video_style,
            description: t.highlight_video_style_description,
            DropdownButtonFormField<HighlightStyle>(
              key: const Key('highlight-style'),
              initialValue: _options.style,
              isExpanded: true,
              decoration: const InputDecoration(border: OutlineInputBorder()),
              items: [
                for (final style in [
                  HighlightStyle.auto,
                  ...bookStylePresetOrder.map((preset) => HighlightStyle.fromJson(preset.toJson())).nonNulls,
                ])
                  DropdownMenuItem(value: style, child: Text(_styleLabel(style))),
              ],
              onChanged: (style) => _update(_with(style: style)),
            ),
          ),
          const SizedBox(height: 8),
          SwitchListTile(
            key: const Key('highlight-maps'),
            contentPadding: EdgeInsets.zero,
            title: Text(t.highlight_video_maps),
            subtitle: Text(t.highlight_video_maps_description),
            value: _options.includeMaps,
            onChanged: (value) => _update(_with(includeMaps: value)),
          ),
          SwitchListTile(
            key: const Key('highlight-captions'),
            contentPadding: EdgeInsets.zero,
            title: Text(t.highlight_video_captions),
            subtitle: Text(t.highlight_video_captions_description),
            value: _options.captions,
            onChanged: (value) => _update(_with(captions: value)),
          ),
          section(
            t.highlight_video_music,
            DropdownButtonFormField<String?>(
              key: const Key('highlight-music'),
              initialValue: _options.music,
              isExpanded: true,
              decoration: const InputDecoration(border: OutlineInputBorder()),
              items: [
                DropdownMenuItem(value: null, child: Text(t.highlight_video_no_music)),
                for (final track in music ?? const <HighlightMusicResponseDto>[])
                  DropdownMenuItem(
                    value: track.id,
                    child: Text(_trackLabel(track), overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: music == null ? null : (value) => _update(_with(music: () => value)),
            ),
          ),
        ],
      );
      actions = [
        FilledButton.icon(
          key: const Key('highlight-create'),
          onPressed: state.starting ? null : () => unawaited(_make(controller)),
          icon: state.starting
              ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.movie_creation_outlined),
          label: Text(t.highlight_video_create),
        ),
      ];
    } else if (resultAssetId != null) {
      body = _Status(
        icon: Icons.movie_outlined,
        title: t.highlight_video_ready,
        subtitle: job.title,
        notes: job.warnings,
      );
      actions = [
        OutlinedButton.icon(
          key: const Key('highlight-open'),
          onPressed: () async {
            await Navigator.of(context).maybePop();
            await navigator.openAssets([resultAssetId]);
          },
          icon: const Icon(Icons.play_circle_outline),
          label: Text(t.open),
        ),
        FilledButton.icon(
          key: const Key('highlight-share'),
          onPressed: state.sharing ? null : () => unawaited(_share(controller, job, resultAssetId)),
          icon: state.sharing
              ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.share),
          label: Text(t.share),
        ),
      ];
    } else if (job.status == HighlightJobStatus.failed || job.status == HighlightJobStatus.cancelled) {
      body = _Status(
        icon: Icons.error_outline,
        title: t.highlight_video_failed,
        subtitle: job.error ?? job.title,
        error: true,
      );
      actions = [OutlinedButton(onPressed: () => unawaited(Navigator.of(context).maybePop()), child: Text(t.close))];
    } else {
      final pending = job.status == HighlightJobStatus.pending;
      final preparing = job.status == HighlightJobStatus.completed;
      body = _Status(
        icon: Icons.movie_creation_outlined,
        title: job.title,
        subtitle: pending
            ? t.highlight_video_waiting
            : preparing
            ? t.highlight_video_preparing
            : t.highlight_video_progress(percent: (job.progress * 100).round()),
        progress: pending ? 0 : job.progress,
        label: t.highlight_video_rendering(title: job.title),
      );
      actions = [
        OutlinedButton(
          key: const Key('highlight-cancel'),
          onPressed: () => unawaited(_cancel(controller)),
          child: Text(t.cancel),
        ),
      ];
    }

    return Scaffold(
      appBar: AppBar(title: Text(t.highlight_video_make)),
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

/// "My trip (2:41)"
String _trackLabel(HighlightMusicResponseDto track) {
  final duration = track.durationSeconds;
  if (duration == null) {
    return track.name;
  }
  final seconds = duration.round();
  return '${track.name} (${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')})';
}

class _Status extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final double? progress;
  final String? label;
  final List<String> notes;
  final bool error;

  const _Status({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.progress,
    this.label,
    this.notes = const [],
    this.error = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          spacing: 12,
          children: [
            Icon(icon, size: 56, color: error ? theme.colorScheme.error : theme.colorScheme.primary),
            Text(title, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
            if (progress != null)
              Semantics(
                label: label,
                child: LinearProgressIndicator(key: const Key('highlight-progress'), value: progress),
              ),
            Text(subtitle, textAlign: TextAlign.center),
            for (final note in notes) Text(note, style: muted, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}
