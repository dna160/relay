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

/* -------------------------------------------------------------------------- */
/* The cascade graph.                                                         */
/*                                                                            */
/* A guard that scans for `delete(approvals)` is a guard about a spelling.     */
/* `approvals.asset_version_id` is `ON DELETE cascade`, `asset_versions.       */
/* card_id` is `ON DELETE cascade`, `cards.lane_id` is `ON DELETE cascade` —   */
/* so `DELETE FROM lanes` destroys approvals, and the word `approvals` never   */
/* appears. Every scan in this directory was blind to that.                    */
/*                                                                            */
/* So the set of tables a deletion may not touch is *derived* from the         */
/* migrations rather than written down. A removal feature that adds a table    */
/* with its own cascade widens the set automatically, which is the only way a  */
/* list like this stays true across phases.                                    */
/* -------------------------------------------------------------------------- */

export interface CascadeEdge {
  /** The table whose rows disappear. */
  child: string;
  /** The table whose deletion takes them. */
  parent: string;
}

/**
 * Every `ON DELETE cascade` foreign key in the committed migrations.
 *
 * drizzle-kit emits one `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY …
 * REFERENCES … ON DELETE cascade` per line, which is what this reads. Inline
 * `REFERENCES` inside a `CREATE TABLE` is matched too, because a hand-written
 * migration is allowed to be hand-written.
 */
export function cascadeEdges(): CascadeEdge[] {
  const sql = allMigrationSql();
  const out: CascadeEdge[] = [];

  for (const m of sql.matchAll(
    /ALTER TABLE\s+"([a-z_]+)"\s+ADD CONSTRAINT[^;]*?REFERENCES\s+(?:"public"\.)?"([a-z_]+)"[^;]*?ON DELETE\s+cascade/gi,
  )) {
    out.push({ child: m[1] ?? '', parent: m[2] ?? '' });
  }

  // `CREATE TABLE "x" ( … "y_id" uuid REFERENCES "y"("id") ON DELETE cascade … )`.
  for (const table of [...sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([a-z_]+)"/gi)]) {
    const name = table[1] ?? '';
    const body = createTableBody(name);
    if (body === null) continue;
    for (const m of body.matchAll(
      /REFERENCES\s+(?:"public"\.)?"([a-z_]+)"[^,\n]*ON DELETE\s+cascade/gi,
    )) {
      out.push({ child: name, parent: m[1] ?? '' });
    }
  }

  return out;
}

/**
 * Every table whose deletion reaches one of `tables` through one or more
 * `ON DELETE cascade` hops, plus `tables` themselves.
 *
 * This is the answer to "what may a removal feature not delete?". Deleting any
 * table in this set destroys an approval or an immutable version somewhere
 * downstream, whether or not the code that does it ever names one.
 */
export function cascadeAncestorsOf(tables: readonly string[]): string[] {
  const edges = cascadeEdges();
  const reached = new Set(tables);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of edges) {
      if (reached.has(edge.child) && !reached.has(edge.parent)) {
        reached.add(edge.parent);
        grew = true;
      }
    }
  }
  return [...reached].sort();
}
