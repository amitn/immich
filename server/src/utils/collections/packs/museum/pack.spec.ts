import { bookStylePresetIds, bookStyleThemes } from 'src/dtos/book.dto.js';
import { AssetType } from 'src/enum.js';
import { AssetService } from 'src/services/asset.service.js';
import { CollectionService } from 'src/services/collection.service.js';
import { TagService } from 'src/services/tag.service.js';
import { getCollectionTag, isCollectionTheme, isPrintedTheme } from 'src/utils/book/collections.js';
import { CollectionKind, getPromptList } from 'src/utils/collections/classify.js';
import { getCollectionMessages, validateCollectionPack } from 'src/utils/collections/pack.js';
import { museumPack } from 'src/utils/collections/packs/museum/pack.js';
import {
  BUILT_IN_COLLECTION_PACKS,
  getCollectionPack,
  getCollectionPackByTagRoot,
} from 'src/utils/collections/registry.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

/** CLIP similarities with the prompts of the museum pack, every prompt of a kind at the given value */
const similarities = (values: Partial<Record<CollectionKind, number>>) =>
  getPromptList(museumPack.prompts).map(({ kind }) => values[kind] ?? 0.15);

const artwork = similarities({ subject: 0.3, other: 0.2 });
const label = similarities({ source: 0.27, other: 0.2 });
const sign = similarities({ sign: 0.28, other: 0.22 });
const hall = similarities({ subject: 0.18, other: 0.3 });

const box = (text: string, left: number, top: number, height = 0.03) => {
  const right = Math.min(1, left + text.length * height * 0.45);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.97 };
};

const labelBoxes = (texts: string[]) => texts.map((text, index) => box(text, 0.1, 0.2 + index * 0.045));

const virgin = labelBoxes([
  'Nicolau Chanterene (act. 1511 circa 1551)',
  'Virgin and Child',
  '1535-1540',
  'Marble',
  'ME 1774',
]);
const calvary = labelBoxes([
  'Gregório Lopes (act. 1513-1550)',
  'Calvary',
  'Oil on panel',
  'Portuguese School, 1544',
  'ME 1522',
]);
const lion = labelBoxes(['6298-6299', 'Lion Capital', 'Ca. 3rd century B.C.E.', 'Chunar Sandstone']);

const eventRow = (id: string, iso: string, extra: Record<string, unknown> = {}) => ({
  id,
  localDateTime: new Date(`${iso}Z`),
  latitude: null,
  longitude: null,
  city: null,
  country: null,
  people: [],
  ...extra,
});

const agentRow = (id: string, iso: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: AssetType.Image,
    localDateTime: new Date(`${iso}Z`),
    latitude: null,
    longitude: null,
    city: null,
    country: null,
    description: '',
    previewPath: `/data/thumbs/${id}.jpeg`,
    faces: [],
    ...extra,
  }) as never;

describe('the museum pack', () => {
  it('should be a valid built-in pack with the Gallery book style', () => {
    expect(validateCollectionPack(museumPack, BUILT_IN_COLLECTION_PACKS)).toEqual([]);
    expect(getCollectionPack('museum')).toBe(museumPack);
    expect(getCollectionPackByTagRoot('Art')).toBe(museumPack);
    expect(bookStylePresetIds).toContain('museum');
    expect(bookStyleThemes).toContain('gallery');
    expect(isCollectionTheme('gallery')).toBe(true);
    expect(isPrintedTheme('gallery')).toBe(false);
    expect(museumPack.book.theme?.look).toBe('gallery');
    expect(museumPack.agent.instructions).toContain('pack "museum"');
  });

  it('should read its tags in books, captioned like a museum label', () => {
    const tag = getCollectionTag(['Art/Museu de Évora/Virgin and Child — Nicolau Chanterene, 1535-1540, marble']);
    expect(tag).toEqual({
      pack: 'museum',
      place: 'Museu de Évora',
      kind: 'entry',
      entry: 'Virgin and Child — Nicolau Chanterene, 1535-1540, marble',
    });
    expect(getCollectionTag(['Art/Museu de Évora/Label'])).toMatchObject({ pack: 'museum', kind: 'source' });
    expect(museumPack.book.caption(tag!.kind === 'entry' ? tag!.entry : '', 'Museu de Évora')).toBe(
      'Virgin and Child\nNicolau Chanterene, 1535-1540, marble',
    );
  });

  it('should speak of artworks and wall labels', () => {
    const messages = getCollectionMessages(museumPack);
    expect(messages.noSource).toBe('No wall label: name the artworks from what you see');
    expect(messages.placeNeedsName).toBe('The museum needs a name');
    expect(messages.unmatchedEntries(['Calvary — Gregório Lopes, 1544, oil on panel'])).toBe(
      '1 label entry matched no artwork (Calvary — Gregório Lopes, 1544, oil on panel): check whether an artwork ' +
        'photo is missing, or matched to another label entry',
    );
  });
});

