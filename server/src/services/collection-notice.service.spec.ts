import { vitest } from 'vitest';
import { CollectionVisitResponse, CollectionVisitsResponseDto } from 'src/dtos/collection.dto.js';
import { defaults } from 'src/dtos/config.dto.js';
import { JobName, JobStatus, NotificationLevel, NotificationType } from 'src/enum.js';
import {
  CollectionNoticeService,
  HOME_MIN_DAYS,
  getNoticeText,
  getVisitKey,
  isAwayFromHome,
} from 'src/services/collection-notice.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { PackFit } from 'src/utils/collections/arbitration.js';
import { getCollectionMessages, getNoticeDay } from 'src/utils/collections/pack.js';
import { REDACTED } from 'src/utils/collections/packs/travel/privacy.js';
import { getCollectionPack } from 'src/utils/collections/registry.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const NOW = new Date('2026-09-27T09:00:00Z');
const config = { enabled: true, maxPerRun: 3, windowDays: 14 };

const visit = (overrides: Partial<CollectionVisitResponse> = {}): CollectionVisitResponse => ({
  index: 0,
  start: `${overrides.day ?? '2026-09-26'}T20:10:00`,
  end: `${overrides.day ?? '2026-09-26'}T21:40:00`,
  day: '2026-09-26',
  type: 'Dinner',
  city: 'Taormina',
  subjectIds: [newUuid(), newUuid(), newUuid(), newUuid()],
  sourceIds: [newUuid()],
  signIds: [],
  receiptIds: [],
  place: { name: 'Dinner in Taormina', source: 'fallback', confidence: 0, assetIds: [] },
  candidates: [],
  saved: [],
  ...overrides,
});

const visits = (pack: string, items: CollectionVisitResponse[]): CollectionVisitsResponseDto => ({
  pack,
  count: items.length,
  truncated: false,
  photos: items.length,
  visits: items,
  warnings: [],
});

const pack = (id: string) => getCollectionPack(id)!;
const six = () => Array.from({ length: 6 }, () => newUuid());

