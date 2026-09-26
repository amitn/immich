import {
  compactJson,
  extractRefs,
  extractRefsFromText,
  extractToolCallRefs,
  getImmichToolName,
  getToolCallResult,
  mergeRefs,
  summarizeToolArgs,
} from 'src/utils/agent/session-updates.js';

const id1 = '5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10';
const id2 = '1d7b2c4e-9f5a-4d3b-8e2c-7a6f5e4d3c2b';
const id3 = '0b6f4f3e-7c3d-4d8e-9d4c-6f1f1f0e7b5a';
const id4 = '9a1e2b3c-4d5e-4f60-8a7b-8c9d0e1f2a3b';
const id5 = 'c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f';

const none = { assetIds: [], albumIds: [], bookIds: [] };

/** a `tool_call_update` as claude-agent-acp 0.81 sends it for the result of an MCP tool */
const claudeToolResult = (toolName: string, result: unknown) => {
  const text = JSON.stringify(result);
  return {
    sessionUpdate: 'tool_call_update' as const,
    toolCallId: 'toolu_01AbCdEf',
    _meta: { claudeCode: { toolName: `mcp__immich__${toolName}` } },
    status: 'completed' as const,
    rawOutput: [{ type: 'text', text }],
    content: [{ type: 'content', content: { type: 'text', text } }],
  };
};

const refsOf = (toolName: string, result: unknown) =>
  extractToolCallRefs(toolName, { output: getToolCallResult(claudeToolResult(toolName, result)).values });

describe('tool result refs', () => {
  it('should find the picks of select_best, but not the people or missing photos', () => {
    const result = {
      ids: [id1, id2],
      count: 2,
      mainPeople: [{ id: id3, name: 'Amit', n: 2 }],
      perEvent: { '0': 2 },
      events: 1,
      clusters: 0,
      simulated: 5,
      rescued: 0,
      improvements: [{ id: id2, enhance: { strength: 'subtle' }, gain: 0.04 }],
      missing: [id4],
    };
    expect(refsOf('select_best', result)).toEqual({ ...none, assetIds: [id1, id2] });
  });

  it('should find the items of search_photos', () => {
    const result = {
      items: [
        { id: id1, date: '2024-06-01T18:02:11', city: 'Palermo', country: 'Italy', people: ['Amit'], w: 4032, h: 3024 },
        { id: id2, date: '2024-06-01T18:05:40', w: 3024, h: 4032, fav: true },
      ],
      next: 2,
    };
    expect(refsOf('search_photos', result)).toEqual({ ...none, assetIds: [id1, id2] });
  });

  it('should find the copies of improve_photos', () => {
    const result = {
      improved: [{ sourceId: id1, id: id2, description: 'straightened 1.2°, auto-enhanced' }],
      skipped: [{ id: id3, reason: 'Not found' }],
      copies: { [id1]: id2 },
    };
    expect(refsOf('improve_photos', result)).toEqual({ ...none, assetIds: [id2] });
  });

  it('should find the photos of a view_photos contact sheet and of a single preview', () => {
    expect(refsOf('view_photos', { sheet: { '1': id1, '2': id2 }, noPreview: [id2] })).toEqual({
      ...none,
      assetIds: [id1, id2],
    });
    expect(refsOf('view_photos', { id: id3, date: '2024-06-01T18:02:11', w: 4032, h: 3024 })).toEqual({
      ...none,
      assetIds: [id3],
    });
  });

  it('should find the album of create_album and the photos it was created with', () => {
    const input = { name: 'Best of Sicily', description: 'Our trip', assetIds: [id1, id2] };
    const output = getToolCallResult(
      claudeToolResult('create_album', { id: id3, name: 'Best of Sicily', added: 2, duplicate: 0, failed: 0 }),
    ).values;

    expect(extractToolCallRefs('create_album', { input, output })).toEqual({
      assetIds: [id1, id2],
      albumIds: [id3],
      bookIds: [],
    });
  });

  it('should find the samples and expanded ids of find_events', () => {
    const result = {
      count: 3,
      events: [
        {
          index: 0,
          start: '2024-06-01T09:00:00',
          end: '2024-06-01T12:00:00',
          day: '2024-06-01',
          city: 'Palermo',
          country: 'Italy',
          count: 3,
          people: ['Amit'],
          sampleIds: [id1, id2],
          ids: [id1, id2, id3],
        },
      ],
      days: [{ day: '2024-06-01', count: 3, events: [0] }],
    };
    expect(refsOf('find_events', result)).toEqual({ ...none, assetIds: [id1, id2, id3] });
  });

  it('should find the book and its photos, but not its page ids', () => {
    const page = { page: 1, id: id4, layout: 'cover', slots: [{ slot: 1, aspect: 1, assetId: id1 }] };
    expect(refsOf('get_book', { id: id3, title: 'Sicily', pageCount: 1, pages: [page] })).toEqual({
      assetIds: [id1],
      albumIds: [],
      bookIds: [id3],
    });
    expect(refsOf('add_page', page)).toEqual({ ...none, assetIds: [id1] });
    expect(refsOf('list_books', [{ id: id3, title: 'Sicily', pageCount: 20 }])).toEqual({ ...none, bookIds: [id3] });
  });

  it('should find the copy made by crop_photo', () => {
    expect(refsOf('crop_photo', { id: id2, sourceId: id1, width: 3000, height: 3000, duplicate: false })).toEqual({
      ...none,
      assetIds: [id2],
    });
  });

  it('should not treat the top-level id of other tools as a photo, album or book', () => {
    expect(refsOf('find_people', [{ id: id1, name: 'Amit', n: 120 }])).toEqual(none);
    expect(refsOf('set_caption', { page: 2, id: id1, layout: 'full', caption: 'Palermo', slots: [] })).toEqual(none);
  });

  it('should not show the candidates given to select_best', () => {
    expect(extractToolCallRefs('select_best', { input: { ids: [id1, id2, id5], count: 1 }, output: [] })).toEqual(none);
  });
});

