import type { MockInstance } from 'vitest';
import { defaults } from 'src/dtos/config.dto.js';
import {
  BookDraftKind,
  CronJob,
  JobName,
  JobStatus,
  MemoryType,
  NotificationLevel,
  NotificationType,
  UserMetadataKey,
} from 'src/enum.js';
import { EmailTemplate } from 'src/repositories/email.repository.js';
import { BookDraftService } from 'src/services/book-draft.service.js';
import { MemoryNoticeService } from 'src/services/memory-notice.service.js';
import { MemoryService } from 'src/services/memory.service.js';
import { MEMORY_NOTICES_CRON } from 'src/utils/memory-notices.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// Saturday 3 October 2026, 10:00 in London
const NOW = new Date('2026-10-03T09:00:00Z');
const ZONE = 'Europe/London';

const user = (memoryNotifications: Record<string, unknown> = {}, other: Record<string, unknown> = {}) => ({
  id: 'owner',
  name: 'Dana',
  email: 'dana@example.com',
  isAdmin: false,
  quotaUsageInBytes: 0,
  quotaSizeInBytes: null,
  metadata: [
    {
      key: UserMetadataKey.Preferences,
      value: { memoryNotifications: { timeZone: ZONE, ...memoryNotifications }, ...other },
    },
  ],
});

const CONTEXT = {
  placeLabel: 'Lisbon',
  yearsAgo: 3,
  tripStart: '2023-10-01T09:00:00.000Z',
  tripEnd: '2023-10-05T18:00:00.000Z',
};

const memory = (id: string, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    ownerId: 'owner',
    type: MemoryType.Rule,
    data: { ruleId: 'trip_anniversary', score: 100, context: CONTEXT },
    memoryAt: new Date('2023-10-03T00:00:00Z'),
    isSaved: false,
    assets: [{ id: `${id}-a` }],
    ...overrides,
  }) as never;

const draft = (id: string, kind = BookDraftKind.Trip) =>
  ({
    id,
    key: `trip:${id}`,
    kind,
    reason: 'Your trip to Crete',
    createdAt: new Date(),
    book: { id: `book-${id}`, title: 'Crete 2026' },
  }) as never;

// Saturday is the digest day
const digestUser = (overrides: Record<string, unknown> = {}, other: Record<string, unknown> = {}) =>
  user({ memories: false, drafts: false, digest: true, digestDay: 6, ...overrides }, other);

const smtpOn = {
  ...defaults.notifications,
  smtp: { ...defaults.notifications.smtp, enabled: true },
};

