import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { LRUMap } from 'mnemonist';
import z from 'zod';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetOrder, AssetType, AssetVisibility, Permission } from 'src/enum.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { SearchService } from 'src/services/search.service.js';
import {
  Cluster,
  clusterSimilar,
  getClusterDefaults,
  parseEmbedding,
  toClusterIndex,
} from 'src/utils/agent/clustering.js';
import {
  DEFAULT_EVENT_OPTIONS,
  EventSplitOptions,
  groupEventsByDay,
  splitEvents,
  summarizeEvent,
  toLocalIso,
} from 'src/utils/agent/events.js';
import { ImageAnalysis, PhotoScore, normalizeFaceBox, scorePhoto } from 'src/utils/agent/scoring.js';
import { SelectionCandidate, selectBest } from 'src/utils/agent/selection.js';
import {
  AgentTool,
  AgentToolContext,
  AgentToolResult,
  defineTool,
  toolError,
  toolImage,
  toolJson,
} from 'src/utils/agent/tools.js';
import { getMyPartnerIds } from 'src/utils/asset.util.js';

type AgentAsset = Awaited<ReturnType<AssetJobRepository['getForAgent']>>[number];

const LIMITS = {
  search: 500,
  events: 5000,
  metadata: 100,
  view: 36,
  cluster: 2000,
  score: 200,
  select: 1000,
};

/** analysis results keyed by asset, checksum and preview path, shared by every session */
const analysisCache = new LRUMap<string, ImageAnalysis>(20_000);

const uuid = z.uuid();
const ids = (max: number) => z.array(uuid).min(1).max(max);
const date = z.string().describe('ISO date or date-time, e.g. 2024-06-01 or 2024-06-01T18:00:00');

const parseDate = (value?: string) => {
  if (value === undefined) {
    return;
  }
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new BadRequestException(`Invalid date: ${value}`);
  }
  return result;
};

const unique = <T>(values: T[]) => [...new Set(values)];

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

const namesOf = (asset: Pick<AgentAsset, 'faces'>) =>
  unique(asset.faces.map((face) => face.name).filter((name): name is string => !!name));

const personIdsOf = (asset: Pick<AgentAsset, 'faces'>) =>
  unique(asset.faces.map((face) => face.personId).filter((id): id is string => !!id));

const compactAsset = (asset: AgentAsset) => {
  const people = namesOf(asset);
  const width = asset.width ?? asset.exifImageWidth;
  const height = asset.height ?? asset.exifImageHeight;
  return {
    id: asset.id,
    date: toLocalIso(asset.localDateTime),
    ...(asset.type === AssetType.Video && { video: true }),
    ...(asset.city && { city: asset.city }),
    ...(asset.country && { country: asset.country }),
    ...(people.length > 0 && { people }),
    ...(width && { w: width }),
    ...(height && { h: height }),
    ...(asset.isFavorite && { fav: true }),
  };
};

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/** turns client errors (access, validation) into tool errors the agent can read and recover from */
const handle =
  <I>(handler: (ctx: AgentToolContext, input: I) => Promise<AgentToolResult>) =>
  async (ctx: AgentToolContext, input: I) => {
    try {
      return await handler(ctx, input);
    } catch (error) {
      if (error instanceof HttpException) {
        return toolError(error.message);
      }
      throw error;
    }
  };