describe('getToolCallResult', () => {
  it('should read the result of a claude-agent-acp tool_call_update once', () => {
    // the same text is sent as content and as rawOutput
    expect(getToolCallResult(claudeToolResult('select_best', { ids: [id1] }))).toEqual({
      texts: [JSON.stringify({ ids: [id1] })],
      values: [{ ids: [id1] }],
    });
  });

  it('should read an error of claude-agent-acp once', () => {
    expect(
      getToolCallResult({
        rawOutput: [{ type: 'text', text: 'Could not create album: Not found' }],
        content: [{ type: 'content', content: { type: 'text', text: '```\nCould not create album: Not found\n```' } }],
      }),
    ).toEqual({ texts: ['```\nCould not create album: Not found\n```'], values: [] });
  });

  it('should read a string rawOutput', () => {
    expect(getToolCallResult({ rawOutput: JSON.stringify({ albumId: id1 }) })).toEqual({
      texts: [JSON.stringify({ albumId: id1 })],
      values: [{ albumId: id1 }],
    });
  });

  it('should read an MCP CallToolResult with structured content', () => {
    const result = getToolCallResult({
      rawOutput: {
        content: [
          { type: 'text', text: '{"id":"x"}' },
          { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
        ],
        structuredContent: { ids: [id1] },
      },
    });
    expect(result).toEqual({ texts: ['{"id":"x"}'], values: [{ id: 'x' }, { ids: [id1] }] });
  });

  it('should ignore content that is not text', () => {
    expect(
      getToolCallResult({
        content: [
          { type: 'content', content: { type: 'image' } },
          { type: 'terminal' },
          { type: 'content', content: { type: 'text', text: 'not json' } },
        ],
      }),
    ).toEqual({ texts: ['not json'], values: [] });
  });
});

describe('food tool refs', () => {
  it('should find the photos of the meals of find_meals', () => {
    const result = {
      count: 40,
      meals: [
        {
          index: 0,
          restaurant: { name: 'Trattoria da Nino', source: 'sign', confidence: 0.8 },
          dishIds: [id1],
          menuIds: [id2],
          signIds: [id3],
          receiptIds: [id4],
          saved: [{ assetId: id1, tag: 'Trattoria da Nino/Carbonara' }],
        },
      ],
    };
    expect(refsOf('find_meals', result)).toEqual({ ...none, assetIds: [id1, id2, id3, id4] });
  });

  it('should find the menu of read_menu from its input and result', () => {
    expect(extractToolCallRefs('read_menu', { input: { id: id1 }, output: [{ id: id1, items: [] }] })).toEqual({
      ...none,
      assetIds: [id1],
    });
  });

  it('should find the dishes of match_dishes and the named photos of set_dish_names', () => {
    expect(
      refsOf('match_dishes', {
        items: [{ i: 0, name: 'Carbonara' }],
        dishes: [{ assetIds: [id1, id2], match: 'Carbonara', i: 0, suggestions: [{ i: 0, name: 'Carbonara' }] }],
        sheet: { 1: id1 },
      }),
    ).toEqual({ ...none, assetIds: [id1, id2] });
    expect(
      extractToolCallRefs('set_dish_names', {
        input: { restaurant: 'Nino', photos: [{ id: id3, dish: 'Carbonara' }] },
        output: [{ restaurant: 'Nino', photos: [{ id: id3, tag: 'Food/Nino/Carbonara' }] }],
      }),
    ).toEqual({ ...none, assetIds: [id3] });
  });
});

describe('collection tool refs', () => {
  it('should find the photos of the visits of find_visits', () => {
    const result = {
      pack: 'food',
      count: 40,
      visits: [
        {
          index: 0,
          place: { name: 'Trattoria da Nino', source: 'sign', confidence: 0.8 },
          subjectIds: [id1],
          sourceIds: [id2],
          signIds: [id3],
          receiptIds: [id4],
          saved: [{ assetId: id1, tag: 'Trattoria da Nino/Carbonara' }],
        },
      ],
    };
    expect(refsOf('find_visits', result)).toEqual({ ...none, assetIds: [id1, id2, id3, id4] });
  });

  it('should find the photos of the answers of query_collections, but not the people', () => {
    const result = {
      total: { visits: 1, places: 1, entries: 2, photos: 3 },
      last: { pack: 'food', place: 'Noma Australia', date: '2016-03-23', entries: ['Rum lamington'], photoIds: [id1] },
      visits: [
        {
          pack: 'food',
          place: 'Noma Australia',
          date: '2016-03-23',
          entries: [
            { name: 'Rum lamington', photoIds: [id1, id2], n: 4 },
            { name: 'Golden petits fours', photoIds: [id3] },
          ],
          sourcePhotoIds: [id4],
        },
      ],
      people: [{ id: id5, name: 'Anna' }],
      notes: ['Only photos named with a collection pack count.'],
    };
    expect(refsOf('query_collections', result)).toEqual({ ...none, assetIds: [id1, id2, id3, id4] });
    expect(refsOf('query_collections', { total: {}, places: [{ place: 'Noma Australia', photoIds: [id5] }] })).toEqual({
      ...none,
      assetIds: [id5],
    });
  });

  it('should find the source of read_source from its input and result', () => {
    expect(
      extractToolCallRefs('read_source', { input: { pack: 'food', id: id1 }, output: [{ id: id1, entries: [] }] }),
    ).toEqual({ ...none, assetIds: [id1] });
  });

  it('should find the subjects of match_subjects and the named photos of save_entries', () => {
    expect(
      refsOf('match_subjects', {
        entries: [{ i: 0, name: 'Carbonara' }],
        subjects: [{ assetIds: [id1, id2], match: 'Carbonara', i: 0, suggestions: [{ i: 0, name: 'Carbonara' }] }],
        sheet: { 1: id1 },
      }),
    ).toEqual({ ...none, assetIds: [id1, id2] });
    expect(
      extractToolCallRefs('save_entries', {
        input: { pack: 'food', place: 'Nino', photos: [{ id: id3, entry: 'Carbonara' }] },
        output: [{ place: 'Nino', photos: [{ id: id3, tag: 'Food/Nino/Carbonara' }] }],
      }),
    ).toEqual({ ...none, assetIds: [id3] });
  });
});

describe('extractRefs', () => {
  it('should find asset, album and book ids', () => {
    expect(
      extractRefs({
        assetIds: [id1],
        coverAssetId: id2,
        album: { id: id3 },
        bookId: id3,
        photos: [{ id: id2, personIds: [id3] }],
        events: [{ id: 'not-a-uuid', sampleAssetIds: [id1] }],
      }),
    ).toEqual({ assetIds: [id1, id2], albumIds: [id3], bookIds: [id3] });
  });

  it('should ignore ids that are not asset ids', () => {
    expect(extractRefs({ id: id1, people: [{ id: id2 }], personId: id3 })).toEqual({
      assetIds: [],
      albumIds: [],
      bookIds: [],
    });
  });

  it('should parse JSON text and skip other text', () => {
    expect(extractRefsFromText(['not json', JSON.stringify({ albumId: id1 })])).toEqual({
      assetIds: [],
      albumIds: [id1],
      bookIds: [],
    });
  });
});

describe('mergeRefs', () => {
  it('should merge without duplicates and omit empty lists', () => {
    expect(mergeRefs({ text: 'a', assetIds: [id1] }, { assetIds: [id1, id2], albumIds: [] })).toEqual({
      text: 'a',
      assetIds: [id1, id2],
    });
  });
});

describe('compactJson', () => {
  it('should cut long strings and arrays', () => {
    const value = compactJson({ data: 'x'.repeat(1000), ids: Array.from({ length: 60 }, (_, i) => i) }) as {
      data: string;
      ids: unknown[];
    };
    expect(value.data).toHaveLength(501);
    expect(value.ids).toHaveLength(51);
    expect(value.ids.at(-1)).toBe('…10 more');
  });
});

describe('summarizeToolArgs', () => {
  it('should describe create_album with readable labels and a photo count', () => {
    expect(
      summarizeToolArgs({
        name: 'Best of Sicily',
        description: 'Our summer trip',
        assetIds: Array.from({ length: 20 }, () => id1),
        skip: undefined,
      }),
    ).toBe('Name: Best of Sicily · Description: Our summer trip · 20 photos');
  });

  it('should leave out album and book ids, which are shown as links', () => {
    expect(summarizeToolArgs({ albumId: id2, assetIds: [id1] })).toBe('1 photo');
    expect(summarizeToolArgs({ bookId: id3 })).toBe('');
  });

  it('should count the photos of improve_photos once', () => {
    expect(
      summarizeToolArgs({
        photos: [
          { id: id1, rotate: 1.2, gain: 0.05 },
          { id: id2, enhance: { strength: 'subtle' } },
        ],
        ids: [id3],
        auto: true,
      }),
    ).toBe('3 photos · Auto: yes');
  });

  it('should describe crops, lists and people', () => {
    expect(
      summarizeToolArgs({
        id: id1,
        aspectRatio: '4:3',
        rectNormalized: { x: 0.1, y: 0, width: 0.8, height: 0.9123 },
        rotate: -1.5,
      }),
    ).toBe('1 photo · Aspect ratio: 4:3 · Crop: x 0.1, y 0, width 0.8, height 0.912 · Rotate: -1.5');
    expect(summarizeToolArgs({ id: id1, only: ['exposure', 'contrast'], personIds: [id2, id3] })).toBe(
      '1 photo · Only: exposure, contrast · 2 people',
    );
  });

  it('should cut long values', () => {
    expect(summarizeToolArgs({ description: 'x'.repeat(100) })).toBe(`Description: ${'x'.repeat(80)}…`);
  });
});

describe('getImmichToolName', () => {
  const tools = new Set(['search_photos']);

  it.each([
    [{ title: 'mcp__immich__search_photos' }, 'search_photos'],
    [{ title: 'Search', name: 'mcp__immich__search_photos' }, 'search_photos'],
    [{ title: 'Search', _meta: { claudeCode: { toolName: 'mcp__immich__search_photos' } } }, 'search_photos'],
    [{ title: 'immich.search_photos' }, 'search_photos'],
    [{ title: 'mcp.immich.search_photos' }, 'search_photos'],
    [{ title: 'immich/search_photos' }, 'search_photos'],
    [{ title: 'search_photos', _meta: { claudeCode: { mcpServer: { name: 'immich' } } } }, 'search_photos'],
    [{ title: 'search_photos' }, undefined],
    [{ title: 'mcp__immich__delete_everything' }, undefined],
    [{ title: 'mcp__evil__search_photos' }, undefined],
    [{ title: 'Bash', name: 'Bash' }, undefined],
  ])('should resolve %j to %s', (toolCall, expected) => {
    expect(getImmichToolName(toolCall, tools)).toBe(expected);
  });
});