describe('new collection messages', () => {
  const today = '2026-09-27';

  it('should say when a visit was', () => {
    expect(getNoticeDay('2026-09-27', today)).toEqual({ days: 0, text: 'today' });
    expect(getNoticeDay('2026-09-26', today)).toEqual({ days: 1, text: 'yesterday' });
    // 26 September 2026 is a Saturday
    expect(getNoticeDay('2026-09-26', '2026-09-30').text).toBe('on Saturday');
    expect(getNoticeDay('2026-06-12', today).text).toBe('on 12 June');
    expect(getNoticeDay('2025-12-31', today).text).toBe('on 31 December 2025');
  });

  it('should name the meal of a food visit from today, and its place', () => {
    const food = pack('food');
    expect(getNoticeText(food, visit(), today)).toEqual({
      title: 'Name the dishes from last night at Taormina?',
      description: '4 dishes · Taormina, 26 September 2026',
    });
    const lunch = visit({
      type: 'Lunch',
      day: '2026-09-27',
      place: { name: 'Trattoria da Nino', source: 'sign', confidence: 0.9, assetIds: [] },
    });
    expect(getNoticeText(food, lunch, today)).toEqual({
      title: "Name the dishes from today's lunch at Trattoria da Nino?",
      description: '4 dishes · Trattoria da Nino, Taormina, 27 September 2026',
    });
    expect(getNoticeText(food, visit({ day: '2026-09-27' }), today).title).toBe(
      'Name the dishes from tonight at Taormina?',
    );
    expect(getNoticeText(food, visit({ type: 'Breakfast', day: '2026-09-23' }), today).title).toBe(
      'Name the dishes from your breakfast at Taormina on Wednesday?',
    );
  });

  it('should name the artworks of a museum visit', () => {
    const museum = pack('museum');
    const named = visit({
      type: undefined,
      city: 'Évora',
      place: { name: 'Museu de Évora', source: 'sign', confidence: 0.8, assetIds: [] },
    });
    expect(getNoticeText(museum, named, today).title).toBe('Name the artworks from your visit to the Museu de Évora?');
    const met = { ...named, place: { ...named.place, name: 'The Met' } };
    expect(getNoticeText(museum, met, today).title).toBe('Name the artworks from your visit to The Met?');
    expect(
      getNoticeText(museum, visit({ type: undefined, city: 'Évora', day: '2026-09-26' }), '2026-09-30').title,
    ).toBe('Name the artworks from your museum visit in Évora on Saturday?');
  });

  it('should name the wines of a tasting, and the recipe of a cooking session', () => {
    expect(getNoticeText(pack('wine'), visit({ type: undefined }), '2026-09-30').title).toBe(
      'Name the wines from your tasting on Saturday?',
    );
    expect(getNoticeText(pack('cookbook'), visit({ type: undefined }), today).title).toBe(
      'Name the recipe you cooked yesterday?',
    );
  });

  it('should hide the private text of a trip', () => {
    const trip = visit({
      type: undefined,
      city: undefined,
      place: { name: 'Booking ref QWERTY', source: 'source', confidence: 0.5, assetIds: [] },
    });
    const { title, description } = getNoticeText(pack('travel'), trip, today);
    expect(title).toBe(`Name the legs of your trip to Booking ref ${REDACTED}?`);
    expect(title).not.toContain('QWERTY');
    expect(description).not.toContain('QWERTY');
  });

  it('should word the question of a new pack from its names', () => {
    const messages = getCollectionMessages({
      names: {
        subject: 'drawing',
        subjects: 'drawings',
        source: 'label',
        sources: 'labels',
        place: 'place',
        entry: 'drawing',
        entries: 'drawings',
        visit: 'art session',
        visits: 'art sessions',
      },
    });
    expect(messages.newVisit({ day: '2026-09-26', today, subjects: 5, city: 'Lisbon' })).toBe(
      'Name the drawings from your art session in Lisbon yesterday?',
    );
  });

  it('should key a visit by its day, kind and city', () => {
    expect(getVisitKey(visit())).toBe('2026-09-26T20|Dinner|Taormina');
    expect(getVisitKey({ start: '2026-09-26T11:05:00', latitude: 37.8512, longitude: 15.2877 })).toBe(
      '2026-09-26T11||37.85,15.29',
    );
  });

  it.each([
    ['sign', 0.8, 'Nino'],
    ['sign', 0.2, 'Taormina'],
    ['tag', 0, 'Nino'],
    ['fallback', 0, 'Taormina'],
  ] as const)('should only name a place read clearly enough (%s, %s)', (source, confidence, at) => {
    const meal = visit({ place: { name: 'Nino', source, confidence, assetIds: [] } });
    expect(getNoticeText(pack('food'), meal, today).title).toBe(`Name the dishes from last night at ${at}?`);
  });
});

