import { AuthDto } from 'src/dtos/auth.dto.js';
import { QUESTION_NOTES, QuestionAgentTools } from 'src/services/agent-tools/question.tools.js';
import { ASSISTANT_INSTRUCTIONS } from 'src/utils/agent/instructions.js';
import { extractToolCallRefs } from 'src/utils/agent/session-updates.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { getCollectionPacks } from 'src/utils/collections/registry.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { demoCollectionRows } from 'test/fixtures/collections/demo-tags.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  expect(result.content[0].type).toBe('text');
  return JSON.parse((result.content[0] as { text: string }).text);
};

const tagRows = () => demoCollectionRows().map((row) => ({ ...row, people: [] as Array<{ name: string }> }));

describe(QuestionAgentTools.name, () => {
  let sut: QuestionAgentTools;
  let mocks: ServiceMocks;
  let auth: AuthDto;

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name);
    if (!tool) {
      throw new Error(`Unknown tool ${name}`);
    }
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(QuestionAgentTools));
    mocks.tag.getCollectionTags.mockResolvedValue(tagRows() as never);
    auth = AuthFactory.create();
  });

  it('should expose read-only tools that know every pack', () => {
    const tools = sut.getTools();
    expect(tools.map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'query_collections', mutating: false },
      { name: 'summarize_collections', mutating: false },
    ]);
    const query = tools[0];
    for (const pack of getCollectionPacks()) {
      expect(query.description).toContain(`${pack.id} (${pack.tagRoot}/`);
    }
    expect(() => query.input.parse({ pack: 'nope' })).toThrow();
    expect(query.input.parse({})).toEqual({});
  });

  it('should be in the instructions of the assistant', () => {
    expect(ASSISTANT_INSTRUCTIONS).toContain('Questions about the library:');
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/call query_collections first/);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/Never invent/);
  });

  it('should answer "what did I eat at The French Laundry?"', async () => {
    const result = parse(await call('query_collections', { place: 'french laundry' }));
    expect(result.total).toEqual({ visits: 1, places: 1, entries: 12, photos: 12 });
    expect(result.visits).toHaveLength(1);
    expect(result.visits[0]).toMatchObject({
      pack: 'food',
      place: 'The French Laundry',
      date: '2014-01-11',
      type: 'Lunch',
      sources: 2,
    });
    expect(result.visits[0].entries[0]).toEqual({
      name: 'Gougères',
      photoIds: ['7144b65c-9b36-4845-9280-0522144198e6'],
    });
    expect(result.notes).toEqual([QUESTION_NOTES.tagsOnly]);
  });

  it('should take alternatives for the entry, and say that names are matched by their words', async () => {
    const result = parse(
      await call('query_collections', { entry: ['desserts', 'petits fours'], order: 'asc', includeSources: true }),
    );
    expect(result.visits.map(({ place }: { place: string }) => place)).toEqual([
      'The French Laundry',
      'Noma Australia',
    ]);
    expect(result.visits[0].sourcePhotoIds).toEqual([
      'f47aed56-a50d-4c63-b16c-e74fc54d6944',
      'a363d7df-e4c1-405e-ada9-5bf7f8e1d34d',
    ]);
    expect(result.notes).toEqual([QUESTION_NOTES.tagsOnly, QUESTION_NOTES.byName]);
  });

  it('should list the places of a pack', async () => {
    const result = parse(await call('query_collections', { pack: 'food', from: '2014', detail: 'places' }));
    // the dates are filtered by the repository
    expect(mocks.tag.getCollectionTags).toHaveBeenCalledWith(
      expect.objectContaining({ tagRoots: ['Food'], takenAfter: new Date('2014-01-01T00:00:00Z') }),
    );
    expect(result.places.map(({ place }: { place: string }) => place)).toEqual([
      'Noma Australia',
      'The French Laundry',
      "Katz's Delicatessen",
    ]);
    expect(result).not.toHaveProperty('visits');
  });

  it('should return a tool error for an invalid date', async () => {
    const result = await call('query_collections', { from: 'last summer' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringMatching(/Invalid date/) });
  });

  it('should let the chat show the photos of the answer', async () => {
    const output = parse(await call('query_collections', { place: 'katz', includeSources: true }));
    const refs = extractToolCallRefs('query_collections', { input: { place: 'katz' }, output: [output] });
    expect(refs.assetIds).toEqual(
      expect.arrayContaining([
        'e95ba90a-30e0-4e29-a993-083420913d53',
        'cccbda84-27a4-4b82-81fa-afe9c79db73d',
        'ad3e0356-6091-420b-92d9-e3ffe04cbf3b',
      ]),
    );
    expect(refs.albumIds).toEqual([]);
    expect(refs.bookIds).toEqual([]);
  });

  it('should summarize the collections, leaving the empty packs aside', async () => {
    const result = parse(await call('summarize_collections', {}));
    expect(result.packs).toEqual([
      {
        pack: 'food',
        title: 'Food',
        place: 'restaurant',
        entry: 'menu items',
        visit: 'meals',
        photos: 36,
        visits: 3,
        places: 3,
        entries: 32,
        sources: 4,
        years: [2013, 2014, 2016],
        first: '2013-06-15',
        last: '2016-03-23',
        recentPlaces: [
          { name: 'Noma Australia', visits: 1, last: '2016-03-23' },
          { name: 'The French Laundry', visits: 1, last: '2014-01-11' },
          { name: "Katz's Delicatessen", visits: 1, last: '2013-06-15' },
        ],
      },
    ]);
    expect(result.empty).toEqual(
      getCollectionPacks()
        .map(({ id }) => id)
        .filter((id) => id !== 'food'),
    );
  });
});
