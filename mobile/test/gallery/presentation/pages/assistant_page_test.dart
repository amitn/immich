import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/presentation/pages/assistant.page.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/repositories/assistant_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';
import '../../assistant_fixtures.dart';
import '../../gallery_test_helpers.dart';

class _MockAssistantApiRepository extends Mock implements AssistantApiRepository {}

void main() {
  late _MockAssistantApiRepository repository;
  late GalleryEventBus bus;
  late FakeGalleryNavigator navigator;
  late FakeToastService toast;

  setUp(() {
    repository = _MockAssistantApiRepository();
    bus = GalleryEventBus();
    navigator = FakeGalleryNavigator();
    toast = FakeToastService();
    when(() => repository.getSessions()).thenAnswer((_) async => []);
    when(() => repository.prompt(any(), any(), assetIds: any(named: 'assetIds'))).thenAnswer((_) async {});
  });

  tearDown(() => bus.dispose());

  Future<void> pumpPage(
    WidgetTester tester, {
    String? sessionId,
    List<String> assetIds = const [],
    String? prompt,
    GalleryFeatures features = const GalleryFeatures(assistant: true),
  }) async {
    await tester.pumpConsumerWidgetRaw(
      AssistantPage(sessionId: sessionId, assetIds: assetIds, prompt: prompt),
      overrides: [
        ...galleryOverrides(features: features, navigator: navigator, toast: toast),
        assistantApiRepositoryProvider.overrideWithValue(repository),
        galleryEventBusProvider.overrideWithValue(bus),
      ],
    );
    await tester.pump();
    await tester.pump();
  }

  /// Lets drawers, menus and dialogs finish animating; pumpAndSettle never settles beside a spinner
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
  }

  Future<void> emit(WidgetTester tester, AgentUpdateDto update) async {
    // the shape the websocket delivers: decoded JSON
    bus.addAgentUpdate(jsonDecode(jsonEncode(update)));
    await tester.pump();
  }

  testWidgets('is hidden on a server without the assistant', (tester) async {
    await pumpPage(tester, features: const GalleryFeatures());

    expect(find.text('The assistant is not enabled'), findsOneWidget);
    expect(find.byKey(const Key('assistant-input')), findsNothing);
    verifyNever(() => repository.getSessions());
  });

  testWidgets('sends the first message of a new chat and shows the streamed reply as markdown', (tester) async {
    when(
      () => repository.createSession(
        title: any(named: 'title'),
        autoApprove: any(named: 'autoApprove'),
      ),
    ).thenAnswer((_) async => session('session-1', title: 'Find our best beach photos'));
    await pumpPage(tester);

    expect(find.text('How can I help with your photos?'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('assistant-input')), 'Find our best beach photos');
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-send')));
    await tester.pump();
    await tester.pump();

    verify(() => repository.createSession(title: 'Find our best beach photos', autoApprove: false)).called(1);
    verify(() => repository.prompt('session-1', 'Find our best beach photos', assetIds: [])).called(1);
    expect(find.text('Find our best beach photos'), findsWidgets);
    expect(find.text('Working…'), findsOneWidget);
    expect(find.byKey(const Key('assistant-stop')), findsOneWidget);

    await emit(
      tester,
      update(
        'session-1',
        'running',
        message: messageJson('m1', role: 'user', content: {'text': 'Find our best beach photos'}),
      ),
    );
    await emit(tester, update('session-1', 'running', message: messageJson('m2', content: {'text': 'Searching'})));
    expect(find.text('Searching'), findsOneWidget);

    await emit(
      tester,
      update(
        'session-1',
        'idle',
        message: messageJson('m2', content: {'text': 'I found **2** beach photos:\n- $photoA\n- $photoB'}),
      ),
    );

    expect(find.text('Searching'), findsNothing);
    expect(find.textContaining('I found 2 beach photos'), findsOneWidget);
    // the ids of the chat's photos are not chips until the chat has them; plain ids stay text
    expect(find.textContaining(photoA), findsOneWidget);
    expect(find.text('Working…'), findsNothing);
    expect(find.byKey(const Key('assistant-stop')), findsNothing);
    expect(find.byKey(const Key('assistant-send')), findsOneWidget);
  });

  testWidgets('a failed message comes back to the box', (tester) async {
    when(
      () => repository.createSession(
        title: any(named: 'title'),
        autoApprove: any(named: 'autoApprove'),
      ),
    ).thenAnswer((_) async => session('session-1'));
    when(() => repository.prompt(any(), any(), assetIds: any(named: 'assetIds'))).thenThrow(ApiException(500, 'boom'));
    await pumpPage(tester);

    await tester.enterText(find.byKey(const Key('assistant-input')), 'Hello');
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-send')));
    await tester.pump();
    await tester.pump();

    expect(toast.errors, ['Unable to send the message']);
    expect(tester.widget<TextField>(find.byKey(const Key('assistant-input'))).controller!.text, 'Hello');
  });

  testWidgets('"Ask assistant" attaches the selected photos to the first message', (tester) async {
    when(
      () => repository.createSession(
        title: any(named: 'title'),
        autoApprove: any(named: 'autoApprove'),
      ),
    ).thenAnswer((_) async => session('session-1'));
    await pumpPage(tester, assetIds: [photoA, photoB, photoA]);

    expect(find.byKey(const ValueKey('assistant-asset-$photoA')), findsOneWidget);
    expect(find.byKey(const ValueKey('assistant-asset-$photoB')), findsOneWidget);
    expect(
      find.text('The selected photos are attached to your next message. Tell the assistant what to do with them.'),
      findsOneWidget,
    );

    // removing one leaves the other
    await tester.tap(find.byIcon(Icons.close).last);
    await tester.pump();
    expect(find.byKey(const ValueKey('assistant-asset-$photoB')), findsNothing);

    await tester.enterText(find.byKey(const Key('assistant-input')), 'Make an album of these');
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-send')));
    await tester.pump();
    await tester.pump();

    verify(() => repository.prompt('session-1', 'Make an album of these', assetIds: [photoA])).called(1);
  });

  testWidgets('"Create with assistant" starts from a prompt to edit', (tester) async {
    await pumpPage(tester, prompt: 'Create an album of my best photos.');

    expect(
      tester.widget<TextField>(find.byKey(const Key('assistant-input'))).controller!.text,
      'Create an album of my best photos.',
    );
    verifyNever(() => repository.prompt(any(), any(), assetIds: any(named: 'assetIds')));
  });

  group('permission requests', () {
    setUp(() {
      when(() => repository.getSessions()).thenAnswer((_) async => [session('session-1', title: 'Beach')]);
      when(() => repository.getSession('session-1')).thenAnswer(
        (_) async => detail(
          'session-1',
          title: 'Beach',
          status: 'running',
          messages: [
            messageJson('m1', role: 'user', content: {'text': 'Make a beach album'}),
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
            messageJson('p1', kind: 'permission', content: permissionContent()),
          ],
        ),
      );
      when(
        () => repository.respond(
          any(),
          any(),
          optionId: any(named: 'optionId'),
          approved: any(named: 'approved'),
        ),
      ).thenAnswer((_) async {});
    });

    testWidgets('the tool card shows the photos it found, which open the viewer', (tester) async {
      await pumpPage(tester, sessionId: 'session-1');

      expect(find.text('Search photos'), findsOneWidget);
      expect(find.byKey(const ValueKey('assistant-asset-$photoA')), findsWidgets);

      await tester.tap(find.byKey(const ValueKey('assistant-asset-$photoB')).first);
      await tester.pump();

      expect(navigator.calls, contains('assets $photoA,$photoB at 1'));

      // a reply naming a photo of the chat shows its thumbnail, which opens it
      await emit(
        tester,
        update('session-1', 'running', message: messageJson('m9', content: {'text': 'The best one is `$photoA`.'})),
      );
      expect(find.byKey(const ValueKey('markdown-asset-$photoA')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('markdown-asset-$photoA')));
      await tester.pump();
      expect(navigator.calls, contains('assets $photoA at 0'));
    });

    testWidgets('Allow all in this chat approves and turns on auto-approve', (tester) async {
      await pumpPage(tester, sessionId: 'session-1');

      expect(find.text('Permission needed'), findsOneWidget);
      expect(find.text('Create the album "Beach" with 2 photos'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Allow'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Allow all in this chat'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Deny'), findsOneWidget);
      expect(find.byKey(const Key('assistant-auto-approve-on')), findsNothing);

      await tester.tap(find.byKey(const ValueKey('assistant-permission-allowAll')));
      await tester.pump();

      verify(() => repository.respond('session-1', 'request-1', optionId: 'allow_always', approved: true)).called(1);
      expect(find.text('Approved'), findsOneWidget);
      expect(find.byKey(const ValueKey('assistant-permission-allow')), findsNothing);
      expect(find.byKey(const Key('assistant-auto-approve-on')), findsOneWidget);

      // the server confirms the answer over the websocket
      await emit(
        tester,
        update(
          'session-1',
          'running',
          message: messageJson(
            'p1',
            kind: 'permission',
            content: permissionContent(status: 'approved'),
          ),
        ),
      );
      expect(find.text('Approved'), findsOneWidget);
    });

    testWidgets('Allow approves this change only', (tester) async {
      await pumpPage(tester, sessionId: 'session-1');

      await tester.tap(find.byKey(const ValueKey('assistant-permission-allow')));
      await tester.pump();

      verify(() => repository.respond('session-1', 'request-1', optionId: 'allow', approved: true)).called(1);
      expect(find.text('Approved'), findsOneWidget);
      expect(find.byKey(const Key('assistant-auto-approve-on')), findsNothing);
    });

    testWidgets('Deny refuses the change', (tester) async {
      await pumpPage(tester, sessionId: 'session-1');

      await tester.tap(find.byKey(const ValueKey('assistant-permission-deny')));
      await tester.pump();

      verify(() => repository.respond('session-1', 'request-1', optionId: 'deny', approved: false)).called(1);
      expect(find.text('Denied'), findsOneWidget);
    });

    testWidgets('a failed answer asks again', (tester) async {
      when(
        () => repository.respond(
          any(),
          any(),
          optionId: any(named: 'optionId'),
          approved: any(named: 'approved'),
        ),
      ).thenThrow(ApiException(400, 'expired'));
      await pumpPage(tester, sessionId: 'session-1');

      await tester.tap(find.byKey(const ValueKey('assistant-permission-allow')));
      await tester.pump();
      await tester.pump();

      expect(toast.errors, ['Unable to answer the permission request']);
      expect(find.byKey(const ValueKey('assistant-permission-allow')), findsOneWidget);
      expect(find.text('Approved'), findsNothing);
    });

    testWidgets('Stop cancels the running turn', (tester) async {
      when(() => repository.cancel('session-1')).thenAnswer((_) async {});
      await pumpPage(tester, sessionId: 'session-1');

      await tester.tap(find.byKey(const Key('assistant-stop')));
      await tester.pump();

      verify(() => repository.cancel('session-1')).called(1);
      await emit(tester, update('session-1', 'idle'));
      expect(find.byKey(const Key('assistant-stop')), findsNothing);
    });
  });

  testWidgets('the auto-approve switch of a new chat is sent when it is created', (tester) async {
    when(
      () => repository.createSession(
        title: any(named: 'title'),
        autoApprove: any(named: 'autoApprove'),
      ),
    ).thenAnswer((_) async => session('session-1', autoApprove: true));
    await pumpPage(tester);

    await tester.tap(find.byKey(const Key('assistant-menu')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Auto-approve'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.byKey(const Key('assistant-auto-approve-on')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('assistant-input')), 'Crop these');
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-send')));
    await tester.pump();

    verify(() => repository.createSession(title: 'Crop these', autoApprove: true)).called(1);
  });

  testWidgets('the auto-approve switch of an open chat updates the chat', (tester) async {
    when(() => repository.getSessions()).thenAnswer((_) async => [session('session-1', title: 'Beach')]);
    when(() => repository.getSession('session-1')).thenAnswer((_) async => detail('session-1', title: 'Beach'));
    when(
      () => repository.setAutoApprove('session-1', true),
    ).thenAnswer((_) async => session('session-1', title: 'Beach', autoApprove: true));
    await pumpPage(tester, sessionId: 'session-1');

    await tester.tap(find.byKey(const Key('assistant-menu')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Auto-approve'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    verify(() => repository.setAutoApprove('session-1', true)).called(1);
    expect(find.byKey(const Key('assistant-auto-approve-on')), findsOneWidget);
  });

  group('chat list', () {
    setUp(() {
      when(() => repository.getSessions()).thenAnswer(
        (_) async => [
          session('session-1', title: 'Beach'),
          session('session-2', title: 'Rome book'),
          session('session-3', title: 'Still working', status: 'running'),
        ],
      );
    });

    testWidgets('opens an earlier chat', (tester) async {
      when(() => repository.getSession('session-2')).thenAnswer(
        (_) async => detail(
          'session-2',
          title: 'Rome book',
          messages: [
            messageJson('m1', sessionId: 'session-2', role: 'user', content: {'text': 'Make a Rome book'}),
            messageJson('m2', sessionId: 'session-2', content: {'text': 'Done, the book has 20 pages.'}),
          ],
        ),
      );
      await pumpPage(tester);

      await tester.tap(find.byKey(const Key('assistant-chats')));
      await settle(tester);
      expect(find.text('Beach'), findsOneWidget);
      expect(find.text('Running'), findsOneWidget);

      await tester.tap(find.text('Rome book'));
      await settle(tester);

      verify(() => repository.getSession('session-2')).called(1);
      expect(find.text('Done, the book has 20 pages.'), findsOneWidget);
    });

    testWidgets('deletes a chat after confirming; a running chat cannot be deleted', (tester) async {
      when(() => repository.deleteSession('session-2')).thenAnswer((_) async {});
      await pumpPage(tester);

      await tester.tap(find.byKey(const Key('assistant-chats')));
      await settle(tester);

      expect(find.byKey(const ValueKey('assistant-delete-session-3')), findsNothing);

      await tester.tap(find.byKey(const ValueKey('assistant-delete-session-2')));
      await settle(tester);
      expect(find.text('Delete chat'), findsOneWidget);
      await tester.tap(find.byKey(const Key('gallery-confirm')));
      await settle(tester);

      verify(() => repository.deleteSession('session-2')).called(1);
      expect(find.text('Rome book'), findsNothing);
      expect(toast.successes, ['Chat deleted']);
    });
  });
}