describe(MemoryNoticeService.name, () => {
  let sut: MemoryNoticeService;
  let mocks: ServiceMocks;
  let search: MockInstance<MemoryService['search']>;
  let getDrafts: MockInstance<BookDraftService['getDrafts']>;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(MemoryNoticeService));
    search = vi.spyOn(MemoryService.prototype, 'search').mockResolvedValue([]);
    getDrafts = vi.spyOn(BookDraftService.prototype, 'getDrafts').mockResolvedValue([]);
    mocks.memoryNotice.hasDay.mockResolvedValue(false);
    mocks.memoryNotice.getSent.mockResolvedValue(new Set());
    mocks.memoryNotice.claim.mockResolvedValue({ id: 'claim-1' });
    mocks.memoryNotice.setNotification.mockResolvedValue();
    mocks.memoryNotice.delete.mockResolvedValue();
    mocks.memoryNotice.cleanup.mockResolvedValue();
    mocks.cron.create.mockReturnValue(void 0 as never);
    mocks.notification.create.mockImplementation((values) =>
      Promise.resolve({ id: 'notification-1', createdAt: NOW, ...values } as never),
    );
    mocks.collectionNotice.getUnreadSince.mockResolvedValue([]);
    mocks.email.renderEmail.mockResolvedValue({ html: '<html>', text: 'text' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onConfigInit', () => {
    it('schedules the notifier every hour on the instance that holds the lock', async () => {
      mocks.database.tryLock.mockResolvedValue(true);
      await sut.onConfigInit();
      expect(mocks.cron.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: CronJob.MemoryNotices, expression: MEMORY_NOTICES_CRON, start: true }),
      );
    });

    it('does not schedule it twice', async () => {
      mocks.database.tryLock.mockResolvedValue(false);
      await sut.onConfigInit();
      expect(mocks.cron.create).not.toHaveBeenCalled();
    });
  });

  describe('handleQueueAll', () => {
    it('queues the users whose time of day has come', async () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
      try {
        mocks.user.getList.mockResolvedValue([
          user() as never,
          { ...user({ hour: 11 }), id: 'later' } as never,
          { ...user({ memories: false, drafts: false }), id: 'nothing' } as never,
        ]);
        await expect(sut.handleQueueAll()).resolves.toBe(JobStatus.Success);
        expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.MemoryNoticesSend, data: { id: 'owner' } }]);
        expect(mocks.memoryNotice.cleanup).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does nothing when the admin turned the notifications and the digest off', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ memoryNotifications: { enabled: false, digest: false } });
      await expect(sut.handleQueueAll()).resolves.toBe(JobStatus.Skipped);
      expect(mocks.user.getList).not.toHaveBeenCalled();
    });
  });

  describe('the notification of the day', () => {
    it('notifies the best memory of the day, as facts the web words, and opens it', async () => {
      search.mockResolvedValue([
        memory('years-ago', { type: MemoryType.OnThisDay, data: { year: 2019 } }),
        memory('anniversary'),
      ]);

      const { notice } = await sut.sendNotices(user(), defaults, NOW);

      expect(notice).toEqual(expect.objectContaining({ kind: 'memory', notificationId: 'notification-1' }));
      // the memories of the user's day
      expect(search).toHaveBeenCalledWith(expect.anything(), { for: new Date('2026-10-03T00:00:00.000Z') });
      expect(mocks.memoryNotice.claim).toHaveBeenCalledWith({
        userId: 'owner',
        kind: 'memory',
        refId: 'anniversary',
        day: '2026-10-03',
      });
      expect(mocks.notification.create).toHaveBeenCalledWith({
        userId: 'owner',
        type: NotificationType.Custom,
        level: NotificationLevel.Info,
        title: 'A trip anniversary',
        description: null,
        data: JSON.stringify({
          memoryId: 'anniversary',
          memoryNotice: {
            type: MemoryType.Rule,
            data: { ruleId: 'trip_anniversary', context: CONTEXT },
            memoryAt: '2023-10-03T00:00:00.000Z',
            assetCount: 1,
          },
        }),
      });
      expect(mocks.memoryNotice.setNotification).toHaveBeenCalledWith('claim-1', 'notification-1');
      expect(mocks.websocket.clientSend).toHaveBeenCalledWith('on_notification', 'owner', expect.anything());
      // the hook of a push channel (#3)
      expect(mocks.event.emit).toHaveBeenCalledWith('MemoryNoticeSend', {
        userId: 'owner',
        kind: 'memory',
        notificationId: 'notification-1',
        data: expect.objectContaining({ memoryId: 'anniversary' }),
      });
    });

    it('sends at most one a day', async () => {
      search.mockResolvedValue([memory('anniversary')]);
      mocks.memoryNotice.hasDay.mockResolvedValue(true);

      await expect(sut.sendNotices(user(), defaults, NOW)).resolves.toEqual({});
      expect(mocks.memoryNotice.hasDay).toHaveBeenCalledWith('owner', '2026-10-03');
      expect(mocks.notification.create).not.toHaveBeenCalled();
    });

    it('waits for the time of day, in the time zone of the user', async () => {
      search.mockResolvedValue([memory('anniversary')]);

      await expect(sut.sendNotices(user({ hour: 11 }), defaults, NOW)).resolves.toEqual({});
      await expect(sut.sendNotices(user({ timeZone: 'America/New_York' }), defaults, NOW)).resolves.toEqual({});
      expect(mocks.notification.create).not.toHaveBeenCalled();

      await sut.sendNotices(user({ timeZone: 'Asia/Tokyo', hour: 18 }), defaults, NOW);
      expect(mocks.notification.create).toHaveBeenCalledTimes(1);
      expect(mocks.memoryNotice.claim).toHaveBeenCalledWith(expect.objectContaining({ day: '2026-10-03' }));
    });

    it('notifies a memory once', async () => {
      search.mockResolvedValue([memory('anniversary'), memory('place', { data: { ruleId: 'on_this_day_place' } })]);
      mocks.memoryNotice.getSent.mockResolvedValue(new Set(['anniversary']));

      await sut.sendNotices(user(), defaults, NOW);

      expect(mocks.memoryNotice.getSent).toHaveBeenCalledWith('owner', 'memory', ['anniversary', 'place']);
      expect(mocks.memoryNotice.claim).toHaveBeenCalledWith(expect.objectContaining({ refId: 'place' }));
      expect(mocks.notification.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'On this day' }));
    });

    it('sends nothing when another job took the day meanwhile', async () => {
      search.mockResolvedValue([memory('anniversary')]);
      mocks.memoryNotice.claim.mockResolvedValue(undefined);

      await expect(sut.sendNotices(user(), defaults, NOW)).resolves.toEqual({});
      expect(mocks.notification.create).not.toHaveBeenCalled();
    });

    it('gives the day back when the notification fails, to try again the next hour', async () => {
      search.mockResolvedValue([memory('anniversary')]);
      mocks.notification.create.mockRejectedValue(new Error('database down'));

      await expect(sut.sendNotices(user(), defaults, NOW)).resolves.toEqual({});
      expect(mocks.memoryNotice.delete).toHaveBeenCalledWith('claim-1');
    });

    it("never notifies the year recap (it has its own notification) nor someone else's memory", async () => {
      search.mockResolvedValue([
        memory('recap', { data: { ruleId: 'year_recap', score: 999, context: { year: 2025 } } }),
        memory('partner', { ownerId: 'partner' }),
      ]);

      await expect(sut.sendNotices(user(), defaults, NOW)).resolves.toEqual({});
      expect(mocks.notification.create).not.toHaveBeenCalled();
    });

    it('relies on the memories as served: without what the user keeps out of them', async () => {
      // `MemoryService.search` drops a memory about an excluded person or with all its photos excluded
      search.mockResolvedValue([]);

      await expect(sut.sendNotices(user(), defaults, NOW)).resolves.toEqual({});
      expect(search).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 'owner' }) }), {
        for: expect.any(Date),
      });
      expect(mocks.notification.create).not.toHaveBeenCalled();
    });

    it('tells of a suggested book waiting for the user on a day without a memory', async () => {
      getDrafts.mockResolvedValue([draft('recap', BookDraftKind.Recap), draft('told'), draft('crete')]);
      mocks.memoryNotice.getSent.mockImplementation((_userId, kind) =>
        Promise.resolve(new Set(kind === 'draft' ? ['told'] : [])),
      );

      const { notice } = await sut.sendNotices(user(), defaults, NOW);

      expect(notice?.kind).toBe('draft');
      expect(mocks.memoryNotice.claim).toHaveBeenCalledWith({
        userId: 'owner',
        kind: 'draft',
        refId: 'crete',
        day: '2026-10-03',
      });
      expect(mocks.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Your trip book is ready',
          description: 'Crete 2026',
          data: JSON.stringify({
            bookId: 'book-crete',
            draftNotice: { draftId: 'crete', kind: BookDraftKind.Trip, title: 'Crete 2026' },
          }),
        }),
      );
    });

    it('prefers the memory of the day to a waiting draft', async () => {
      search.mockResolvedValue([memory('anniversary')]);
      getDrafts.mockResolvedValue([draft('crete')]);

      await sut.sendNotices(user(), defaults, NOW);

      expect(mocks.notification.create).toHaveBeenCalledTimes(1);
      expect(getDrafts).not.toHaveBeenCalled();
    });

    it('follows the preferences of each kind', async () => {
      search.mockResolvedValue([memory('anniversary')]);
      getDrafts.mockResolvedValue([draft('crete')]);

      await sut.sendNotices(user({ memories: false }), defaults, NOW);
      expect(search).not.toHaveBeenCalled();
      expect(mocks.memoryNotice.claim).toHaveBeenCalledWith(expect.objectContaining({ kind: 'draft' }));

      mocks.memoryNotice.claim.mockClear();
      await sut.sendNotices(user({ memories: false, drafts: false }), defaults, NOW);
      expect(mocks.memoryNotice.claim).not.toHaveBeenCalled();

      await sut.sendNotices(user({ drafts: false }, { memories: { enabled: false } }), defaults, NOW);
      expect(mocks.memoryNotice.claim).not.toHaveBeenCalled();
    });

    it('follows the admin switch', async () => {
      search.mockResolvedValue([memory('anniversary')]);
      const config = { ...defaults, memoryNotifications: { enabled: false, digest: true } };

      await expect(sut.sendNotices(user(), config, NOW)).resolves.toEqual({});
      expect(search).not.toHaveBeenCalled();
    });
  });

  describe('the weekly digest', () => {
    const config = { ...defaults, notifications: smtpOn };

    it("lists the week's memories, waiting drafts and unread journal visits, with links", async () => {
      search.mockImplementation((_auth, dto) =>
        Promise.resolve(
          dto.for?.toISOString().startsWith('2026-10-01')
            ? [memory('anniversary'), memory('recap', { data: { ruleId: 'year_recap', context: { year: 2025 } } })]
            : dto.for?.toISOString().startsWith('2026-10-03')
              ? [
                  memory('anniversary'),
                  memory('years-ago', {
                    type: MemoryType.OnThisDay,
                    data: { year: 2019 },
                    memoryAt: new Date('2019-10-03T00:00:00Z'),
                  }),
                ]
              : [],
        ),
      );
      getDrafts.mockResolvedValue([draft('crete')]);
      mocks.collectionNotice.getUnreadSince.mockResolvedValue([
        {
          pack: 'food',
          assetIds: ['photo-1', 'photo-2'],
          createdAt: new Date(),
          title: 'Name the dishes from last night at Taormina?',
          description: '12 dishes · Taormina, 26 September 2026',
        },
      ] as never);

      const { digest } = await sut.sendNotices(digestUser(), config, NOW);

      // the seven days up to today
      expect(search).toHaveBeenCalledTimes(7);
      expect(search).toHaveBeenCalledWith(expect.anything(), { for: new Date('2026-09-27T00:00:00.000Z') });
      expect(mocks.collectionNotice.getUnreadSince).toHaveBeenCalledWith('owner', new Date('2026-09-26T09:00:00Z'));
      expect(digest).toEqual({
        memories: [
          {
            title: 'Your trip to Lisbon',
            subtitle: expect.stringContaining('October 2023'),
            url: 'https://my.immich.app/memories/anniversary',
          },
          {
            title: '7 years ago',
            subtitle: expect.stringContaining('2019'),
            url: 'https://my.immich.app/memories/years-ago',
          },
        ],
        drafts: [
          { title: 'Crete 2026', subtitle: 'Your trip to Crete', url: 'https://my.immich.app/books/book-crete' },
        ],
        visits: [
          {
            title: 'Name the dishes from last night at Taormina?',
            subtitle: '12 dishes · Taormina, 26 September 2026',
            url: 'https://my.immich.app/photos/photo-1',
          },
        ],
      });
      expect(mocks.memoryNotice.claim).toHaveBeenCalledWith({
        userId: 'owner',
        kind: 'digest',
        refId: '2026-W40',
        day: '2026-10-03',
      });
      expect(mocks.email.renderEmail).toHaveBeenCalledWith({
        template: EmailTemplate.MEMORY_DIGEST,
        data: { baseUrl: 'https://my.immich.app', recipientName: 'Dana', ...digest },
        customTemplate: '',
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SendMail,
        data: { to: 'dana@example.com', subject: 'Your week in memories', html: '<html>', text: 'text' },
      });
    });

    it('is skipped when email is not set up', async () => {
      getDrafts.mockResolvedValue([draft('crete')]);

      await expect(sut.sendNotices(digestUser(), defaults, NOW)).resolves.toEqual({});
      expect(getDrafts).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('is skipped when there is nothing to tell', async () => {
      await expect(sut.sendNotices(digestUser(), config, NOW)).resolves.toEqual({});
      expect(mocks.memoryNotice.claim).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('is sent once a week', async () => {
      getDrafts.mockResolvedValue([draft('crete')]);
      mocks.memoryNotice.getSent.mockResolvedValue(new Set(['2026-W40']));

      await expect(sut.sendNotices(digestUser(), config, NOW)).resolves.toEqual({});
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('waits for the digest day and the time of day', async () => {
      getDrafts.mockResolvedValue([draft('crete')]);

      await sut.sendNotices(digestUser({ digestDay: 7 }), config, NOW);
      await sut.sendNotices(digestUser({ hour: 11 }), config, NOW);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('is off by default, and follows the email switch and the admin switch', async () => {
      getDrafts.mockResolvedValue([draft('crete')]);

      await sut.sendNotices(user({ memories: false, drafts: false, digestDay: 6 }), config, NOW);
      await sut.sendNotices(digestUser({}, { emailNotifications: { enabled: false } }), config, NOW);
      await sut.sendNotices(digestUser(), { ...config, memoryNotifications: { enabled: true, digest: false } }, NOW);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('gives the week back when the email cannot be made', async () => {
      getDrafts.mockResolvedValue([draft('crete')]);
      mocks.email.renderEmail.mockRejectedValue(new Error('render failed'));

      await expect(sut.sendNotices(digestUser(), config, NOW)).resolves.toEqual({});
      expect(mocks.memoryNotice.delete).toHaveBeenCalledWith('claim-1');
    });
  });

  describe('handleSend', () => {
    it('skips a user that is gone', async () => {
      mocks.user.get.mockResolvedValue(void 0);
      await expect(sut.handleSend({ id: newUuid() })).resolves.toBe(JobStatus.Skipped);
    });
  });
});
