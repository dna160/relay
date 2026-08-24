/**
 * Runs a real query function against a real drizzle instance whose driver is a
 * fake, and hands back the SQL that came out.
 *
 * The point is to assert INV-1 **at the query layer** rather than at the
 * projection. `tests/unit/client-projection.spec.ts` and the cases above prove
 * that a private lane never survives serialisation; nothing until now proved
 * that a private lane never leaves the database in the first place. Those are
 * different failures: the projection is the second lock, and a client-reachable
 * read that forgets `clientScope()` is a query returning rows it should never
 * have selected — visible here as a missing predicate, invisible everywhere
 * else until a projection changes shape.
 *
 * No Postgres. drizzle compiles the statement before the driver is ever called,
 * so capturing the driver call captures the finished SQL and its parameters,
 * which is exactly the artifact the invariant is about.
 */

import type { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Executor } from '@/db/types';
import type { Session } from '@/lib/types';
import { clientScope, type ClientScope } from '@/db/queries/client-scope';

export interface CapturedStatement {
  sql: string;
  params: readonly unknown[];
  /** Every table named in a `from` or `join`, in order of appearance. */
  tables: readonly string[];
  /** Every quoted column in the select list, snake_case as emitted. */
  selected: readonly string[];
}

/** The session every capture runs under. Fixed so failures name real values. */
export const CAPTURE_SESSION = {
  engagementId: 'engagement-under-test',
  contactId: 'contact-under-test',
} as const;

export function captureScope(): ClientScope {
  return clientScope({
    kind: 'client',
    engagementId: CAPTURE_SESSION.engagementId,
    contactId: CAPTURE_SESSION.contactId,
  } as Session);
}

function selectList(sql: string): string[] {
  const match = /^select (.+?) from /is.exec(sql);
  if (!match) return [];
  return [...(match[1] ?? '').matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1] ?? '');
}

function tablesIn(sql: string): string[] {
  return [...sql.matchAll(/\b(?:from|join)\s+"([a-z0-9_]+)"/gi)].map((m) => m[1] ?? '');
}

/**
 * One plausible row for whatever the statement selected.
 *
 * Returning nothing would stop a read at its first empty result and leave the
 * later legs of a multi-statement query — the version fetch inside a board
 * read, for instance — never compiled and therefore never asserted. Values are
 * keyed off the emitted column names, so the shape follows the query rather
 * than a hand-maintained duplicate of the schema.
 */
const COLUMN_VALUES: Record<string, unknown> = {
  id: 'row-1',
  card_id: 'card-1',
  lane_id: 'lane-1',
  engagement_id: CAPTURE_SESSION.engagementId,
  title: 'A deliverable',
  name: 'A lane',
  description: null,
  state: 'awaiting_client',
  position: 0,
  visibility: 'published',
  visibility_override: 'inherit',
  rounds_used: 0,
  contracted_rounds: 2,
  due_at: null,
  version_no: 1,
  filename: 'artwork.png',
  mime: 'image/png',
  size_bytes: 1024,
  sha256: 'a'.repeat(64),
  storage_key: 'engagements/e/versions/v/artwork.png',
  published_to_client_at: new Date('2026-01-01T00:00:00.000Z'),
  group_label: null,
  email: 'contact@client.example',
  status: 'active',
  purge_at: null,
  brand_primary: null,
  brand_logo_key: null,
  verified_at: null,
};

function fakeRow(sql: string): unknown[] {
  return selectList(sql).map((column) =>
    column in COLUMN_VALUES ? COLUMN_VALUES[column] : null,
  );
}

/**
 * @param run receives an `Executor` backed by the fake driver.
 * @returns every statement the run compiled, in order. A run that throws still
 * returns what it compiled first — a read that 404s a client is a read that
 * already ran its predicate, and the predicate is the thing under test.
 */
export async function capture(
  run: (exec: Executor) => Promise<unknown>,
): Promise<CapturedStatement[]> {
  const statements: CapturedStatement[] = [];

  const client = {
    query(config: { text: string }, params: readonly unknown[]) {
      const sql = config.text;
      statements.push({
        sql,
        params,
        tables: tablesIn(sql),
        selected: selectList(sql),
      });
      return Promise.resolve({ rows: [fakeRow(sql)], rowCount: 1, fields: [] });
    },
  };

  const db = drizzle(client as unknown as Client) as unknown as Executor;
  try {
    await run(db);
  } catch {
    // A NOT_VISIBLE on a fake row is expected and irrelevant. The statements
    // are already captured, and they are the subject.
  }
  return statements;
}

/**
 * The same, but keeps what the function returned.
 *
 * Some reads select a column the projection then drops — `revision_notes`
 * carries author ids that the client shape must not emit. For those, the SQL is
 * only half the story: the other half is what came back out.
 */
export async function captureWithResult<T>(
  run: (exec: Executor) => Promise<T>,
): Promise<{ statements: CapturedStatement[]; result: T | undefined; threw: unknown }> {
  let result: T | undefined;
  let threw: unknown;
  const statements = await capture(async (exec) => {
    try {
      result = await run(exec);
    } catch (error) {
      threw = error;
    }
    return result;
  });
  return { statements, result, threw };
}

/** Convenience: the union of every table any captured statement touched. */
export function tablesTouched(statements: readonly CapturedStatement[]): Set<string> {
  return new Set(statements.flatMap((s) => [...s.tables]));
}

/** Convenience: the union of every column any captured statement selected. */
export function columnsSelected(statements: readonly CapturedStatement[]): Set<string> {
  return new Set(statements.flatMap((s) => [...s.selected]));
}
