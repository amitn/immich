import { BadRequestException } from '@nestjs/common';
import type { AcpAgent, AcpClientHandlers, AcpPermissionRequest } from 'src/repositories/acp.repository.js';
import { ArtJobStatus, AssetType, Colorspace, NotificationLevel, NotificationType } from 'src/enum.js';
import {
  ArtService,
  decideArtPermission,
  getArtInstructions,
  getArtUpscaleSize,
  getGeneratedImage,
} from 'src/services/art.service.js';
import { DerivedAssetService } from 'src/services/derived-asset.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const PNG = Buffer.from('fake png');
const UPSCALED = Buffer.from('upscaled png');

const newJob = (overrides: Record<string, unknown> = {}) => ({
  id: factory.uuid(),
  userId: factory.uuid(),
  sourceAssetId: factory.uuid(),
  resultAssetId: null,
  style: 'watercolor',
  prompt: 'paint it',
  caption: null,
  profile: 'codex',
  status: ArtJobStatus.Pending,
  error: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  updateId: factory.uuid(),
  ...overrides,
});

const imageUpdate = (data: string) => ({
  sessionId: 'acp-session',
  update: {
    sessionUpdate: 'tool_call_update' as const,
    toolCallId: 'ig_1',
    status: 'completed' as const,
    content: [{ type: 'content' as const, content: { type: 'image' as const, data, mimeType: 'image/png' } }],
  },
});