describe(CollectionNoticeService.name, () => {
  let sut: CollectionNoticeService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();

  const setup = (
    byPack: Record<string, CollectionVisitResponse[]>,
    notices: Array<{ pack: string; key: string; assetIds: string[] }> = [],
    fits: Map<string, PackFit> = new Map(),
  ) => {
    vitest.spyOn(CollectionService.prototype, 'getPackFits').mockResolvedValue(fits);
    // home is in Taormina, where the user took photos on 200 days
    mocks.collectionNotice.getHome.mockResolvedValue({ latitude: 37.9, longitude: 15.3, days: 200 });
    mocks.collectionNotice.getCheckedAt.mockResolvedValue(undefined);
    mocks.collectionNotice.getUploads.mockResolvedValue([
      {
        id: newUuid(),
        // taken at 22:00 in Taormina, UTC+2
        localDateTime: new Date('2026-09-26T22:00:00Z'),
        fileCreatedAt: new Date('2026-09-26T20:00:00Z'),
        createdAt: new Date('2026-09-27T07:00:00Z'),
      },
    ] as never);
    mocks.collectionNotice.getNotices.mockResolvedValue(notices);
    mocks.collectionNotice.claim.mockImplementation(() => Promise.resolve({ id: newUuid() }));
    mocks.collectionNotice.setNotification.mockResolvedValue();
    mocks.collectionNotice.setCheckedAt.mockResolvedValue();
    mocks.collectionNotice.delete.mockResolvedValue();
    mocks.notification.create.mockImplementation(
      (item) => Promise.resolve({ id: newUuid(), createdAt: new Date(), ...item }) as never,
    );
    return vitest
      .spyOn(CollectionService.prototype, 'findVisits')
      .mockImplementation((_auth, packId) => Promise.resolve(visits(packId, byPack[packId] ?? [])));
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(CollectionNoticeService));
    vitest.restoreAllMocks();
  });

  describe('handleQueueAll', () => {
    it('should check the users who want the notifications', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ collections: { notifications: { enabled: true } } });
      mocks.user.getList.mockResolvedValue([
        { id: 'user-1', metadata: [] },
        {
          id: 'user-2',
          metadata: [{ key: 'preferences', value: { collectionNotifications: { enabled: false } } }],
        },
      ] as never);

      await expect(sut.handleQueueAll()).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.CollectionNoticesCheck, data: { id: 'user-1' } },
      ]);
    });

    it('should do nothing by default, until the administrator turns the notifications on', async () => {
      mocks.systemMetadata.get.mockResolvedValue({});
      await expect(sut.handleQueueAll()).resolves.toBe(JobStatus.Skipped);
      await expect(sut.handleCheck({ id: auth.user.id })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should do nothing when the administrator turned the notifications off', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ collections: { notifications: { enabled: false } } });
      await expect(sut.handleQueueAll()).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should do nothing without smart search, which finds the photos of the collections', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        collections: { notifications: { enabled: true } },
        machineLearning: { clip: { enabled: false } },
      });
      await expect(sut.handleQueueAll()).resolves.toBe(JobStatus.Skipped);
    });
  });

  describe('handleCheck', () => {
    it('should skip a user who turned the notifications off', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ collections: { notifications: { enabled: true } } });
      mocks.user.get.mockResolvedValue({
        id: auth.user.id,
        metadata: [{ key: 'preferences', value: { collectionNotifications: { enabled: false } } }],
      } as never);
      await expect(sut.handleCheck({ id: auth.user.id })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.collectionNotice.getUploads).not.toHaveBeenCalled();
    });

    it('should notify a user who wants the notifications', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ collections: { notifications: { enabled: true } } });
      mocks.user.get.mockResolvedValue({ ...auth.user, metadata: [] } as never);
      setup({ food: [visit()] });
      await expect(sut.handleCheck({ id: auth.user.id })).resolves.toBe(JobStatus.Success);
      expect(mocks.notification.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifyNewVisits', () => {
    it('should notify a new, unnamed visit, and open the naming dialog on its photos', async () => {
      const meal = visit();
      const findVisits = setup({ food: [meal] });

      const notified = await sut.notifyNewVisits(auth, config, NOW);

      expect(notified).toHaveLength(1);
      const assetIds = [...meal.subjectIds, ...meal.sourceIds];
      expect(findVisits).toHaveBeenCalledWith(
        auth,
        'food',
        { assetIds: [expect.any(String)] },
        { foreign: expect.any(Map) },
      );
      expect(mocks.collectionNotice.claim).toHaveBeenCalledWith({
        userId: auth.user.id,
        pack: 'food',
        key: '2026-09-26T20|Dinner|Taormina',
        assetIds,
      });
      expect(mocks.notification.create).toHaveBeenCalledWith({
        userId: auth.user.id,
        type: NotificationType.Custom,
        level: NotificationLevel.Info,
        // the user's today is the 27th: the dinner of the 26th was last night
        title: 'Name the dishes from last night at Taormina?',
        description: '4 dishes · Taormina, 26 September 2026',
        data: JSON.stringify({ collectionPack: 'food', assetIds, visitKey: '2026-09-26T20|Dinner|Taormina' }),
      });
      expect(mocks.collectionNotice.setNotification).toHaveBeenCalled();
      expect(mocks.websocket.clientSend).toHaveBeenCalledWith('on_notification', auth.user.id, expect.anything());
      expect(mocks.collectionNotice.setCheckedAt).toHaveBeenCalledWith(auth.user.id, NOW);
    });

    it('should not notify a visit that is named, too small or already notified', async () => {
      const named = visit({ saved: [{ assetId: newUuid(), place: 'Nino', entry: 'Caponata', source: false }] });
      const small = visit({ day: '2026-09-25', subjectIds: [newUuid(), newUuid()] });
      const byKey = visit({ day: '2026-09-24' });
      const byPhoto = visit({ day: '2026-09-23' });
      setup({ food: [named, small, byKey, byPhoto] }, [
        { pack: 'food', key: '2026-09-24T20|Dinner|Taormina', assetIds: [] },
        { pack: 'food', key: 'other', assetIds: [byPhoto.subjectIds[1]] },
      ]);

      const found = await sut.findNewVisits(auth, config, NOW);
      expect(found.map(({ key, status }) => [key.slice(0, 10), status])).toEqual([
        ['2026-09-26', 'named'],
        ['2026-09-25', 'small'],
        ['2026-09-24', 'notified'],
        ['2026-09-23', 'notified'],
      ]);

      await expect(sut.notifyNewVisits(auth, config, NOW)).resolves.toEqual([]);
      expect(mocks.notification.create).not.toHaveBeenCalled();
    });

    it('should only notify a trip with a travel document', async () => {
      const crete = { type: undefined, city: 'Chania', latitude: 35.51, longitude: 24.02 };
      setup({ travel: [visit({ ...crete, sourceIds: [] }), visit({ ...crete, day: '2026-09-20' })] });
      const found = await sut.findNewVisits(auth, config, NOW);
      expect(found.map(({ status }) => status)).toEqual(['small', 'new']);
    });

    it('should only notify a trip away from home, with a place to name it after', async () => {
      const trip = { type: undefined, sourceIds: [newUuid()] };
      setup({
        travel: [
          // Chania, 700 km from home
          visit({ ...trip, day: '2026-09-26', city: 'Chania', latitude: 35.51, longitude: 24.02 }),
          // Taormina: home
          visit({ ...trip, day: '2026-09-25', city: 'Taormina', latitude: 37.85, longitude: 15.29 }),
          // nowhere known
          visit({ ...trip, day: '2026-09-24', city: undefined }),
          // far, but without a place or a city
          visit({ ...trip, day: '2026-09-23', city: undefined, latitude: 35.51, longitude: 24.02 }),
        ],
      });
      const found = await sut.findNewVisits(auth, config, NOW);
      expect(found.map(({ status }) => status)).toEqual(['new', 'not-away', 'not-away', 'not-away']);

      // a user whose home is not known yet
      mocks.collectionNotice.getHome.mockResolvedValue({ latitude: 37.9, longitude: 15.3, days: HOME_MIN_DAYS - 1 });
      const unknown = await sut.findNewVisits(auth, config, NOW);
      expect(unknown[0].status).toBe('not-away');
    });

    it('should not look for home without a pack that needs it', async () => {
      setup({ food: [visit()] });
      await sut.findNewVisits(auth, config, NOW);
      expect(mocks.collectionNotice.getHome).toHaveBeenCalledTimes(1);
      expect(isAwayFromHome(pack('food'), visit({ city: undefined }), undefined)).toBe(true);
    });

    it('should notify the stage shots of a gig in the concerts, not as a trip', async () => {
      const shots = six();
      const stage: PackFit = { concerts: { subject: 0.27 }, travel: { subject: 0.2, source: 0.22 } };
      const ticket = newUuid();
      const crete = { type: undefined, city: 'Chania', latitude: 35.51, longitude: 24.02 };
      const findVisits = setup(
        {
          travel: [visit({ ...crete, subjectIds: shots, sourceIds: [ticket] })],
          concerts: [visit({ ...crete, subjectIds: shots.slice(0, 5), sourceIds: [] })],
        },
        [],
        new Map([...shots, ticket].map((id) => [id, stage])),
      );

      const found = await sut.findNewVisits(auth, config, NOW);

      expect(found.map(({ pack, status, share }) => [pack, status, share])).toEqual([
        ['travel', 'unsure', 0],
        ['concerts', 'new', 1],
      ]);
      // the stage shots (and the ticket, the travel pack's for a subject) are another pack's for sure: the trip is
      // found without them as subjects
      const travelCall = findVisits.mock.calls.find(([, packId]) => packId === 'travel')!;
      expect([...travelCall[3]!.foreign!.get('subject')!]).toEqual([...shots, ticket]);
    });

    it('should notify a visit without the photos another pack won, from its first photo left', async () => {
      const [a, b, c, d, e] = [newUuid(), newUuid(), newUuid(), newUuid(), newUuid()];
      const tree: PackFit = { garden: { subject: 0.3 }, nature: { subject: 0.27 } };
      const book: PackFit = { reading: { subject: 0.32 }, garden: { subject: 0.2, source: 0.22 } };
      mocks.collectionNotice.getUploads.mockResolvedValue([]);
      setup(
        {
          garden: [visit({ type: undefined, city: undefined, subjectIds: [a, b, c], sourceIds: [d] })],
          reading: [
            visit({
              type: undefined,
              city: undefined,
              day: '2026-09-25',
              subjectIds: [d, e, newUuid()],
              sourceIds: [],
              place: { name: 'Ransom Center', source: 'sign', confidence: 0.9, assetIds: [d] },
            }),
          ],
        },
        [],
        new Map([
          [a, tree],
          [b, tree],
          [c, tree],
          [d, book],
          [e, book],
        ]),
      );
      mocks.collectionNotice.getUploads.mockResolvedValue(
        [a, b, c, d, e].map((id, index) => ({
          id,
          localDateTime: new Date(`2026-09-2${index + 3}T10:00:00Z`),
          fileCreatedAt: new Date(`2026-09-2${index + 3}T08:00:00Z`),
          createdAt: new Date('2026-09-27T07:00:00Z'),
        })) as never,
      );

      const found = await sut.findNewVisits(auth, config, NOW);

      const reading = found.find(({ pack }) => pack === 'reading')!;
      // the book is sure of its title page, which the garden took for a plant tag
      expect(reading).toMatchObject({ status: 'new', subjects: 3 });
      expect(found.find(({ pack }) => pack === 'garden')).toMatchObject({ status: 'new', subjects: 3 });
      expect(found.find(({ pack }) => pack === 'garden')!.assetIds).toEqual([a, b, c]);
      // and starts at the first photo it kept
      expect(found.find(({ pack }) => pack === 'garden')).toMatchObject({
        start: '2026-09-23T10:00:00',
        key: '2026-09-23T10||',
      });
      // the name was read on the photo it kept
      expect(reading.title).toContain('Ransom Center');
    });

    it('should notify photos found by several packs once, without smart search in the pack with the most subjects', async () => {
      const dishes = [newUuid(), newUuid(), newUuid(), newUuid()];
      const named = [newUuid(), newUuid(), newUuid()];
      setup({
        food: [
          visit({ subjectIds: dishes }),
          visit({ day: '2026-09-20', subjectIds: named, saved: [{ assetId: named[0], place: 'Nino', source: false }] }),
        ],
        cookbook: [
          visit({ type: undefined, subjectIds: dishes.slice(0, 3) }),
          // the dishes of a named meal, taken for cooking photos
          visit({ type: undefined, day: '2026-09-20', subjectIds: named }),
        ],
      });

      const found = await sut.findNewVisits(auth, config, NOW);

      expect(found.map(({ pack, status }) => `${pack} ${status}`)).toEqual([
        'food new',
        'cookbook duplicate',
        'cookbook named-elsewhere',
        'food named',
      ]);
    });

    it('should use the minimum of the pack: two bottles are a tasting', async () => {
      setup({ wine: [visit({ type: undefined, subjectIds: [newUuid(), newUuid()] })] });
      await expect(sut.notifyNewVisits(auth, config, NOW)).resolves.toHaveLength(1);
    });

    it('should notify the newest visits first, a few per run, and look at the uploads again for the others', async () => {
      const days = ['2026-09-20', '2026-09-26', '2026-09-22', '2026-09-24'];
      setup({
        food: days.map((day) => visit({ day, start: `${day}T20:00:00` })),
        museum: [
          visit({ type: undefined, day: '2026-09-25', start: '2026-09-25T11:00:00', city: 'Évora', subjectIds: six() }),
        ],
      });

      const notified = await sut.notifyNewVisits(auth, { ...config, maxPerRun: 3 }, NOW);

      expect(notified.map(({ pack, key }) => `${pack} ${key.slice(0, 10)}`)).toEqual([
        'food 2026-09-26',
        'museum 2026-09-25',
        'food 2026-09-24',
      ]);
      expect(mocks.notification.create).toHaveBeenCalledTimes(3);
      expect(mocks.collectionNotice.setCheckedAt).not.toHaveBeenCalled();
    });

    it('should not notify a visit notified meanwhile by another run', async () => {
      setup({ food: [visit()] });
      mocks.collectionNotice.claim.mockResolvedValue(undefined);
      await expect(sut.notifyNewVisits(auth, config, NOW)).resolves.toEqual([]);
      expect(mocks.notification.create).not.toHaveBeenCalled();
    });

    it('should forget the notice when the notification could not be sent, to send it next time', async () => {
      setup({ food: [visit()] });
      mocks.collectionNotice.claim.mockResolvedValue({ id: 'notice-id' });
      mocks.notification.create.mockRejectedValue(new Error('database down'));
      await expect(sut.notifyNewVisits(auth, config, NOW)).resolves.toEqual([]);
      expect(mocks.collectionNotice.delete).toHaveBeenCalledWith('notice-id');
    });

    it('should look at the photos uploaded since the last check, within the window', async () => {
      setup({});
      const lastCheck = new Date('2026-09-26T09:00:00Z');
      mocks.collectionNotice.getCheckedAt.mockResolvedValue(lastCheck);
      await sut.notifyNewVisits(auth, config, NOW);
      expect(mocks.collectionNotice.getUploads).toHaveBeenCalledWith(auth.user.id, lastCheck, 2000);

      mocks.collectionNotice.getCheckedAt.mockResolvedValue(new Date('2026-01-01T00:00:00Z'));
      await sut.notifyNewVisits(auth, config, NOW);
      expect(mocks.collectionNotice.getUploads).toHaveBeenLastCalledWith(
        auth.user.id,
        new Date('2026-09-13T09:00:00Z'),
        2000,
      );
    });

    it('should do nothing without new uploads, and move the check on', async () => {
      const findVisits = setup({});
      mocks.collectionNotice.getUploads.mockResolvedValue([]);
      await expect(sut.notifyNewVisits(auth, config, NOW)).resolves.toEqual([]);
      expect(findVisits).not.toHaveBeenCalled();
      expect(mocks.collectionNotice.setCheckedAt).toHaveBeenCalledWith(auth.user.id, NOW);
    });

    it('should go on with the other packs when one fails', async () => {
      const findVisits = setup({});
      findVisits.mockImplementation((_auth, packId) =>
        packId === 'food'
          ? Promise.reject(new Error('broken'))
          : Promise.resolve(visits(packId, packId === 'wine' ? [visit({ type: undefined, city: 'Évora' })] : [])),
      );
      await expect(sut.notifyNewVisits(auth, config, NOW)).resolves.toHaveLength(1);
    });
  });

  it('should be off by default for now, and on for the users once the administrator turns it on', () => {
    expect(defaults.collections.notifications).toEqual({ enabled: false, maxPerRun: 3, windowDays: 14 });
  });
});