/** Search, people, events, metadata, contact sheets and photo selection helpers */
@Injectable()
export class LibraryAgentTools extends BaseService {
  getTools(): AgentTool[] {
    return [
      defineTool({
        name: 'search_photos',
        title: 'Search photos',
        description:
          'Find photos by a natural-language query (CLIP smart search, ranked by relevance) and/or filters. ' +
          'Without a query results are ordered by date (oldest first unless order=desc). ' +
          `limit defaults to 50 (max ${LIMITS.search}); pass the returned "next" as page for more. ` +
          'Returns [{id, date (local time), city, country, people, w, h, fav, video}]. ' +
          'Typical flow: find_events → search_photos → view_photos → cluster_similar/score_photo → select_best.',
        input: z.object({
          query: z.string().optional().describe('What the photos show, e.g. "kids on the beach at sunset"'),
          takenAfter: date.optional(),
          takenBefore: date.optional(),
          personIds: z
            .array(uuid)
            .max(10)
            .optional()
            .describe('Photos containing all of these people (see find_people)'),
          city: z.string().optional(),
          state: z.string().optional(),
          country: z.string().optional(),
          albumId: uuid.optional(),
          type: z.enum(['image', 'video']).optional(),
          isFavorite: z.boolean().optional(),
          order: z.enum(['asc', 'desc']).optional().describe('Date order without a query, default asc'),
          limit: z.int().min(1).max(LIMITS.search).optional(),
          page: z.int().min(1).optional(),
        }),
        mutating: false,
        handler: handle((ctx, input) => this.searchPhotos(ctx.auth, input)),
      }),
      defineTool({
        name: 'find_people',
        title: 'Find people',
        description:
          'Look up named people by (fuzzy) name, or list the most photographed named people when no name is given. ' +
          'Returns [{id, name, n}] where n is the number of photos. Use the ids as personIds in other tools.',
        input: z.object({
          name: z.string().optional(),
          limit: z.int().min(1).max(100).optional().describe('Default 20'),
        }),
        mutating: false,
        handler: handle((ctx, input) => this.findPeople(ctx.auth, input)),
      }),
      defineTool({
        name: 'find_events',
        title: 'Find events',
        description:
          'Split photos of a date range, album and/or people into events (a new event starts after a time gap or a ' +
          'jump in location) and groups them by day. Start here to understand a trip or period. ' +
          `Considers up to ${LIMITS.events} photos in time order. Returns {count, events: [{index, start, end, day, city, ` +
          'country, count, people, sampleIds}], days: [{day, count, events}]}. Pass expand=[event indexes] with the ' +
          'same filters to also get every id of those events (for cluster_similar, score_photo, select_best).',
        input: z.object({
          takenAfter: date.optional(),
          takenBefore: date.optional(),
          albumId: uuid.optional(),
          personIds: z.array(uuid).max(10).optional(),
          gapHours: z.number().min(0.1).max(72).optional().describe('Time gap that starts a new event, default 3'),
          distanceKm: z
            .number()
            .min(0.1)
            .max(10_000)
            .optional()
            .describe('Location jump that starts an event, default 30'),
          byDay: z.boolean().optional().describe('One event per local calendar day instead'),
          samples: z.int().min(0).max(12).optional().describe('Sample ids per event, default up to 6'),
          expand: z.array(z.int().min(0)).max(50).optional(),
        }),
        mutating: false,
        handler: handle((ctx, input) => this.findEvents(ctx.auth, input)),
      }),
      defineTool({
        name: 'get_photo_metadata',
        title: 'Get photo metadata',
        description:
          `Details of up to ${LIMITS.metadata} photos: local date, time zone, dimensions, camera, lens, exposure ` +
          '(f, exp, iso, fl), gps [lat, lon], place, description, favorite, rating, people with face boxes ' +
          '[x1, y1, x2, y2] normalized 0..1, and the albums each photo is in.',
        input: z.object({ ids: ids(LIMITS.metadata) }),
        mutating: false,
        handler: handle((ctx, input) => this.getPhotoMetadata(ctx.auth, input.ids)),
      }),
      defineTool({
        name: 'view_photos',
        title: 'View photos',
        description:
          'Look at photos. One id returns a single preview (size = longest edge, default 1024, max 1440). ' +
          `2-${LIMITS.view} ids return one contact sheet: a grid of tiles (size = tile edge, default 256) each ` +
          'labelled with its 1-based position, plus the JSON map {position: id}. Use it to check composition, ' +
          'expressions and closed eyes, preferably on shortlisted photos.',
        input: z.object({
          ids: ids(LIMITS.view),
          size: z.int().min(96).max(1440).optional(),
        }),
        mutating: false,
        handler: handle((ctx, input) => this.viewPhotos(ctx.auth, input)),
      }),
      defineTool({
        name: 'cluster_similar',
        title: 'Cluster similar photos',
        description:
          `Group up to ${LIMITS.cluster} photos into near-duplicates and bursts using CLIP embeddings: two photos join ` +
          'when their cosine distance is at most maxDistance, or at most burstDistance when taken within maxSeconds. ' +
          'Defaults derive from the server duplicate detection setting. Returns {clusters: [{ids, span (s)}], singles, ' +
          'noEmbedding}; photos not listed in a cluster are unique.',
        input: z.object({
          ids: ids(LIMITS.cluster),
          maxDistance: z.number().min(0.001).max(0.5).optional(),
          burstDistance: z.number().min(0.001).max(0.5).optional(),
          maxSeconds: z.number().min(0).max(3600).optional().describe('Default 5'),
        }),
        mutating: false,
        handler: handle((ctx, input) => this.clusterPhotos(ctx.auth, input)),
      }),
      defineTool({
        name: 'score_photo',
        title: 'Score photos',
        description:
          `Technical and people scores (0..1) for up to ${LIMITS.score} photos, best first: sharp (Laplacian ` +
          'variance), expo (mid-tone mean, few clipped pixels), faces (count), face (largest face share of the frame), ' +
          'people (names), overall = 0.55 sharp + 0.35 expo + 0.1 face score, +0.1 for favorites, ±0.03 per rating ' +
          'star around 3. Heuristics only: judge expressions yourself with view_photos.',
        input: z.object({ ids: ids(LIMITS.score) }),
        mutating: false,
        handler: handle((ctx, input) => this.scorePhotos(ctx.auth, input.ids)),
      }),
      defineTool({
        name: 'select_best',
        title: 'Select best photos',
        description:
          `Pick the best \`count\` photos out of up to ${LIMITS.select} candidates, deterministically. Combines the ` +
          'score_photo overall score, cluster_similar clusters and find_events events (computed over the given ids) ' +
          'with a diversity penalty for similar or near-in-time photos. Precedence: mustIncludeIds, then the caps ' +
          'maxPerCluster (default 2) and maxPerEvent, then minPerPerson for requirePersonIds (default 1) and ' +
          'minPerEvent, then the best remaining photos. Returns {ids, perPerson, perEvent, events, clusters, unmet}; ' +
          'unmet lists constraints that could not be satisfied. Scoring uncached photos can take a while; ' +
          'set useImageScores=false for a quick selection based on metadata only.',
        input: z.object({
          ids: ids(LIMITS.select),
          count: z.int().min(1).max(LIMITS.select),
          maxPerCluster: z.int().min(1).optional(),
          requirePersonIds: z.array(uuid).max(20).optional(),
          minPerPerson: z.int().min(0).optional(),
          maxPerEvent: z.int().min(1).optional(),
          minPerEvent: z.int().min(0).optional(),
          preferPeople: z.boolean().optional().describe('Favour photos with people'),
          chronological: z.boolean().optional().describe('Sort the result by time, default true'),
          excludeIds: z.array(uuid).optional(),
          mustIncludeIds: z.array(uuid).optional(),
          diversity: z.number().min(0).max(1).optional().describe('Similarity penalty weight, default 0.3'),
          gapHours: z.number().min(0.1).max(72).optional().describe('Event gap, default 3'),
          distanceKm: z.number().min(0.1).max(10_000).optional().describe('Event location jump, default 30'),
          eventsByDay: z.boolean().optional().describe('Use calendar days as events'),
          useImageScores: z.boolean().optional().describe('Default true'),
        }),
        mutating: false,
        handler: handle((ctx, input) => this.selectBestPhotos(ctx.auth, input)),
      }),
    ];
  }

