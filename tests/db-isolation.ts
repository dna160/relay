/**
 * A database of this suite's own.
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
 * So this creates `<database>_dbsuite` from scratch, migrates it, points
 * `DATABASE_URL` at it for the duration, and drops it afterwards. Set
 * `RELAY_KEEP_TEST_DB=1` to keep it for a post-mortem.
 */

import { execFileSync } from 'node:child_process';
import pg from 'pg';

const SUFFIX = '_dbsuite';

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

function nameFrom(base: string): string {
  const url = new URL(base);
  const current = url.pathname.replace(/^\//, '');
  if (current === '') throw new Error('DATABASE_URL names no database');
  return current.endsWith(SUFFIX) ? current : `${current}${SUFFIX}`;
}

let created: { admin: string; name: string } | null = null;

export async function setup(): Promise<void> {
  const base = process.env.DATABASE_URL;
  if (!base) {
    // The suites themselves fail loudly about this, with a better message than
    // a global setup can give. Let them.
    return;
  }

  const name = nameFrom(base);
  const admin = urlFor(base, 'postgres');
  const target = urlFor(base, name);

  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  try {
    // WITH (FORCE) so a connection left behind by a previous killed run — and
    // this suite kills processes for a living — cannot block the drop.
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
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
    await client.query(`DROP DATABASE IF EXISTS "${created.name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
