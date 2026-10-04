import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:immich_mobile/gallery/presentation/pages/assistant.page.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/repositories/assistant_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../widget_tester_extensions.dart';
import '../assistant_fixtures.dart';
import '../gallery_test_helpers.dart';

/// The app's API service, pointed at the fake server
class _FakeApiService extends Mock implements ApiService {
  @override
  late ServerApi serverInfoApi;

  _FakeApiService(http.Client client) {
    serverInfoApi = ServerApi(ApiClient(basePath: 'http://gallery.test/api')..client = client);
  }
}

/// A fake Gallery server for the assistant: the REST endpoints of the chats (over a mocked HTTP client) and the
/// websocket events a real agent run sends back (`on_agent_update`), in the order the server sends them. The app's
/// real repository, provider, socket handlers and page run against it.
class _FakeAssistantServer {
  static const sessionId = 'session-1';

  final requests = <String>[];

  /// The changes asked of the server (the chat list is also reloaded when a turn ends)
  Iterable<String> get posts => requests.where((request) => request.startsWith('POST '));
  final _handlers = <String, dynamic Function(dynamic)>{};
  final _messages = <Map<String, Object?>>[];
  String? _title;
  bool _autoApprove = false;
  String _status = 'idle';

  late final client = MockClient(_handle);

  /// The socket's `on`, for `registerGallerySocketHandlers`
  Object? on(String event, dynamic Function(dynamic data) handler) => _handlers[event] = handler;

  Map<String, Object?> _session() => {
    'id': sessionId,
    'title': _title,
    'profile': 'claude',
    'status': _status,
    'autoApprove': _autoApprove,
    'createdAt': '2026-09-01T09:00:00.000Z',
    'updatedAt': '2026-09-01T10:00:00.000Z',
  };

  /// Sends an agent update over the websocket, decoded like socket.io delivers it
  void _push(String status, Map<String, Object?> message) {
    _status = status;
    _messages.removeWhere((other) => other['id'] == message['id']);
    _messages.add(message);
    _handlers[GalleryServerEvent.agentUpdate]?.call(
      jsonDecode(jsonEncode({'sessionId': sessionId, 'status': status, 'message': message})),
    );
  }

  /// The agent's turn after a prompt: it searches, then asks to create an album
  void _runUntilPermission(String text) {
    _push('running', messageJson('u1', role: 'user', content: {'text': text}));
    _push(
      'running',
      messageJson(
        't1',
        kind: 'tool_call',
        content: {
          'toolName': 'mcp__immich__search',
          'title': 'Search photos',
          'status': 'completed',
          'assetIds': [photoA, photoB],
          'input': {'query': 'beach'},
        },
      ),
    );
    _push('running', messageJson('p1', kind: 'permission', content: permissionContent()));
  }

  /// The rest of the turn once the user answered
  void _finish({required bool approved}) {
    _push(
      'running',
      messageJson(
        'p1',
        kind: 'permission',
        content: permissionContent(status: approved ? 'approved' : 'denied'),
      ),
    );
    if (approved) {
      _push(
        'running',
        messageJson(
          't2',
          kind: 'tool_call',
          content: {
            'toolName': 'mcp__immich__create_album',
            'title': 'Create album',
            'status': 'completed',
            'assetIds': [photoA, photoB],
            'input': {'name': 'Beach'},
          },
        ),
      );
    }
    _push(
      'idle',
      messageJson(
        'a1',
        content: {'text': approved ? 'I created the album **Beach** with 2 photos.' : 'OK, I did not create it.'},
      ),
    );
  }

  Future<http.Response> _handle(http.Request request) async {
    final path = request.url.path.replaceFirst('/api', '');
    requests.add('${request.method} $path${request.body.isEmpty ? '' : ' ${request.body}'}');
    http.Response json(Object? body, [int status = 200]) =>
        http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

    switch ((request.method, path)) {
      case ('GET', '/agent/sessions'):
        return json(_title == null ? <Object?>[] : [_session()]);
      case ('POST', '/agent/sessions'):
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        _title = body['title'] as String?;
        _autoApprove = body['autoApprove'] == true;
        return json(_session(), 201);
      case ('GET', '/agent/sessions/$sessionId'):
        return json({..._session(), 'messages': _messages});
      case ('POST', '/agent/sessions/$sessionId/prompt'):
        final text = (jsonDecode(request.body) as Map<String, dynamic>)['text'] as String;
        // the reply streams over the websocket after the request is accepted
        scheduleMicrotask(() => _runUntilPermission(text));
        return http.Response('', 204);
      case ('POST', '/agent/sessions/$sessionId/permissions/request-1'):
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        final approved = body['approved'] == true;
        if (body['optionId'] == 'allow_always') {
          _autoApprove = true;
        }
        scheduleMicrotask(() => _finish(approved: approved));
        return http.Response('', 204);
      default:
        return json({'message': 'Not found'}, 404);
    }
  }
}

