import sharp from 'sharp';
import { defaultBookStyle } from 'src/dtos/book.dto.js';
import { AssetFileType, AssetType } from 'src/enum.js';
import { BookStyleAgentTools, getBookStyleThemes } from 'src/services/agent-tools/book-style.tools.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { BookFactory } from 'test/factories/book.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newDate, newUuid, newUuidV7 } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  expect(result.content[0].type).toBe('text');
  return JSON.parse((result.content[0] as { text: string }).text);
};

const errorText = (result: AgentToolResult) => {
  expect(result.isError).toBe(true);
  return (result.content[0] as { text: string }).text;
};

const renderAsset = (id = newUuid()) => ({
  id,
  type: AssetType.Image,
  originalPath: '/data/library/photo.jpg',
  originalFileName: 'photo.jpg',
  isEdited: false,
  localDateTime: new Date('2025-06-01T10:00:00.000Z'),
  width: 3000,
  height: 2000,
  exifImageWidth: 3000,
  exifImageHeight: 2000,
  orientation: null,
  files: [
    { type: AssetFileType.Preview, path: '/data/thumbs/preview.jpeg', isEdited: false },
    { type: AssetFileType.Thumbnail, path: '/data/thumbs/thumbnail.webp', isEdited: false },
  ],
});

const styleRow = (dto: Record<string, unknown> = {}) => ({
  id: newUuid(),
  ownerId: authStub.admin.user.id,
  name: 'Polaroid',
  description: 'A 1970s album',
  style: { ...defaultBookStyle, background: '#efe6d2', fontFamily: 'FreeMono, monospace' },
  createdAt: newDate(),
  updatedAt: newDate(),
  updateId: newUuidV7(),
  ...dto,
});

