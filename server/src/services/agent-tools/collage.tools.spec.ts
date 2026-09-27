import { BadRequestException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { CollageAgentTools } from 'src/services/agent-tools/collage.tools.js';
import { CollageService } from 'src/services/collage.service.js';
import { ASSISTANT_INSTRUCTIONS } from 'src/utils/agent/instructions.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { newTestService } from 'test/utils.js';

describe(CollageAgentTools.name, () => {
  let sut: CollageAgentTools;
  let auth: AuthDto;
  const assetIds = [newUuid(), newUuid(), newUuid(), newUuid()];

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name)!;
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut } = newTestService(CollageAgentTools));
    auth = AuthFactory.create();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should save collages only with approval', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'preview_collage', mutating: false },
      { name: 'make_collage', mutating: true },
    ]);
  });

  it('should tell the assistant to suggest collage sets, e.g. the best 4 photos of each day', () => {
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/make_collage/);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/best 4 photos of each day/);
  });

  it('should limit a collage to 2 to 9 photos', () => {
    const tool = sut.getTools().find(({ name }) => name === 'make_collage')!;
    expect(() => tool.input.parse({ assetIds: [newUuid()] })).toThrow();
    expect(() => tool.input.parse({ assetIds: Array.from({ length: 10 }, () => newUuid()) })).toThrow();
    expect(() => tool.input.parse({ assetIds, aspectRatio: '3:2' })).toThrow();
  });

  it('should preview a collage with its layouts', async () => {
    vi.spyOn(CollageService.prototype, 'getLayouts').mockResolvedValue({
      layouts: [
        { id: 'four-grid', name: 'Four grid', description: '' },
        { id: 'hero-three', name: 'Hero + three', description: '' },
      ],
    });
    const render = vi.spyOn(CollageService.prototype, 'render').mockResolvedValue(Buffer.from('jpeg'));

    const result = await call('preview_collage', { assetIds, aspectRatio: '4:5' });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      layout: 'four-grid',
      layouts: [
        { id: 'four-grid', name: 'Four grid' },
        { id: 'hero-three', name: 'Hero + three' },
      ],
    });
    expect(result.content[1]).toEqual({
      type: 'image',
      data: Buffer.from('jpeg').toString('base64'),
      mimeType: 'image/jpeg',
    });
    expect(render).toHaveBeenCalledWith(auth, { assetIds, aspectRatio: '4:5' });
  });

  it('should make a collage', async () => {
    const create = vi.spyOn(CollageService.prototype, 'create').mockResolvedValue({
      assetId: 'collage-id',
      duplicate: false,
      layout: 'four-grid',
      tag: 'Collages/Day 1',
    });

    const result = await call('make_collage', { assetIds, title: 'Day 1', stylePreset: 'bold' });

    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      assetId: 'collage-id',
      duplicate: false,
      layout: 'four-grid',
      tag: 'Collages/Day 1',
    });
    expect(create).toHaveBeenCalledWith(auth, { assetIds, title: 'Day 1', stylePreset: 'bold' }, undefined);
  });

  it('should return the error of the service', async () => {
    vi.spyOn(CollageService.prototype, 'create').mockRejectedValue(new BadRequestException('Not a photo'));
    const result = await call('make_collage', { assetIds });
    expect(result).toEqual({ content: [{ type: 'text', text: 'Not a photo' }], isError: true });
  });
});
