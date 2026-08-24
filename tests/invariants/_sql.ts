/**
 * Reads the committed migrations.
 *
 * Some invariants are guarantees the database makes, not guarantees the
 * application makes — `UNIQUE (engagement_id, email)` is what actually stops a
 * cross-engagement client identity, and a CHECK constraint is what actually
 * stops an unattributed approval. Asserting those against the migration SQL
 * needs no running Postgres, so the check is available on every push rather
 * than only in the job that has a database service attached.
 *
 * Migrations are forward-only and never edited after commit (CLAUDE.md), so
 * this reads all of them and concatenates: a constraint added in 0002 and never
 * dropped is present, and a `DROP CONSTRAINT` in a later file would show up
 * here as text that a test can look for.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './_source';

const MIGRATIONS_DIR = join(ROOT, 'src', 'db', 'migrations');

export interface MigrationFile {
  /** e.g. `0002_assets_versions_approvals.sql`. */
  name: string;
  sql: string;
}

/** Every committed migration, in filename order. Empty before Phase 1. */
export function migrations(): MigrationFile[] {
  let names: string[];
  try {
    names = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  } catch {
    return []; // No migrations yet. An invariant over an empty set holds.
  }
  return names
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
}

/** All migration SQL concatenated, for "does this constraint exist anywhere" checks. */
export function allMigrationSql(): string {
  return migrations()
    .map((m) => m.sql)
    .join('\n');
}

/** True when at least one migration has been committed. */
export function hasMigrations(): boolean {
  return migrations().length > 0;
}

/**
 * The `CREATE TABLE` body for one table, or null if no migration creates it.
 * Naive on purpose — it stops at the first `);` at the start of a line, which
 * is how drizzle-kit formats every table it emits.
 */
export function createTableBody(table: string): string | null {
  const sql = allMigrationSql();
  const start = sql.search(new RegExp(`CREATE TABLE (IF NOT EXISTS )?"${table}"\\s*\\(`, 'i'));
  if (start === -1) return null;
  const rest = sql.slice(start);
  const end = rest.search(/\n\)/);
  return end === -1 ? rest : rest.slice(0, end);
}
