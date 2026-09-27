import { HttpException, Injectable } from '@nestjs/common';
import z from 'zod';
import { highlightStyles } from 'src/dtos/highlight.dto.js';
import { HighlightJobStatus } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { HighlightService } from 'src/services/highlight.service.js';
import { AgentTool, AgentToolResult, defineTool, toolError, toolJson } from 'src/utils/agent/tools.js';
import {
  HIGHLIGHT_DURATIONS,
  HIGHLIGHT_FORMATS,
  MAX_HIGHLIGHT_DURATION,
  MIN_HIGHLIGHT_DURATION,
} from 'src/utils/highlight/plan.js';

const MAX_WAIT_SECONDS = 90;

const isUnfinished = (status: HighlightJobStatus) =>
  status === HighlightJobStatus.Pending || status === HighlightJobStatus.Running;

/** Highlight videos: short films of an album, a book or a selection */
@Injectable()
export class HighlightAgentTools extends BaseService {
  getTools(): AgentTool[] {
    const highlights = BaseService.create(HighlightService, this);

    return [
      defineTool({
        name: 'make_highlight_video',
        title: 'Make a highlight video',
        description:
          'Start making a short highlight film (1080p MP4, landscape 16:9 or vertical 9:16) of an album, a book or a ' +
          'list of photos and videos: the ' +
          'best photos as slow pans and zooms towards the faces, short clips of the videos, a title card, a map (or a ' +
          'title card) for every chapter (a day, a stop, a restaurant visit, a leg of a trip) and lower thirds naming ' +
          'the dishes, artworks, wines, recipe steps and places. It picks the photos like auto_layout_book (one per ' +
          'stack and per burst). It renders in the background for a minute or a few, and is saved as a new video in ' +
          'the timeline (tagged Highlights/<title>, and added to the album). Pass exactly one of albumId, bookId or ' +
          'assetIds. Use format vertical when the user wants it for a phone, a story, a reel, TikTok, Instagram or ' +
          'WhatsApp status: it crops the photos around their subject and keeps the text clear of the apps’ buttons. ' +
          'Music: only an audio file the user uploaded (musicId from list_highlight_music); none by ' +
          'default. Returns a highlightId; call get_highlight_video to follow it.',
        input: z.object({
          albumId: z.string().optional().describe('Album to make the video of'),
          bookId: z.string().optional().describe('Book to make the video of (its photos and style)'),
          assetIds: z.array(z.string()).optional().describe('Photos and videos to make the video of'),
          title: z.string().max(200).optional().describe('Title card; default: the name of the album or book'),
          durationSeconds: z
            .int()
            .min(MIN_HIGHLIGHT_DURATION)
            .max(MAX_HIGHLIGHT_DURATION)
            .optional()
            .describe(`Length in seconds, usually ${HIGHLIGHT_DURATIONS.join(', ')}; default 60`),
          style: z
            .enum(highlightStyles)
            .optional()
            .describe('auto (the book style, or the collection style such as food) or a book style preset'),
          format: z
            .enum(HIGHLIGHT_FORMATS)
            .optional()
            .describe('landscape (16:9, default) or vertical (9:16, 1080×1920, for phones and social apps)'),
          musicId: z.string().optional().describe('An audio file of the user, from list_highlight_music'),
          includeMaps: z.boolean().optional().describe('Open the chapters with GPS with a map, default true'),
          captions: z.boolean().optional().describe('Lower thirds with names and places, default true'),
        }),
        mutating: true,
        handler: ({ auth, activity }, { musicId, ...input }) =>
          this.run(async () => {
            const sources = [input.albumId, input.bookId, input.assetIds].filter((value) => value !== undefined);
            if (sources.length !== 1) {
              return toolError('Pass exactly one of albumId, bookId or assetIds');
            }
            const job = await highlights.create(auth, { ...input, music: musicId }, activity);
            return toolJson({
              highlightId: job.id,
              title: job.title,
              status: job.status,
              durationSeconds: job.durationSeconds,
              format: job.format,
              next: 'call get_highlight_video with this highlightId to wait for the video',
            });
          }),
      }),
      defineTool({
        name: 'get_highlight_video',
        title: 'Get a highlight video',
        description: `Wait for a highlight video from make_highlight_video (up to "wait" seconds, max ${MAX_WAIT_SECONDS}) and return its status and progress; once it is completed, the assetId of the video to show the user. Call again while it is still rendering.`,
        input: z.object({
          highlightId: z.string(),
          wait: z.int().min(0).max(MAX_WAIT_SECONDS).optional().describe('Seconds to wait, default 30'),
        }),
        mutating: false,
        handler: ({ auth }, { highlightId, wait = 30 }) =>
          this.run(async () => {
            const deadline = Date.now() + wait * 1000;
            let job = await highlights.get(auth, highlightId);
            while (isUnfinished(job.status) && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, Math.min(2000, deadline - Date.now())));
              job = await highlights.get(auth, highlightId);
            }
            return toolJson({
              highlightId: job.id,
              status: job.status,
              progress: Math.round(job.progress * 100),
              ...(job.resultAssetId && { assetId: job.resultAssetId }),
              ...(job.error && { error: job.error }),
              ...(job.warnings.length > 0 && { warnings: job.warnings }),
            });
          }),
      }),
      defineTool({
        name: 'list_highlight_music',
        title: 'List music for highlight videos',
        description:
          'List the audio files the user uploaded as music for highlight videos (name and length). Immich bundles no ' +
          'music: when there is none, the video is silent, or the user uploads a file in the highlight dialog.',
        input: z.object({}),
        mutating: false,
        handler: ({ auth }) => this.run(async () => toolJson(await highlights.getMusic(auth))),
      }),
    ];
  }

  private async run(handler: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
    try {
      return await handler();
    } catch (error: any) {
      if (!(error instanceof HttpException)) {
        this.logger.error(`Highlight tool failed: ${error?.message ?? error}`, error?.stack);
      }
      const message = error?.response?.message ?? error?.message ?? String(error);
      return toolError(Array.isArray(message) ? message.join('; ') : String(message));
    }
  }
}
