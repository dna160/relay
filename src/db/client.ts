/**
 * The pg pool and the drizzle instance. The only module in the tree that opens
 * a connection.
 *
 * INV-9 forbids `src/domain/**` from importing this file: domain functions take
 * an executor as an argument so they can be run inside someone else's
 * transaction and tested without a database.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';
import type { Database } from './types';

const { Pool, types } = pg;

/**
 * Hand `bigint` (OID 20) back as a JS number. Every bigint in this schema is a
 * byte count that tops out at 5 GB, which is nine orders of magnitude inside
 * `Number.MAX_SAFE_INTEGER`.
 */
types.setTypeParser(20, (value: string) => Number(value));

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

declare global {
  var __relayPool: pg.Pool | undefined;
}

/** One pool per process. Next's dev server re-evaluates modules on every edit. */
export const pool: pg.Pool =
  globalThis.__relayPool ??
  new pg.Pool({
    connectionString: connectionString(),
    max: Number(process.env.PGPOOL_MAX ?? 10),
  });

if (process.env.NODE_ENV !== 'production') globalThis.__relayPool = pool;

export const db: Database = drizzle(pool, { schema });

export { Pool };
