import { BadRequestException } from '@nestjs/common';
import { COLLECTION_QUERY_ROWS, CollectionService } from 'src/services/collection.service.js';
import { getCollectionPacks } from 'src/utils/collections/registry.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { demoCollectionRows } from 'test/fixtures/collections/demo-tags.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

/** the demo tags as the repository returns them, with a trip and its ticket */
const tagRows = () => [
  ...demoCollectionRows().map((row) => ({ ...row, people: [] as Array<{ name: string }> })),
  {
    assetId: 'b0000000-0000-4000-8000-000000000001',
    value: 'Travel/Crete, October 2016/Flight A3 123 ATH → CHQ PNR: A41NQS',
    localDateTime: new Date('2016-10-03T07:00:00Z'),
    city: 'Chania',
    country: 'Greece',
    people: [{ name: 'Anna' }],
  },
  {
    assetId: 'b0000000-0000-4000-8000-000000000002',
    value: 'Travel/Crete, October 2016/Tickets',
    localDateTime: new Date('2016-10-03T06:00:00Z'),
    city: null,
    country: null,
    people: [],
  },
];

describe(`${CollectionService.name} questions`, () => {
  let sut: CollectionService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();

  beforeEach(() => {
    ({ sut, mocks } = newTestService(CollectionService));
    mocks.tag.getCollectionTags.mockResolvedValue(tagRows() as never);
    mocks.assetJob.getPersonTimesForAgent.mockResolvedValue([]);
  });

  describe('queryCollections', () => {
    it("should read the tags of every pack on the user's photos", async () => {
      await sut.queryCollections(auth, {});
      expect(mocks.tag.getCollectionTags).toHaveBeenCalledWith({
        userId: auth.user.id,
        tagRoots: getCollectionPacks().map(({ tagRoot }) => tagRoot),
        takenAfter: undefined,
        takenBefore: undefined,
        limit: COLLECTION_QUERY_ROWS + 1,
      });
    });

    it('should read the tags of one pack, in a date range', async () => {
      await sut.queryCollections(auth, { pack: 'food', from: '2016', to: '2016-03' });
      expect(mocks.tag.getCollectionTags).toHaveBeenCalledWith(
        expect.objectContaining({
          tagRoots: ['Food'],
          takenAfter: new Date('2016-01-01T00:00:00Z'),
          takenBefore: new Date('2016-04-01T00:00:00Z'),
        }),
      );
    });

    it('should reject an unknown pack, an invalid date and an empty range', async () => {
      await expect(sut.queryCollections(auth, { pack: 'nope' })).rejects.toThrow(/Unknown collection pack/);
      await expect(sut.queryCollections(auth, { from: 'last summer' })).rejects.toThrow(/Invalid date/);
      await expect(sut.queryCollections(auth, { from: '2025', to: '2024' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should answer "what did I eat at The French Laundry?"', async () => {
      const result = await sut.queryCollections(auth, { place: ['french laundry'] });
      expect(result.total).toEqual({ visits: 1, places: 1, entries: 12, photos: 12 });
      expect(result.visits![0]).toMatchObject({ place: 'The French Laundry', date: '2014-01-11', sources: 2 });
      expect(result).not.toHaveProperty('truncated');
    });

    it('should keep travel names redacted and never list the travel documents', async () => {
      const result = await sut.queryCollections(auth, { pack: 'travel', sources: true });
      const text = JSON.stringify(result);
      expect(text).not.toContain('A41NQS');
      expect(text).not.toContain('b0000000-0000-4000-8000-000000000002');
      expect(result.visits![0]).toMatchObject({ place: 'Crete, October 2016', sources: 1, people: ['Anna'] });
    });

    it('should find the people by name and by id, and the visits they were at', async () => {
      const annaId = newUuid();
      const benId = newUuid();
      mocks.person.getByName.mockResolvedValue([{ personGroupId: annaId, name: 'Anna' }] as never);
      mocks.person.getByGroupId.mockResolvedValue({ personGroupId: benId, name: 'Ben' } as never);
      mocks.assetJob.getPersonTimesForAgent.mockResolvedValue([
        { personId: annaId, localDateTime: new Date('2016-03-23T19:00:00Z') },
        { personId: benId, localDateTime: new Date('2016-03-23T21:30:00Z') },
        { personId: annaId, localDateTime: new Date('2013-06-15T09:00:00Z') },
      ]);

      const result = await sut.queryCollections(auth, { people: ['anna', benId] });

      expect(mocks.person.getByName).toHaveBeenCalledWith(auth.user.id, 'anna', { withHidden: false });
      expect(mocks.person.getByGroupId).toHaveBeenCalledWith({ ownerId: auth.user.id, personGroupId: benId });
      expect(mocks.assetJob.getPersonTimesForAgent).toHaveBeenCalledWith({
        userId: auth.user.id,
        personIds: [annaId, benId],
        takenAfter: new Date(new Date('2013-06-15T08:53:24.480Z').getTime() - 3_600_000),
        takenBefore: new Date(new Date('2016-10-03T07:00:00Z').getTime() + 3_600_001),
        limit: 50_000,
      });
      expect(result.people).toEqual([
        { id: annaId, name: 'Anna' },
        { id: benId, name: 'Ben' },
      ]);
      expect(result.visits!.map(({ place, people }) => [place, people])).toEqual([['Noma Australia', ['Anna', 'Ben']]]);
    });

    it('should say when a person is unknown', async () => {
      mocks.person.getByName.mockResolvedValue([]);
      await expect(sut.queryCollections(auth, { people: ['Zed'] })).rejects.toThrow(/No person named "Zed"/);
      mocks.person.getByGroupId.mockResolvedValue(undefined);
      await expect(sut.queryCollections(auth, { people: [newUuid()] })).rejects.toThrow(/Unknown person/);
      expect(mocks.tag.getCollectionTags).not.toHaveBeenCalled();
    });

    it('should say when the tags were truncated', async () => {
      const [first] = tagRows();
      mocks.tag.getCollectionTags.mockResolvedValue(
        Array.from({ length: COLLECTION_QUERY_ROWS + 1 }, () => first) as never,
      );
      const result = await sut.queryCollections(auth, {});
      expect(result.truncated).toBe(true);
    });
  });

  describe('getSummary', () => {
    it('should summarize every pack', async () => {
      const { packs, truncated } = await sut.getSummary(auth);
      expect(truncated).toBe(false);
      expect(packs.map(({ pack }) => pack)).toEqual(getCollectionPacks().map(({ id }) => id));
      expect(packs.find(({ pack }) => pack === 'food')).toMatchObject({
        photos: 36,
        visits: 3,
        places: 3,
        entries: 32,
        sources: 4,
        years: [2013, 2014, 2016],
        recentPlaces: [
          { name: 'Noma Australia', visits: 1, last: '2016-03-23' },
          { name: 'The French Laundry', visits: 1, last: '2014-01-11' },
          { name: "Katz's Delicatessen", visits: 1, last: '2013-06-15' },
        ],
      });
      expect(packs.find(({ pack }) => pack === 'travel')).toMatchObject({ photos: 2, visits: 1, sources: 1 });
      expect(packs.find(({ pack }) => pack === 'museum')).toMatchObject({ photos: 0, years: [], recentPlaces: [] });
    });
  });
});
