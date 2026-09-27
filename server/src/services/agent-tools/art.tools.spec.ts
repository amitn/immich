import { ArtJobStatus, AssetType } from 'src/enum.js';
import { ArtAgentTools } from 'src/services/agent-tools/art.tools.js';
import { ArtService } from 'src/services/art.service.js';
import { AgentToolResult } from 'src/utils/agent/tools.js';
import { clearConfigCache } from 'src/utils/config.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const parse = (result: AgentToolResult) => {
  expect(result.isError).toBeFalsy();
  return JSON.parse((result.content[0] as { text: string }).text);
};

const errorText = (result: AgentToolResult) => {
  expect(result.isError).toBe(true);
  return (result.content[0] as { text: string }).text;
};

const PROMPT =
  'Transform the reference photograph into a stained-glass window of the exact same scene. Preserve the ' +
  'recognizable composition, subjects, people, poses and perspective of the reference photograph. Bold lead lines, ' +
  'jewel-toned glass, light shining through. No text.';

const userStyle = (overrides: Record<string, unknown> = {}) => ({
  id: factory.uuid(),
  ownerId: factory.uuid(),
  name: 'Stained glass',
  description: 'Jewel-toned glass and lead lines',
  prompt: PROMPT,
  usesCaption: false,
  photoAbove: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  updateId: factory.uuid(),
  ...overrides,
});

describe(ArtAgentTools.name, () => {
  let sut: ArtAgentTools;
  let mocks: ServiceMocks;
  const auth = factory.auth();

  const getTool = (name: string) => {
    const tool = sut.getTools().find((tool) => tool.name === name);
    if (!tool) {
      throw new Error(`Unknown tool ${name}`);
    }
    return tool;
  };

  const call = (name: string, input: Record<string, unknown>) => {
    const tool = getTool(name);
    return tool.handler({ auth, sessionId: null }, tool.input.parse(input));
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(ArtAgentTools));
    clearConfigCache();
    mocks.systemMetadata.get.mockResolvedValue({ agent: { enabled: true, artProfile: 'codex' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should ask for approval to test and save a style', () => {
    expect(getTool('list_art_styles').mutating).toBe(false);
    expect(getTool('test_art_style').mutating).toBe(true);
    expect(getTool('save_art_style').mutating).toBe(true);
  });

  it('should remind that a style keeps the subject recognizable', () => {
    expect(getTool('test_art_style').description).toContain("must keep the photo's subject recognizable");
    expect(getTool('save_art_style').description).toContain("must keep the photo's subject recognizable");
  });

  describe('list_art_styles', () => {
    it("should list the built-in styles, then the user's own with their prompts", async () => {
      const row = userStyle();
      mocks.artJob.getStyles.mockResolvedValue([row]);

      const styles = parse(await call('list_art_styles', {}));

      expect(styles[0]).not.toHaveProperty('prompt');
      expect(styles.at(-1)).toEqual({
        id: row.id,
        name: 'Stained glass',
        description: 'Jewel-toned glass and lead lines',
        usesCaption: false,
        owned: true,
        prompt: PROMPT,
      });
    });

    it('should show the built-in prompts as models', async () => {
      mocks.artJob.getStyles.mockResolvedValue([]);
      const styles = parse(await call('list_art_styles', { withPrompts: true }));
      expect(styles[0].prompt).toContain('reference photograph');
    });
  });

  describe('test_art_style', () => {
    it('should start a test job with the draft prompt', async () => {
      const createJob = vi.spyOn(ArtService.prototype, 'createJob').mockResolvedValue({
        id: 'job-1',
        status: ArtJobStatus.Pending,
      } as never);
      const assetId = factory.uuid();

      const result = parse(await call('test_art_style', { assetId, prompt: PROMPT }));

      expect(result).toEqual({ jobId: 'job-1', status: ArtJobStatus.Pending, next: expect.any(String) });
      expect(createJob).toHaveBeenCalledWith(
        auth,
        { assetId, prompt: PROMPT, caption: undefined },
        { test: true, photoAbove: undefined },
      );
    });

    it('should refuse a prompt that is too short or has unknown placeholders', async () => {
      const createJob = vi.spyOn(ArtService.prototype, 'createJob');
      expect(errorText(await call('test_art_style', { assetId: factory.uuid(), prompt: 'Make it art' }))).toContain(
        'characters long',
      );
      expect(
        errorText(await call('test_art_style', { assetId: factory.uuid(), prompt: PROMPT + ' Signed {artist}.' })),
      ).toContain('Unknown placeholder');
      expect(createJob).not.toHaveBeenCalled();
    });

    it('should pass on warnings about the subject', async () => {
      vi.spyOn(ArtService.prototype, 'createJob').mockResolvedValue({ id: 'j', status: ArtJobStatus.Pending } as never);
      const result = parse(
        await call('test_art_style', {
          assetId: factory.uuid(),
          prompt: 'An abstract composition of swirling colours and shapes, loosely inspired by a summer evening.',
        }),
      );
      expect(result.warnings.join(' ')).toContain('recognizable');
    });

    it('should need the photo to be the user’s own', async () => {
      const assetId = factory.uuid();
      mocks.asset.getById.mockResolvedValue({ id: assetId, type: AssetType.Image } as never);
      expect(errorText(await call('test_art_style', { assetId, prompt: PROMPT }))).toBeTruthy();
      expect(mocks.artJob.create).not.toHaveBeenCalled();
    });
  });

  describe('save_art_style', () => {
    it('should save a valid style', async () => {
      mocks.artJob.createStyle.mockImplementation((values) => Promise.resolve(userStyle(values as never)));

      const result = parse(
        await call('save_art_style', {
          name: 'Stained glass',
          description: 'Jewel-toned glass and lead lines',
          prompt: PROMPT,
          usesCaption: false,
        }),
      );

      expect(result).toEqual({ id: expect.any(String), name: 'Stained glass' });
      expect(mocks.artJob.createStyle).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: auth.user.id, prompt: PROMPT, usesCaption: false, photoAbove: false }),
      );
    });

    it('should refuse a caption style without {caption}', async () => {
      const text = errorText(
        await call('save_art_style', { name: 'Glass', description: '', prompt: PROMPT, usesCaption: true }),
      );
      expect(text).toContain('{caption}');
      expect(mocks.artJob.createStyle).not.toHaveBeenCalled();
    });
  });
});
