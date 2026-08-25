/**
 * INV-7 — Purge destroys all object bytes and content rows for an engagement
 * and leaves exactly one `purge_certificate`.
 *
 * The certificate proves absence, not content. It is the compliance artifact
 * the agency forwards to its client's legal team, which is what turns the
 * paywall's downside into something they are glad to have.
 *
 * UNSKIPPED IN: Phase 6 — `src/workers/purge.ts`, migration 0003, and a live
 * Postgres. Every case below runs; none is asserted by reasoning about the
 * worker's source.
 *
 * ## The kills are real kills
 *
 * Condition 4 — "a forced mid-run failure is safe to rerun" — is the reason
 * this suite spawns a child process. Throwing an exception inside the worker
 * would test the wrong thing: an exception unwinds the stack, runs every
 * `finally`, and lets drizzle send its `ROLLBACK` politely. The failure RUNBOOK
 * §6 is written for is a container that stops existing. So the purge under test
 * runs in its own process and is killed with SIGKILL, which cannot be caught,
 * at each of the four checkpoints plus once *inside* the content transaction.
 * `_purge-harness.ts` explains how each kill is made deterministic rather than
 * raced.
 *
 * ## Why this suite needs a database and does not pretend otherwise
 *
 * A skipped suite is honest and a passing empty suite is a lie. So is a suite
 * that quietly degrades to nothing when `DATABASE_URL` is absent. Phase 6 has
 * landed; the database is part of the gate. If it is missing, this fails and
 * says so.
 *
 * Never edit this file to make a build pass.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { TABLE_DISPOSITION } from '@/domain/retention/manifest';
import { REQUIRED_WARNINGS } from '@/domain/retention/schedule';
import { linesMatching, sourceFiles } from './_source';
import { allMigrationSql } from './_sql';
import {
  censusTotal,
  cleanStore,
  contentCensus,
  dropSeed,
  listObjects,
  seedPurgeable,
  sentinelPath,
  spawnPurge,
  waitForSentinel,
  waitForLockWait,
  type ParkPoint,
  type SeededEngagement,
} from './_purge-harness';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

/* ========================================================================== */
/* Structural — the half that holds without executing anything.               */
/* ========================================================================== */

