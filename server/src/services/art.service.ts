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
import { ArtJobCreateDto, ArtJobResponseDto, ArtStyleDto, mapArtJob, mapArtStyle } from 'src/dtos/art.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { ArtJobStatus, AssetFileType, AssetType, ImmichWorker, Permission } from 'src/enum.js';
import { ArtJobTable } from 'src/schema/tables/art-job.table.js';
import { BaseService } from 'src/services/base.service.js';
import { DerivedAssetService, getArtworkTag } from 'src/services/derived-asset.service.js';
import { artStyles, buildArtPrompt, getArtStyle } from 'src/utils/agent/art-styles.js';
import { getAgentProfile, isArtEnabled } from 'src/utils/agent/config.js';

const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

type GeneratedImage = { buffer: Buffer; extension: string };

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

  getStyles(): ArtStyleDto[] {
    return artStyles.map((style) => mapArtStyle(style));
  }

  async createJob(auth: AuthDto, dto: ArtJobCreateDto): Promise<ArtJobResponseDto> {
    const { agent } = await this.getConfig({ withCache: true });
    if (!isArtEnabled(agent)) {
      throw new BadRequestException('Artistic styles are not enabled');
    }

    const style = dto.style === undefined ? undefined : getArtStyle(dto.style);
    if (dto.style !== undefined && !style) {
      throw new BadRequestException(`Unknown art style: ${dto.style}`);
    }

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

    this.schedule(auth, job, agent.maxConcurrentSessions);

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

  private schedule(auth: AuthDto, job: Selectable<ArtJobTable>, concurrency: number) {
    queue.push(() => this.runJob(auth, job));
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

  private async runJob(auth: AuthDto, job: Selectable<ArtJobTable>) {
    let workdir: string | undefined;
    let agent: Awaited<ReturnType<typeof this.acpRepository.start>> | undefined;
    let timer: NodeJS.Timeout | undefined;

    try {
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

      const style = job.style ? getArtStyle(job.style) : undefined;
      const derivedAssetService = BaseService.create(DerivedAssetService, this);
      const { id } = await derivedAssetService.createDerivedAsset(auth, job.sourceAssetId, image, {
        description: `${style?.name ?? 'Custom style'} artwork${job.caption ? ` “${job.caption}”` : ''}, made with ${job.profile}`,
        suffix: style?.id ?? 'art',
        tags: [getArtworkTag(style?.name)],
      });

      await this.updateJob(job.id, { status: ArtJobStatus.Completed, resultAssetId: id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Art job ${job.id} failed: ${message}`);
      await this.updateJob(job.id, { status: ArtJobStatus.Failed, error: message }).catch(() => {});
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

  /** the preview is large enough as a reference and is always a web-friendly JPEG */
  private async writeSource(assetId: string, workdir: string) {
    const { path } = await this.assetRepository.getForThumbnail(assetId, AssetFileType.Preview, true);
    if (!path) {
      throw new Error('The photo has no preview yet');
    }

    const buffer = await this.storageRepository.readFile(path);
    const { width, height } = await this.mediaRepository.getImageMetadata(buffer);
    await this.storageRepository.createFile(join(workdir, 'source.jpg'), buffer);
    return { buffer, width, height };
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

const isUnfinished = (status: ArtJobStatus) => status === ArtJobStatus.Pending || status === ArtJobStatus.Running;

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