describe(`${CollectionService.name} with the museum pack`, () => {
  let sut: CollectionService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();

  beforeEach(() => {
    ({ sut, mocks } = newTestService(CollectionService));
    mocks.machineLearning.encodeText.mockImplementation((text: string) => Promise.resolve(`[${text.length},1,0]`));
    mocks.tag.getAssetTagsByPrefix.mockResolvedValue([]);
    mocks.ocr.getByAssetIds.mockResolvedValue([]);
    mocks.asset.getByIds.mockImplementation((ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ id, type: AssetType.Image, deletedAt: null })) as never),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should list the pack with its lookup and book style', () => {
    expect(sut.getPacks().find(({ id }) => id === 'museum')).toEqual({
      id: 'museum',
      title: 'Museum',
      description: expect.stringContaining('museum and gallery visits'),
      tagRoot: 'Art',
      sourceLeaf: 'Label',
      names: expect.objectContaining({ subject: 'artwork', source: 'wall label', place: 'museum' }),
      bookStylePreset: 'museum',
      placeLookup: true,
    });
  });

  it('should find a museum visit across a long pause, with its labels, its sign and without its halls', async () => {
    const albumId = newUuid();
    const [signId, virginId, virginLabel, hallId, calvaryId, calvaryLabel, otherDay] = Array.from({ length: 7 }, () =>
      newUuid(),
    );
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    mocks.assetJob.getForAgentEvents.mockResolvedValue([
      eventRow(signId, '2025-08-28T15:30:00', { city: 'Évora' }),
      eventRow(virginId, '2025-08-28T15:40:24', { city: 'Évora' }),
      eventRow(virginLabel, '2025-08-28T15:40:29', { city: 'Évora' }),
      eventRow(hallId, '2025-08-28T15:50:00', { city: 'Évora' }),
      // an hour later, in the rooms upstairs
      eventRow(calvaryId, '2025-08-28T16:51:41', { city: 'Évora' }),
      eventRow(calvaryLabel, '2025-08-28T16:51:45', { city: 'Évora' }),
      eventRow(otherDay, '2025-09-02T11:00:00', { city: 'Lisboa' }),
    ] as never);
    mocks.search.getEmbeddingSimilarities.mockResolvedValue([
      { assetId: signId, similarities: sign },
      { assetId: virginId, similarities: artwork },
      { assetId: virginLabel, similarities: label },
      { assetId: hallId, similarities: hall },
      { assetId: calvaryId, similarities: artwork },
      { assetId: calvaryLabel, similarities: label },
      { assetId: otherDay, similarities: artwork },
    ]);
    mocks.ocr.getByAssetIds.mockResolvedValue([
      { assetId: signId, ...box('MUSEU DE ÉVORA', 0.2, 0.3, 0.08) },
      ...virgin.map((ocr) => ({ assetId: virginLabel, ...ocr })),
      ...calvary.map((ocr) => ({ assetId: calvaryLabel, ...ocr })),
    ] as never);

    const result = await sut.findVisits(auth, 'museum', { albumId });

    expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(
      'a photo of a museum wall label with text',
      expect.anything(),
    );
    expect(mocks.tag.getAssetTagsByPrefix).toHaveBeenCalledWith(expect.any(Array), 'Art/');
    expect(result).toMatchObject({ pack: 'museum', count: 7, photos: 6, warnings: [] });
    expect(result.visits).toHaveLength(2);
    expect(result.visits[0]).toMatchObject({
      subjectIds: [virginId, calvaryId],
      sourceIds: [virginLabel, calvaryLabel],
      signIds: [signId],
      place: { name: 'Museu de Évora', source: 'sign' },
    });
    expect(result.visits[0].type).toBeUndefined();
    expect(result.visits[1]).toMatchObject({
      subjectIds: [otherDay],
      place: { name: 'Museum visit in Lisboa', source: 'fallback' },
    });
  });

  it('should pair each artwork with the label photographed next to it, and report the labels no artwork matched', async () => {
    const [virginId, virginLabel, calvaryId, calvaryLabel, lionLabel] = Array.from({ length: 5 }, () => newUuid());
    const ids = new Set([virginId, virginLabel, calvaryId, calvaryLabel, lionLabel]);
    mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { ocr: { enabled: false } } });
    mocks.access.asset.checkOwnerAccess.mockImplementation((_userId: string, requested: Set<string>) =>
      Promise.resolve(requested.intersection(ids)),
    );
    mocks.asset.getById.mockImplementation((id: string) =>
      Promise.resolve({ id, type: AssetType.Image, deletedAt: null, exifInfo: null, files: [] } as never),
    );
    const ocr: Record<string, unknown[]> = { [virginLabel]: virgin, [calvaryLabel]: calvary, [lionLabel]: lion };
    mocks.ocr.getByAssetId.mockImplementation((id: string) => Promise.resolve((ocr[id] ?? []) as never));
    const rows: Record<string, ReturnType<typeof agentRow>> = {
      [virginId]: agentRow(virginId, '2025-08-28T15:40:24'),
      [virginLabel]: agentRow(virginLabel, '2025-08-28T15:40:29'),
      // the label of the Calvary was photographed before it
      [calvaryLabel]: agentRow(calvaryLabel, '2025-08-28T16:21:30'),
      [calvaryId]: agentRow(calvaryId, '2025-08-28T16:21:41'),
      [lionLabel]: agentRow(lionLabel, '2025-08-28T16:40:00'),
    };
    mocks.assetJob.getForAgent.mockImplementation((requested: string[]) =>
      Promise.resolve(requested.flatMap((id) => (rows[id] ? [rows[id]] : [])) as never),
    );
    // the capture times of the label photos, for the pack's own assignment
    mocks.asset.getByIds.mockImplementation((requested: string[]) =>
      Promise.resolve(requested.flatMap((id) => (rows[id] ? [rows[id]] : [])) as never),
    );
    // CLIP can't tell the artworks apart: the sequence of the photos does
    mocks.machineLearning.encodeText.mockResolvedValue('[1,0,0,0]');
    mocks.search.getEmbeddings.mockResolvedValue([
      { assetId: virginId, embedding: '[0.9,0.1,0.1,0.3]' },
      { assetId: calvaryId, embedding: '[0.9,0.1,0.1,0.3]' },
    ]);

    const result = await sut.matchVisit(auth, 'museum', {
      subjectIds: [virginId, calvaryId],
      sourceIds: [virginLabel, calvaryLabel, lionLabel],
    });

    // the times of the labels
    expect(mocks.asset.getByIds).toHaveBeenCalledWith([virginLabel, calvaryLabel, lionLabel]);
    expect(result.entries.map(({ name, description, sourceId }) => ({ name, description, sourceId }))).toEqual([
      {
        name: 'Virgin and Child — Nicolau Chanterene, 1535-1540, marble',
        description: 'Inv. ME 1774',
        sourceId: virginLabel,
      },
      { name: 'Calvary — Gregório Lopes, 1544, oil on panel', description: 'Inv. ME 1522', sourceId: calvaryLabel },
      {
        name: 'Lion Capital — c. 3rd century B.C.E., Chunar Sandstone',
        description: 'Inv. 6298-6299',
        sourceId: lionLabel,
      },
    ]);
    expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(
      'a photo of a painting, Calvary (oil on panel)',
      expect.anything(),
    );
    expect(result.subjects.map(({ assetIds, name }) => ({ assetIds, name }))).toEqual([
      { assetIds: [virginId], name: 'Virgin and Child — Nicolau Chanterene, 1535-1540, marble' },
      { assetIds: [calvaryId], name: 'Calvary — Gregório Lopes, 1544, oil on panel' },
    ]);
    expect(result.ordered).toBeUndefined();
    expect(result.warnings).toEqual([
      expect.stringMatching(
        /^1 label entry matched no artwork \(Lion Capital — c\. 3rd century B\.C\.E\., Chunar Sandstone\)/,
      ),
    ]);
  });

  it('should look museums up on OpenStreetMap only when the admin enabled it', async () => {
    mocks.systemMetadata.get.mockResolvedValue({ food: { openStreetMap: { enabled: false } } });
    await expect(sut.lookupPlaces(auth, 'museum', { latitude: 38.57, longitude: -7.91 })).resolves.toEqual({
      enabled: false,
      message: expect.stringContaining('Ask the user for the name of the museum'),
    });
    expect(mocks.map.queryOverpass).not.toHaveBeenCalled();
  });

  it('should look museums and galleries up on OpenStreetMap', async () => {
    mocks.systemMetadata.get.mockResolvedValue({ food: { openStreetMap: { enabled: true } } });
    mocks.map.queryOverpass.mockResolvedValue({
      elements: [
        {
          type: 'way',
          id: 7,
          center: { lat: 38.5725, lon: -7.9077 },
          tags: { name: 'Museu de Évora', tourism: 'museum' },
        },
      ],
    });
    const result = await sut.lookupPlaces(auth, 'museum', { latitude: 38.5724, longitude: -7.9076 });
    expect(mocks.map.queryOverpass).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('["tourism"~"^(museum|gallery)$"]'),
    );
    expect(result).toMatchObject({ enabled: true, places: [{ name: 'Museu de Évora', type: 'museum' }] });
  });

  it('should tag the artworks and the labels of a museum, and describe the artworks', async () => {
    const [virginId, virginLabel] = [newUuid(), newUuid()];
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([virginId, virginLabel]));
    mocks.tag.upsertValue.mockImplementation(({ value }: { value: string }) =>
      Promise.resolve({ id: `tag:${value}`, value } as never),
    );
    const addAssets = vi
      .spyOn(TagService.prototype, 'addAssets')
      .mockImplementation((_, __, { ids }) => Promise.resolve(ids.map((id) => ({ id, success: true }))));
    const update = vi.spyOn(AssetService.prototype, 'update').mockResolvedValue({} as never);
    mocks.assetJob.getForAgent.mockResolvedValue([
      agentRow(virginId, '2025-08-28T15:40:24'),
      agentRow(virginLabel, '2025-08-28T15:40:29'),
    ]);

    const result = await sut.saveEntries(auth, 'museum', {
      place: 'Museu de Évora',
      photos: [
        { id: virginId, entry: 'Virgin and Child — Nicolau Chanterene, 1535-1540, marble' },
        { id: virginLabel, source: true },
      ],
    });

    const entryTag = 'Art/Museu de Évora/Virgin and Child — Nicolau Chanterene, 1535-1540, marble';
    expect(addAssets).toHaveBeenCalledWith(auth, `tag:${entryTag}`, { ids: [virginId] });
    expect(addAssets).toHaveBeenCalledWith(auth, 'tag:Art/Museu de Évora/Label', { ids: [virginLabel] });
    expect(update.mock.calls).toEqual([
      [auth, virginId, { description: 'Virgin and Child · Nicolau Chanterene, 1535-1540 · Museu de Évora' }],
    ]);
    expect(result.results).toEqual([
      {
        id: virginId,
        success: true,
        tag: entryTag,
        description: 'Virgin and Child · Nicolau Chanterene, 1535-1540 · Museu de Évora',
      },
      { id: virginLabel, success: true, tag: 'Art/Museu de Évora/Label' },
    ]);
  });
});
