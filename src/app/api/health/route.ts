/**
 * `GET /api/health` — the deploy gate.
 *
 * `railway.json` and `.railway/railway.ts` both point `healthcheckPath` at this
 * route. Until it existed the first deploy of a new service failed its health
 * check and rolled back, which is a confusing way to discover that a route is
 * missing.
 *
 * It checks the **database**, not just process liveness. A Next process boots
 * happily with a wrong `DATABASE_URL`; every request then 500s. Railway holds
 * traffic on the old version until this returns 200, so making the check real
 * is what turns a bad database URL into a failed deploy instead of an outage.
 *
 * Deliberately unauthenticated and deliberately dull: a status, a duration, and
 * nothing that names a host, a database, or a driver error. A health endpoint
 * is the most-scanned route on any deployment, and an error string from `pg` in
 * its body is free reconnaissance.
 *
 * ## It checks object storage too, and treats it differently
 *
 * The same argument that made the database check real applies to the bucket:
 * staging booted with no `S3_*` variables, answered `ok`, passed its health
 * check, and the first person to discover that uploads could not work was a
 * user being told the workspace was unreachable. A green health check on a
 * deployment where a core feature is structurally impossible is a health check
 * that is lying.
 *
 * But the two failures are not equal, and the response codes say so:
 *
 *   - **`unconfigured`** is a deploy-time fact. It cannot heal, it is always
 *     the new build's fault, and Railway holding traffic on the old version
 *     until somebody sets the variables is exactly the right outcome. **503.**
 *   - **`unreachable`** is a runtime fact about somebody else's service. Boards,
 *     comments, transitions and approvals all still work; only uploads do not.
 *     Failing the health check would take the whole deployment down — or roll
 *     it back — over a dependency that will probably be back in a minute, so
 *     this reports `degraded` at **200** and stays up.
 *
 * The probe behind `checkStorage()` is cached for ten seconds, because this
 * route is polled by Railway and scanned by everyone else, and an uncached
 * bucket call here turns that traffic into object-store traffic.
 */

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { checkStorage, type StorageHealth } from '@/lib/storage';

/** Never cached, never statically rendered — a cached health check is a lie. */
/**
 * What this instance is serving.
 *
 * A git deploy gets the commit sha. A `railway up` from a working tree has no
 * commit to name — it uploads source — so it falls back to the deployment id,
 * which is the thing a rollback actually changes and therefore the honest
 * answer either way. `dev` locally.
 */
const RELEASE = (
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  process.env.RAILWAY_DEPLOYMENT_ID ??
  'dev'
).slice(0, 8);

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface HealthBody {
  status: 'ok' | 'degraded';
  /** `ok` when a round trip to Postgres completed, `unreachable` otherwise. */
  db: 'ok' | 'unreachable';
  /** Milliseconds for the database round trip. Useful in a deploy log. */
  dbLatencyMs: number;
  /**
   * Object storage. `unconfigured` means this deployment has no `S3_*` settings
   * and uploads are structurally impossible; `unreachable` means it has them
   * and the bucket did not answer. Three values rather than two because that is
   * the distinction an operator needs and the one that was missing.
   *
   * Names no endpoint, no bucket, no credential and no SDK error — the same
   * rule `db` follows. What it discloses is that uploads do not work here,
   * which is a fact any user of this deployment discovers by trying one.
   */
  storage: StorageHealth;
  checkedAt: string;
  /**
   * The commit this instance is serving, from Railway's build-time injection.
   *
   * A rollback is otherwise unverifiable from outside: two deployments answer
   * identically, so "the rollback worked" rests on the dashboard agreeing with
   * itself. RUNBOOK §4 tells an operator to roll back and then confirm — this
   * is the thing they confirm against. Seven characters, no host, no branch,
   * nothing an unauthenticated caller can act on.
   */
  release: string;
}

/**
 * Short enough that a health check cannot itself become the outage. Railway's
 * `healthcheckTimeout` is 60s (90s in production); waiting anywhere near that
 * for a single `select 1` tells us nothing we do not already know at 3s.
 */
const DB_TIMEOUT_MS = 3_000;

/**
 * Shorter than the database's. A `HeadBucket` that has not answered in two
 * seconds is a bucket that cannot serve an upload either, and this check is
 * additive to a request that already has a budget.
 */
const STORAGE_TIMEOUT_MS = 2_000;

function timeout(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => { reject(new Error('database check timed out')); }, ms).unref?.();
  });
}

export async function GET(): Promise<NextResponse<HealthBody>> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  /**
   * Storage first, and unconditionally. It is asked even when the database is
   * down so that an operator staring at a failed deploy sees *both* reasons at
   * once rather than fixing one and rediscovering the other on the next push.
   * It cannot throw — `checkStorage()` classifies its own failures.
   */
  const storage = await checkStorage(STORAGE_TIMEOUT_MS);

  try {
    await Promise.race([db.execute(sql`select 1`), timeout(DB_TIMEOUT_MS)]);
  } catch (error) {
    // Logged with detail, answered without it.
    console.error('[health] database check failed', error);
    return NextResponse.json(
      {
        status: 'degraded',
        db: 'unreachable',
        dbLatencyMs: Date.now() - startedAt,
        storage,
        checkedAt,
        release: RELEASE,
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      status: storage === 'ok' ? 'ok' : 'degraded',
      db: 'ok',
      dbLatencyMs: Date.now() - startedAt,
      storage,
      checkedAt,
      release: RELEASE,
    },
    {
      // A deployment that *cannot* do uploads must not pass its own health
      // check; one whose bucket is momentarily quiet must not be rolled back
      // for it. See the header — this line is the whole distinction.
      status: storage === 'unconfigured' ? 503 : 200,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
