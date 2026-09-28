import { BadRequestException, Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { extname, join, relative, resolve } from 'node:path';
import type {
  AcpContentBlock,
  AcpPermissionRequest,
  AcpPermissionResponse,
  AcpSessionNotification,
} from 'src/repositories/acp.repository.js';
import { OnEvent } from 'src/decorators.js';
import {
  ArtJobCreateDto,
  ArtJobResponseDto,
  ArtStyleDto,
  ArtUserStyleCreateDto,
  ArtUserStyleResponseDto,
  ArtUserStyleUpdateDto,
  mapArtJob,
  mapArtStyle,
  mapArtUserStyle,
} from 'src/dtos/art.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { mapNotification } from 'src/dtos/notification.dto.js';
import {
  ActivityLogAction,
  ArtJobStatus,
  AssetFileType,
  AssetType,
  Colorspace,
  ImmichWorker,
  NotificationLevel,
  NotificationType,
  Permission,
} from 'src/enum.js';
import { ArtJobTable } from 'src/schema/tables/art-job.table.js';
import { ArtStyleTable } from 'src/schema/tables/art-style.table.js';
import { BaseService } from 'src/services/base.service.js';
import { DerivedAssetService, getArtworkTag } from 'src/services/derived-asset.service.js';
import { ActivityRecorder, quote, recordActivity } from 'src/utils/activity-log.js';
import { ArtStyle, artStyles, buildArtPrompt, checkArtPrompt, getArtStyle } from 'src/utils/agent/art-styles.js';
import { getAgentProfile, isArtEnabled } from 'src/utils/agent/config.js';
import { findOrFail } from 'src/utils/misc.js';

const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

type GeneratedImage = { buffer: Buffer; extension: string };

/**
 * how a job runs: `test` marks the artwork as the test of a draft style in its description, and `photoAbove` places
 * the photo above the artwork of a draft prompt, like the styles that do
 */
export type ArtJobOptions = { test?: boolean; photoAbove?: boolean };

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** jobs are shared by every service instance (the controller's and the agent tools') */
const queue: Array<() => Promise<void>> = [];
let active = 0;

/** Runs artistic style transforms through the configured ACP art agent, e.g. codex-acp with image generation. */
@Injectable()
export class ArtService extends BaseService {
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Api] })
  async onBootstrap() {
    await this.artJobRepository.failUnfinished();
  }

  /** the built-in styles, then the user's own */
  async getStyles(auth: AuthDto): Promise<ArtStyleDto[]> {
    const own = await this.artJobRepository.getStyles(auth.user.id);
    return [...artStyles.map((style) => mapArtStyle(style)), ...own.map((row) => mapArtStyle(row, true))];
  }

  async getUserStyles(auth: AuthDto): Promise<ArtUserStyleResponseDto[]> {
    const rows = await this.artJobRepository.getStyles(auth.user.id);
    return rows.map((row) => mapArtUserStyle(row));
  }

  async getUserStyle(auth: AuthDto, id: string): Promise<ArtUserStyleResponseDto> {
    await this.requireAccess({ auth, permission: Permission.ArtStyleRead, ids: [id] });
    return mapArtUserStyle(await findOrFail(() => this.artJobRepository.getStyle(id), 'Art style'));
  }

  async createStyle(
    auth: AuthDto,
    dto: ArtUserStyleCreateDto,
    activity?: ActivityRecorder,
  ): Promise<ArtUserStyleResponseDto> {
    const usesCaption = dto.usesCaption ?? false;
    const photoAbove = dto.photoAbove ?? false;
    this.requireValidPrompt(dto.prompt, { usesCaption, photoAbove });
    const row = await this.artJobRepository.createStyle({
      ownerId: auth.user.id,
      name: dto.name,
      description: dto.description ?? '',
      prompt: dto.prompt,
      usesCaption,
      photoAbove,
    });
    await recordActivity({ repository: this.activityLogRepository, logger: this.logger }, auth.user.id, activity, {
      action: ActivityLogAction.ArtStyleCreate,
      summary: `Saved the art style ${quote(row.name)}`,
      targetId: row.id,
      undo: { styleId: row.id, updatedAt: row.updatedAt.toISOString() },
    });
    return mapArtUserStyle(row);
  }

  async updateStyle(auth: AuthDto, id: string, dto: ArtUserStyleUpdateDto): Promise<ArtUserStyleResponseDto> {
    await this.requireAccess({ auth, permission: Permission.ArtStyleUpdate, ids: [id] });
    const current = await findOrFail(() => this.artJobRepository.getStyle(id), 'Art style');
    const prompt = dto.prompt ?? current.prompt;
    const usesCaption = dto.usesCaption ?? current.usesCaption;
    const photoAbove = dto.photoAbove ?? current.photoAbove;
    if (dto.prompt !== undefined || dto.usesCaption !== undefined || dto.photoAbove !== undefined) {
      this.requireValidPrompt(prompt, { usesCaption, photoAbove });
    }
    const row = await this.artJobRepository.updateStyle(id, {
      name: dto.name,
      description: dto.description,
      prompt: dto.prompt,
      usesCaption: dto.usesCaption,
      photoAbove: dto.photoAbove,
    });
    return mapArtUserStyle(row);
  }

  async deleteStyle(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.ArtStyleDelete, ids: [id] });
    // the artworks made with it keep their name and tag
    await this.artJobRepository.deleteStyle(id);
  }

  /** a built-in style by its id, or one of the user's own by its UUID */
  async resolveStyle(auth: AuthDto, id: string): Promise<ArtStyle> {
    const builtIn = getArtStyle(id);
    if (builtIn) {
      return builtIn;
    }
    if (!UUID.test(id)) {
      throw new BadRequestException(`Unknown art style: ${id}`);
    }
    await this.requireAccess({ auth, permission: Permission.ArtStyleRead, ids: [id] });
    const row = await findOrFail(() => this.artJobRepository.getStyle(id), 'Art style');
    return toArtStyle(row);
  }

  async createJob(auth: AuthDto, dto: ArtJobCreateDto, options: ArtJobOptions = {}): Promise<ArtJobResponseDto> {
    const { agent } = await this.getConfig({ withCache: true });
    if (!isArtEnabled(agent)) {
      throw new BadRequestException('Artistic styles are not enabled');
    }

    const style = dto.style === undefined ? undefined : await this.resolveStyle(auth, dto.style);

    // the artwork is stacked with the photo, so the user has to own it
    await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [dto.assetId] });
    const asset = await this.assetRepository.getById(dto.assetId);
    if (!asset || asset.type !== AssetType.Image) {
      throw new BadRequestException('Only photos can be transformed');
    }

    const job = await this.artJobRepository.create({
      userId: auth.user.id,
      sourceAssetId: dto.assetId,
      style: style?.id ?? null,
      prompt: buildArtPrompt({ style, prompt: dto.prompt, caption: dto.caption }),
      caption: dto.caption ?? null,
      profile: agent.artProfile,
    });

    this.schedule(auth, job, agent.maxConcurrentSessions, options);

    return mapArtJob(job);
  }

  async getJob(auth: AuthDto, id: string): Promise<ArtJobResponseDto> {
    await this.requireAccess({ auth, permission: Permission.ArtJobRead, ids: [id] });
    const job = await this.artJobRepository.get(id);
    if (!job) {
      throw new BadRequestException('Art job not found');
    }
    return mapArtJob(job);
  }

  /** resolves once the job is no longer pending or running, or after `timeoutMs` */
  async waitForJob(auth: AuthDto, id: string, timeoutMs: number): Promise<ArtJobResponseDto> {
    const deadline = Date.now() + timeoutMs;
    let job = await this.getJob(auth, id);
    while (isUnfinished(job.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, deadline - Date.now())));
      job = await this.getJob(auth, id);
    }
    return job;
  }

  private requireValidPrompt(prompt: string, options: { usesCaption: boolean; photoAbove: boolean }) {
    const { errors } = checkArtPrompt(prompt, options);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '));
    }
  }

  private schedule(auth: AuthDto, job: Selectable<ArtJobTable>, concurrency: number, options: ArtJobOptions) {
    queue.push(() => this.runJob(auth, job, options));
    const next = () => {
      while (active < concurrency && queue.length > 0) {
        const run = queue.shift()!;
        active++;
        void run().finally(() => {
          active--;
          next();
        });
      }
    };
    next();
  }

  /** the style of a job: a built-in one, or the user's own (unless it was deleted since) */
  private async getJobStyle(id: string | null): Promise<ArtStyle | undefined> {
    if (!id) {
      return;
    }
    const builtIn = getArtStyle(id);
    if (builtIn || !UUID.test(id)) {
      return builtIn;
    }
    const row = await this.artJobRepository.getStyle(id);
    return row ? toArtStyle(row) : undefined;
  }

  private async runJob(auth: AuthDto, job: Selectable<ArtJobTable>, { test, photoAbove }: ArtJobOptions) {
    let style: ArtStyle | undefined;
    let workdir: string | undefined;
    let agent: Awaited<ReturnType<typeof this.acpRepository.start>> | undefined;
    let timer: NodeJS.Timeout | undefined;

    try {
      style = await this.getJobStyle(job.style);
      await this.updateJob(job.id, { status: ArtJobStatus.Running });
      workdir = await this.acpRepository.createWorkdir(`art-${job.id}`);
      const cwd = workdir;

      const { agent: config } = await this.getConfig({ withCache: true });
      const profile = getAgentProfile(config, job.profile);
      if (!profile) {
        throw new Error(`The art profile "${job.profile}" does not exist anymore`);
      }

      const source = await this.writeSource(job.sourceAssetId, cwd);
      let generated: GeneratedImage | undefined;

      agent = await this.acpRepository.start({
        profile,
        cwd,
        handlers: {
          onUpdate: (notification) => {
            generated = getGeneratedImage(notification) ?? generated;
          },
          onPermission: (request) => Promise.resolve(decideArtPermission(cwd, request)),
        },
      });

      const { sessionId } = await agent.newSession({ cwd, mcpServers: [] });
      const supportsImages = !!agent.initialize.agentCapabilities?.promptCapabilities?.image;
      const prompt: AcpContentBlock[] = [{ type: 'text', text: getArtInstructions(job.prompt, source) }];
      if (supportsImages) {
        prompt.push({ type: 'image', data: source.buffer.toString('base64'), mimeType: 'image/jpeg' });
      }

      const running = agent;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void running.cancel(sessionId).catch(() => {});
          reject(new Error('The art agent did not finish within 10 minutes'));
        }, JOB_TIMEOUT_MS);
      });
      await Promise.race([agent.prompt(sessionId, prompt), timeout]);

      const image = generated ?? (await this.readOutputFile(cwd));
      if (!image) {
        throw new Error('The art agent did not produce an image. Is image generation available for this agent?');
      }

      const { width, height } = await this.mediaRepository.getImageMetadata(image.buffer);
      if (!width || !height) {
        throw new Error('The art agent produced an invalid image');
      }

      let output = image;
      let upscaled = '';
      const size = getArtUpscaleSize(width, height);
      if (style?.photoAbove ?? photoAbove) {
        // the photo sets the size, and the artwork below it is scaled to its width
        output = { buffer: await this.stackBelowPhoto(job.sourceAssetId, image.buffer), extension: '.jpg' };
      } else if (size) {
        // generated images are often too small to fill a printed page; painterly styles take upscaling well
        output = { ...image, buffer: await this.mediaRepository.upscaleImage(image.buffer, size, image.extension) };
        upscaled = `, upscaled from ${width}×${height} to ${size.width}×${size.height}`;
        this.logger.log(
          `Art job ${job.id}: upscaled the artwork from ${width}×${height} to ${size.width}×${size.height}`,
        );
      }

      const derivedAssetService = BaseService.create(DerivedAssetService, this);
      const { id } = await derivedAssetService.createDerivedAsset(auth, job.sourceAssetId, output, {
        description: test
          ? `Test of a draft art style${job.caption ? ` “${job.caption}”` : ''}, made with ${job.profile}${upscaled}. Delete it when the style is done.`
          : `${style?.name ?? 'Custom style'} artwork${job.caption ? ` “${job.caption}”` : ''}, made with ${job.profile}${upscaled}`,
        // the file name of a user's style is not its UUID
        suffix: test ? 'style-test' : (getArtStyle(style?.id ?? '')?.id ?? 'art'),
        tags: [getArtworkTag(test ? 'Style tests' : style?.name)],
      });

      await this.updateJob(job.id, { status: ArtJobStatus.Completed, resultAssetId: id });
      await this.notifyOwner(job, id, {
        level: NotificationLevel.Success,
        title: 'Artwork ready',
        description: getArtworkName(job, style, test),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Art job ${job.id} failed: ${message}`);
      await this.updateJob(job.id, { status: ArtJobStatus.Failed, error: message }).catch(() => {});
      await this.notifyOwner(job, null, {
        level: NotificationLevel.Error,
        title: 'Artwork failed',
        description: `${getArtworkName(job, style, test)}: ${message}`,
      });
    } finally {
      clearTimeout(timer);
      await agent?.kill().catch(() => {});
      if (workdir) {
        await this.acpRepository.removeWorkdir(workdir).catch(() => {});
      }
    }
  }

  private async updateJob(id: string, update: Partial<Selectable<ArtJobTable>>) {
    const job = await this.artJobRepository.update(id, update);
    this.websocketRepository.clientSend('on_art_job_update', job.userId, mapArtJob(job));
    return job;
  }

  /** shows in the notification panel, also when the art dialog was closed */
  private async notifyOwner(
    job: Selectable<ArtJobTable>,
    assetId: string | null,
    notification: { level: NotificationLevel; title: string; description: string },
  ): Promise<void> {
    try {
      const item = await this.notificationRepository.create({
        userId: job.userId,
        type: NotificationType.Custom,
        ...notification,
        data: JSON.stringify({ artJobId: job.id, assetId: assetId ?? undefined, sourceAssetId: job.sourceAssetId }),
      });
      this.websocketRepository.clientSend('on_notification', job.userId, mapNotification(item));
    } catch (error: any) {
      this.logger.warn(`Unable to notify the owner of art job ${job.id}: ${error?.message ?? error}`);
    }
  }

  /** the preview is large enough as a reference and is always a web-friendly JPEG */
  private async writeSource(assetId: string, workdir: string) {
    const { path } = await this.assetRepository.getForThumbnail(assetId, AssetFileType.Preview, true);
    if (!path) {
      throw new Error('The photo has no preview yet');
    }

    const buffer = await this.readStoredFile(path);
    const { width, height } = await this.mediaRepository.getImageMetadata(buffer);
    await this.storageRepository.createFile(join(workdir, 'source.jpg'), buffer);
    return { buffer, width, height };
  }

  /** the untouched photo above the generated artwork, decoded from the original rather than the smaller preview */
  private async stackBelowPhoto(assetId: string, artwork: Buffer) {
    const asset = await this.assetRepository.getById(assetId, { exifInfo: true });
    if (!asset?.exifInfo) {
      throw new Error('The metadata of the photo has not been extracted yet');
    }

    const { image } = await this.getConfig({ withCache: true });
    const photo = await this.decodeAssetOriginal(
      { originalPath: asset.originalPath, originalFileName: asset.originalFileName, exifInfo: asset.exifInfo },
      { ...image, colorspace: Colorspace.Srgb },
      { size: ART_MAX_LONG_EDGE },
    );
    return this.mediaRepository.stackPhotoAboveArtwork(photo, artwork, { maxLongEdge: ART_MAX_LONG_EDGE });
  }

  private async readOutputFile(workdir: string): Promise<GeneratedImage | undefined> {
    const files = await this.storageRepository.readdir(workdir);
    const output = files.find(
      (file) => file.startsWith('output.') && OUTPUT_EXTENSIONS.has(extname(file).toLowerCase()),
    );
    if (!output) {
      return;
    }
    return { buffer: await this.storageRepository.readFile(join(workdir, output)), extension: extname(output) };
  }
}

const getArtworkName = ({ caption }: Pick<Selectable<ArtJobTable>, 'caption'>, style?: ArtStyle, test?: boolean) => {
  const name = test ? 'Style test' : style?.name || 'Custom style';
  return caption ? `${name} “${caption}”` : name;
};

const toArtStyle = (row: Selectable<ArtStyleTable>): ArtStyle => ({
  id: row.id,
  name: row.name,
  description: row.description,
  prompt: row.prompt,
  usesCaption: row.usesCaption,
  photoAbove: row.photoAbove,
});

const isUnfinished = (status: ArtJobStatus) => status === ArtJobStatus.Pending || status === ArtJobStatus.Running;

/** artwork with a shorter long edge is upscaled, to fill a 20 cm page at 300 dpi or a larger one at 150 dpi */
export const ART_MIN_LONG_EDGE = 2400;
export const ART_MAX_LONG_EDGE = 3000;

/** the size artwork is upscaled to: twice its size, but at least 2400 and at most 3000 px on the long edge */
export const getArtUpscaleSize = (width: number, height: number) => {
  const longEdge = Math.max(width, height);
  if (!width || !height || longEdge >= ART_MIN_LONG_EDGE) {
    return;
  }
  const target = Math.max(ART_MIN_LONG_EDGE, Math.min(ART_MAX_LONG_EDGE, 2 * longEdge));
  const scale = target / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

export const getArtInstructions = (artDirection: string, source: { width: number; height: number }) =>
  [
    'You are an image generation assistant working for the Immich photo app.',
    'Create ONE new image with your image generation tool, using the attached reference photo (also saved as source.jpg in the working directory) as the reference.',
    `Keep the aspect ratio of the reference photo (${source.width}×${source.height}).`,
    'Do not run shell commands, browse the web or change any files other than the output image.',
    'If your image tool does not return the image to the client, save the final image as output.png in the working directory.',
    'When you are done, reply with one short sentence.',
    '',
    'Art direction:',
    artDirection,
  ].join('\n');

/** the last image in a tool call (e.g. codex-acp "Image generation") or an agent message */
export const getGeneratedImage = ({ update }: AcpSessionNotification): GeneratedImage | undefined => {
  const blocks: AcpContentBlock[] = [];
  if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
    for (const item of update.content ?? []) {
      if (item.type === 'content') {
        blocks.push(item.content);
      }
    }
  } else if (update.sessionUpdate === 'agent_message_chunk') {
    blocks.push(update.content);
  }

  const image = blocks.findLast((block) => block.type === 'image' && !!block.data);
  if (image?.type !== 'image') {
    return;
  }

  return { buffer: Buffer.from(image.data, 'base64'), extension: MIME_EXTENSIONS[image.mimeType] ?? '.png' };
};

const isInside = (dir: string, path: string) => {
  const rel = relative(resolve(dir), resolve(dir, path));
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/');
};

/** the art agent may only generate images and write files inside its own working directory */
export const decideArtPermission = (
  workdir: string,
  { toolCall, options }: AcpPermissionRequest,
): AcpPermissionResponse => {
  const locations = toolCall.locations ?? [];
  const isImageGeneration = /image generation/i.test(toolCall.title ?? '') && toolCall.kind !== 'execute';
  const isWorkdirEdit =
    toolCall.kind === 'edit' && locations.length > 0 && locations.every((location) => isInside(workdir, location.path));

  const allowed = isImageGeneration || isWorkdirEdit;
  const option = options.find((option) => option.kind === (allowed ? 'allow_once' : 'reject_once'));
  return option
    ? { outcome: { outcome: 'selected', optionId: option.optionId } }
    : { outcome: { outcome: 'cancelled' } };
};