  private async searchPhotos(
    auth: AuthDto,
    input: {
      query?: string;
      takenAfter?: string;
      takenBefore?: string;
      personIds?: string[];
      city?: string;
      state?: string;
      country?: string;
      albumId?: string;
      type?: 'image' | 'video';
      isFavorite?: boolean;
      order?: 'asc' | 'desc';
      limit?: number;
      page?: number;
    },
  ) {
    const searchService = BaseService.create(SearchService, this);
    const page = input.page ?? 1;
    const filters = {
      takenAfter: parseDate(input.takenAfter),
      takenBefore: parseDate(input.takenBefore),
      personIds: input.personIds,
      city: input.city,
      state: input.state,
      country: input.country,
      albumIds: input.albumId ? [input.albumId] : undefined,
      type: input.type ? (input.type === 'video' ? AssetType.Video : AssetType.Image) : undefined,
      isFavorite: input.isFavorite,
      visibility: input.albumId ? undefined : AssetVisibility.Timeline,
      size: input.limit ?? 50,
      page,
    };

    const { assets } = input.query
      ? await searchService.searchSmart(auth, { ...filters, query: input.query })
      : await searchService.searchMetadata(auth, {
          ...filters,
          order: input.order === 'desc' ? AssetOrder.Desc : AssetOrder.Asc,
        });

    const rows = await this.getAssets(
      auth,
      assets.items.map(({ id }) => id),
    );
    return toolJson({
      items: rows.map((row) => compactAsset(row)),
      ...(assets.nextPage && { next: page + 1 }),
    });
  }

