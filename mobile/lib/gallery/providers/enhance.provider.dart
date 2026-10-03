import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/repositories/creation_api.repository.dart';
import 'package:openapi/api.dart';

class EnhanceState {
  final EnhanceStrength strength;

  /// What enhancing at [strength] corrects; null while it is analyzed
  final EnhanceAnalysisResponseDto? analysis;
  final bool analyzing;

  /// The analysis failed
  final bool failed;
  final bool saving;

  /// The enhanced copy, once saved
  final EnhanceResponseDto? result;

  const EnhanceState({
    this.strength = EnhanceStrength.normal,
    this.analysis,
    this.analyzing = true,
    this.failed = false,
    this.saving = false,
    this.result,
  });

  EnhanceState copyWith({
    EnhanceStrength? strength,
    EnhanceAnalysisResponseDto? Function()? analysis,
    bool? analyzing,
    bool? failed,
    bool? saving,
    EnhanceResponseDto? result,
  }) => EnhanceState(
    strength: strength ?? this.strength,
    analysis: analysis == null ? this.analysis : analysis(),
    analyzing: analyzing ?? this.analyzing,
    failed: failed ?? this.failed,
    saving: saving ?? this.saving,
    result: result ?? this.result,
  );

  bool get canSave => !analyzing && !saving && result == null && (analysis?.needed ?? false);
}

/// Auto enhance of a photo of the user's: analyzed at a strength (the server renders the photo before and after side
/// by side), then saved as an enhanced copy stacked with it
class EnhanceController extends StateNotifier<EnhanceState> {
  final CreationApiRepository _repository;
  final String assetId;

  /// The analysis of the latest strength wins over one that comes back late
  var _request = 0;

  EnhanceController(this._repository, this.assetId) : super(const EnhanceState()) {
    unawaited(analyze(EnhanceStrength.normal));
  }

  Future<void> analyze(EnhanceStrength strength) async {
    final request = ++_request;
    state = state.copyWith(strength: strength, analyzing: true, failed: false);
    try {
      final analysis = await _repository.analyzeEnhancement(assetId, strength);
      if (mounted && request == _request) {
        state = state.copyWith(analysis: () => analysis, analyzing: false);
      }
    } catch (_) {
      if (mounted && request == _request) {
        state = state.copyWith(analyzing: false, failed: true);
      }
    }
  }

  /// Saves the enhanced copy; throws when the server cannot
  Future<EnhanceResponseDto?> save() async {
    if (!state.canSave) {
      return null;
    }
    state = state.copyWith(saving: true);
    try {
      final result = await _repository.enhance(assetId, state.strength);
      if (mounted) {
        state = state.copyWith(saving: false, result: result);
      }
      return result;
    } catch (_) {
      if (mounted) {
        state = state.copyWith(saving: false);
      }
      rethrow;
    }
  }
}

final enhanceProvider = StateNotifierProvider.autoDispose.family<EnhanceController, EnhanceState, String>(
  (ref, assetId) => EnhanceController(ref.watch(creationApiRepositoryProvider), assetId),
);
