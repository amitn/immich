import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/presentation/pages/routine_run.page.dart';
import 'package:immich_mobile/gallery/presentation/pages/routines_inbox.page.dart';
import 'package:immich_mobile/gallery/presentation/widgets/library/gallery_library_entries.widget.dart';
import 'package:immich_mobile/gallery/providers/gallery_events.provider.dart';
import 'package:immich_mobile/gallery/providers/gallery_features.provider.dart';
import 'package:immich_mobile/gallery/repositories/routine_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';
import '../../gallery_test_helpers.dart';
import '../../routine_fixtures.dart';

class _MockRoutineApiRepository extends Mock implements RoutineApiRepository {}

void main() {
  late _MockRoutineApiRepository repository;
  late GalleryEventBus bus;
  late FakeGalleryNavigator navigator;
  late FakeToastService toast;

  setUp(() {
    repository = _MockRoutineApiRepository();
    bus = GalleryEventBus();
    navigator = FakeGalleryNavigator();
    toast = FakeToastService();
  });

  tearDown(() => bus.dispose());

  List<Override> overrides({int routinesPending = 0}) => [
    ...galleryOverrides(navigator: navigator, toast: toast, routinesPending: routinesPending),
    routineApiRepositoryProvider.overrideWithValue(repository),
    galleryEventBusProvider.overrideWithValue(bus),
  ];

  group('Routines inbox', () {
    Future<void> pumpInbox(WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 1200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpConsumerWidget(const RoutinesInboxPage(), overrides: overrides());
    }

    testWidgets('groups the waiting changes by run, with each run a tap away', (tester) async {
      when(() => repository.getInbox()).thenAnswer(
        (_) async => [
          routineChange('c-1'),
          routineChange('c-2', title: 'Add to album', summary: 'Food 2026'),
          routineChange('c-3', runId: 'run-2', routineName: 'Weekly bursts', title: 'Archive photos'),
        ],
      );
      await pumpInbox(tester);

      expect(find.text('Name dishes'), findsOneWidget);
      expect(find.text('Weekly bursts'), findsOneWidget);
      expect(find.text('Save names'), findsOneWidget);
      expect(find.text('3 dishes at Trattoria'), findsNWidgets(2));
      expect(find.text('Waiting for you'), findsNWidgets(3));
      // approve all only where a run has more than one change
      expect(find.byKey(const ValueKey('routine-approve-all-run-1')), findsOneWidget);
      expect(find.byKey(const ValueKey('routine-approve-all-run-2')), findsNothing);

      await tester.tap(find.byKey(const ValueKey('routine-open-run-run-2')));
      await tester.pump();
      expect(navigator.calls, ['routine run run-2']);
    });

    testWidgets('approving a change applies it and takes it out of the inbox', (tester) async {
      when(() => repository.getInbox()).thenAnswer((_) async => [routineChange('c-1'), routineChange('c-2')]);
      when(
        () => repository.decide(ids: ['c-1'], approve: true),
      ).thenAnswer((_) async => routineDecision([routineChange('c-1', status: 'applied')], applied: 1));
      await pumpInbox(tester);

      await tester.tap(find.byKey(const ValueKey('routine-approve-c-1')));
      await tester.pumpAndSettle();

      verify(() => repository.decide(ids: ['c-1'], approve: true)).called(1);
      expect(find.byKey(const ValueKey('routine-change-c-1')), findsNothing);
      expect(find.byKey(const ValueKey('routine-change-c-2')), findsOneWidget);
      expect(toast.successes, ['1 change applied']);
    });

    testWidgets('denies every change of a run at once', (tester) async {
      when(() => repository.getInbox()).thenAnswer((_) async => [routineChange('c-1'), routineChange('c-2')]);
      when(() => repository.decide(ids: ['c-1', 'c-2'], approve: false)).thenAnswer(
        (_) async => routineDecision([
          routineChange('c-1', status: 'denied'),
          routineChange('c-2', status: 'denied'),
        ], denied: 2),
      );
      await pumpInbox(tester);

      await tester.tap(find.byKey(const ValueKey('routine-deny-all-run-1')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('routines-inbox-empty')), findsOneWidget);
      expect(toast.successes, ['2 changes denied']);
    });

    testWidgets('a change that fails to apply is reported', (tester) async {
      when(() => repository.getInbox()).thenAnswer((_) async => [routineChange('c-1')]);
      when(() => repository.decide(ids: ['c-1'], approve: true)).thenAnswer(
        (_) async => routineDecision([routineChange('c-1', status: 'failed', result: 'Album not found')], failed: 1),
      );
      await pumpInbox(tester);

      await tester.tap(find.byKey(const ValueKey('routine-approve-c-1')));
      await tester.pumpAndSettle();

      expect(toast.errors, ['1 change could not be applied']);
    });

    testWidgets('a new run notification reloads the inbox', (tester) async {
      var changes = <RoutineApprovalResponseDto>[];
      when(() => repository.getInbox()).thenAnswer((_) async => changes);
      await pumpInbox(tester);
      expect(find.byKey(const Key('routines-inbox-empty')), findsOneWidget);

      changes = [routineChange('c-9')];
      bus.addNotification({
        'id': 'n-1',
        'title': 'Routine “Name dishes” ran',
        'level': 'info',
        'createdAt': '2026-10-03T10:00:00.000Z',
        'data': '{"routineRunId":"run-1","routineId":"routine-1"}',
      });
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('routine-change-c-9')), findsOneWidget);
    });
  });

  group('Routine run', () {
    testWidgets('shows the summary, the changes to decide and the transcript', (tester) async {
      var approvals = [routineChange('c-1'), routineChange('c-2', status: 'applied', result: 'Saved 3 names')];
      when(() => repository.getRun('run-1')).thenAnswer((_) async => routineRun('run-1', approvals: approvals));
      when(() => repository.decide(ids: ['c-1'], approve: false)).thenAnswer((_) async {
        approvals = [routineChange('c-1', status: 'denied'), approvals[1]];
        return routineDecision([approvals[0]], denied: 1);
      });
      await tester.binding.setSurfaceSize(const Size(420, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpConsumerWidget(const RoutineRunPage(runId: 'run-1'), overrides: overrides());

      expect(find.text('Name dishes'), findsWidgets);
      expect(find.text('Done'), findsOneWidget);
      expect(find.text('1 needs your OK'), findsOneWidget);
      expect(find.textContaining('3 dishes'), findsWidgets);
      expect(find.text('Saved 3 names'), findsOneWidget);
      expect(find.text('Transcript'), findsOneWidget);
      expect(find.textContaining('I read the menu of Trattoria'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('routine-deny-c-1')));
      await tester.pumpAndSettle();

      verify(() => repository.decide(ids: ['c-1'], approve: false)).called(1);
      expect(find.text('Denied'), findsOneWidget);
      expect(toast.successes, ['1 change denied']);
    });
  });

  group('Library', () {
    testWidgets('the Routines entry shows how many changes wait, and opens the inbox', (tester) async {
      await tester.pumpConsumerWidget(
        const CustomScrollView(slivers: [GalleryLibraryEntries()]),
        overrides: [
          ...galleryOverrides(
            features: const GalleryFeatures(assistant: true),
            navigator: navigator,
            routinesPending: 3,
          ),
        ],
      );

      expect(find.text('Routines'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);

      await tester.tap(find.byKey(const Key('library-routines')));
      await tester.pump();
      expect(navigator.calls, ['routines inbox']);
    });
  });
}
