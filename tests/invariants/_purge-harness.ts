/**
 * The INV-7 harness: a real engagement in a real Postgres, real bytes on a real
 * filesystem, and a way to kill a purge at each of its four checkpoints for
 * real — SIGKILL to a child process, not a thrown exception.
 *
 * ## Why a child process
 *
 * INV-7's fourth condition is "a forced mid-run failure is safe to rerun". A
 * thrown error does not test that. A thrown error unwinds the stack, runs every
 * `finally`, lets drizzle issue its `ROLLBACK`, and returns the connection to
 * the pool politely. The failure the runbook is actually written for is the
 * container being killed: no unwinding, no rollback statement, no goodbye to
 * the server. Postgres finds out when the socket closes.
 *
 * So the purge under test runs in a child process and is killed with SIGKILL,
 * which cannot be caught, and the assertions run in the parent afterwards.
 *
 * ## How the kill is made deterministic
 *
 * Racing a `setTimeout` against a purge would give a flaky test that proves
 * nothing on the runs where it fires too late. Each checkpoint is instead
 * parked deliberately, by one of two mechanisms:
 *
 * - **Steps 1 and 2** are parked from inside the injected `ObjectStore`: it
 *   drops a sentinel file and then never resolves. The parent polls for the
 *   sentinel and kills. The store is a dependency the worker already takes, so
 *   nothing about the worker changes to be testable.
 *
 * - **Steps 3 and 4** have no injected seam, so they are parked from the
 *   database instead: the parent holds a `SELECT ... FOR UPDATE` row lock on a
 *   row the step must write, and the child blocks on it. Row locks do not block
 *   the plain reads the earlier steps do, so the child gets all the way to the
 *   statement we want to interrupt and no further. The parent watches
 *   `pg_stat_activity` for the child's backend to enter `wait_event_type =
 *   'Lock'`, and only then kills it. That is an observation, not a delay.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Every table `TABLE_DISPOSITION` calls `content`, and how it reaches an engagement. */
export const CONTENT_CENSUS_SQL = `
  SELECT
    (SELECT count(*) FROM lanes WHERE engagement_id = $1) AS lanes,
    (SELECT count(*) FROM cards WHERE engagement_id = $1) AS cards,
    (SELECT count(*) FROM reference_files WHERE engagement_id = $1) AS reference_files,
    (SELECT count(*) FROM client_contacts WHERE engagement_id = $1) AS client_contacts,
    (SELECT count(*) FROM comments c JOIN cards k ON k.id = c.card_id
       WHERE k.engagement_id = $1) AS comments,
    (SELECT count(*) FROM state_transitions s JOIN cards k ON k.id = s.card_id
       WHERE k.engagement_id = $1) AS state_transitions,
    (SELECT count(*) FROM asset_versions v JOIN cards k ON k.id = v.card_id
       WHERE k.engagement_id = $1) AS asset_versions,
    (SELECT count(*) FROM approvals a JOIN asset_versions v ON v.id = a.asset_version_id
       JOIN cards k ON k.id = v.card_id WHERE k.engagement_id = $1) AS approvals,
    (SELECT count(*) FROM revision_notes r JOIN asset_versions v ON v.id = r.asset_version_id
       JOIN cards k ON k.id = v.card_id WHERE k.engagement_id = $1) AS revision_notes,
    (SELECT count(*) FROM audit_log
       WHERE engagement_id = $1
         AND NOT (action LIKE 'retention.%' OR action LIKE 'purge.%'
                  OR action = 'engagement.archived')) AS audit_log
`;

export type ContentCensus = Record<string, number>;

export async function contentCensus(
  pool: pg.Pool,
  engagementId: string,
): Promise<ContentCensus> {
  const { rows } = await pool.query(CONTENT_CENSUS_SQL, [engagementId]);
  const row = rows[0] as Record<string, string>;
  const out: ContentCensus = {};
  for (const [k, v] of Object.entries(row)) out[k] = Number(v);
  return out;
}

