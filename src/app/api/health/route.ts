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
 */

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/** Never cached, never statically rendered — a cached health check is a lie. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface HealthBody {
  status: 'ok' | 'degraded';
  /** `ok` when a round trip to Postgres completed, `unreachable` otherwise. */
  db: 'ok' | 'unreachable';
  /** Milliseconds for the database round trip. Useful in a deploy log. */
  dbLatencyMs: number;
  checkedAt: string;
}

/**
 * Short enough that a health check cannot itself become the outage. Railway's
 * `healthcheckTimeout` is 60s (90s in production); waiting anywhere near that
 * for a single `select 1` tells us nothing we do not already know at 3s.
 */
const DB_TIMEOUT_MS = 3_000;

function timeout(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => { reject(new Error('database check timed out')); }, ms).unref?.();
  });
}

export async function GET(): Promise<NextResponse<HealthBody>> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

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
        checkedAt,
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { status: 'ok', db: 'ok', dbLatencyMs: Date.now() - startedAt, checkedAt },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
