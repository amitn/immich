import type { MockInstance } from 'vitest';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { MemoryExclusionType } from 'src/enum.js';
import { YearRecapAgentTools } from 'src/services/agent-tools/year-recap.tools.js';
import { MemoryExclusionService } from 'src/services/memory-exclusion.service.js';
import { YearRecapService } from 'src/services/year-recap.service.js';
import { ASSISTANT_INSTRUCTIONS } from 'src/utils/agent/instructions.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  return JSON.parse((result.content[0] as { text: string }).text);
};

describe(YearRecapAgentTools.name, () => {
  let sut: YearRecapAgentTools;
  let mocks: ServiceMocks;
  let auth: AuthDto;
  let change: MockInstance<MemoryExclusionService['change']>;
  let createVideo: MockInstance<YearRecapService['createVideo']>;
  let createBook: MockInstance<YearRecapService['createBook']>;
  let get: MockInstance<YearRecapService['get']>;

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name)!;
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(YearRecapAgentTools));
    auth = AuthFactory.create();
    change = vi
      .spyOn(MemoryExclusionService.prototype, 'change')
      .mockResolvedValue({ added: [{ id: 'e1' }], removedIds: [], exclusions: [{}] } as never);
    createVideo = vi
      .spyOn(YearRecapService.prototype, 'createVideo')
      .mockResolvedValue({ id: 'h1', title: '2025 in review', status: 'pending', format: 'vertical' } as never);
    createBook = vi
      .spyOn(YearRecapService.prototype, 'createBook')
      .mockResolvedValue({ reason: 'Your 2025', book: { id: 'b1', title: '2025 in review', pageCount: 30 } } as never);
    get = vi
      .spyOn(YearRecapService.prototype, 'get')
      .mockResolvedValue({ year: 2025, memoryId: 'm1', stats: { count: 10 } } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for approval only to change something', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'get_memory_exclusions', mutating: false },
      { name: 'set_memory_exclusions', mutating: true },
      { name: 'get_year_recap', mutating: false },
      { name: 'make_year_recap_video', mutating: true },
      { name: 'make_year_recap_book', mutating: true },
    ]);
  });

  it('tells the assistant to leave someone out of one recap without excluding them for good', () => {
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/my 2026 recap without Dana/);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/set_memory_exclusions/);
  });

  it('lists the exclusions', async () => {
    vi.spyOn(MemoryExclusionService.prototype, 'getAll').mockResolvedValue({
      exclusions: [
        {
          id: 'e1',
          type: MemoryExclusionType.Person,
          person: { id: 'p1', name: 'Rex', isPet: true },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'e2',
          type: MemoryExclusionType.DateRange,
          startDate: '2026-03-01',
          endDate: '2026-03-14',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      documents: true,
    });

    expect(parse(await call('get_memory_exclusions', {}))).toEqual({
      exclusions: [
        { exclusionId: 'e1', type: 'person', personId: 'p1', name: 'Rex', isPet: true },
        { exclusionId: 'e2', type: 'date_range', startDate: '2026-03-01', endDate: '2026-03-14' },
      ],
      documents: true,
    });
  });

  it('leaves people and pets out by name, and days, in one change', async () => {
    mocks.memoryExclusion.findPeopleByName.mockResolvedValue([{ id: 'rex', name: 'Rex', type: 'pet' }]);

    const result = parse(
      await call('set_memory_exclusions', {
        personIds: ['dana'],
        peopleNamed: ['rex'],
        dateRanges: [{ startDate: '2026-03-01', endDate: '2026-03-14' }],
        documents: true,
      }),
    );

    expect(change).toHaveBeenCalledWith(
      auth,
      {
        add: [
          { type: MemoryExclusionType.Person, personId: 'dana' },
          { type: MemoryExclusionType.Person, personId: 'rex' },
          { type: MemoryExclusionType.DateRange, startDate: '2026-03-01', endDate: '2026-03-14' },
        ],
        removeIds: undefined,
        documents: true,
      },
      undefined,
    );
    expect(result).toMatchObject({ added: ['e1'] });
  });

  it('says when nobody has a name', async () => {
    mocks.memoryExclusion.findPeopleByName.mockResolvedValue([]);

    const result = await call('set_memory_exclusions', { peopleNamed: ['Nobody'] });

    expect(result.isError).toBe(true);
    expect(change).not.toHaveBeenCalled();
  });

  it('makes a vertical recap video without someone, for that recap only', async () => {
    mocks.memoryExclusion.findPeopleByName.mockResolvedValue([{ id: 'dana', name: 'Dana', type: 'person' }]);

    const result = parse(
      await call('make_year_recap_video', { year: 2026, format: 'vertical', excludePeopleNamed: ['Dana'] }),
    );

    expect(createVideo).toHaveBeenCalledWith(
      auth,
      2026,
      expect.objectContaining({ excludePersonIds: ['dana'], format: 'vertical' }),
      undefined,
    );
    expect(change).not.toHaveBeenCalled();
    expect(result).toMatchObject({ highlightId: 'h1', format: 'vertical' });
  });

  it('makes the recap book without some days', async () => {
    const result = parse(
      await call('make_year_recap_book', {
        year: 2026,
        excludeDateRanges: [{ startDate: '2026-02-01', endDate: '2026-02-28' }],
      }),
    );

    expect(createBook).toHaveBeenCalledWith(
      auth,
      2026,
      expect.objectContaining({ excludeDateRanges: [{ startDate: '2026-02-01', endDate: '2026-02-28' }] }),
    );
    expect(result).toMatchObject({ bookId: 'b1', pageCount: 30 });
  });

  it('refuses a range of days that ends before it starts', async () => {
    const result = await call('make_year_recap_book', {
      year: 2026,
      excludeDateRanges: [{ startDate: '2026-03-01', endDate: '2026-02-01' }],
    });

    expect(result.isError).toBe(true);
    expect(createBook).not.toHaveBeenCalled();
  });

  it('gives the stats of a year', async () => {
    expect(parse(await call('get_year_recap', { year: 2025 }))).toEqual({
      year: 2025,
      memoryId: 'm1',
      stats: { count: 10 },
    });
    expect(get).toHaveBeenCalledWith(auth, 2025, expect.objectContaining({ excludePersonIds: [] }));
  });
});
