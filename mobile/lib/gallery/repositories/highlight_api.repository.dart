import 'dart:typed_data';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' show MultipartFile;
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

/// The highlight videos (`/highlights`): a short film of an album, photos or a memory, rendered on the server and saved
/// as a new video
class HighlightApiRepository extends ApiRepository {
  final ApiService _apiService;

  HighlightApiRepository(this._apiService);

  // Resolved on each call: ApiService.setEndpoint() swaps the API client on login
  HighlightsApi get _api => HighlightsApi(_apiService.serverInfoApi.apiClient);

  AssetsApi get _assets => AssetsApi(_apiService.serverInfoApi.apiClient);

  /// The audio files the user uploaded for their videos
  Future<List<HighlightMusicResponseDto>> getMusic() => checkNull(_api.getHighlightMusic());

  /// Uploads an audio file (MP3, M4A, AAC, WAV, FLAC, OGG or Opus, up to 100 MB) as music for the videos; the same
  /// file uploaded twice answers the first upload
  Future<HighlightMusicResponseDto> uploadMusic(String path, {required String filename}) async =>
      checkNull(_api.uploadHighlightMusic(file: await MultipartFile.fromPath('file', path, filename: filename)));

  /// Starts a video; its progress comes over the websocket (`on_highlight_update`)
  Future<HighlightJobResponseDto> create(HighlightCreateDto dto) => checkNull(_api.createHighlight(dto));

  Future<HighlightJobResponseDto> get(String id) => checkNull(_api.getHighlight(id));

  Future<HighlightJobResponseDto> cancel(String id) => checkNull(_api.cancelHighlight(id));

  /// The rendered video, to share
  Future<Uint8List> downloadVideo(String assetId) async {
    final response = await _assets.downloadAssetWithHttpInfo(assetId);
    if (response.statusCode >= 400) {
      throw ApiException(response.statusCode, response.body);
    }
    return response.bodyBytes;
  }
}

final highlightApiRepositoryProvider = Provider<HighlightApiRepository>(
  (ref) => HighlightApiRepository(ref.watch(apiServiceProvider)),
);