describe(ArtService.name, () => {
  let sut: ArtService;
  let mocks: ServiceMocks;

  const setConfig = (agent: Record<string, unknown> = {}) => {
    clearConfigCache();
    mocks.systemMetadata.get.mockResolvedValue({ agent: { enabled: true, artProfile: 'codex', ...agent } });
  };

  const finalUpdate = async () => {
    await vi.waitFor(() =>
      expect(mocks.artJob.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: expect.stringMatching(/completed|failed/) }),
      ),
    );
    return mocks.artJob.update.mock.calls.at(-1)![1];
  };

  const notification = async () => {
    await vi.waitFor(() => expect(mocks.notification.create).toHaveBeenCalled());
    const item = mocks.notification.create.mock.calls[0][0];
    return { ...item, data: JSON.parse(item.data as string) };
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(ArtService));
    setConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getStyles', () => {
    it('should list the styles without their prompts', () => {
      const styles = sut.getStyles();
      expect(styles).toContainEqual(expect.objectContaining({ id: 'watercolor-editorial-split', usesCaption: true }));
      expect(styles[0]).not.toHaveProperty('prompt');
    });
  });

  describe('createJob', () => {
    const auth = factory.auth();

    it('should require the art profile to be configured', async () => {
      setConfig({ artProfile: '' });
      await expect(sut.createJob(auth, { assetId: factory.uuid(), style: 'watercolor' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.artJob.create).not.toHaveBeenCalled();
    });

    it('should reject unknown styles', async () => {
      await expect(sut.createJob(auth, { assetId: factory.uuid(), style: 'nope' })).rejects.toThrow(
        'Unknown art style',
      );
    });

    it('should require the user to own the photo', async () => {
      await expect(sut.createJob(auth, { assetId: factory.uuid(), style: 'watercolor' })).rejects.toThrow();
      expect(mocks.artJob.create).not.toHaveBeenCalled();
    });

    it('should reject videos', async () => {
      const assetId = factory.uuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.asset.getById.mockResolvedValue({ id: assetId, type: AssetType.Video } as never);

      await expect(sut.createJob(auth, { assetId, style: 'watercolor' })).rejects.toThrow('Only photos');
    });

    it('should store the expanded prompt and start the job', async () => {
      const assetId = factory.uuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.asset.getById.mockResolvedValue({ id: assetId, type: AssetType.Image } as never);
      const job = newJob({ sourceAssetId: assetId, status: ArtJobStatus.Pending });
      mocks.artJob.create.mockResolvedValue(job);
      mocks.acp.createWorkdir.mockRejectedValue(new Error('stop here'));
      mocks.artJob.update.mockResolvedValue({ ...job, status: ArtJobStatus.Failed });

      await expect(
        sut.createJob(auth, { assetId, style: 'watercolor-editorial-split', caption: 'summer days' }),
      ).resolves.toMatchObject({ id: job.id, status: ArtJobStatus.Pending });

      expect(mocks.artJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: auth.user.id,
          sourceAssetId: assetId,
          style: 'watercolor-editorial-split',
          caption: 'summer days',
          profile: 'codex',
          prompt: expect.stringContaining('reading "summer days"'),
        }),
      );
      await vi.waitFor(() =>
        expect(mocks.artJob.update).toHaveBeenCalledWith(job.id, { status: ArtJobStatus.Failed, error: 'stop here' }),
      );
    });
  });

  describe('running a job', () => {
    const auth = factory.auth();
    let handlers: AcpClientHandlers | undefined;
    let agent: AcpAgent;
    let onPrompt: () => void;

    const start = async (job = newJob()) => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([job.sourceAssetId]));
      mocks.asset.getById.mockResolvedValue({ id: job.sourceAssetId, type: AssetType.Image } as never);
      mocks.artJob.create.mockResolvedValue(job);
      mocks.artJob.update.mockImplementation((id, update) => Promise.resolve({ ...job, ...update } as never));
      await sut.createJob(auth, { assetId: job.sourceAssetId, style: 'watercolor' });
      return job;
    };

    beforeEach(() => {
      handlers = undefined;
      onPrompt = () => {};
      agent = {
        pid: 1,
        cwd: '/tmp/immich-agent/art',
        initialize: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: true } } },
        newSession: vi.fn().mockResolvedValue({ sessionId: 'acp-session' }),
        loadSession: vi.fn(),
        prompt: vi.fn(() => {
          onPrompt();
          return Promise.resolve({ stopReason: 'end_turn' as const });
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(undefined),
        isAlive: vi.fn().mockReturnValue(true),
      };

      mocks.systemMetadata.get.mockResolvedValue({
        agent: {
          enabled: true,
          artProfile: 'codex',
          profiles: [{ name: 'codex', command: 'codex-acp', args: [], env: [], passEnv: [] }],
        },
      });
      clearConfigCache();
      mocks.acp.createWorkdir.mockResolvedValue('/tmp/immich-agent/art');
      mocks.acp.removeWorkdir.mockResolvedValue();
      mocks.acp.start.mockImplementation((options) => {
        handlers = options.handlers;
        return Promise.resolve(agent);
      });
      mocks.asset.getForThumbnail.mockResolvedValue({
        path: '/data/preview.jpg',
        originalPath: '/data/original.jpg',
        originalFileName: 'IMG.jpg',
      });
      mocks.storage.readFile.mockResolvedValue(Buffer.from('jpeg'));
      mocks.storage.createFile.mockResolvedValue();
      mocks.storage.readdir.mockResolvedValue([]);
      mocks.media.getImageMetadata.mockResolvedValue({ width: 1440, height: 1080, isTransparent: false });
      mocks.media.upscaleImage.mockResolvedValue(UPSCALED);
      mocks.notification.create.mockImplementation((item) => Promise.resolve({ id: factory.uuid(), ...item } as never));
    });

    it('should notify the owner when the artwork is ready', async () => {
      vi.spyOn(DerivedAssetService.prototype, 'createDerivedAsset').mockResolvedValue({
        id: 'new-asset',
        duplicate: false,
      });
      onPrompt = () => void handlers!.onUpdate(imageUpdate(PNG.toString('base64')));

      const job = await start(newJob({ caption: 'summer days' }));
      await expect(notification()).resolves.toEqual({
        userId: job.userId,
        type: NotificationType.Custom,
        level: NotificationLevel.Success,
        title: 'Artwork ready',
        description: 'Watercolor “summer days”',
        data: { artJobId: job.id, assetId: 'new-asset', sourceAssetId: job.sourceAssetId },
      });
      await vi.waitFor(() =>
        expect(mocks.websocket.clientSend).toHaveBeenCalledWith(
          'on_notification',
          job.userId,
          expect.objectContaining({ title: 'Artwork ready' }),
        ),
      );
    });

    it('should notify the owner when the job failed', async () => {
      const job = await start(newJob({ style: null }));
      await expect(notification()).resolves.toEqual(
        expect.objectContaining({
          userId: job.userId,
          level: NotificationLevel.Error,
          title: 'Artwork failed',
          description: expect.stringMatching(/^Custom style: .*did not produce an image/),
          data: { artJobId: job.id, sourceAssetId: job.sourceAssetId },
        }),
      );
    });

    it('should finish the job when the notification cannot be created', async () => {
      vi.spyOn(DerivedAssetService.prototype, 'createDerivedAsset').mockResolvedValue({ id: 'x', duplicate: false });
      mocks.notification.create.mockRejectedValue(new Error('db down'));
      onPrompt = () => void handlers!.onUpdate(imageUpdate(PNG.toString('base64')));

      await start();
      await expect(finalUpdate()).resolves.toMatchObject({ status: ArtJobStatus.Completed });
      await vi.waitFor(() => expect(agent.kill).toHaveBeenCalled());
      expect(mocks.artJob.update).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: ArtJobStatus.Failed }),
      );
    });

    it('should save the image returned over ACP as a derived asset', async () => {
      const derive = vi
        .spyOn(DerivedAssetService.prototype, 'createDerivedAsset')
        .mockResolvedValue({ id: 'new-asset', duplicate: false });
      onPrompt = () => void handlers!.onUpdate(imageUpdate(PNG.toString('base64')));

      const job = await start();
      await expect(finalUpdate()).resolves.toEqual({ status: ArtJobStatus.Completed, resultAssetId: 'new-asset' });

      expect(agent.prompt).toHaveBeenCalledWith('acp-session', [
        expect.objectContaining({ type: 'text', text: expect.stringContaining('1440×1080') }),
        { type: 'image', data: Buffer.from('jpeg').toString('base64'), mimeType: 'image/jpeg' },
      ]);
      expect(mocks.media.upscaleImage).toHaveBeenCalledWith(PNG, { width: 2880, height: 2160 }, '.png');
      expect(derive).toHaveBeenCalledWith(
        auth,
        job.sourceAssetId,
        { buffer: UPSCALED, extension: '.png' },
        expect.objectContaining({
          suffix: 'watercolor',
          description: expect.stringMatching(/^Watercolor artwork.*, upscaled from 1440×1080 to 2880×2160$/),
        }),
      );
      expect(mocks.websocket.clientSend).toHaveBeenCalledWith(
        'on_art_job_update',
        job.userId,
        expect.objectContaining({ status: ArtJobStatus.Completed }),
      );
      expect(agent.kill).toHaveBeenCalled();
      expect(mocks.acp.removeWorkdir).toHaveBeenCalledWith('/tmp/immich-agent/art');
    });

    it('should keep artwork that is large enough for print', async () => {
      const derive = vi
        .spyOn(DerivedAssetService.prototype, 'createDerivedAsset')
        .mockResolvedValue({ id: 'new-asset', duplicate: false });
      mocks.media.getImageMetadata.mockResolvedValue({ width: 3072, height: 2048, isTransparent: false });
      onPrompt = () => void handlers!.onUpdate(imageUpdate(PNG.toString('base64')));

      await start();
      await expect(finalUpdate()).resolves.toMatchObject({ status: ArtJobStatus.Completed });
      expect(mocks.media.upscaleImage).not.toHaveBeenCalled();
      expect(derive).toHaveBeenCalledWith(
        auth,
        expect.any(String),
        { buffer: PNG, extension: '.png' },
        expect.objectContaining({ description: expect.not.stringContaining('upscaled') }),
      );
    });

    it('should place the untouched photo above the artwork of split styles', async () => {
      const derive = vi
        .spyOn(DerivedAssetService.prototype, 'createDerivedAsset')
        .mockResolvedValue({ id: 'new-asset', duplicate: false });
      const photo = { data: Buffer.from('pixels'), info: { width: 4000, height: 3000, channels: 3 } };
      mocks.media.decodeImage.mockResolvedValue(photo as never);
      onPrompt = () => void handlers!.onUpdate(imageUpdate(PNG.toString('base64')));

      const job = newJob({ style: 'watercolor-editorial-split' });
      await start(job);
      mocks.asset.getById.mockResolvedValue({
        id: job.sourceAssetId,
        type: AssetType.Image,
        originalPath: '/data/original.jpg',
        originalFileName: 'IMG.jpg',
        exifInfo: { orientation: null, profileDescription: 'sRGB', colorspace: 'sRGB', bitsPerSample: 8 },
      } as never);
      await expect(finalUpdate()).resolves.toMatchObject({ status: ArtJobStatus.Completed });

      expect(mocks.media.decodeImage).toHaveBeenCalledWith(
        '/data/original.jpg',
        expect.objectContaining({ colorspace: Colorspace.Srgb, size: 3000 }),
      );
      expect(mocks.media.stackPhotoAboveArtwork).toHaveBeenCalledWith(
        expect.objectContaining({ data: photo.data }),
        PNG,
        { maxLongEdge: 3000 },
      );
      expect(mocks.media.upscaleImage).not.toHaveBeenCalled();
      expect(derive).toHaveBeenCalledWith(
        auth,
        job.sourceAssetId,
        { buffer: Buffer.from('stacked'), extension: '.jpg' },
        expect.objectContaining({ suffix: 'watercolor-editorial-split' }),
      );
    });

    it('should fall back to an output file in the workdir', async () => {
      const derive = vi
        .spyOn(DerivedAssetService.prototype, 'createDerivedAsset')
        .mockResolvedValue({ id: 'new-asset', duplicate: false });
      mocks.storage.readdir.mockResolvedValue(['source.jpg', 'output.webp']);
      mocks.storage.readFile.mockImplementation((path) =>
        Promise.resolve(Buffer.from(path.endsWith('output.webp') ? 'webp' : 'jpeg')),
      );

      await start();
      await expect(finalUpdate()).resolves.toMatchObject({ status: ArtJobStatus.Completed });
      expect(derive).toHaveBeenCalledWith(
        auth,
        expect.any(String),
        { buffer: UPSCALED, extension: '.webp' },
        expect.anything(),
      );
    });

    it('should fail when the agent made no image', async () => {
      const derive = vi.spyOn(DerivedAssetService.prototype, 'createDerivedAsset');

      await start();
      await expect(finalUpdate()).resolves.toEqual({
        status: ArtJobStatus.Failed,
        error: expect.stringContaining('did not produce an image'),
      });
      expect(derive).not.toHaveBeenCalled();
      expect(agent.kill).toHaveBeenCalled();
    });

    it('should not send the image block to agents without image prompts', async () => {
      vi.spyOn(DerivedAssetService.prototype, 'createDerivedAsset').mockResolvedValue({ id: 'x', duplicate: false });
      agent = { ...agent, initialize: { protocolVersion: 1, agentCapabilities: {} } };
      onPrompt = () => void handlers!.onUpdate(imageUpdate(PNG.toString('base64')));

      await start();
      await finalUpdate();
      expect(agent.prompt).toHaveBeenCalledWith('acp-session', [expect.objectContaining({ type: 'text' })]);
    });
  });

  describe('getArtUpscaleSize', () => {
    it('should upscale small artwork to a 2400 to 3000 px long edge', () => {
      expect(getArtUpscaleSize(1024, 1024)).toEqual({ width: 2400, height: 2400 });
      expect(getArtUpscaleSize(1536, 1024)).toEqual({ width: 3000, height: 2000 });
      expect(getArtUpscaleSize(1024, 1536)).toEqual({ width: 2000, height: 3000 });
      expect(getArtUpscaleSize(1200, 900)).toEqual({ width: 2400, height: 1800 });
    });

    it('should keep large or unknown sizes', () => {
      expect(getArtUpscaleSize(2400, 1600)).toBeUndefined();
      expect(getArtUpscaleSize(0, 0)).toBeUndefined();
    });
  });

  describe('getGeneratedImage', () => {
    it('should read the last image of a tool call update', () => {
      expect(getGeneratedImage(imageUpdate(PNG.toString('base64')))).toEqual({ buffer: PNG, extension: '.png' });
    });

    it('should read images in agent messages', () => {
      expect(
        getGeneratedImage({
          sessionId: 's',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'image', data: PNG.toString('base64'), mimeType: 'image/webp' },
          },
        }),
      ).toEqual({ buffer: PNG, extension: '.webp' });
    });

    it('should ignore text', () => {
      expect(
        getGeneratedImage({
          sessionId: 's',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } },
        }),
      ).toBeUndefined();
    });
  });

  describe('decideArtPermission', () => {
    const options = [
      { optionId: 'yes', name: 'Allow', kind: 'allow_once' as const },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' as const },
    ];
    const request = (toolCall: AcpPermissionRequest['toolCall']): AcpPermissionRequest => ({
      sessionId: 's',
      toolCall,
      options,
    });

    it('should allow image generation', () => {
      expect(decideArtPermission('/work', request({ toolCallId: '1', title: 'Image generation' }))).toEqual({
        outcome: { outcome: 'selected', optionId: 'yes' },
      });
    });

    it('should allow writing inside the workdir', () => {
      expect(
        decideArtPermission(
          '/work',
          request({ toolCallId: '1', title: 'Write', kind: 'edit', locations: [{ path: '/work/output.png' }] }),
        ),
      ).toEqual({ outcome: { outcome: 'selected', optionId: 'yes' } });
    });

    it('should reject writing outside the workdir', () => {
      for (const path of ['/etc/passwd', '/work/../secrets', '/work']) {
        expect(
          decideArtPermission(
            '/work',
            request({ toolCallId: '1', title: 'Write', kind: 'edit', locations: [{ path }] }),
          ),
        ).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
      }
    });

    it('should reject shell commands', () => {
      expect(
        decideArtPermission('/work', request({ toolCallId: '1', title: 'Image generation script', kind: 'execute' })),
      ).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
    });

    it('should cancel when there is no reject option', () => {
      expect(
        decideArtPermission('/work', {
          sessionId: 's',
          toolCall: { toolCallId: '1', title: 'Bash' },
          options: [options[0]],
        }),
      ).toEqual({ outcome: { outcome: 'cancelled' } });
    });
  });

  describe('getArtInstructions', () => {
    it('should ask for one image with the aspect ratio of the source', () => {
      const text = getArtInstructions('paint it blue', { width: 1200, height: 800 });
      expect(text).toContain('1200×800');
      expect(text).toContain('output.png');
      expect(text.endsWith('paint it blue')).toBe(true);
    });
  });
});