export function censusTotal(census: ContentCensus): number {
  return Object.values(census).reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ seeding */

export interface SeededEngagement {
  orgId: string;
  userId: string;
  engagementId: string;
  laneId: string;
  cardId: string;
  versionIds: string[];
  contactId: string;
  /** Storage keys written as real files under the store root. */
  keys: string[];
  /** An orphan object with no row pointing at it. A purge must still take it. */
  orphanKey: string;
}

const DAY_MS = 86_400_000;

/**
 * One engagement carrying at least one row in every table `TABLE_DISPOSITION`
 * classifies as `content`, plus its four warnings, archived and overdue.
 *
 * Nothing here writes `cards.state`. INV-2 reserves that column for the state
 * machine, and a purge does not care what state a card was in — so the fixture
 * declines to take the exception it would be entitled to.
 */
export async function seedPurgeable(
  pool: pg.Pool,
  storeRoot: string,
  options: { warnings?: number; label?: string } = {},
): Promise<SeededEngagement> {
  const warnings = options.warnings ?? 4;
  const label = options.label ?? 'inv7';
  const id = {
    org: uuidv7(),
    user: uuidv7(),
    engagement: uuidv7(),
    lane: uuidv7(),
    card: uuidv7(),
    v1: uuidv7(),
    v2: uuidv7(),
    contact: uuidv7(),
    approval: uuidv7(),
    note: uuidv7(),
    comment: uuidv7(),
    transition: uuidv7(),
    shelf: uuidv7(),
  };
  const now = Date.now();
  const archiveAt = new Date(now - 31 * DAY_MS);
  const purgeAt = new Date(now - 1 * DAY_MS);
  const sha = 'a'.repeat(64);

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO organizations (id, name, slug, plan) VALUES ($1, $2, $3, 'free')`,
      [id.org, `${label} agency`, `${label}-${id.org.slice(0, 8)}`],
    );
    await c.query(
      `INSERT INTO users (id, org_id, email, name, role) VALUES ($1, $2, $3, 'Owner', 'admin')`,
      [id.user, id.org, `${label}-${id.user.slice(0, 8)}@relay.test`],
    );
    await c.query(
      `INSERT INTO engagements
         (id, org_id, client_org_name, title, status, last_activity_at, archive_at, purge_at)
       VALUES ($1, $2, 'Bellweather', $3, 'archived', $4, $5, $6)`,
      [id.engagement, id.org, `${label} engagement`, new Date(now - 61 * DAY_MS), archiveAt, purgeAt],
    );
    await c.query(
      `INSERT INTO client_contacts (id, engagement_id, email, name, verified_at, invited_by)
       VALUES ($1, $2, $3, 'Rowan', now(), $4)`,
      [id.contact, id.engagement, `rowan-${id.contact.slice(0, 8)}@bellweather.test`, id.user],
    );
    await c.query(
      `INSERT INTO lanes (id, engagement_id, name, position, visibility)
       VALUES ($1, $2, 'Deliverables', 0, 'published')`,
      [id.lane, id.engagement],
    );
    await c.query(
      `INSERT INTO cards (id, engagement_id, lane_id, title, position, assignee_id)
       VALUES ($1, $2, $3, 'Key art', 0, $4)`,
      [id.card, id.engagement, id.lane, id.user],
    );

    const keys: string[] = [];
    for (const [i, versionId] of [id.v1, id.v2].entries()) {
      const key = `engagements/${id.engagement}/versions/${versionId}/art-v${String(i + 1)}.png`;
      keys.push(key);
      await c.query(
        `INSERT INTO asset_versions
           (id, card_id, version_no, storage_key, filename, mime, size_bytes, sha256,
            uploaded_by_user_id, published_to_client_at)
         VALUES ($1, $2, $3, $4, $5, 'image/png', $6, $7, $8, now())`,
        [versionId, id.card, i + 1, key, `art-v${String(i + 1)}.png`, 1024 * (i + 1), sha, id.user],
      );
    }

    /**
     * `decided_by_side` is written explicitly, never inferred from which FK is
     * populated. Inferring it is precisely what stops working the moment an
     * erasure nulls the FK — which is the whole reason the column exists
     * (migration 0004).
     */
    await c.query(
      `INSERT INTO approvals
         (id, asset_version_id, decision, decided_by_contact_id, decided_by_side,
          version_sha256, note)
       VALUES ($1, $2, 'changes_requested', $3, 'client', $4, 'the blue is wrong')`,
      [id.approval, id.v1, id.contact, sha],
    );
    await c.query(
      `INSERT INTO revision_notes (id, asset_version_id, author_contact_id, body)
       VALUES ($1, $2, $3, 'the blue is wrong')`,
      [id.note, id.v1, id.contact],
    );
    await c.query(
      `INSERT INTO comments (id, card_id, author_contact_id, body, internal)
       VALUES ($1, $2, $3, 'when can we see the next one?', false)`,
      [id.comment, id.card, id.contact],
    );
    await c.query(
      `INSERT INTO state_transitions (id, card_id, from_state, to_state, possession, actor_user_id)
       VALUES ($1, $2, 'draft', 'in_progress', 'agency', $3)`,
      [id.transition, id.card, id.user],
    );

    const shelfKey = `engagements/${id.engagement}/shelf/${id.shelf}/brief.pdf`;
    keys.push(shelfKey);
    await c.query(
      `INSERT INTO reference_files
         (id, engagement_id, group_label, storage_key, filename, mime, size_bytes,
          uploaded_by_user_id)
       VALUES ($1, $2, 'Brief', $3, 'brief.pdf', 'application/pdf', 2048, $4)`,
      [id.shelf, id.engagement, shelfKey, id.user],
    );

    /* Ordinary audit rows — these go with the engagement. */
    await c.query(
      `INSERT INTO audit_log (id, org_id, engagement_id, actor, action, subject_type, subject_id)
       VALUES ($1, $2, $3, 'system', 'card.created', 'card', $4)`,
      [uuidv7(), id.org, id.engagement, id.card],
    );
    /* Retention rows — these are the evidence and must survive. */
    await c.query(
      `INSERT INTO audit_log (id, org_id, engagement_id, actor, action, subject_type, occurred_at)
       VALUES ($1, $2, $3, 'system', 'engagement.archived', 'engagement', $4)`,
      [uuidv7(), id.org, id.engagement, archiveAt],
    );
    for (const offset of [0, 14, 23, 29].slice(0, warnings)) {
      await c.query(
        `INSERT INTO audit_log
           (id, org_id, engagement_id, actor, action, subject_type, occurred_at)
         VALUES ($1, $2, $3, 'system', 'retention.warned', $4, $5)`,
        [
          uuidv7(),
          id.org,
          id.engagement,
          `retention_warning:${String(offset)}`,
          new Date(archiveAt.getTime() + offset * DAY_MS),
        ],
      );
    }
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }

  /* Real bytes on disk, including one orphan the database knows nothing about. */
  const keys = [
    `engagements/${id.engagement}/versions/${id.v1}/art-v1.png`,
    `engagements/${id.engagement}/versions/${id.v2}/art-v2.png`,
    `engagements/${id.engagement}/shelf/${id.shelf}/brief.pdf`,
  ];
  const orphanKey = `engagements/${id.engagement}/versions/orphan/interrupted-upload.png`;
  for (const key of [...keys, orphanKey]) writeObject(storeRoot, key, 'bytes');

  return {
    orgId: id.org,
    userId: id.user,
    engagementId: id.engagement,
    laneId: id.lane,
    cardId: id.card,
    versionIds: [id.v1, id.v2],
    contactId: id.contact,
    keys,
    orphanKey,
  };
}

/* ---------------------------------------------------------- the object store */

/** Where a key lands on disk. Flattened so one `readdir` counts the bucket. */
export function objectPath(root: string, key: string): string {
  return join(root, Buffer.from(key).toString('base64url'));
}

export function writeObject(root: string, key: string, body: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(objectPath(root, key), body);
}

export function objectExists(root: string, key: string): boolean {
  return existsSync(objectPath(root, key));
}

export function listObjects(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => !f.startsWith('.') && !f.endsWith('.sentinel'))
    .map((f) => Buffer.from(f, 'base64url').toString('utf8'));
}

/* ------------------------------------------------------------- the child run */

export type ParkPoint = 'list' | 'remove' | 'remove-half' | 'none';

export interface ChildHandle {
  pid: number;
  /** Resolves with the exit signal or code once the child is gone. */
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string }>;
  kill: () => void;
}

const CHILD = 'tests/invariants/_purge-child.ts';

export function spawnPurge(
  engagementId: string,
  storeRoot: string,
  park: ParkPoint,
  // Plain strings, not `NodeJS.ProcessEnv`: Next augments that type with a
  // required `NODE_ENV`, and this is an overlay merged onto `process.env`.
  env: Readonly<Record<string, string>>,
): ChildHandle {
  /**
   * `node --import tsx <file>` rather than the `tsx` CLI: the CLI is a wrapper
   * that spawns the real runtime as a grandchild, and a SIGKILL to the wrapper
   * leaves that grandchild alive holding the database connection we are trying
   * to sever. One process is the whole point of this test.
   */
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join(ROOT, CHILD)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ...env,
        RELAY_PURGE_ENGAGEMENT: engagementId,
        RELAY_PURGE_STORE_ROOT: storeRoot,
        RELAY_PURGE_PARK: park,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
  child.stderr.on('data', (d: Buffer) => (stdout += d.toString()));

  const done = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
  }>((resolve) => {
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout });
    });
  });

  return {
    pid: child.pid ?? -1,
    done,
    // SIGKILL, not SIGTERM. The point is that nothing gets to clean up.
    kill: () => {
      try {
        process.kill(child.pid ?? -1, 'SIGKILL');
      } catch {
        /* already gone */
      }
    },
  };
}

/** The sentinel a parked store drops just before it stops resolving. */
export function sentinelPath(storeRoot: string, park: ParkPoint): string {
  return join(storeRoot, `${park}.sentinel`);
}

/**
 * Waits for the parked store's sentinel. Takes the child so that a purge which
 * died on its way to the checkpoint reports *why* rather than timing out thirty
 * seconds later with nothing to say.
 */
export async function waitForSentinel(
  child: ChildHandle,
  path: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exited: { code: number | null; stdout: string } | null = null;
  void child.done.then((r) => (exited = r));

  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    if (exited !== null) {
      const { code, stdout } = exited as { code: number | null; stdout: string };
      throw new Error(
        `the purge exited (code ${String(code)}) before reaching ${path}:\n${stdout.slice(-2000)}`,
      );
    }
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${path}`);
}

