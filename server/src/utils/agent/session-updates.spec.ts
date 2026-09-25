import {
  compactJson,
  extractRefs,
  extractRefsFromText,
  getImmichToolName,
  mergeRefs,
  summarizeToolArgs,
} from 'src/utils/agent/session-updates.js';

const id1 = '5c3cbd27-5c0d-4f26-8b5a-3b1d6a8f3b10';
const id2 = '1d7b2c4e-9f5a-4d3b-8e2c-7a6f5e4d3c2b';
const id3 = '0b6f4f3e-7c3d-4d8e-9d4c-6f1f1f0e7b5a';

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
  it('should describe arguments in one line', () => {
    expect(summarizeToolArgs({ name: 'Italy', assetIds: [1, 2, 3, 4], crop: { x: 0 }, skip: undefined })).toBe(
      'name: Italy, assetIds: 4 items, crop: {"x":0}',
    );
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
