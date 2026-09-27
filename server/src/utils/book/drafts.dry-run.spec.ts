import { Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import postgres from 'postgres';
import { defaults } from 'src/dtos/config.dto.js';
import { BookDraftRepository } from 'src/repositories/book-draft.repository.js';
import { DB } from 'src/schema/index.js';
import {
  findTrips,
  getBirthdayDraft,
  getBirthdayYear,
  getDaySpan,
  getDraftPageCount,
  getTripDrafts,
  getYearlyDrafts,
  selectDrafts,
} from 'src/utils/book/drafts.js';

/**
 * A dry run of the book drafts on a real library, read-only: which books would be drafted for a user, without
 * drafting them. Run it against a copy of a database, or a database you only read:
 *
 *   BOOK_DRAFTS_DRY_RUN_DB_URL=postgres://… BOOK_DRAFTS_DRY_RUN_EMAIL=demo@immich.dev pnpm test drafts.dry-run
 *
 * Every connection is read-only (`default_transaction_read_only`), and only SELECT queries are run.
 */
const url = process.env.BOOK_DRAFTS_DRY_RUN_DB_URL;
const email = process.env.BOOK_DRAFTS_DRY_RUN_EMAIL ?? 'demo@immich.dev';

describe.skipIf(!url)('book drafts dry run', () => {
  let db: Kysely<DB>;

  beforeAll(() => {
    db = new Kysely<DB>({
      dialect: new PostgresJSDialect({
        postgres: postgres(url!, { max: 1, connection: { default_transaction_read_only: 'on' } }),
      }),
    });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('should draft the books of the library', async () => {
    const { rows } = await sql<{ readOnly: string }>`show default_transaction_read_only`.execute(db);
    expect(rows[0].readOnly ?? Object.values(rows[0])[0]).toBe('on');

    const user = await db
      .selectFrom('user')
      .select(['id', 'name'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    const repository = new BookDraftRepository(db);
    const now = new Date();

    const tags = await repository.getCollectionTags(user.id, ['Food/', 'Art/', 'Recipes/', 'Wine/', 'Travel/']);
    const timeline = await repository.getTimeline(user.id);
    const people = await repository.getPeopleWithBirthdays(user.id);
    const candidates = [...getYearlyDrafts(tags, now), ...getTripDrafts(tags, timeline, now)];
    for (const person of people) {
      const year = getBirthdayYear(person.birthDate, now);
      if (!year) {
        continue;
      }
      const photos = await repository.getPersonPhotos(user.id, person.id, new Date(year.from), new Date(year.to + 1));
      const draft = getBirthdayDraft(person, photos, now);
      if (draft) {
        candidates.push(draft);
      }
    }

    const roots = Map.groupBy(tags, (tag) => tag.value.split('/', 1)[0]);
    // what falls short of the thresholds, to see how close the library is
    const years = Map.groupBy(tags, (tag) => `${tag.value.split('/', 1)[0]} ${new Date(tag.time).getUTCFullYear()}`);
    const trips = findTrips(timeline);
    process.stdout.write(
      [
        `Dry run for ${email} (${user.name}) on ${now.toISOString()}`,
        `  timeline: ${timeline.length} photos, ${timeline.filter((photo) => photo.latitude !== null).length} located`,
        `  collection tags: ${[...roots].map(([root, values]) => `${root} ${values.length}`).join(', ') || 'none'}`,
        `  collection years: ${[...years]
          .map(([year, values]) => {
            const places = new Set(values.map(({ value }) => value.split('/', 2)[1]));
            const entries = values.filter(({ value }) => !/\/(Menu|Label|Recipe|Wine list|Tickets)$/.test(value));
            return `${year}: ${places.size} places, ${entries.length} subject photos`;
          })
          .join('; ')}`,
        `  trips away from home: ${
          trips
            .map(
              (trip) =>
                `${new Date(trip.start).toISOString().slice(0, 10)} ${getDaySpan(trip.start, trip.end)}d/${trip.photos.length}p`,
            )
            .join(', ') || 'none'
        }`,
        `  people with a birth date: ${people.length}`,
        `  candidates: ${candidates.length}`,
        ...candidates.map(
          (draft) =>
            `    ${draft.key} · "${draft.title}"${draft.subtitle ? ` (${draft.subtitle})` : ''} · ${draft.stylePreset} · ` +
            `${draft.assetIds.length} photos${getDraftPageCount(draft.assetIds.length) ? ', capped pages' : ''} · ${draft.reason}`,
        ),
        `  first run would draft: ${
          selectDrafts(candidates, {
            existingKeys: new Set(),
            kinds: defaults.books.drafts,
            limit: defaults.books.drafts.maxPerRun,
          })
            .map((draft) => draft.key)
            .join(', ') || 'nothing'
        }`,
      ].join('\n') + '\n',
    );
  });
});
