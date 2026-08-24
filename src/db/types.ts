/**
 * Database *types*, with no connection attached.
 *
 * Domain modules import from here and never from `@/db/client` (INV-9). The
 * distinction is not a technicality: importing a type cannot open a socket,
 * cannot read an environment variable, and cannot make a unit test need
 * Postgres. A domain function that receives an `Executor` runs equally well
 * against the pool, inside a caller's transaction, or against a fake.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

/** The handle drizzle hands a `db.transaction(async (tx) => ...)` callback. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Anything a query or a domain write can run against. Passing `Executor` rather
 * than `Database` is what lets `transitionCard()` and `recordDecision()` compose
 * into one transaction instead of each opening their own.
 */
export type Executor = Database | Tx;
