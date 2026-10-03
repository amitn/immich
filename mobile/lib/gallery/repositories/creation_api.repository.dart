import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

/// What the server makes of a photo as a new photo, stacked with it: an artwork in an artistic style (`/art/*`, with
/// the art agent) and an enhanced copy (`/assets/{id}/enhance`, local image processing)
class CreationApiRepository extends ApiRepository {
  final ApiService _apiService;

  CreationApiRepository(this._apiService);

  // Resolved on each call: ApiService.setEndpoint() swaps the API client on login
  AssistantApi get _art => AssistantApi(_apiService.serverInfoApi.apiClient);

  AssetsApi get _assets => AssetsApi(_apiService.serverInfoApi.apiClient);

  /// The built-in styles first, then the user's own (`owned`)
  Future<List<ArtStyleDto>> getArtStyles() => checkNull(_art.getArtStyles());

  Future<void> deleteArtStyle(String id) => _art.deleteArtUserStyle(id);

  /// Starts an artwork of a photo; its progress comes over the websocket (`on_art_job_update`)
  Future<ArtJobResponseDto> createArtJob({required String assetId, String? style, String? prompt, String? caption}) =>
      checkNull(
        _art.createArtJob(
          ArtJobCreateDto(
            assetId: assetId,
            style: style == null ? const Optional.absent() : Optional.present(style),
            prompt: prompt == null ? const Optional.absent() : Optional.present(prompt),
            caption: caption == null ? const Optional.absent() : Optional.present(caption),
          ),
        ),
      );

  Future<ArtJobResponseDto> getArtJob(String id) => checkNull(_art.getArtJob(id));

  /// What enhancing a photo at [strength] would correct
  Future<EnhanceAnalysisResponseDto> analyzeEnhancement(String assetId, EnhanceStrength strength) =>
      checkNull(_assets.analyzeEnhancement(assetId, EnhancePreviewDto(strength: Optional.present(strength))));

  /// Saves the enhanced copy of a photo, stacked with it; the photo itself is not changed
  Future<EnhanceResponseDto> enhance(String assetId, EnhanceStrength strength) =>
      checkNull(_assets.enhanceAsset(assetId, EnhanceDto(strength: Optional.present(strength))));
}

final creationApiRepositoryProvider = Provider<CreationApiRepository>(
  (ref) => CreationApiRepository(ref.watch(apiServiceProvider)),
);
