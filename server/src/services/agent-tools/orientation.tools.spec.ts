import { BadRequestException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { OrientationStatus } from 'src/enum.js';
import { OrientationAgentTools } from 'src/services/agent-tools/orientation.tools.js';
import { OrientationService } from 'src/services/orientation.service.js';
import { ASSISTANT_INSTRUCTIONS } from 'src/utils/agent/instructions.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  return JSON.parse((result.content[0] as { text: string }).text);
};

const suggestion = (assetId: string) => ({
  assetId,
  status: OrientationStatus.Suggested,
  rotate: 90,
  confidence: 0.93,
  reasons: ['CLIP: upright when turned 90° (93%)'],
  checkedAt: new Date(),
});

describe(OrientationAgentTools.name, () => {
  let sut: OrientationAgentTools;
  let auth: AuthDto;

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = sut.getTools().find((tool) => tool.name === name)!;
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut } = newTestService(OrientationAgentTools));
    auth = AuthFactory.create();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should find freely and fix only with approval', () => {
    expect(sut.getTools().map(({ name, mutating }) => ({ name, mutating }))).toEqual([
      { name: 'find_rotated_photos', mutating: false },
      { name: 'fix_rotation', mutating: true },
    ]);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/find_rotated_photos/);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/fix_rotation/);
  });

  it('should list what the background check found', async () => {
    const getSuggestions = vi
      .spyOn(OrientationService.prototype, 'getSuggestions')
      .mockResolvedValue([suggestion('a')]);
    const find = vi.spyOn(OrientationService.prototype, 'find');

    expect(parse(await call('find_rotated_photos', {}))).toEqual({
      source: 'background check',
      photos: [{ assetId: 'a', rotate: 90, confidence: 0.93, reasons: ['CLIP: upright when turned 90° (93%)'] }],
    });
    expect(getSuggestions).toHaveBeenCalledWith(auth, OrientationStatus.Suggested);
    expect(find).not.toHaveBeenCalled();
  });

  it('should check an album now', async () => {
    const find = vi
      .spyOn(OrientationService.prototype, 'find')
      .mockResolvedValue([{ assetId: 'a', rotate: 180, confidence: 0.8, reasons: [] }]);

    expect(parse(await call('find_rotated_photos', { albumId: 'album-id', takenAfter: '2025-06-01' }))).toEqual({
      source: 'checked now',
      photos: [{ assetId: 'a', rotate: 180, confidence: 0.8, reasons: [] }],
    });
    expect(find).toHaveBeenCalledWith(auth, {
      assetIds: undefined,
      albumId: 'album-id',
      takenAfter: new Date('2025-06-01'),
      takenBefore: undefined,
    });
  });

  it('should fix the suggested photos, recording the ones checked now first', async () => {
    vi.spyOn(OrientationService.prototype, 'getSuggestions').mockResolvedValue([suggestion('a')]);
    const suggest = vi.spyOn(OrientationService.prototype, 'suggest').mockResolvedValue(1);
    const fix = vi.spyOn(OrientationService.prototype, 'fix').mockResolvedValue([
      { id: 'a', success: true },
      { id: 'b', success: false, errorMessage: 'Editing live photos is not supported' },
    ]);

    expect(parse(await call('fix_rotation', { assetIds: ['a', 'b'] }))).toEqual({
      fixed: ['a'],
      failed: [{ id: 'b', error: 'Editing live photos is not supported' }],
    });
    expect(suggest).toHaveBeenCalledWith(auth, ['b']);
    expect(fix).toHaveBeenCalledWith(auth, { assetIds: ['a', 'b'], rotate: undefined });
  });

  it('should turn photos by the given turn', async () => {
    const suggest = vi.spyOn(OrientationService.prototype, 'suggest');
    const fix = vi.spyOn(OrientationService.prototype, 'fix').mockResolvedValue([{ id: 'a', success: true }]);
    await call('fix_rotation', { assetIds: ['a'], rotate: 270 });
    expect(fix).toHaveBeenCalledWith(auth, { assetIds: ['a'], rotate: 270 });
    expect(suggest).not.toHaveBeenCalled();
  });

  it('should refuse other turns', () => {
    const tool = sut.getTools().find(({ name }) => name === 'fix_rotation')!;
    expect(() => tool.input.parse({ assetIds: ['a'], rotate: 45 })).toThrow();
  });

  it('should return the error of the service', async () => {
    vi.spyOn(OrientationService.prototype, 'find').mockRejectedValue(new BadRequestException('Smart search is off'));
    const result = await call('find_rotated_photos', { assetIds: ['a'] });
    expect(result).toEqual({ content: [{ type: 'text', text: 'Smart search is off' }], isError: true });
  });
});
