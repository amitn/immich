import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/repositories/creation_api.repository.dart';
import 'package:openapi/api.dart';

/// The phase of the artistic style page, like the web's dialog
enum ArtPhase { select, running, done, failed }

ArtPhase artPhaseOf(ArtJobResponseDto? job) => switch (job) {
  null => ArtPhase.select,
  ArtJobResponseDto(status: ArtJobStatus.completed, :final resultAssetId) when resultAssetId != null => ArtPhase.done,
  ArtJobResponseDto(status: ArtJobStatus.completed || ArtJobStatus.failed) => ArtPhase.failed,
  _ => ArtPhase.running,
};

class ArtState {
  /// null while they load
  final List<ArtStyleDto>? styles;

  /// The style chosen; null for a custom prompt
  final String? style;
  final ArtJobResponseDto? job;
  final DateTime? startedAt;
  final bool starting;

  const ArtState({this.styles, this.style, this.job, this.startedAt, this.starting = false});

  ArtState copyWith({
    List<ArtStyleDto>? styles,
    String? Function()? style,
    ArtJobResponseDto? Function()? job,
    DateTime? Function()? startedAt,
    bool? starting,
  }) => ArtState(
    styles: styles ?? this.styles,
    style: style == null ? this.style : style(),
    job: job == null ? this.job : job(),
    startedAt: startedAt == null ? this.startedAt : startedAt(),
    starting: starting ?? this.starting,
  );

  ArtPhase get phase => artPhaseOf(job);

  ArtStyleDto? get selected => styles?.where((style) => style.id == this.style).firstOrNull;
}

/// An artwork of a photo: the styles to choose from, then the job, followed over the websocket and, should an update
/// be missed, by asking the server every few seconds
class ArtController extends StateNotifier<ArtState> {
  static const pollInterval = Duration(seconds: 5);

  final CreationApiRepository _repository;
  final String assetId;
  StreamSubscription<ArtJobResponseDto>? _updates;
  Timer? _poll;

  ArtController(this._repository, GalleryEventBus bus, this.assetId) : super(const ArtState()) {
    _updates = bus.artJobs.listen((update) {
      if (update.id == state.job?.id) {
        _apply(update);
      }
    });
    unawaited(loadStyles());
  }

  @override
  void dispose() {
    unawaited(_updates?.cancel());
    _poll?.cancel();
    super.dispose();
  }

  /// The first style is chosen, or a custom prompt when there are none
  Future<void> loadStyles() async {
    try {
      final styles = await _repository.getArtStyles();
      if (mounted) {
        state = state.copyWith(styles: styles, style: () => styles.firstOrNull?.id);
      }
    } catch (_) {
      if (mounted) {
        state = state.copyWith(styles: const [], style: () => null);
      }
    }
  }

  /// A style, or null for a custom prompt
  void choose(String? style) => state = state.copyWith(style: () => style);

  /// Deletes one of the user's own styles; the artworks made with it stay
  Future<void> deleteStyle(ArtStyleDto style) async {
    await _repository.deleteArtStyle(style.id);
    if (!mounted) {
      return;
    }
    final styles = [...?state.styles]..removeWhere((other) => other.id == style.id);
    state = state.copyWith(styles: styles, style: state.style == style.id ? () => styles.firstOrNull?.id : null);
  }

  Future<void> start({String prompt = '', String caption = ''}) async {
    final style = state.selected;
    final trimmedPrompt = prompt.trim();
    final trimmedCaption = caption.trim();
    state = state.copyWith(starting: true);
    try {
      final job = await _repository.createArtJob(
        assetId: assetId,
        style: style?.id,
        prompt: trimmedPrompt.isEmpty ? null : trimmedPrompt,
        caption: style != null && style.usesCaption && trimmedCaption.isNotEmpty ? trimmedCaption : null,
      );
      if (!mounted) {
        return;
      }
      state = state.copyWith(starting: false, startedAt: () => DateTime.now());
      _apply(job);
    } catch (_) {
      if (mounted) {
        state = state.copyWith(starting: false);
      }
      rethrow;
    }
  }

  void _apply(ArtJobResponseDto job) {
    state = state.copyWith(job: () => job);
    if (state.phase == ArtPhase.running) {
      _poll ??= Timer.periodic(pollInterval, (_) => unawaited(_refresh()));
    } else {
      _poll?.cancel();
      _poll = null;
    }
  }

  Future<void> _refresh() async {
    final id = state.job?.id;
    if (id == null) {
      return;
    }
    try {
      final job = await _repository.getArtJob(id);
      if (mounted && state.job?.id == id) {
        _apply(job);
      }
    } catch (_) {
      // the next poll, or the websocket, brings it
    }
  }

  /// Back to the styles, for another artwork
  void again() {
    _poll?.cancel();
    _poll = null;
    state = state.copyWith(job: () => null, startedAt: () => null);
  }
}

final artProvider = StateNotifierProvider.autoDispose.family<ArtController, ArtState, String>(
  (ref, assetId) =>
      ArtController(ref.watch(creationApiRepositoryProvider), ref.watch(galleryEventBusProvider), assetId),
);
