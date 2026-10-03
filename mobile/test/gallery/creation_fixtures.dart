import 'package:openapi/api.dart';

ArtStyleDto artStyle(String id, String name, {bool owned = false, bool usesCaption = false}) => ArtStyleDto.fromJson({
  'id': id,
  'name': name,
  'description': '$name description',
  'usesCaption': usesCaption,
  'photoAbove': false,
  'owned': owned,
})!;

Map<String, Object?> artJobJson(
  String id, {
  String status = 'pending',
  String? resultAssetId,
  String? error,
  String? style = 'watercolor',
}) => {
  'id': id,
  'sourceAssetId': 'photo-1',
  'resultAssetId': resultAssetId,
  'style': style,
  'caption': null,
  'status': status,
  'error': error,
  'createdAt': '2026-10-03T10:00:00.000Z',
  'updatedAt': '2026-10-03T10:00:00.000Z',
};

ArtJobResponseDto artJob(String id, {String status = 'pending', String? resultAssetId, String? error}) =>
    ArtJobResponseDto.fromJson(artJobJson(id, status: status, resultAssetId: resultAssetId, error: error))!;

EnhanceAnalysisResponseDto enhanceAnalysis({bool needed = true, String strength = 'normal'}) =>
    EnhanceAnalysisResponseDto.fromJson({
      'assetId': 'photo-1',
      'strength': strength,
      'needed': needed,
      'adjustments': needed ? ['levels'] : <String>[],
      'corrections': [
        if (needed)
          {'type': 'levels', 'amount': 0.4, 'description': 'Stretched the levels', 'reason': 'The photo is flat'},
      ],
      'notes': <String>[],
      'plan': <String, Object?>{},
    })!;

Map<String, Object?> highlightJson(
  String id, {
  String status = 'pending',
  double progress = 0,
  String? resultAssetId,
  String format = 'landscape',
  String title = 'Sicily',
  String? error,
}) => {
  'id': id,
  'title': title,
  'status': status,
  'progress': progress,
  'albumId': 'album-1',
  'bookId': null,
  'memoryId': null,
  'durationSeconds': 60,
  'format': format,
  'resultAssetId': resultAssetId,
  'error': error,
  'warnings': <String>[],
  'createdAt': '2026-10-03T10:00:00.000Z',
  'updatedAt': '2026-10-03T10:00:00.000Z',
};

HighlightJobResponseDto highlightJob(
  String id, {
  String status = 'pending',
  double progress = 0,
  String? resultAssetId,
  String format = 'landscape',
}) => HighlightJobResponseDto.fromJson(
  highlightJson(id, status: status, progress: progress, resultAssetId: resultAssetId, format: format),
)!;
