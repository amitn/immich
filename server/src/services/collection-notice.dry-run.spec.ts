import { Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import postgres from 'postgres';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { CollectionNoticeRepository } from 'src/repositories/collection-notice.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { OcrRepository } from 'src/repositories/ocr.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { CollectionNoticeService, NewVisit } from 'src/services/collection-notice.service.js';
import { newMediumService } from 'test/medium.factory.js';

/**
 * A dry run of the "new collection found" notifications on a real library, read-only: which visits of which packs
 * would be notified to a user on a first run, and why the others would not, without notifying anyone. It needs the
 * machine learning service for the CLIP texts of the packs. Run it against a copy of a database, or a database you
 * only read:
 *
 *   COLLECTION_NOTICES_DRY_RUN_DB_URL=postgres://… COLLECTION_NOTICES_DRY_RUN_EMAIL=demo@immich.dev \
 *   IMMICH_MACHINE_LEARNING_URL=http://127.0.0.1:3003 pnpm test collection-notice.dry-run
 *
 * Every connection is read-only (`default_transaction_read_only`), and only SELECT queries are run: the notices
 * already sent and the last check are taken as none (as on a first run), so the database needs no migration.
 */
const url = process.env.COLLECTION_NOTICES_DRY_RUN_DB_URL;
const email = process.env.COLLECTION_NOTICES_DRY_RUN_EMAIL ?? 'demo@immich.dev';
const windowDays = Number(process.env.COLLECTION_NOTICES_DRY_RUN_DAYS ?? 14);

describe.skipIf(!url)('collection notices dry run', () => {
  let db: Kysely<DB>;

  beforeAll(() => {
    db = new Kysely<DB>({
      dialect: new PostgresJSDialect({
        postgres: postgres(url!, { max: 2, connection: { default_transaction_read_only: true } }),
      }),
    });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('should find the new visits to notify', { timeout: 600_000 }, async () => {
    const { rows } = await sql<{ readOnly: string }>`show default_transaction_read_only`.execute(db);
    expect(rows[0].readOnly ?? Object.values(rows[0])[0]).toBe('on');

    const user = await db
      .selectFrom('user')
      .select(['id', 'name', 'email', 'isAdmin', 'quotaUsageInBytes', 'quotaSizeInBytes'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();

    const { sut, ctx } = newMediumService(CollectionNoticeService, {
      database: db,
      real: [
        AccessRepository,
        AssetRepository,
        AssetJobRepository,
        CollectionNoticeRepository,
        ConfigRepository,
        OcrRepository,
        SearchRepository,
        SystemMetadataRepository,
        TagRepository,
        UserRepository,
      ],
      mock: [LoggingRepository],
    });
    // a first run: nothing notified yet, never checked (the tables may not even exist in this database)
    const notices = ctx.get(CollectionNoticeRepository);
    vi.spyOn(notices, 'getCheckedAt').mockResolvedValue(undefined);
    vi.spyOn(notices, 'getNotices').mockResolvedValue([]);
    const machineLearning = new MachineLearningRepository(LoggingRepository.create());
    const config = await sut.getConfig({ withCache: false });
    machineLearning.setup(config.machineLearning);
    Object.assign(sut, { machineLearningRepository: machineLearning });

    const now = new Date();
    const auth = { user: { ...user, quotaUsageInBytes: Number(user.quotaUsageInBytes) } };
    const uploads = await notices.getUploads(user.id, new Date(now.getTime() - windowDays * 86_400_000), 2000);
    const visits = await sut.findNewVisits(auth, { windowDays }, now);
    const home = await notices.getHome(user.id);

    // the uploads that no pack found a visit in, by the first words of their file names
    const inVisits = new Set(visits.flatMap(({ assetIds }) => assetIds));
    const outside = uploads.filter(({ id }) => !inVisits.has(id));
    const assets = outside.length > 0 ? await ctx.get(AssetRepository).getByIds(outside.map(({ id }) => id)) : [];
    const stems = Map.groupBy(assets, (asset) =>
      asset.originalFileName
        .replace(/\.[^.]+$/, '')
        .split(/[\s_-]+/)
        .filter((word) => /^[a-z]/i.test(word))
        .slice(0, 2)
        .join(' ')
        .toLowerCase(),
    );
    // the file names of the photos of the visits worth a look, to tell what they are
    const worthALook = visits.filter(({ status }) => status !== 'small');
    const names = new Map<string, string>();
    const ids = [...new Set(worthALook.flatMap(({ assetIds }) => assetIds))];
    for (let index = 0; index < ids.length; index += 500) {
      for (const asset of await ctx.get(AssetRepository).getByIds(ids.slice(index, index + 500))) {
        names.set(asset.id, asset.originalFileName);
      }
    }
    const line = (visit: NewVisit) =>
      `    [${visit.status}] ${visit.pack} ${visit.key} · ${visit.subjects} subjects, ${visit.assetIds.length} photos` +
      (visit.share === undefined ? '' : `, ${Math.round(visit.share * 100)}% ${visit.pack}`) +
      ' · ' +
      `“${visit.title}” — ${visit.description}` +
      (visit.status === 'small'
        ? ''
        : ` · e.g. ${visit.assetIds
            .slice(0, 2)
            .map((id) => names.get(id)?.slice(0, 40))
            .join(', ')}`);
    const fresh = visits.filter(({ status }) => status === 'new');
    process.stdout.write(
      [
        `Dry run for ${email} (${user.name}) on ${now.toISOString()}, uploads of the last ${windowDays} days`,
        `  uploads: ${uploads.length} photos`,
        `  home: ${home ? `${home.latitude}, ${home.longitude} (located photos on ${home.days} days)` : 'unknown'}`,
        `  visits found: ${visits.length} (${[...Map.groupBy(visits, ({ status }) => status)]
          .map(([status, items]) => `${items.length} ${status}`)
          .join(', ')})`,
        ...[...Map.groupBy(visits, ({ pack }) => pack)].flatMap(([pack, items]) => [
          `  ${pack}: ${items.filter(({ status }) => status === 'small').length} too small (not listed)`,
          ...items.filter(({ status }) => status !== 'small').map((visit) => line(visit)),
        ]),
        `  a first run would notify (at most 3): ${
          fresh
            .slice(0, 3)
            .map(({ title }) => `“${title}”`)
            .join(', ') || 'nothing'
        }`,
        `  uploads in no visit of any pack: ${outside.length}`,
        ...[...stems]
          .toSorted((a, b) => b[1].length - a[1].length)
          .slice(0, 25)
          .map(([stem, items]) => `    ${items.length} × ${stem || '(no name)'}`),
      ].join('\n') + '\n',
    );
    expect(visits.every((visit) => visit.title.endsWith('?'))).toBe(true);
  });
});
