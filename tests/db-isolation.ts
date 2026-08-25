/**
 * A database of this run's own — and of *this run's* own, not of this suite's.
 *
 * The two suites in `vitest.db.config.ts` are destructive by nature: INV-7
 * kills backends mid-transaction and the failure-mode matrix terminates them on
 * purpose. The e2e suite is destructive in a different way — `POST /api/test/
 * seed` TRUNCATEs every content table. Pointed at one database they corrupt
 * each other, and the corruption does not look like a race. It looks like a
 * product bug: a seed truncating `engagements` while INV-7 is between its
 * `content` and `finalize` checkpoints leaves the purge asserting against a row
 * that no longer exists, and the failure reads as "the purge wrote the wrong
 * status". That cost a wrong bug report against the purge worker, which was
 * behaving correctly the whole time.
 *
 * A lock would serialise the two suites. That is the wrong fix: it makes each
 * suite responsible for knowing about the other, forever, including suites
 * nobody has written yet. A separate database makes the question not arise.
 *
 * ## Why the name now carries a run id
 *
 * The first version of this file created one database called
 * `<database>_dbsuite` — separate from the e2e suite's, and **shared by every
 * concurrent run of `npm run test:db`**. `fileParallelism: false` serialises
 * files within a run and says nothing about two runs, and this repository has
 * several agents working at once.
 *
 * The back-end lost a run to exactly that: a second `test:db` reached the
 * `DROP DATABASE ... WITH (FORCE)` at the top of this file while the first was
 * mid-suite, and every open connection died with
 * `57P01 terminating connection due to administrator command`. Twenty-seven
 * failures, clean on retry.
 *
 * The interesting part is not the collision, it is the shape of the evidence.
 * It does not present as two runs colliding. It presents as **twenty-seven
 * unrelated-looking failures in someone else's work**, and the retry that
 * clears them is indistinguishable from flake. A whole investigation was spent
 * establishing that code which was never wrong was not wrong. That is the same
 * cost DEFECT-8 imposed, one level up: this file was the fix for two *suites*
 * sharing a database, and it left two *runs* sharing one.
 *
 * So the name carries an epoch, a pid and a random tail. Two runs cannot meet.
 *
 * ## And the sweep, because unique names trade a collision for a leak
 *
 * A run that is SIGKILLed — and this suite kills processes for a living, so
 * that is a Tuesday — never reaches `teardown()` and leaves its database
 * behind. Under a fixed name that was self-correcting: the next run dropped it.
 * Under unique names nothing ever drops it, and a developer's Postgres quietly
 * accumulates one database per interrupted run until `max_connections` or the
 * disk says otherwise.
 *
 * The epoch is in the name so the sweep needs no catalogue timestamp: anything
 * matching the prefix and older than `STALE_MS` is from a run that is not
 * coming back. It is dropped `WITH (FORCE)`, which is safe precisely because
 * the age check has already established nobody is using it.
 *
 * Set `RELAY_KEEP_TEST_DB=1` to keep this run's database for a post-mortem; the
 * name is printed either way.
 */

import { execFileSync } from 'node:child_process';
import pg from 'pg';

const SUFFIX = '_dbsuite';

/**
 * How old an abandoned database must be before the sweep drops it.
 *
 * Comfortably longer than the suite's own `testTimeout` (120s) so that a run
 * still in progress is never a candidate, and short enough that a developer
 * does not accumulate a day's worth. The age is read from the name, so this
 * needs no privileges beyond what creating the database already required.
 */
const STALE_MS = 2 * 60 * 60 * 1000;

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/** The database name with any previous run's suffix stripped back off. */
function baseNameFrom(base: string): string {
  const url = new URL(base);
  const current = url.pathname.replace(/^\//, '');
  if (current === '') throw new Error('DATABASE_URL names no database');
  // Idempotent: pointing DATABASE_URL at a suite database must not produce
  // `relay_dbsuite_..._dbsuite_...`.
  const index = current.indexOf(SUFFIX);
  return index === -1 ? current : current.slice(0, index);
}

/**
 * `<base>_dbsuite_<epoch36>_<pid>_<rand>`.
 *
 * The epoch is base 36 to keep the identifier short — Postgres truncates at 63
 * bytes, and a truncated name is a name two runs can share again. The pid
 * separates two runs started in the same millisecond on one machine; the random
 * tail separates two started in the same millisecond on two machines against
 * one server, which is what CI looks like.
 */
function runNameFrom(base: string): string {
  const stem = baseNameFrom(base);
  const epoch = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  const name = `${stem}${SUFFIX}_${epoch}_${process.pid}_${rand}`;
  if (name.length > 63) throw new Error(`test database name is ${name.length} bytes; max is 63`);
  return name;
}

/** Reads the creation time back out of a run database's name. */
export function epochFromName(name: string, stem: string): number | null {
  const prefix = `${stem}${SUFFIX}_`;
  if (!name.startsWith(prefix)) return null;
  const epoch = Number.parseInt(name.slice(prefix.length).split('_')[0] ?? '', 36);
  return Number.isFinite(epoch) && epoch > 0 ? epoch : null;
}

/**
 * Drops databases left behind by runs that were killed before teardown.
 *
 * Never throws. A sweep that fails must not fail the suite: it is housekeeping,
 * and the run that triggered it has its own database either way. A permission
 * error here is a note, not a stop.
 */
async function sweepAbandoned(client: pg.Client, stem: string, now: number): Promise<void> {
  try {
    const { rows } = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${stem}${SUFFIX}\\_%`],
    );
    for (const { datname } of rows) {
      const epoch = epochFromName(datname, stem);
      if (epoch === null || now - epoch < STALE_MS) continue;
      try {
        await client.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
        console.log(`[db-isolation] swept abandoned ${datname}`);
      } catch (error) {
        console.log(`[db-isolation] could not sweep ${datname}: ${String(error)}`);
      }
    }
  } catch (error) {
    console.log(`[db-isolation] sweep skipped: ${String(error)}`);
  }
}

let created: { admin: string; name: string } | null = null;

export async function setup(): Promise<void> {
  const base = process.env.DATABASE_URL;
  if (!base) {
    // The suites themselves fail loudly about this, with a better message than
    // a global setup can give. Let them.
    return;
  }

  const stem = baseNameFrom(base);
  const name = runNameFrom(base);
  const admin = urlFor(base, 'postgres');
  const target = urlFor(base, name);

  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  try {
    await sweepAbandoned(client, stem, Date.now());
    // No `DROP ... IF EXISTS` before this any more, and that is the whole
    // point: the name is this run's, so there is nothing of anyone else's to
    // drop. The `WITH (FORCE)` that used to sit here is what killed a
    // concurrent run's connections with 57P01.
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }

  execFileSync(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: target },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = target;
  created = { admin, name };
  console.log(`[db-isolation] using ${name}`);
}

export async function teardown(): Promise<void> {
  if (!created) return;
  if (process.env.RELAY_KEEP_TEST_DB === '1') {
    console.log(`[db-isolation] keeping ${created.name} (RELAY_KEEP_TEST_DB=1)`);
    return;
  }
  const client = new pg.Client({ connectionString: created.admin });
  await client.connect();
  try {
    // `WITH (FORCE)` still, for this run's own database: the suite kills
    // backends for a living and one of ours may have outlived its test.
    await client.query(`DROP DATABASE IF EXISTS "${created.name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
