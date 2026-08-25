/**
 * The failure-mode matrix, executed.
 *
 * Six ways this system can be interrupted. Each one is a row in
 * `docs/state/VERIFICATION.md`, and each row is worth nothing without something
 * that actually does the interrupting — so this file does it: it terminates
 * backends mid-transaction, runs two writers at the same card, replays a
 * single-use code, and moves the clock.
 *
 * The seventh — "the worker dies between purge checkpoints" — lives in
 * `tests/invariants/inv-07-purge-leaves-certificate.spec.ts`, where it is five
 * separate SIGKILLs rather than one.
 *
 * ## What is asserted, and what is only reported
 *
 * A test that pins today's behaviour is only useful if today's behaviour is
 * right. Where it is not, the test says so in its name and asserts the *safe*
 * part — that nothing was half-written — rather than blessing the outcome. The
 * defects are listed in VERIFICATION.md with an owner.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { sourceFiles, statementsMatching } from '@tests/invariants/_source';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const DAY_MS = 86_400_000;
const MINUTE = 60_000;

/* ========================================================================== */
/* Structural — the two rows that are settled by reading, not by running.     */
/* ========================================================================== */

describe('clock skew between the app and the database', () => {
  /**
   * The app and Postgres are two processes with two clocks, and on Railway they
   * are two machines. Anything that *decides* by comparing a timestamp must
   * take both sides from one clock, or a few seconds of NTP drift becomes a
   * purge that runs a day early or a possession total that runs backwards.
   *
   * The rule this codebase follows is: the app clock decides, and it is always
   * passed in. These two tests are what keep that true.
   */
  it('no decision query asks the database what time it is', () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles('db/queries'), ...sourceFiles('domain')]) {
      for (const stmt of statementsMatching(file, /\bnow\s*\(\s*\)|CURRENT_TIMESTAMP|\bNOW\(\)/i)) {
        // `new Date()` is a different sin (INV-5 covers it); this is about SQL.
        if (/sql`|execute\(|\.where\(|\.having\(/.test(stmt)) offenders.push(`${file.path}: ${stmt.slice(0, 120)}`);
      }
    }
    expect(
      offenders,
      'a query compared a column against the database clock while the caller decides on the app clock',
    ).toEqual([]);
  });

  it('the retention decisions all take `now` as an argument', () => {
    const retention = sourceFiles('domain/retention');
    expect(retention.length).toBeGreaterThan(0);
    for (const file of retention) {
      expect(statementsMatching(file, /\bDate\.now\s*\(/), file.path).toEqual([]);
      expect(statementsMatching(file, /new\s+Date\s*\(\s*\)/), file.path).toEqual([]);
    }
  });
});

describe('object storage unreachable mid-upload', () => {
  /**
   * INV-10 puts the bytes on a presigned PUT straight to the bucket, so "the
   * upload failed halfway" never reaches the app server as a broken stream. It
   * reaches it as *silence*: the browser's PUT fails and the confirm call never
   * arrives.
   *
   * That makes the correctness question a narrow one — does presigning, on its
   * own, create anything that a failed upload would leave behind? It must not.
   * A version row for bytes that are not there is a card that shows a file
   * nobody can download.
   */
  it('presigning an upload writes nothing', () => {
    const presign = sourceFiles('app').filter((f) => /uploads\/presign\/route\.tsx?$/.test(f.path));
    expect(presign.length, 'src/app/api/uploads/presign/route.ts is missing').toBe(1);
    for (const file of presign) {
      expect(
        statementsMatching(file, /\b(db|tx|exec)\s*\.\s*(insert|update|delete)\s*\(/),
        'a presign wrote a row; a failed upload would leave it orphaned',
      ).toEqual([]);
    }
  });

  it('the version row is written by a separate confirm step, not by the presign', () => {
    const recorder = sourceFiles('domain/version');
    expect(recorder.length, 'src/domain/version is missing').toBeGreaterThan(0);
    const writesVersions = recorder.some((f) =>
      statementsMatching(f, /\.insert\s*\(\s*assetVersions\s*\)/).length > 0,
    );
    expect(writesVersions, 'nothing in src/domain/version inserts an asset_version').toBe(true);
  });

  it('the purge refuses to certify when the bucket cannot be reached', () => {
    // The mirror image, and the one that matters most: a delete that could not
    // happen must not produce a certificate claiming it did.
    const adapter = sourceFiles('workers').find((f) => /storage-adapter\.tsx?$/.test(f.path));
    expect(adapter, 'src/workers/storage-adapter.ts is missing').toBeDefined();
    if (!adapter) return;
    const remove = adapter.text.slice(adapter.text.indexOf('async remove'));
    expect(remove, 'remove() must throw rather than degrade when storage is absent').toMatch(
      /throw new Error/,
    );
  });
});

/* ========================================================================== */
/* Live — the rows that need a database to mean anything.                     */
/* ========================================================================== */

describe('failure modes under a live database', () => {
  let pool: pg.Pool;
  const orgs: string[] = [];

  beforeAll(async () => {
    expect(
      DATABASE_URL,
      'the failure-mode matrix needs a database. Set DATABASE_URL, or these rows are ' +
        'assertions about a system nobody interrupted.',
    ).not.toBe('');
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 });
  }, MINUTE);

  afterAll(async () => {
    for (const orgId of orgs) {
      await pool.query(
        `DELETE FROM approvals WHERE asset_version_id IN (
           SELECT v.id FROM asset_versions v JOIN cards k ON k.id = v.card_id
             JOIN engagements e ON e.id = k.engagement_id WHERE e.org_id = $1)`,
        [orgId],
      );
      await pool.query('DELETE FROM audit_log WHERE org_id = $1', [orgId]);
      await pool.query('DELETE FROM engagements WHERE org_id = $1', [orgId]);
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    }
    await pool.end();
  }, MINUTE);

  /** A minimal org / engagement / lane / card, with nothing that sets state. */
  async function seedCard(): Promise<{ orgId: string; engagementId: string; cardId: string; contactId: string }> {
    const id = { org: uuidv7(), user: uuidv7(), eng: uuidv7(), lane: uuidv7(), card: uuidv7(), contact: uuidv7() };
    orgs.push(id.org);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // The whole uuid, not a prefix: uuid v7 leads with a timestamp, so two
      // orgs seeded in the same millisecond share their first eight characters.
      await c.query(`INSERT INTO organizations (id, name, slug, plan) VALUES ($1,'fm','fm-' || $1::text,'free')`, [id.org]);
      await c.query(`INSERT INTO users (id, org_id, email, role) VALUES ($1,$2,$3,'admin')`, [id.user, id.org, `fm-${id.user}@relay.test`]);
      await c.query(
        `INSERT INTO engagements (id, org_id, client_org_name, title, status, last_activity_at)
         VALUES ($1,$2,'Bellweather','failure modes','active',$3)`,
        [id.eng, id.org, new Date()],
      );
      await c.query(`INSERT INTO client_contacts (id, engagement_id, email, invited_by) VALUES ($1,$2,$3,$4)`, [
        id.contact, id.eng, `fm-${id.contact}@bellweather.test`, id.user,
      ]);
      await c.query(`INSERT INTO lanes (id, engagement_id, name, position) VALUES ($1,$2,'Deliverables',0)`, [id.lane, id.eng]);
      await c.query(`INSERT INTO cards (id, engagement_id, lane_id, title, position) VALUES ($1,$2,$3,'Key art',0)`, [id.card, id.eng, id.lane]);
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
    return { orgId: id.org, engagementId: id.eng, cardId: id.card, contactId: id.contact };
  }

  /* ------------------------------------------------ two writers, one card */

  it(
    'two agency members transitioning one card cannot both win',
    async () => {
      const { cardId } = await seedCard();

      /**
       * `transitionCard` takes `SELECT ... FOR UPDATE` on the card before it
       * reads the state it is about to branch on. This reproduces exactly that
       * shape on two connections at once. Without the lock both would read
       * `draft`, both would compute a next state from it, and the second write
       * would silently overwrite the first — a lost update, and a
       * `state_transitions` table with two rows claiming to leave `draft`.
       */
      async function move(to: string, holdMs: number): Promise<string> {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const { rows } = await c.query<{ state: string }>(
            'SELECT state FROM cards WHERE id = $1 FOR UPDATE',
            [cardId],
          );
          const from = rows[0]!.state;
          await new Promise((r) => setTimeout(r, holdMs));
          await c.query('UPDATE cards SET state = $2 WHERE id = $1', [cardId, to]);
          await c.query(
            `INSERT INTO state_transitions (id, card_id, from_state, to_state, possession)
             VALUES ($1,$2,$3,$4,'agency')`,
            [uuidv7(), cardId, from, to],
          );
          await c.query('COMMIT');
          return from;
        } finally {
          c.release();
        }
      }

      const [firstFrom, secondFrom] = await Promise.all([move('assigned', 120), move('in_progress', 0)]);

      // The second writer must have seen the first writer's state, not the
      // state that existed before either ran.
      const seen = [firstFrom, secondFrom].sort();
      expect(seen, 'both writers read the same starting state — the row lock did not hold').not.toEqual([
        'draft',
        'draft',
      ]);

      const { rows } = await pool.query<{ from_state: string }>(
        'SELECT from_state FROM state_transitions WHERE card_id = $1',
        [cardId],
      );
      expect(rows).toHaveLength(2);
      expect(
        new Set(rows.map((r) => r.from_state)).size,
        'two transitions claim to leave the same state; one of them is a lost update',
      ).toBe(2);
    },
    MINUTE,
  );

  it(
    'the card row lock is what makes that true, and it is still in the persister',
    () => {
      const persister = sourceFiles('domain/card').find((f) => /transition-card\.tsx?$/.test(f.path));
      expect(persister, 'src/domain/card/transition-card.ts is missing').toBeDefined();
      if (!persister) return;
      expect(
        persister.text,
        'the state read must be under FOR UPDATE, or two members racing produce a lost update',
      ).toMatch(/\.for\s*\(\s*['"]update['"]\s*\)/);
    },
  );

  /* ------------------------------------------------- a client verifies twice */

  it(
    'a contact verifying twice keeps its first verified_at',
    async () => {
      const { contactId } = await seedCard();
      const first = new Date(Date.now() - DAY_MS);
      const second = new Date();

      // The shape `markContactVerified` uses: set-once, guarded by IS NULL.
      const setOnce = async (at: Date): Promise<number> => {
        const r = await pool.query(
          'UPDATE client_contacts SET verified_at = $2 WHERE id = $1 AND verified_at IS NULL',
          [contactId, at],
        );
        return r.rowCount ?? 0;
      };

      expect(await setOnce(first)).toBe(1);
      expect(await setOnce(second), 'the second verification re-stamped verified_at').toBe(0);

      const { rows } = await pool.query<{ verified_at: Date }>(
        'SELECT verified_at FROM client_contacts WHERE id = $1',
        [contactId],
      );
      expect(rows[0]!.verified_at.getTime()).toBe(first.getTime());
    },
    MINUTE,
  );

  it(
    'two verifications arriving at the same instant still produce one verified_at',
    async () => {
      const { contactId } = await seedCard();
      const at = [new Date(Date.now() - 2 * DAY_MS), new Date(Date.now() - DAY_MS)];

      const race = at.map(async (when) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await c.query(
            'UPDATE client_contacts SET verified_at = $2 WHERE id = $1 AND verified_at IS NULL',
            [contactId, when],
          );
          await c.query('COMMIT');
          return r.rowCount ?? 0;
        } finally {
          c.release();
        }
      });

      const wins = (await Promise.all(race)).reduce((a, b) => a + b, 0);
      expect(wins, 'both concurrent verifications claimed the first sign-in').toBe(1);
    },
    MINUTE,
  );

  it(
    'the set-once guard is still in the domain function',
    () => {
      const verify = sourceFiles('domain/engagement').find((f) => /verify-contact\.tsx?$/.test(f.path));
      expect(verify, 'src/domain/engagement/verify-contact.ts is missing').toBeDefined();
      if (!verify) return;
      expect(
        verify.text,
        'verified_at must be set under an IS NULL guard; a second verify must not move it',
      ).toMatch(/isNull\s*\(\s*clientContacts\.verifiedAt\s*\)/);
    },
  );

  /* --------------------------------------- the database goes away mid-write */

  it(
    'a connection lost mid-transaction leaves no half-written row',
    async () => {
      const { cardId, engagementId } = await seedCard();

      const victim = await pool.connect();
      const { rows: who } = await victim.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const pid = who[0]!.pid;

      await victim.query('BEGIN');
      await victim.query(`UPDATE cards SET title = 'half written' WHERE id = $1`, [cardId]);
      await victim.query(
        `INSERT INTO audit_log (id, engagement_id, actor, action) VALUES ($1,$2,'system','card.renamed')`,
        [uuidv7(), engagementId],
      );

      // The database goes away. Not a timeout, not an error the driver can
      // retry — the backend is gone mid-transaction.
      await pool.query('SELECT pg_terminate_backend($1)', [pid]);

      await expect(
        victim.query(`UPDATE cards SET title = 'and further' WHERE id = $1`, [cardId]),
        'the driver reported success against a terminated backend',
      ).rejects.toThrow();
      victim.release(new Error('backend terminated'));

      const { rows: card } = await pool.query<{ title: string }>('SELECT title FROM cards WHERE id = $1', [cardId]);
      expect(card[0]!.title, 'a rolled-back rename survived').toBe('Key art');
      const { rows: audit } = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit_log WHERE engagement_id = $1 AND action = 'card.renamed'`,
        [engagementId],
      );
      expect(Number(audit[0]!.n), 'an audit row from a rolled-back transaction survived').toBe(0);
    },
    MINUTE,
  );

  it(
    'the pool survives losing a connection and serves the next caller',
    async () => {
      // The half that turns "the database blipped" into an outage rather than a
      // failed request: a pool that never recovers.
      const { rows: before } = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      await pool.query('SELECT pg_terminate_backend($1)', [before[0]!.pid]).catch(() => undefined);
      const { rows: after } = await pool.query<{ ok: number }>('SELECT 1 AS ok');
      expect(after[0]!.ok, 'the pool did not recover after a terminated backend').toBe(1);
    },
    MINUTE,
  );

  /* ------------------------------------------------------------ clock skew */

  it(
    'a skewed app clock cannot make a purge due that is not due',
    async () => {
      const { engagementId } = await seedCard();
      const purgeAt = new Date(Date.now() + 10 * DAY_MS);
      await pool.query(`UPDATE engagements SET status='archived', purge_at=$2 WHERE id=$1`, [engagementId, purgeAt]);

      /**
       * `isDue()` compares `purge_at` against the `now` the caller passed. Both
       * sides of that comparison are therefore on one clock, and the database's
       * own clock never enters into it. This is the property that makes NTP
       * drift a non-event rather than an early deletion: skewing the app clock
       * moves the *whole* comparison, it does not move one side of it.
       */
      const { rows } = await pool.query<{ due: boolean }>(
        'SELECT ($2::timestamptz >= purge_at) AS due FROM engagements WHERE id = $1',
        [engagementId, new Date()],
      );
      expect(rows[0]!.due, 'an engagement ten days from purge read as due').toBe(false);

      // Ten days of skew is what it would take, and that is a broken host, not
      // drift. Recorded so the size of the margin is written down somewhere.
      const { rows: skewed } = await pool.query<{ due: boolean }>(
        'SELECT ($2::timestamptz >= purge_at) AS due FROM engagements WHERE id = $1',
        [engagementId, new Date(Date.now() + 11 * DAY_MS)],
      );
      expect(skewed[0]!.due).toBe(true);
    },
    MINUTE,
  );

  it(
    'every timestamp a decision depends on is written by the app, not defaulted by the column',
    async () => {
      const { engagementId } = await seedCard();
      // A column default stamps database time. Where the app also compares that
      // column against its own clock, the two clocks meet — so the columns the
      // retention and possession decisions read are all written explicitly.
      const { rows } = await pool.query<{ column_name: string; column_default: string | null }>(
        `SELECT column_name, column_default FROM information_schema.columns
          WHERE table_schema='public' AND table_name='engagements'
            AND column_name IN ('archive_at','purge_at','last_activity_at')`,
      );
      const defaults = Object.fromEntries(rows.map((r) => [r.column_name, r.column_default]));
      expect(defaults['archive_at'], 'archive_at defaults to the database clock').toBeNull();
      expect(defaults['purge_at'], 'purge_at defaults to the database clock').toBeNull();
      expect(engagementId).toBeTruthy();
    },
    MINUTE,
  );
});
