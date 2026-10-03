# Memory notifications (fork issue #6)

"On this day" reminders, ready creations, waiting drafts and a weekly email digest, built on noodle's memory
engine. User docs: `docs/docs/features/memories.md#memory-notifications`.

## Shape

- **`MemoryNoticeService`** (`server/src/services/memory-notice.service.ts`) is the notifier. `MemoryNoticesQueueAll`
  runs every hour (cron `5 * * * *`, on the microservices instance that holds `DatabaseLock.MemoryNotices`) and right
  after `MemoryGenerate` (queued at the end of `MemoryService.onMemoriesCreate`, fail-soft). It queues
  `MemoryNoticesSend` for each user whose time of day has come (`isMemoryNoticeDue`).
- **The notification of the day**: the best memory of the user's day (`MemoryService.search({ for: <local day> })`, so
  the exclusions, the type switches and the hidden-space rules are those of the memory lane; ranked like the engine
  ranks cards: rule score above plain on-this-day, then photo count; never `year_recap`, which has its own
  notification), else the newest waiting book draft (not the recap's). Book drafts no longer notify when drafted.
- **Once, one a day**: `memory_notice` (`userId`, `kind` memory|draft|digest, `refId`, `day`). Unique
  (`userId`, `kind`, `refId`) makes each memory, draft and ISO week once; a partial unique index on (`userId`, `day`)
  for memory|draft makes the one-a-day limit hold even when two jobs race. A failed notification gives its claim back.
- **No prose stored**: the notification data is `{ memoryId, memoryNotice: { type, data: { ruleId, context, year } } }`
  or `{ bookId, draftNotice: { draftId, kind, title } }`. The web words it (`web/src/lib/utils/memory-notice.ts`, on top
  of `memory-card.ts`); `title` is an English fallback for other clients.
- **Ready creations** (highlight video, book export, artwork) keep their own notifications, gated by
  `memoryNotifications.creations` (`wantsCreationNotices`); failures always notify; no daily limit.
- **Digest**: `EmailTemplate.MEMORY_DIGEST`, queued as `SendMail` on the digest day once the time of day has come;
  skipped without SMTP, with the user's email notifications off, or with nothing to tell.
- **Preferences**: `memoryNotifications` { memories, creations, drafts, hour, timeZone, digest, digestDay }; journal
  visits stay `collectionNotifications.enabled` (moved to the same settings section). The web saves the browser's IANA
  time zone with the hour; an empty or unknown zone falls back to the server's.
- **Admin**: `memoryNotifications.enabled` (notification of the day) and `.digest`.

## Push hook (for #3)

Every notification of the day is emitted after it is stored and sent to the web clients:

```ts
eventRepository.emit('MemoryNoticeSend', { userId, kind: 'memory' | 'draft', notificationId, data });
```

A push channel subscribes with `@OnEvent({ name: 'MemoryNoticeSend' })`, looks up the user's devices and words the
push from `data` the way the web does (the Android app already has the card wording in
`mobile/lib/utils/memory_card_text.dart`). The daily limit, the time of day and the exclusions are already applied when
the event fires, so the channel only delivers. Ready creations and journal visits do not emit it yet; they would need
the same one-line emit if push should carry them.