describe(BookStyleAgentTools.name, () => {
  let sut: BookStyleAgentTools;
  let mocks: ServiceMocks;
  const auth = authStub.admin;

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name);
    if (!tool) {
      throw new Error(`Unknown tool ${name}`);
    }
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  const isMutating = (name: string) => sut.getTools().find((tool) => tool.name === name)?.mutating;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(BookStyleAgentTools));
    mocks.tag.getAssetTagsByPrefix.mockResolvedValue([]);
    mocks.ocr.getByAssetIds.mockResolvedValue([]);
    mocks.tag.getAssetTagValues.mockResolvedValue([]);
  });

  it('should only ask for approval to save and apply', () => {
    expect(isMutating('list_book_styles')).toBe(false);
    expect(isMutating('get_photo_palette')).toBe(false);
    expect(isMutating('preview_book_style')).toBe(false);
    expect(isMutating('save_book_style')).toBe(true);
    expect(isMutating('apply_book_style')).toBe(true);
  });

  describe('list_book_styles', () => {
    it('should list the presets, the styles of the user, the fonts and the themes', async () => {
      mocks.book.getStyles.mockResolvedValue([styleRow()]);
      const result = parse(await call('list_book_styles', {}));

      expect(result.presets.map((preset: { id: string }) => preset.id)).toContain('classic');
      expect(result.yourStyles).toEqual([expect.objectContaining({ name: 'Polaroid' })]);
      expect(result.fonts).toContainEqual(expect.objectContaining({ fontFamily: 'FreeMono, monospace' }));
      expect(result.themes).toEqual(getBookStyleThemes());
      expect(result.themes.map((theme: { look: string }) => theme.look)).toEqual(
        expect.arrayContaining(['plain', 'printed', 'gallery']),
      );
    });
  });

  describe('preview_book_style', () => {
    it('should return an image of the style', async () => {
      const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#efe6d2' } })
        .jpeg()
        .toBuffer();
      mocks.media.composeBookPage.mockResolvedValue({ data: jpeg, slots: [] });
      const asset = renderAsset();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.book.getAssetsForRender.mockResolvedValue([asset]);

      const result = await call('preview_book_style', {
        style: { background: '#efe6d2', textColor: '#3b2f25', fontFamily: 'FreeMono, monospace' },
        assetIds: [asset.id],
        title: 'Summer 1976',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[1]).toEqual({ type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' });
      const details = JSON.parse((result.content[0] as { text: string }).text);
      expect(details.pages).toEqual([1, 2, 3]);
      expect(details.contrast.text).toBeGreaterThan(7);
      expect(mocks.media.composeBookPage.mock.calls[0][0].overlay).toContain('Summer 1976');
    });

    it('should explain why a style is refused', async () => {
      const asset = renderAsset();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      const text = errorText(
        await call('preview_book_style', {
          style: { fontFamily: 'Brush Script MT' },
          assetIds: [asset.id],
        }),
      );
      expect(text).toContain('"Brush Script MT" is not available');
    });

    it('should need a book or photos', async () => {
      expect(errorText(await call('preview_book_style', { style: {} }))).toContain('Pass a bookId');
    });

    it('should reject invalid colours in the input', () => {
      expect(() => call('preview_book_style', { style: { background: 'ivory' }, assetIds: [newUuid()] })).toThrow();
    });
  });

  describe('get_photo_palette', () => {
    it('should return the colours of the photos', async () => {
      const asset = renderAsset();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.book.getAssetsForRender.mockResolvedValue([asset]);
      const { data, info } = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c9a13b' } })
        .raw()
        .toBuffer({ resolveWithObject: true });
      mocks.media.getSmallRgb.mockResolvedValue({ data, info: info as never });

      const result = parse(await call('get_photo_palette', { assetIds: [asset.id] }));

      expect(result.dominant.hex).toBe('#c9a13b');
      expect(result.suggestion).toEqual({
        background: expect.any(String),
        textColor: expect.any(String),
        accentColor: expect.any(String),
      });
    });
  });

  describe('save_book_style', () => {
    it('should save a valid style', async () => {
      mocks.book.createStyle.mockImplementation((values) => Promise.resolve(styleRow(values as never)));

      const result = parse(
        await call('save_book_style', {
          name: 'Polaroid',
          description: 'A 1970s album',
          style: { background: '#efe6d2', textColor: '#3b2f25', fontFamily: 'FreeMono, monospace' },
        }),
      );

      expect(result.name).toBe('Polaroid');
      expect(mocks.book.createStyle).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: auth.user.id, style: expect.objectContaining({ marginMm: 12 }) }),
      );
    });

    it('should not save an unreadable style', async () => {
      const text = errorText(
        await call('save_book_style', {
          name: 'Ghost',
          description: 'White on white',
          style: { background: '#ffffff', textColor: '#f4f4f4' },
        }),
      );
      expect(text).toContain("can't be read");
      expect(mocks.book.createStyle).not.toHaveBeenCalled();
    });

    it('should need a name', () => {
      expect(() => call('save_book_style', { name: ' ', description: '', style: {} })).toThrow();
    });
  });

  describe('apply_book_style', () => {
    it('should copy a saved style into the book', async () => {
      const book = BookFactory.create({ ownerId: auth.user.id });
      const row = styleRow();
      mocks.access.book.checkOwnerAccess.mockResolvedValue(new Set([book.id]));
      mocks.access.bookStyle.checkOwnerAccess.mockResolvedValue(new Set([row.id]));
      mocks.book.get.mockResolvedValue(book);
      mocks.book.getPages.mockResolvedValue([]);
      mocks.book.getStyle.mockResolvedValue(row);
      mocks.book.update.mockResolvedValue();

      parse(await call('apply_book_style', { bookId: book.id, styleId: row.id }));

      expect(mocks.book.update).toHaveBeenCalledWith(book.id, expect.objectContaining({ style: row.style }));
    });

    it('should need a style or a preset, not both', async () => {
      expect(errorText(await call('apply_book_style', { bookId: newUuid() }))).toContain('either');
      expect(
        errorText(await call('apply_book_style', { bookId: newUuid(), styleId: newUuid(), preset: 'soft' })),
      ).toContain('either');
    });
  });
});