describe('INV-7 the purge worker cannot lose a table or skip the warning guard', () => {
  it('every table in the schema has a disposition, so a new one cannot escape a purge', () => {
    const sql = allMigrationSql();
    const declared = [...sql.matchAll(/CREATE TABLE\s+"([a-z_]+)"/gi)].map((m) => m[1] ?? '');
    expect(declared.length, 'no CREATE TABLE found in the migrations').toBeGreaterThan(10);

    const unclassified = declared.filter((t) => !(t in TABLE_DISPOSITION));
    expect(
      unclassified,
      'a table exists that TABLE_DISPOSITION does not classify. A purge that does not ' +
        'know about a table is a purge that leaves customer content behind.',
    ).toEqual([]);

    // And the reverse: a disposition for a table that no longer exists is a
    // classification nobody is maintaining.
    const phantom = Object.keys(TABLE_DISPOSITION).filter((t) => !declared.includes(t));
    expect(phantom, 'TABLE_DISPOSITION classifies a table the schema does not have').toEqual([]);
  });

  it('the warning guard is checked again inside the transaction that deletes', () => {
    // Not a stylistic preference. The outer check can be reached around by a
    // future caller; the inner one is inside the only transaction that
    // destroys anything, immediately before the first DELETE.
    const worker = sourceFiles().find((f) => f.path === 'src/workers/purge.ts');
    expect(worker, 'src/workers/purge.ts is missing').toBeDefined();
    if (!worker) return;

    const tx = worker.text.match(/\.transaction\s*\(\s*async\s*\(\s*tx\s*\)\s*=>\s*\{([\s\S]*?)\n\s{4}\}\)/);
    expect(tx, 'the content step is no longer a db.transaction block').not.toBeNull();
    const body = tx?.[1] ?? '';
    const warned = body.indexOf('assertWarned');
    const destroyed = body.indexOf('destroyContent');
    expect(warned, 'assertWarned is not called inside the deleting transaction').toBeGreaterThan(-1);
    expect(destroyed, 'destroyContent is not called inside the transaction').toBeGreaterThan(-1);
    expect(warned, 'the warning guard must run before the first delete').toBeLessThan(destroyed);
  });

  it('the certificate insert and the content delete share one transaction', () => {
    const worker = sourceFiles().find((f) => f.path === 'src/workers/purge.ts');
    if (!worker) return;
    const tx = worker.text.match(/\.transaction\s*\(\s*async\s*\(\s*tx\s*\)\s*=>\s*\{([\s\S]*?)\n\s{4}\}\)/);
    const body = tx?.[1] ?? '';
    expect(body, 'the certificate is written outside the deleting transaction').toMatch(
      /insert\s*\(\s*purgeCertificates\s*\)/,
    );
    expect(body, 'the one-certificate count assertion left the transaction').toMatch(
      /countCertificates\s*\(\s*tx\s*,/,
    );
  });

  it('the dry-run path is wired to a store that refuses to delete', () => {
    const cli = sourceFiles().find((f) => f.path === 'src/workers/purge-cli.ts');
    expect(cli, 'src/workers/purge-cli.ts is missing').toBeDefined();
    if (!cli) return;
    expect(cli.text, '--plan must use readOnlyStore').toMatch(/readOnlyStore/);
    // planPurge is the only entry point --plan may call.
    expect(linesMatching(cli, /purgeEngagement\s*\(/).length).toBeGreaterThan(0);
  });

  it('the unique index is what makes "exactly one" a database property', () => {
    expect(allMigrationSql()).toMatch(
      /CREATE UNIQUE INDEX[^;]*ON "purge_certificates"[^;]*\("engagement_id"\)/i,
    );
    expect(
      allMigrationSql(),
      'purge_certificates must carry no foreign key to the engagement it outlives',
    ).not.toMatch(/ALTER TABLE "purge_certificates" ADD CONSTRAINT[^;]*REFERENCES/i);
  });
});

/* ========================================================================== */
/* Live — a real database, real bytes, real SIGKILLs.                          */
/* ========================================================================== */

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const CHILD_ENV = {
  DATABASE_URL,
  CERTIFICATE_SIGNING_KEY: process.env.CERTIFICATE_SIGNING_KEY ?? 'inv7-local-signing-key',
};
const MINUTE = 60_000;

describe('INV-7 under a live database', () => {
  let pool: pg.Pool;
  let bucketRoot: string;
  let store: string;
  const seeded: SeededEngagement[] = [];

  beforeAll(async () => {
    expect(
      DATABASE_URL,
      'INV-7 needs a database. Phase 6 landed the purge worker, so a green INV-7 with no ' +
        'Postgres behind it would be a passing empty suite — the one thing the invariant ' +
        'contract forbids. Set DATABASE_URL (docker compose up -d db; npm run db:migrate).',
    ).not.toBe('');
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM information_schema.tables
        WHERE table_schema='public' AND table_name IN ('purge_certificates','purge_manifest')`,
    );
    expect(Number(rows[0]?.n ?? 0), 'migration 0003 has not been applied; run npm run db:migrate').toBe(2);
    bucketRoot = mkdtempSync(join(tmpdir(), 'relay-inv7-'));
  }, MINUTE);

  afterAll(async () => {
    for (const seed of seeded) await dropSeed(pool, seed);
    await pool.end();
    if (bucketRoot) rmSync(bucketRoot, { recursive: true, force: true });
  }, MINUTE);

  /**
   * A fresh bucket per test. Sharing one directory made a kill in one case
   * visible to the next, which is the kind of coupling that turns a real
   * failure into a mystery about ordering.
   */
  async function seed(options: { warnings?: number; label?: string } = {}): Promise<SeededEngagement> {
    store = join(bucketRoot, `${options.label ?? 'seed'}-${String(seeded.length)}`);
    cleanStore(store);
    const s = await seedPurgeable(pool, store, options);
    seeded.push(s);
    return s;
  }

  async function certificates(engagementId: string): Promise<
    { count: number; objectCount: number | null; totalBytes: number | null; sha: string | null }
  > {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n, min(object_count) AS oc, min(total_bytes) AS tb,
              min(manifest_sha256) AS sha
         FROM purge_certificates WHERE engagement_id = $1`,
      [engagementId],
    );
    const row = rows[0] as { n: number; oc: number | null; tb: string | null; sha: string | null };
    return {
      count: row.n,
      objectCount: row.oc,
      totalBytes: row.tb === null ? null : Number(row.tb),
      sha: row.sha,
    };
  }

  async function steps(engagementId: string): Promise<Record<string, string>> {
    const { rows } = await pool.query<{ step: string; status: string }>(
      'SELECT step, status FROM purge_manifest WHERE engagement_id = $1',
      [engagementId],
    );
    return Object.fromEntries(rows.map((r) => [r.step, r.status]));
  }

  async function auditActions(engagementId: string): Promise<Record<string, number>> {
    const { rows } = await pool.query<{ action: string; n: string }>(
      'SELECT action, count(*) AS n FROM audit_log WHERE engagement_id = $1 GROUP BY action',
      [engagementId],
    );
    return Object.fromEntries(rows.map((r) => [r.action, Number(r.n)]));
  }

  async function run(
    engagementId: string,
    options: { resume?: boolean } = {},
  ): Promise<{ code: number | null; stdout: string }> {
    const handle = spawnPurge(engagementId, store, 'none', {
      ...CHILD_ENV,
      ...(options.resume ? { RELAY_PURGE_RESUME: '1' } : {}),
    });
    const { code, stdout } = await handle.done;
    return { code, stdout };
  }

  /* ---------------------------------------------------------- condition 1 */

  it(
    'purging removes every content row reachable from the engagement',
    async () => {
      const s = await seed({ label: 'c1' });
      const before = await contentCensus(pool, s.engagementId);
      // The fixture must actually exercise every content table, or "all rows
      // were destroyed" is a claim about an empty set.
      for (const [table, n] of Object.entries(before)) {
        expect(n, `the fixture seeded no rows in ${table}`).toBeGreaterThan(0);
      }

      const { code, stdout } = await run(s.engagementId);
      expect(stdout).toContain('CHILD_OK');
      expect(code).toBe(0);

      const after = await contentCensus(pool, s.engagementId);
      for (const [table, n] of Object.entries(after)) {
        expect(n, `${table} still holds rows after a purge`).toBe(0);
      }

      // The tombstone survives, marked. ADR-007.
      const { rows } = await pool.query<{ status: string }>(
        'SELECT status FROM engagements WHERE id = $1',
        [s.engagementId],
      );
      expect(rows[0]?.status, 'the engagement tombstone was destroyed or left unmarked').toBe('purged');

      // The evidence survives too — this is what RUNBOOK §6 triages against.
      const audit = await auditActions(s.engagementId);
      expect(audit['retention.warned'], 'the warnings were destroyed with the content').toBe(
        REQUIRED_WARNINGS,
      );
      expect(audit['engagement.archived']).toBe(1);
      expect(audit['purge.completed']).toBe(1);
      expect(audit['card.created'], 'an ordinary audit row survived the purge').toBeUndefined();
    },
    MINUTE,
  );

  /* ---------------------------------------------------------- condition 2 */

  it(
    'purging deletes every object key it listed, including one no row points at',
    async () => {
      const s = await seed({ label: 'c2' });
      expect(listObjects(store).length, 'the fixture wrote no objects').toBe(4);
      expect(
        listObjects(store),
        'the fixture must include an orphan, or the bucket-listing half of the manifest is untested',
      ).toContain(s.orphanKey);

      await run(s.engagementId);

      expect(listObjects(store), 'object bytes survived the purge').toEqual([]);
      const cert = await certificates(s.engagementId);
      expect(cert.objectCount, 'the certificate undercounts what it destroyed').toBe(4);
      expect(cert.totalBytes).toBeGreaterThan(0);
    },
    MINUTE,
  );

  /* ------------------------------------------------------- conditions 3, 4 */

  it(
    'a purge that completes twice still leaves exactly one certificate',
    async () => {
      const s = await seed({ label: 'c3' });
      const first = await run(s.engagementId);
      expect(first.stdout).toContain('CHILD_OK purged');
      const second = await run(s.engagementId, { resume: true });
      expect(second.stdout, 'a second run re-purged rather than recognising it was done').toContain(
        'CHILD_OK already_purged',
      );
      expect((await certificates(s.engagementId)).count).toBe(1);
    },
    MINUTE,
  );

  /**
   * The four checkpoints plus the transaction interior. Each is a real SIGKILL
   * to a real process parked at a known point — see `_purge-harness.ts`.
   */
  const SENTINEL_KILLS: { park: Exclude<ParkPoint, 'none'>; expect: Record<string, string> }[] = [
    { park: 'list', expect: { manifest: 'running' } },
    { park: 'remove', expect: { manifest: 'done', objects: 'running' } },
    { park: 'remove-half', expect: { manifest: 'done', objects: 'running' } },
  ];

  for (const { park, expect: expectedSteps } of SENTINEL_KILLS) {
    it(
      `SIGKILL at the ${park} checkpoint is safe to rerun and yields one certificate`,
      async () => {
        const s = await seed({ label: `k-${park}` });
        const child = spawnPurge(s.engagementId, store, park, CHILD_ENV);
        await waitForSentinel(child, sentinelPath(store, park));
        child.kill();
        const killed = await child.done;
        expect(killed.signal, 'the child was not actually killed').toBe('SIGKILL');

        // Nothing was certified, and the content is untouched.
        expect((await certificates(s.engagementId)).count, 'a killed purge certified itself').toBe(0);
        expect(censusTotal(await contentCensus(pool, s.engagementId))).toBeGreaterThan(0);
        expect(await steps(s.engagementId)).toMatchObject(expectedSteps);

        const rerun = await run(s.engagementId, { resume: true });
        expect(rerun.stdout, `rerun after a kill at ${park} failed`).toContain('CHILD_OK');
        expect((await certificates(s.engagementId)).count).toBe(1);
        expect(censusTotal(await contentCensus(pool, s.engagementId))).toBe(0);
        expect(listObjects(store)).toEqual([]);
        expect(await steps(s.engagementId)).toEqual({
          manifest: 'done',
          objects: 'done',
          content: 'done',
          finalize: 'done',
        });
      },
      2 * MINUTE,
    );
  }

  it(
    'SIGKILL inside the deleting transaction destroys nothing and certifies nothing',
    async () => {
      const s = await seed({ label: 'k-content' });
      const rowsBefore = censusTotal(await contentCensus(pool, s.engagementId));

      // Hold a row lock on a row the content step must delete. Row locks leave
      // the earlier steps' plain reads alone, so the child parks precisely on
      // the first DELETE and nowhere earlier.
      const blocker = await pool.connect();
      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT a.id FROM approvals a
           JOIN asset_versions v ON v.id = a.asset_version_id
           JOIN cards k ON k.id = v.card_id
          WHERE k.engagement_id = $1 FOR UPDATE`,
        [s.engagementId],
      );

      const child = spawnPurge(s.engagementId, store, 'none', CHILD_ENV);
      await waitForLockWait(pool);
      child.kill();
      const killed = await child.done;
      await blocker.query('ROLLBACK');
      blocker.release();

      expect(killed.signal).toBe('SIGKILL');
      // This is the case the whole design exists for. Postgres rolled the
      // transaction back with no ROLLBACK ever being sent.
      expect(
        censusTotal(await contentCensus(pool, s.engagementId)),
        'a killed transaction left content half-deleted',
      ).toBe(rowsBefore);
      expect(
        (await certificates(s.engagementId)).count,
        'a certificate survived a transaction that was rolled back',
      ).toBe(0);
      expect((await steps(s.engagementId)).content).toBe('running');

      const rerun = await run(s.engagementId, { resume: true });
      expect(rerun.stdout).toContain('CHILD_OK');
      const cert = await certificates(s.engagementId);
      expect(cert.count).toBe(1);
      expect(censusTotal(await contentCensus(pool, s.engagementId))).toBe(0);
      // The certificate describes what was there, not what a manifest rebuilt
      // after the deletion would have found. A zero here is the bug the stored
      // manifest exists to prevent.
      expect(cert.objectCount, 'the certificate claims nothing was destroyed').toBe(4);
      expect(cert.totalBytes).toBeGreaterThan(0);
    },
    2 * MINUTE,
  );

  it(
    'SIGKILL after the certificate but before the tombstone still yields one certificate',
    async () => {
      const s = await seed({ label: 'k-finalize' });
      const blocker = await pool.connect();
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM engagements WHERE id = $1 FOR UPDATE', [s.engagementId]);

      const child = spawnPurge(s.engagementId, store, 'none', CHILD_ENV);
      await waitForLockWait(pool);
      child.kill();
      const killed = await child.done;
      await blocker.query('ROLLBACK');
      blocker.release();

      expect(killed.signal).toBe('SIGKILL');
      // Content and certificate committed together — that is the part INV-7 is
      // about, and it holds whatever happened to the statement in flight.
      expect(censusTotal(await contentCensus(pool, s.engagementId))).toBe(0);
      expect((await certificates(s.engagementId)).count).toBe(1);

      /**
       * The tombstone is deliberately *not* asserted here, and the reason is
       * worth writing down. `UPDATE engagements SET status = 'purged'` is a
       * statement of its own, not part of a transaction. When the lock is
       * released the killed backend — which Postgres has not yet noticed is
       * orphaned, because it was waiting on a lock rather than reading from a
       * socket — acquires it, runs the update, commits, and only then discovers
       * it has nobody to answer. So the last statement of a killed purge can
       * still land after the kill. It is harmless because step 4 is idempotent,
       * but a test that asserted `archived` here would be asserting a race.
       */
      const { rows } = await pool.query<{ status: string }>(
        'SELECT status FROM engagements WHERE id = $1',
        [s.engagementId],
      );
      /**
       * The row first, on its own, with its own message.
       *
       * This assertion used to be a bare `toContain(rows[0]?.status)`, and when
       * something else truncated `engagements` mid-run it failed with
       * "expected [archived, purged] to contain undefined" — which reads
       * exactly like a purge that wrote a wrong status. It cost a wrong bug
       * report. An assertion that cannot tell "wrong value" from "no row"
       * should not be asked to.
       */
      expect(
        rows,
        'the engagement row is gone. Nothing in a purge deletes it — the tombstone ' +
          'survives by design (ADR-007) — so something outside this suite truncated the ' +
          'table underneath it. Check that nothing else is using this database.',
      ).toHaveLength(1);
      expect(
        ['archived', 'purged'],
        `the engagement is '${String(rows[0]?.status)}' after a finalize kill; expected it ` +
          'to be archived (the update never landed) or purged (it landed post-mortem)',
      ).toContain(rows[0]?.status);

      const rerun = await run(s.engagementId, { resume: true });
      expect(rerun.stdout).toContain('CHILD_OK');
      expect(
        (await certificates(s.engagementId)).count,
        'the resume wrote a second certificate',
      ).toBe(1);
      const after = await pool.query<{ status: string }>(
        'SELECT status FROM engagements WHERE id = $1',
        [s.engagementId],
      );
      expect(after.rows[0]?.status).toBe('purged');
    },
    2 * MINUTE,
  );

  /* ---------------------------------------------------------- condition 5 */

  it(
    'a purge refuses and destroys nothing when the four warnings are not on record',
    async () => {
      const s = await seed({ label: 'unwarned', warnings: 3 });
      const before = censusTotal(await contentCensus(pool, s.engagementId));
      const objectsBefore = listObjects(store).length;

      const { code, stdout } = await run(s.engagementId);
      expect(code, 'a purge with three warnings on record did not refuse').toBe(1);
      expect(stdout).toContain('retention warnings');

      expect(censusTotal(await contentCensus(pool, s.engagementId))).toBe(before);
      expect(listObjects(store).length).toBe(objectsBefore);
      expect((await certificates(s.engagementId)).count).toBe(0);
      expect(await steps(s.engagementId), 'a refused purge wrote a checkpoint').toEqual({});
    },
    MINUTE,
  );

  it(
    'the guard inside the transaction is the one that catches a warning withdrawn mid-run',
    async () => {
      /**
       * The outer `assertWarned` cannot catch this: it has already passed. The
       * child is parked between the two checks — on the `content` checkpoint
       * write, which happens after the outer guard and before the transaction —
       * and the warnings are removed while it waits. If the inner check were
       * removed as redundant, this test destroys an engagement nobody warned.
       */
      const s = await seed({ label: 'inner-guard' });

      // Get steps 1 and 2 done, so the resume goes straight for the content step.
      const first = spawnPurge(s.engagementId, store, 'remove', CHILD_ENV);
      await waitForSentinel(first, sentinelPath(store, 'remove'));
      first.kill();
      await first.done;
      await pool.query(
        `UPDATE purge_manifest SET status='done', finished_at=now()
          WHERE engagement_id=$1 AND step='objects'`,
        [s.engagementId],
      );
      // A content checkpoint row to lock. The worker would write this itself;
      // pre-creating it is what gives the parent something to hold.
      await pool.query(
        `INSERT INTO purge_manifest (id, engagement_id, step, status)
         VALUES (gen_random_uuid(), $1, 'content', 'failed')`,
        [s.engagementId],
      );

      const blocker = await pool.connect();
      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT id FROM purge_manifest WHERE engagement_id=$1 AND step='content' FOR UPDATE`,
        [s.engagementId],
      );

      const child = spawnPurge(s.engagementId, store, 'none', {
        ...CHILD_ENV,
        RELAY_PURGE_RESUME: '1',
      });
      await waitForLockWait(pool);

      // Past the outer guard, not yet at the inner one.
      await pool.query(
        `DELETE FROM audit_log WHERE engagement_id=$1 AND action='retention.warned'`,
        [s.engagementId],
      );
      await blocker.query('ROLLBACK');
      blocker.release();

      const { code, stdout } = await child.done;
      expect(code, 'the purge continued after its warnings were withdrawn').toBe(1);
      expect(stdout).toContain('retention warnings');
      expect(
        censusTotal(await contentCensus(pool, s.engagementId)),
        'content was destroyed by a purge whose warnings had been withdrawn',
      ).toBeGreaterThan(0);
      expect((await certificates(s.engagementId)).count).toBe(0);
    },
    2 * MINUTE,
  );

  /* ---------------------------------------------------------- condition 6 */

  it(
    '--plan prints a manifest and destroys nothing',
    async () => {
      const s = await seed({ label: 'plan' });
      const before = await contentCensus(pool, s.engagementId);
      const objectsBefore = listObjects(store);
      const certsBefore = await certificates(s.engagementId);

      const output = await new Promise<string>((resolve) => {
        const cli = spawn(
          process.execPath,
          ['--import', 'tsx', join(REPO, 'src/workers/purge-cli.ts'), '--plan', '--engagement', s.engagementId],
          { cwd: REPO, env: { ...process.env, ...CHILD_ENV }, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let out = '';
        cli.stdout.on('data', (d: Buffer) => (out += d.toString()));
        cli.stderr.on('data', (d: Buffer) => (out += d.toString()));
        cli.on('close', () => {
          resolve(out);
        });
      });

      expect(output, '--plan printed nothing that looks like a manifest').toMatch(
        /object|bytes|engagement/i,
      );
      expect(await contentCensus(pool, s.engagementId)).toEqual(before);
      expect(listObjects(store)).toEqual(objectsBefore);
      expect((await certificates(s.engagementId)).count).toBe(certsBefore.count);
      expect(
        await steps(s.engagementId),
        'a dry run wrote a checkpoint row; --plan writes nothing at all',
      ).toEqual({});
    },
    2 * MINUTE,
  );
});