  private async findPeople(auth: AuthDto, input: { name?: string; limit?: number }) {
    const limit = input.limit ?? 20;
    const userIds = await this.getUserIds(auth);

    if (!input.name) {
      const people = await this.assetJobRepository.getPeopleForAgent(userIds, auth.user.id, { limit });
      return toolJson(people.map(({ id, name, count }) => ({ id, name, n: count })));
    }

    const searchService = BaseService.create(SearchService, this);
    const people = await searchService.searchPerson(auth, { name: input.name, withHidden: false });
    const matches = people.slice(0, limit);
    if (matches.length === 0) {
      return toolJson([]);
    }

    const counts = await this.assetJobRepository.getPeopleForAgent(userIds, auth.user.id, {
      personIds: matches.map(({ id }) => id),
      limit,
    });
    const countById = new Map(counts.map(({ id, count }) => [id, count]));
    return toolJson(matches.map(({ id, name }) => ({ id, name, n: countById.get(id) ?? 0 })));
  }

  private async findEvents(
    auth: AuthDto,
    input: {
      takenAfter?: string;
      takenBefore?: string;
      albumId?: string;
      personIds?: string[];
      gapHours?: number;
      distanceKm?: number;
      byDay?: boolean;
      samples?: number;
      expand?: number[];
    },
  ) {
    if (!input.takenAfter && !input.takenBefore && !input.albumId && !input.personIds?.length) {
      return toolError('Give at least one of takenAfter, takenBefore, albumId or personIds');
    }

    if (input.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [input.albumId] });
    }

    const rows = await this.assetJobRepository.getForAgentEvents({
      userIds: input.albumId ? undefined : await this.getUserIds(auth),
      viewingUserId: auth.user.id,
      albumId: input.albumId,
      personIds: input.personIds,
      takenAfter: parseDate(input.takenAfter),
      takenBefore: parseDate(input.takenBefore),
      limit: LIMITS.events + 1,
    });
    const truncated = rows.length > LIMITS.events;

    const points = rows.slice(0, LIMITS.events).map((row) => ({
      id: row.id,
      time: row.localDateTime.getTime(),
      latitude: row.latitude,
      longitude: row.longitude,
      city: row.city,
      country: row.country,
      people: unique(row.people.map(({ name }) => name)),
    }));

    const events = splitEvents(points, this.getEventOptions(input));
    const samples = input.samples ?? Math.max(1, Math.min(6, Math.floor(240 / Math.max(events.length, 1))));
    const summaries = events.map((event, index) => summarizeEvent(event, index, samples));
    const expand = new Set(input.expand);

    return toolJson({
      count: points.length,
      ...(truncated && { truncated: true }),
      events: summaries.map((summary, index) =>
        expand.has(index) ? { ...summary, ids: events[index].map(({ id }) => id) } : summary,
      ),
      ...(!input.byDay && { days: groupEventsByDay(summaries) }),
    });
  }

  private async getPhotoMetadata(auth: AuthDto, assetIds: string[]) {
    const rows = await this.getAssets(auth, assetIds);
    const albums = await this.assetJobRepository.getAlbumsForAgent(
      rows.map(({ id }) => id),
      auth.user.id,
    );

    const items = rows.map((row) => {
      const assetAlbums = albums
        .filter(({ assetId }) => assetId === row.id)
        .map(({ id, albumName }) => ({ id, name: albumName }));
      const people = row.faces.map((face) => {
        const { x1, y1, x2, y2 } = normalizeFaceBox(face);
        return {
          ...(face.personId && { id: face.personId }),
          ...(face.name && { name: face.name }),
          box: [x1, y1, x2, y2],
        };
      });
      const hasGps = typeof row.latitude === 'number' && typeof row.longitude === 'number';

      return {
        ...compactAsset(row),
        ...(row.timeZone && { tz: row.timeZone }),
        ...(row.make && { make: row.make }),
        ...(row.model && { model: row.model }),
        ...(row.lensModel && { lens: row.lensModel }),
        ...(row.fNumber && { f: row.fNumber }),
        ...(row.exposureTime && { exp: row.exposureTime }),
        ...(row.iso && { iso: row.iso }),
        ...(row.focalLength && { fl: row.focalLength }),
        ...(hasGps && { gps: [round(row.latitude!, 5), round(row.longitude!, 5)] }),
        ...(row.state && { state: row.state }),
        ...(row.description && { desc: row.description }),
        ...(row.rating && { rating: row.rating }),
        ...(people.length > 0 && { people }),
        ...(assetAlbums.length > 0 && { albums: assetAlbums }),
      };
    });

    return toolJson(this.withMissing(assetIds, rows, { items }));
  }

  private async viewPhotos(auth: AuthDto, input: { ids: string[]; size?: number }) {
    const rows = await this.getAssets(auth, input.ids);
    if (rows.length === 0) {
      return toolError('None of the photos were found');
    }

    if (rows.length === 1) {
      const [row] = rows;
      if (!row.previewPath) {
        return toolError(`Photo ${row.id} has no preview yet`);
      }
      const image = await this.mediaRepository.resizeToJpeg(row.previewPath, Math.min(input.size ?? 1024, 1440));
      return toolImage(image, 'image/jpeg', this.withMissing(input.ids, rows, compactAsset(row)));
    }

    const tileSize = Math.min(input.size ?? 256, 512);
    const image = await this.mediaRepository.createContactSheet(
      rows.map((row, index) => ({ input: row.previewPath, label: String(index + 1) })),
      { tileSize },
    );
    const sheet = Object.fromEntries(rows.map((row, index) => [index + 1, row.id]));
    const noPreview = rows.filter((row) => !row.previewPath).map(({ id }) => id);
    return toolImage(
      image,
      'image/jpeg',
      this.withMissing(input.ids, rows, { sheet, ...(noPreview.length > 0 && { noPreview }) }),
    );
  }

  private async clusterPhotos(
    auth: AuthDto,
    input: { ids: string[]; maxDistance?: number; burstDistance?: number; maxSeconds?: number },
  ) {
    const rows = await this.getAssets(auth, input.ids);
    const { clusters, options, noEmbedding } = await this.getClusters(rows, input);
    const groups = clusters.filter(({ ids }) => ids.length > 1);
    const singles = clusters.length - groups.length - noEmbedding;

    return toolJson(
      this.withMissing(input.ids, rows, {
        clusters: groups,
        singles,
        ...(noEmbedding > 0 && { noEmbedding }),
        maxDistance: round(options.maxDistance, 4),
        burstDistance: round(options.burstDistance, 4),
      }),
    );
  }

  private async scorePhotos(auth: AuthDto, assetIds: string[]) {
    const rows = await this.getAssets(auth, assetIds);
    const scores = await this.getScores(rows, true);

    const items = rows
      .map((row, index) => ({ row, score: scores[index] }))
      .toSorted((a, b) => b.score.overall - a.score.overall)
      .map(({ row, score }) => {
        const people = namesOf(row);
        return {
          id: row.id,
          overall: score.overall,
          sharp: score.sharpness,
          expo: score.exposure,
          faces: score.faces,
          ...(score.faces > 0 && { face: score.faceArea }),
          ...(people.length > 0 && { people }),
          ...(row.isFavorite && { fav: true }),
          ...(!row.previewPath && { noImage: true }),
        };
      });

    return toolJson(this.withMissing(assetIds, rows, { items }));
  }

  private async selectBestPhotos(
    auth: AuthDto,
    input: {
      ids: string[];
      count: number;
      maxPerCluster?: number;
      requirePersonIds?: string[];
      minPerPerson?: number;
      maxPerEvent?: number;
      minPerEvent?: number;
      preferPeople?: boolean;
      chronological?: boolean;
      excludeIds?: string[];
      mustIncludeIds?: string[];
      diversity?: number;
      gapHours?: number;
      distanceKm?: number;
      eventsByDay?: boolean;
      useImageScores?: boolean;
    },
  ) {
    const candidateIds = unique([...input.ids, ...(input.mustIncludeIds ?? [])]);
    if (candidateIds.length > LIMITS.select) {
      return toolError(`At most ${LIMITS.select} candidates, including mustIncludeIds`);
    }

    const excluded = new Set(input.excludeIds);
    const accessible = await this.getAssets(auth, candidateIds);
    const rows = accessible.filter(({ id }) => !excluded.has(id));

    const [{ clusters }, scores] = await Promise.all([
      this.getClusters(rows, {}),
      this.getScores(rows, input.useImageScores ?? true),
    ]);
    const clusterIndex = toClusterIndex(clusters.filter(({ ids }) => ids.length > 1));

    const events = splitEvents(
      rows.map((row) => ({
        id: row.id,
        time: row.localDateTime.getTime(),
        latitude: row.latitude,
        longitude: row.longitude,
      })),
      this.getEventOptions({ gapHours: input.gapHours, distanceKm: input.distanceKm, byDay: input.eventsByDay }),
    );
    const eventIndex = new Map(events.flatMap((event, index) => event.map(({ id }) => [id, index] as const)));

    const candidates: SelectionCandidate[] = rows.map((row, index) => ({
      id: row.id,
      time: row.fileCreatedAt.getTime(),
      score: scores[index].overall,
      cluster: clusterIndex.get(row.id) ?? null,
      event: eventIndex.get(row.id) ?? null,
      personIds: personIdsOf(row),
    }));

    const result = selectBest(candidates, {
      count: input.count,
      maxPerCluster: input.maxPerCluster,
      requirePersonIds: input.requirePersonIds,
      minPerPerson: input.minPerPerson,
      maxPerEvent: input.maxPerEvent,
      minPerEvent: input.minPerEvent,
      preferPeople: input.preferPeople,
      chronological: input.chronological,
      excludeIds: input.excludeIds,
      mustIncludeIds: input.mustIncludeIds,
      diversity: input.diversity,
    });

    const names = new Map<string, string>();
    for (const row of rows) {
      for (const face of row.faces) {
        if (face.personId && face.name) {
          names.set(face.personId, face.name);
        }
      }
    }

    return toolJson(
      this.withMissing(
        candidateIds,
        rows,
        {
          ids: result.ids,
          count: result.ids.length,
          ...(Object.keys(result.perPerson).length > 0 && {
            perPerson: Object.entries(result.perPerson).map(([id, n]) => ({
              id,
              ...(names.has(id) && { name: names.get(id) }),
              n,
            })),
          }),
          perEvent: result.perEvent,
          events: result.events,
          clusters: result.clusters,
          ...(result.unmet.length > 0 && { unmet: result.unmet }),
        },
        excluded,
      ),
    );
  }

  /** accessible assets in the requested order; throws when any id is not accessible */
  private async getAssets(auth: AuthDto, assetIds: string[]) {
    const requested = unique(assetIds);
    if (requested.length === 0) {
      return [];
    }

    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: requested });
    const rows = await this.assetJobRepository.getForAgent(requested, auth.user.id);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return requested.map((id) => byId.get(id)).filter((row): row is AgentAsset => !!row);
  }

  private async getUserIds(auth: AuthDto) {
    const partnerIds = await getMyPartnerIds({
      userId: auth.user.id,
      repository: this.partnerRepository,
      timelineEnabled: true,
    });
    return [auth.user.id, ...partnerIds];
  }

  private getEventOptions(input: { gapHours?: number; distanceKm?: number; byDay?: boolean }): EventSplitOptions {
    return {
      maxGapMinutes: input.gapHours === undefined ? DEFAULT_EVENT_OPTIONS.maxGapMinutes : input.gapHours * 60,
      maxDistanceKm: input.distanceKm ?? DEFAULT_EVENT_OPTIONS.maxDistanceKm,
      byDay: input.byDay,
    };
  }

  private async getClusters(
    rows: AgentAsset[],
    overrides: { maxDistance?: number; burstDistance?: number; maxSeconds?: number },
  ): Promise<{ clusters: Cluster[]; options: ReturnType<typeof getClusterDefaults>; noEmbedding: number }> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    const defaults = getClusterDefaults(machineLearning.duplicateDetection.maxDistance);
    const maxDistance = overrides.maxDistance ?? defaults.maxDistance;
    const options = {
      maxDistance,
      burstDistance: Math.max(overrides.burstDistance ?? defaults.burstDistance, maxDistance),
      maxSeconds: overrides.maxSeconds ?? defaults.maxSeconds,
    };

    const embeddings = await this.searchRepository.getEmbeddings(rows.map(({ id }) => id));
    const byId = new Map(embeddings.map(({ assetId, embedding }) => [assetId, parseEmbedding(embedding)]));
    const clusters = clusterSimilar(
      rows.map((row) => ({ id: row.id, time: row.fileCreatedAt.getTime(), embedding: byId.get(row.id) })),
      options,
    );

    return { clusters, options, noEmbedding: rows.filter(({ id }) => !byId.has(id)).length };
  }

  private async getScores(rows: AgentAsset[], withImage: boolean): Promise<PhotoScore[]> {
    return mapLimit(rows, 4, async (row) => {
      const analysis = withImage ? await this.getAnalysis(row) : null;
      return scorePhoto(
        analysis,
        row.faces.map((face) => ({ ...normalizeFaceBox(face), personId: face.personId, name: face.name })),
        { isFavorite: row.isFavorite, rating: row.rating },
      );
    });
  }

  private async getAnalysis(row: AgentAsset) {
    if (!row.previewPath) {
      return null;
    }

    const key = `${row.id}:${row.checksum.toString('hex')}:${row.previewPath}`;
    const cached = analysisCache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const analysis = await this.mediaRepository.analyzeImage(row.previewPath);
      analysisCache.set(key, analysis);
      return analysis;
    } catch (error) {
      this.logger.warn(`Unable to analyze preview of asset ${row.id}: ${error}`);
      return null;
    }
  }

  /** adds the requested ids that were not found (deleted or unknown) to a result */
  private withMissing<T extends object>(
    requested: string[],
    rows: Array<{ id: string }>,
    result: T,
    ignore: Set<string> = new Set(),
  ) {
    const found = new Set(rows.map(({ id }) => id));
    const missing = unique(requested).filter((id) => !found.has(id) && !ignore.has(id));
    return missing.length > 0 ? { ...result, missing } : result;
  }
}
