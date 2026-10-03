import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/repositories/highlight_api.repository.dart';
import 'package:openapi/api.dart';

/// What a highlight video is made of: exactly one of an album, photos or a memory
class HighlightSource {
  final String? albumId;
  final List<String> assetIds;
  final String? memoryId;

  const HighlightSource.album(String this.albumId) : assetIds = const [], memoryId = null;

  const HighlightSource.assets(this.assetIds) : albumId = null, memoryId = null;

  const HighlightSource.memory(String this.memoryId) : albumId = null, assetIds = const [];

  @override
  bool operator ==(Object other) =>
      other is HighlightSource &&
      other.albumId == albumId &&
      other.memoryId == memoryId &&
      other.assetIds.join(',') == assetIds.join(',');

  @override
  int get hashCode => Object.hash(albumId, memoryId, assetIds.join(','));
}

/// The lengths of the form, in seconds, like the web's
const highlightDurations = [30, 60, 90, 120];

/// The options of a highlight video
class HighlightOptions {
  final String title;
  final int durationSeconds;
  final HighlightFormat format;
  final HighlightStyle style;
  final bool includeMaps;
  final bool captions;

  /// An audio file of the user's; none keeps the video silent
  final String? music;

  const HighlightOptions({
    this.title = '',
    this.durationSeconds = 60,
    this.format = HighlightFormat.landscape,
    this.style = HighlightStyle.auto,
    this.includeMaps = true,
    this.captions = true,
    this.music,
  });

  /// The request: the source, and only the options the server needs (the generated client would send an empty list
  /// of photos otherwise, which is a second source)
  HighlightCreateDto toDto(HighlightSource source) {
    final title = this.title.trim();
    return HighlightCreateDto(
      albumId: source.albumId == null ? const Optional.absent() : Optional.present(source.albumId),
      assetIds: source.assetIds.isEmpty ? const Optional.absent() : Optional.present(source.assetIds),
      memoryId: source.memoryId == null ? const Optional.absent() : Optional.present(source.memoryId),
      title: title.isEmpty ? const Optional.absent() : Optional.present(title),
      durationSeconds: Optional.present(durationSeconds),
      format: Optional.present(format),
      style: Optional.present(style),
      includeMaps: Optional.present(includeMaps),
      captions: Optional.present(captions),
      music: music == null ? const Optional.absent() : Optional.present(music),
    );
  }
}

class HighlightState {
  /// The user's audio files; null while they load
  final List<HighlightMusicResponseDto>? music;
  final HighlightJobResponseDto? job;
  final bool starting;
  final bool sharing;

  const HighlightState({this.music, this.job, this.starting = false, this.sharing = false});

  HighlightState copyWith({
    List<HighlightMusicResponseDto>? music,
    HighlightJobResponseDto? Function()? job,
    bool? starting,
    bool? sharing,
  }) => HighlightState(
    music: music ?? this.music,
    job: job == null ? this.job : job(),
    starting: starting ?? this.starting,
    sharing: sharing ?? this.sharing,
  );

  /// The video is rendered
  String? get resultAssetId => job?.status == HighlightJobStatus.completed ? job?.resultAssetId : null;

  bool get running =>
      job != null &&
      (job!.status == HighlightJobStatus.pending ||
          job!.status == HighlightJobStatus.running ||
          (job!.status == HighlightJobStatus.completed && job!.resultAssetId == null));
}

/// A highlight video being made: the form, then its progress, followed over the websocket and, should an update be
/// missed, by asking the server every few seconds
class HighlightController extends StateNotifier<HighlightState> {
  static const pollInterval = Duration(seconds: 3);

  final HighlightApiRepository _repository;
  final HighlightSource source;
  StreamSubscription<HighlightJobResponseDto>? _updates;
  Timer? _poll;

  HighlightController(this._repository, GalleryEventBus bus, this.source) : super(const HighlightState()) {
    _updates = bus.highlights.listen((update) {
      if (update.id == state.job?.id) {
        _apply(update);
      }
    });
    unawaited(_loadMusic());
  }

  @override
  void dispose() {
    unawaited(_updates?.cancel());
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _loadMusic() async {
    try {
      final music = await _repository.getMusic();
      if (mounted) {
        state = state.copyWith(music: music);
      }
    } catch (_) {
      // a silent video can still be made
      if (mounted) {
        state = state.copyWith(music: const []);
      }
    }
  }

  Future<void> start(HighlightOptions options) async {
    state = state.copyWith(starting: true);
    try {
      final job = await _repository.create(options.toDto(source));
      if (mounted) {
        state = state.copyWith(starting: false);
        _apply(job);
      }
    } catch (_) {
      if (mounted) {
        state = state.copyWith(starting: false);
      }
      rethrow;
    }
  }

  Future<void> cancel() async {
    final id = state.job?.id;
    if (id == null) {
      return;
    }
    final job = await _repository.cancel(id);
    if (mounted) {
      _apply(job);
    }
  }

  void _apply(HighlightJobResponseDto job) {
    state = state.copyWith(job: () => job);
    if (state.running) {
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
      final job = await _repository.get(id);
      if (mounted && state.job?.id == id) {
        _apply(job);
      }
    } catch (_) {
      // the next poll, or the websocket, brings it
    }
  }

  void setSharing(bool sharing) => state = state.copyWith(sharing: sharing);
}

final highlightProvider = StateNotifierProvider.autoDispose
    .family<HighlightController, HighlightState, HighlightSource>(
      (ref, source) =>
          HighlightController(ref.watch(highlightApiRepositoryProvider), ref.watch(galleryEventBusProvider), source),
    );
