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

/**
 * The columns a statement selects, in order.
 *
 * A qualified reference is `"cards"."id"` — two quoted identifiers for one
 * column. Counting both doubles the arity and misaligns every value, which
 * surfaces three frames later as `RangeError: Invalid time value` inside the
 * code under test rather than as a broken fake.
 */
function selectList(sql: string): string[] {
  const match = /^select (.+?) from /is.exec(sql);
  if (!match) return [];
  return [
    ...(match[1] ?? '').matchAll(/"([a-z0-9_]+)"\s*\.\s*"([a-z0-9_]+)"|"([a-z0-9_]+)"/g),
  ].map((m) => m[2] ?? m[3] ?? '');
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
  // A real plan name: `bumpActivity` looks the row up in the plan table on its
  // way to a retention window, and `undefined.retainsIndefinitely` reads as a
  // bug in the code under test rather than as a gap in the fake.
  plan: 'pro',
  purge_at: null,
  brand_primary: null,
  brand_logo_key: null,
  verified_at: null,
};

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

function valueFor(column: string): unknown {
  if (column in COLUMN_VALUES) return COLUMN_VALUES[column];
  // A timestamp column that comes back null is a `.toISOString()` on undefined
  // three frames later, which reads as a bug in the code under test rather than
  // as a gap in the fake.
  if (/_at$/.test(column)) return EPOCH;
  return null;
}

/** The columns an `INSERT ... RETURNING` hands back, in order. */
function returningList(sql: string): string[] {
  const match = /\sreturning\s(.+)$/is.exec(sql);
  if (!match) return [];
  return [
    ...(match[1] ?? '').matchAll(/"([a-z0-9_]+)"\s*\.\s*"([a-z0-9_]+)"|"([a-z0-9_]+)"/g),
  ].map((m) => m[2] ?? m[3] ?? '');
}

/**
 * The row a statement gets back.
 *
 * For an `INSERT ... RETURNING`, that row is built from the values the
 * statement actually bound — which is what Postgres would return, and which
 * matters here beyond fidelity: a route that branches on the *written* row
 * (`if (!comment.internal)`) would otherwise branch on `undefined` and take the
 * wrong path for a reason that has nothing to do with the code under test.
 */
function fakeRow(sql: string, params: readonly unknown[] = []): unknown[] {
  const returning = returningList(sql);
  if (returning.length > 0) {
    const written = insertedValues({ sql, params, tables: [], selected: [] });
    return returning.map((column) => (column in written ? written[column] : valueFor(column)));
  }
  return selectList(sql).map(valueFor);
}

/**
 * One row for a statement, with named columns overridden.
 *
 * Drizzle returns rows positionally (`rowMode: 'array'`), so a test that wants
 * to say "this engagement is archived" has to know where `status` sits in the
 * select list. It should not have to: the select list is in the SQL, so the row
 * is built from the statement and the test names columns.
 */
