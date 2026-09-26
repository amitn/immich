import { AssetFileType, AssetType } from 'src/enum.js';
import { CollectionAgentTools } from 'src/services/agent-tools/collection.tools.js';
import { EnhanceAgentTools } from 'src/services/agent-tools/enhance.tools.js';
import { LibraryAgentTools } from 'src/services/agent-tools/library.tools.js';
import { BookService } from 'src/services/book.service.js';
import { CollectionService, PRIVATE_SOURCE_NOTE } from 'src/services/collection.service.js';
import { EnhanceService } from 'src/services/enhance.service.js';
import { AgentTool } from 'src/utils/agent/tools.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { BookFactory, BookPageFactory } from 'test/factories/book.factory.js';
import { newUuid } from 'test/small.factory.js';
import { newTestService } from 'test/utils.js';

/*
 * Travel documents carry names and booking references: no tool gives the assistant their photos as images, whether
 * they are tagged as the tickets of a trip or only read as one by their text.
 */

const auth = AuthFactory.create();
const ctx = { auth, sessionId: null };

const box = (text: string, left: number, top: number, height = 0.04) => {
  const right = Math.min(1, left + text.length * height * 0.45);
  const bottom = top + height;
  return { x1: left, y1: top, x2: right, y2: top, x3: right, y3: bottom, x4: left, y4: bottom, text, textScore: 0.95 };
};

/** a boarding pass: its text reads as a travel document */
const boardingPass = [
  box('tigerair', 0.04, 0.25),
  box('Name: DOE/JANE MS', 0.03, 0.33),
  box('Flt: IT 231', 0.46, 0.36),
  box('Depart: OKINAWA 0945', 0.03, 0.4),
  box('Seat: 17B', 0.47, 0.44),
  box('Arrive: TAIPEI 1020', 0.03, 0.48),
  box('Date: 12NOV19', 0.46, 0.52),
  box('Boarding gate closes 10 mins before departure', 0.03, 0.58),
];

const row = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: AssetType.Image,
    localDateTime: new Date('2019-11-12T08:00:00Z'),
    fileCreatedAt: new Date('2019-11-12T08:00:00Z'),
    latitude: null,
    longitude: null,
    city: null,
    country: null,
    description: '',
    previewPath: `/data/thumbs/${id}.jpeg`,
    faces: [],
    ...extra,
  }) as never;

const call = (tools: AgentTool[], name: string, input: Record<string, unknown>) => {
  const tool = tools.find((item) => item.name === name)!;
  return tool.handler(ctx, tool.input.parse(input));
};

