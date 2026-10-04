import { AssetType } from 'src/enum.js';
import { CollectionAgentTools } from 'src/services/agent-tools/collection.tools.js';
import { CollectionService, SourceReading } from 'src/services/collection.service.js';
import { AgentTool } from 'src/utils/agent/tools.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { newTestService } from 'test/utils.js';

/* The assistant is the main reader of labels: the tools hand it crops of them, not only the whole photos. */

const auth = AuthFactory.create();
const ctx = { auth, sessionId: null };

const call = (tools: AgentTool[], name: string, input: Record<string, unknown>) => {
  const tool = tools.find((item) => item.name === name)!;
  return tool.handler(ctx, tool.input.parse(input));
};

const row = (id: string) =>
  ({
    id,
    type: AssetType.Image,
    localDateTime: new Date('2013-11-28T12:30:00Z'),
    latitude: null,
    longitude: null,
    city: null,
    country: null,
    description: '',
    previewPath: `/data/thumbs/${id}.jpeg`,
    faces: [],
  }) as never;

describe('the tools with wine labels', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should zoom read_source on the label of a bottle', async () => {
    const { sut } = newTestService(CollectionAgentTools);
    const bottle = newUuid();
    vi.spyOn(CollectionService.prototype, 'readSource').mockResolvedValue({
      items: [{ name: 'Kudos · 2012', column: 0, box: [0.49, 0.65, 0.9, 0.9] }],
      sections: [],
      columns: 1,
      lines: 3,
      assetId: bottle,
      ocr: 'tiles',
      place: [],
      warnings: [],
      previewPath: null,
      width: 1936,
      height: 2592,
    } satisfies SourceReading);
    const images = vi
      .spyOn(CollectionService.prototype, 'getSourceImages')
      .mockResolvedValue([Buffer.from('preview'), Buffer.from('label')]);

    const result = await call(sut.getTools(), 'read_source', { pack: 'wine', id: bottle });

    expect(images).toHaveBeenCalledWith(auth, bottle, {
      zoom: true,
      focus: { x: 0.262, y: 0.55, width: 0.738, height: 0.45 },
    });
    expect(result.content.map(({ type }) => type)).toEqual(['text', 'image', 'image']);
    expect(JSON.parse((result.content[0] as { text: string }).text).entries).toEqual([{ i: 0, name: 'Kudos · 2012' }]);
  });

  it('should show the labels on the contact sheet of match_subjects', async () => {
    const { sut, mocks } = newTestService(CollectionAgentTools);
    const [kudos, glass, blank] = [newUuid(), newUuid(), newUuid()];
    vi.spyOn(CollectionService.prototype, 'matchVisit').mockResolvedValue({
      entries: [{ index: 0, name: 'Kudos · 2012', sourceId: kudos }],
      subjects: [
        { assetIds: [glass, kudos], index: 0, name: 'Kudos · 2012', score: 0.57, unsure: true, suggestions: [] },
        { assetIds: [blank], score: 0, unsure: true, suggestions: [] },
      ],
      noEmbedding: [],
      warnings: [],
    });
    const crops = vi
      .spyOn(CollectionService.prototype, 'getEntryCrops')
      .mockResolvedValue(new Map([[kudos, Buffer.from('kudos label')]]));
    mocks.tag.getAssetTagsByPrefix.mockResolvedValue([]);
    mocks.ocr.getByAssetIds.mockResolvedValue([]);
    mocks.assetJob.getForAgent.mockResolvedValue([row(glass), row(blank)]);
    mocks.media.createContactSheet.mockResolvedValue(Buffer.from('sheet'));

    await call(sut.getTools(), 'match_subjects', { pack: 'wine', subjectIds: [glass, kudos, blank] });

    expect(crops).toHaveBeenCalledWith(auth, 'wine', [glass, kudos, blank]);
    const [tiles, options] = mocks.media.createContactSheet.mock.calls[0];
    // the crop of the label read on the bottle's photos, else the photo
    expect(tiles.map(({ input }) => input)).toEqual([Buffer.from('kudos label'), `/data/thumbs/${blank}.jpeg`]);
    expect(options).toEqual({ tileSize: 400 });
  });

  it('should keep the contact sheet of other packs as it was', async () => {
    const { sut, mocks } = newTestService(CollectionAgentTools);
    const dish = newUuid();
    vi.spyOn(CollectionService.prototype, 'matchVisit').mockResolvedValue({
      entries: [],
      subjects: [{ assetIds: [dish], score: 0, unsure: true, suggestions: [] }],
      noEmbedding: [],
      warnings: [],
    });
    const crops = vi.spyOn(CollectionService.prototype, 'getEntryCrops');
    mocks.tag.getAssetTagsByPrefix.mockResolvedValue([]);
    mocks.ocr.getByAssetIds.mockResolvedValue([]);
    mocks.assetJob.getForAgent.mockResolvedValue([row(dish)]);
    mocks.media.createContactSheet.mockResolvedValue(Buffer.from('sheet'));

    await call(sut.getTools(), 'match_subjects', { pack: 'food', subjectIds: [dish] });

    expect(crops).not.toHaveBeenCalled();
    expect(mocks.media.createContactSheet.mock.calls[0][1]).toEqual({ tileSize: 320 });
  });
});