export function rowFor(sql: string, overrides: Record<string, unknown> = {}): unknown[] {
  return selectList(sql).map((column) =>
    column in overrides ? overrides[column] : valueFor(column),
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
      return Promise.resolve({ rows: [fakeRow(sql, params)], rowCount: 1, fields: [] });
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

/**
 * The same walk, but the database returns nothing.
 *
 * This is how the 404 paths get asserted. Every client-reachable read that
 * resolves a single row throws `NOT_VISIBLE` when its predicate matches no row
 * — and *which* predicate excluded the row is the whole of INV-1. An
 * unpublished version, a version on a private lane and a version belonging to
 * another engagement are all "no row" to the same statement, which is exactly
 * the property: they are indistinguishable to the caller. A 403 would confirm
 * the thing exists; a 404 does not.
 */
export async function captureOnEmpty(
  run: (exec: Executor) => Promise<unknown>,
): Promise<{ statements: CapturedStatement[]; threw: unknown }> {
  const statements: CapturedStatement[] = [];
  let threw: unknown;

  const client = {
    query(config: { text: string }, params: readonly unknown[]) {
      const sql = config.text;
      statements.push({ sql, params, tables: tablesIn(sql), selected: selectList(sql) });
      return Promise.resolve({ rows: [], rowCount: 0, fields: [] });
    },
  };

  const db = drizzle(client as unknown as Client) as unknown as Executor;
  try {
    await run(db);
  } catch (error) {
    threw = error;
  }
  return { statements, threw };
}

/**
 * A capture whose driver answers each statement however the test says.
 *
 * The reads above only need an empty or a plausible row. A *write* path needs
 * the database to say specific things — this parent is on another card, this
 * parent is itself a reply, this parent is internal — because the defence being
 * tested is a branch on what came back. The responder receives the compiled SQL
 * and its parameters and returns rows in drizzle's `rowMode: 'array'` shape, or
 * `undefined` to fall through to the generic fake.
 *
 * Transactions work: drizzle issues `begin` / `commit` / `rollback` as plain
 * strings through the same driver, so a domain write that composes into one
 * transaction runs here exactly as it would against Postgres — minus, of
 * course, anything Postgres itself would enforce.
 */
export async function captureWithRows(
  run: (exec: Executor) => Promise<unknown>,
  respond: (statement: { sql: string; params: readonly unknown[] }) => unknown[][] | undefined,
): Promise<{ statements: CapturedStatement[]; result: unknown; threw: unknown }> {
  const statements: CapturedStatement[] = [];
  let result: unknown;
  let threw: unknown;

  const client = {
    query(config: string | { text: string }, params?: readonly unknown[]) {
      const sql = typeof config === 'string' ? config : config.text;
      const bound = params ?? [];
      // `begin` / `commit` / `rollback` are not statements under test.
      if (!/^\s*(begin|commit|rollback)/i.test(sql)) {
        statements.push({ sql, params: bound, tables: tablesIn(sql), selected: selectList(sql) });
      }
      const answered = respond({ sql, params: bound });
      const rows = answered ?? [fakeRow(sql, bound)];
      return Promise.resolve({ rows, rowCount: rows.length, fields: [] });
    },
  };

  const db = drizzle(client as unknown as Client) as unknown as Executor;
  try {
    result = await run(db);
  } catch (error) {
    threw = error;
  }
  return { statements, result, threw };
}

/**
 * A standing fake `Database`, for code that reaches for `@/db/client` itself.
 *
 * The helpers above take the executor as an argument, which is what every query
 * and domain function does (INV-9). A *route handler* does not — it imports the
 * live client at module scope. So a route can only be driven by replacing that
 * module, and this is what gets put in its place: a real drizzle instance over
 * a driver the test answers for, recording every statement including the ones
 * the route did not make itself.
 *
 * `respond` is read at call time rather than captured, so one database can
 * serve a whole suite with the answers swapped per case.
 */
export function makeFakeDatabase(
  respond: () => (statement: { sql: string; params: readonly unknown[] }) => unknown[][] | undefined,
): { db: Executor; statements: CapturedStatement[]; reset(): void } {
  const statements: CapturedStatement[] = [];

  const client = {
    query(config: string | { text: string }, params?: readonly unknown[]) {
      const sql = typeof config === 'string' ? config : config.text;
      const bound = params ?? [];
      if (!/^\s*(begin|commit|rollback)/i.test(sql)) {
        statements.push({ sql, params: bound, tables: tablesIn(sql), selected: selectList(sql) });
      }
      const rows = respond()({ sql, params: bound }) ?? [fakeRow(sql, bound)];
      return Promise.resolve({ rows, rowCount: rows.length, fields: [] });
    },
  };

  const db = drizzle(client as unknown as Client) as unknown as Executor;
  return {
    db,
    statements,
    reset() {
      statements.length = 0;
    },
  };
}

/**
 * The values an `INSERT` actually bound, by column name.
 *
 * Asserting on the returned row would prove what the fake driver was told to
 * say. Asserting on the bound parameters proves what the code decided to write,
 * which is the only version of the question worth asking of a forced flag.
 */
export function insertedValues(statement: CapturedStatement): Record<string, unknown> {
  const match = /insert\s+into\s+"[a-z0-9_]+"\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/i.exec(
    statement.sql,
  );
  if (!match) return {};
  const columns = [...(match[1] ?? '').matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1] ?? '');
  const placeholders = [...(match[2] ?? '').matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  const out: Record<string, unknown> = {};
  columns.forEach((column, index) => {
    const position = placeholders[index];
    if (position !== undefined) out[column] = statement.params[position - 1];
  });
  return out;
}

/** The one statement matching a pattern, for a test that means exactly one. */
export function theStatement(
  statements: readonly CapturedStatement[],
  pattern: RegExp,
): CapturedStatement {
  const matches = statements.filter((s) => pattern.test(s.sql));
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one statement matching ${pattern}, found ${matches.length}:\n` +
        statements.map((s) => `  ${s.sql.slice(0, 120)}`).join('\n'),
    );
  }
  return matches[0] as CapturedStatement;
}

/** Convenience: the union of every table any captured statement touched. */
export function tablesTouched(statements: readonly CapturedStatement[]): Set<string> {
  return new Set(statements.flatMap((s) => [...s.tables]));
}

/** Convenience: the union of every column any captured statement selected. */
export function columnsSelected(statements: readonly CapturedStatement[]): Set<string> {
  return new Set(statements.flatMap((s) => [...s.selected]));
}