/**
 * Waits until some backend other than ours is blocked on a lock — which is the
 * child, parked exactly where we want it. An observation, not a sleep.
 */
export async function waitForLockWait(
  pool: pg.Pool,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND state = 'active' AND pid <> pg_backend_pid()`,
    );
    if (Number(rows[0]?.n ?? 0) > 0) return;
    await sleep(25);
  }
  throw new Error('timed out waiting for the child to block on a lock');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------------------------------------------------------- teardown */

export function cleanStore(root: string): void {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
}

/**
 * Removes every row this harness created, leaving the database as it found it.
 *
 * This used to delete `approvals` by hand first, to work around a defect: the
 * cascade from `engagements` reached `client_contacts`, whose delete nulled
 * `approvals.decided_by_contact_id`, leaving a row with neither decider and
 * tripping the old `num_nonnulls(...) = 1` CHECK. `DELETE FROM engagements`
 * failed outright on any engagement whose client had ever decided anything.
 *
 * Migration 0004 fixed it properly — an approval is allowed to become anonymous
 * and `decided_by_side` carries the fact that anonymity would have destroyed —
 * so the workaround is gone and the cascade does the work. That the cascade
 * now completes is asserted in `inv-03`, not left to this function silently
 * succeeding.
 */
export async function dropSeed(pool: pg.Pool, seed: SeededEngagement): Promise<void> {
  await pool.query('DELETE FROM purge_certificates WHERE engagement_id = $1', [seed.engagementId]);
  await pool.query('DELETE FROM purge_manifest WHERE engagement_id = $1', [seed.engagementId]);
  await pool.query('DELETE FROM audit_log WHERE engagement_id = $1', [seed.engagementId]);
  await pool.query('DELETE FROM engagements WHERE id = $1', [seed.engagementId]);
  await pool.query('DELETE FROM organizations WHERE id = $1', [seed.orgId]);
}