void main() {
  late _FakeAssistantServer server;
  late GalleryEventBus bus;
  late FakeGalleryNavigator navigator;

  setUp(() {
    server = _FakeAssistantServer();
    bus = GalleryEventBus();
    navigator = FakeGalleryNavigator();
    registerGallerySocketHandlers(server.on, bus, onNewAsset: () {});
  });

  tearDown(() => bus.dispose());

  Future<void> pumpAssistant(WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpConsumerWidgetRaw(
      const AssistantPage(),
      overrides: [
        ...galleryOverrides(navigator: navigator),
        assistantApiRepositoryProvider.overrideWithValue(AssistantApiRepository(_FakeApiService(server.client))),
        galleryEventBusProvider.overrideWithValue(bus),
      ],
    );
    await settle(tester);
  }

  Future<void> send(WidgetTester tester, String text) async {
    await tester.enterText(find.byKey(const Key('assistant-input')), text);
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-send')));
    await settle(tester);
  }

  testWidgets('a chat runs to a permission request; Allow applies it and the agent finishes', (tester) async {
    await pumpAssistant(tester);
    await send(tester, 'Make a beach album');

    expect(server.requests, [
      'GET /agent/sessions',
      'POST /agent/sessions {"autoApprove":false,"title":"Make a beach album"}',
      'POST /agent/sessions/session-1/prompt {"text":"Make a beach album"}',
    ]);
    // the streamed turn: the search with its photos, then the request
    expect(find.text('Search photos'), findsOneWidget);
    expect(find.byKey(const ValueKey('assistant-asset-$photoA')), findsWidgets);
    expect(find.text('Permission needed'), findsOneWidget);
    expect(find.text('Create the album "Beach" with 2 photos'), findsOneWidget);
    expect(find.byKey(const Key('assistant-stop')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('assistant-permission-allow')));
    await settle(tester);

    expect(
      server.posts.last,
      'POST /agent/sessions/session-1/permissions/request-1 {"approved":true,"optionId":"allow"}',
    );
    expect(find.text('Approved'), findsOneWidget);
    expect(find.text('Create album'), findsOneWidget);
    expect(find.textContaining('I created the album Beach with 2 photos.'), findsOneWidget);
    expect(find.byKey(const Key('assistant-stop')), findsNothing);
    expect(find.byKey(const Key('assistant-send')), findsOneWidget);
  });

  testWidgets('Allow all in this chat turns on auto-approve for the chat', (tester) async {
    await pumpAssistant(tester);
    await send(tester, 'Make a beach album');

    await tester.tap(find.byKey(const ValueKey('assistant-permission-allowAll')));
    await settle(tester);

    expect(
      server.posts.last,
      'POST /agent/sessions/session-1/permissions/request-1 {"approved":true,"optionId":"allow_always"}',
    );
    expect(find.byKey(const Key('assistant-auto-approve-on')), findsOneWidget);
    expect(find.textContaining('I created the album Beach'), findsOneWidget);
  });

  testWidgets('Deny refuses the change, and the agent goes on without it', (tester) async {
    await pumpAssistant(tester);
    await send(tester, 'Make a beach album');

    await tester.tap(find.byKey(const ValueKey('assistant-permission-deny')));
    await settle(tester);

    expect(
      server.posts.last,
      'POST /agent/sessions/session-1/permissions/request-1 {"approved":false,"optionId":"deny"}',
    );
    expect(find.text('Denied'), findsOneWidget);
    expect(find.text('Create album'), findsNothing);
    expect(find.textContaining('OK, I did not create it.'), findsOneWidget);
  });
}

/// Lets requests, socket events and animations finish: the generated client decodes responses off the test's fake
/// clock, so real time passes between the frames (pumpAndSettle never settles beside a spinner)
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}