describe('travel documents and the tools that return images', () => {
  const [ticket, scanned, beach, menu] = [newUuid(), newUuid(), newUuid(), newUuid()];

  /** `ticket` is tagged as the tickets of a trip, `scanned` only reads as a boarding pass, the others are photos */
  const setupSources = (mocks: ReturnType<typeof newTestService>['mocks']) => {
    mocks.tag.getAssetTagsByPrefix.mockImplementation((ids: string[], prefix: string) =>
      Promise.resolve(
        [
          { assetId: ticket, tagId: 'tickets', value: 'Travel/Okinawa, November 2019/Tickets' },
          { assetId: beach, tagId: 'leg', value: 'Travel/Okinawa, November 2019/Flight IT231 Okinawa → Taipei' },
          { assetId: menu, tagId: 'menu', value: 'Food/Nino/Menu' },
        ].filter(({ assetId, value }) => ids.includes(assetId) && value.startsWith(prefix)),
      ),
    );
    mocks.ocr.getByAssetIds.mockImplementation((ids: string[]) =>
      Promise.resolve([
        ...(ids.includes(scanned) ? boardingPass.map((ocr) => ({ assetId: scanned, ...ocr })) : []),
        ...(ids.includes(beach) ? [{ assetId: beach, ...box('WELCOME TO OKINAWA', 0.2, 0.2) }] : []),
      ] as never),
    );
  };

  it('should find the travel documents among photos, tagged or read', async () => {
    const { sut, mocks } = newTestService(CollectionService);
    setupSources(mocks);

    const hidden = await sut.getPrivateSourceIds([ticket, scanned, beach, menu]);

    expect([...hidden].toSorted()).toEqual([ticket, scanned].toSorted());
  });

  it('should not show a travel document in view_photos, alone or on a contact sheet', async () => {
    const { sut, mocks } = newTestService(LibraryAgentTools);
    setupSources(mocks);
    mocks.partner.getAll.mockResolvedValue([]);
    mocks.access.asset.checkOwnerAccess.mockImplementation((_userId: string, ids: Set<string>) =>
      Promise.resolve(new Set(ids)),
    );
    const tools = sut.getTools();

    mocks.assetJob.getForAgent.mockResolvedValue([row(ticket)]);
    const single = await call(tools, 'view_photos', { ids: [ticket] });
    expect(single.content.map(({ type }) => type)).toEqual(['text']);
    expect(single.content[0]).toMatchObject({ text: expect.stringContaining(PRIVATE_SOURCE_NOTE) });
    expect(mocks.media.resizeToJpeg).not.toHaveBeenCalled();

    mocks.assetJob.getForAgent.mockResolvedValue([row(scanned), row(beach)]);
    mocks.media.createContactSheet.mockResolvedValue(Buffer.from('sheet'));
    const sheet = await call(tools, 'view_photos', { ids: [scanned, beach] });
    expect(mocks.media.createContactSheet).toHaveBeenCalledWith(
      [
        { input: null, label: '1' },
        { input: `/data/thumbs/${beach}.jpeg`, label: '2' },
      ],
      expect.anything(),
    );
    expect(JSON.parse((sheet.content[0] as { text: string }).text)).toMatchObject({ hidden: [scanned] });
  });

  it('should not show a travel document on the contact sheet of match_subjects', async () => {
    const { sut, mocks } = newTestService(CollectionAgentTools);
    setupSources(mocks);
    vi.spyOn(CollectionService.prototype, 'matchVisit').mockResolvedValue({
      entries: [{ index: 0, name: 'Flight IT231 Okinawa → Taipei, 12 Nov 2019' }],
      subjects: [ticket, beach].map((id) => ({ assetIds: [id], score: 0.9, unsure: false, suggestions: [] })),
      noEmbedding: [],
      warnings: [],
    });
    mocks.assetJob.getForAgent.mockResolvedValue([row(ticket), row(beach)]);
    mocks.media.createContactSheet.mockResolvedValue(Buffer.from('sheet'));

    const result = await call(sut.getTools(), 'match_subjects', { pack: 'travel', subjectIds: [ticket, beach] });

    const tiles = mocks.media.createContactSheet.mock.calls[0][0];
    expect(tiles.map(({ input }) => input)).toEqual([null, `/data/thumbs/${beach}.jpeg`]);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({
      hidden: [ticket],
      note: PRIVATE_SOURCE_NOTE,
    });
  });

  it('should not show the before and after of a travel document', async () => {
    const { sut, mocks } = newTestService(EnhanceAgentTools);
    setupSources(mocks);
    vi.spyOn(EnhanceService.prototype, 'analyze').mockResolvedValue({ needed: true } as never);
    const preview = vi.spyOn(EnhanceService.prototype, 'renderEnhancePreview');

    const result = await call(sut.getTools(), 'suggest_enhancement', { id: ticket });

    expect(preview).not.toHaveBeenCalled();
    expect(result.content.map(({ type }) => type)).toEqual(['text']);
  });

  it('should blur a travel document placed on a book page rendered for the assistant', async () => {
    const { sut, mocks } = newTestService(BookService);
    setupSources(mocks);
    const book = BookFactory.create();
    const page = BookPageFactory.create({
      bookId: book.id,
      layout: 'two-vertical',
      assets: [
        BookPageFactory.placement({ slot: 0, assetId: ticket }),
        BookPageFactory.placement({ slot: 1, assetId: beach }),
      ],
    });
    mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([ticket, beach]));
    mocks.book.get.mockResolvedValue(book);
    mocks.book.getPages.mockResolvedValue([page]);
    mocks.book.getAssetsForRender.mockResolvedValue(
      [ticket, beach].map((id) => ({
        id,
        type: AssetType.Image,
        originalPath: `/data/library/${id}.jpg`,
        originalFileName: `${id}.jpg`,
        isEdited: false,
        localDateTime: new Date('2019-11-12T08:00:00Z'),
        width: 3000,
        height: 2000,
        exifImageWidth: 3000,
        exifImageHeight: 2000,
        orientation: null,
        files: [{ type: AssetFileType.Preview, path: `/data/thumbs/${id}.jpeg`, isEdited: false }],
      })) as never,
    );
    mocks.media.resizeToJpeg.mockResolvedValue(Buffer.from('tiny'));
    mocks.media.composeBookPage.mockResolvedValue({ data: Buffer.from('jpeg'), slots: [] });

    const forAssistant = await sut.renderPage(auth, book.id, page.id, {}, true);

    expect(forAssistant.hidden).toEqual([ticket]);
    expect(mocks.media.resizeToJpeg).toHaveBeenCalledWith(`/data/thumbs/${ticket}.jpeg`, 12);
    const spec = mocks.media.composeBookPage.mock.calls[0][0];
    expect(spec.slots[0]).toMatchObject({ input: Buffer.from('tiny') });
    expect(spec.slots[1]).toMatchObject({ input: `/data/thumbs/${beach}.jpeg` });

    // the user's own render shows the page as it is
    const forUser = await sut.renderPage(auth, book.id, page.id);
    expect(forUser.hidden).toBeUndefined();
    expect(mocks.media.composeBookPage.mock.calls[1][0].slots[0]).toMatchObject({
      input: `/data/thumbs/${ticket}.jpeg`,
    });
  });
});
