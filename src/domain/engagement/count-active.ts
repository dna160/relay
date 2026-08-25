/**
 * INV-8 / ADR-008 — the only definition of "active" in this codebase.
 *
 * The billing gate and the expiry scheduler both call these functions. They may
 * never diverge, because two implementations of "active" will drift and the
 * drift will bill someone for a workspace it also deleted.
 *
 * Pure by construction: it takes rows and a clock, never a database handle. If
 * you find yourself writing `eq(engagements.status, 'active')` anywhere else in
 * the tree, that is the bug this file exists to prevent — load the rows and ask
 * `isEngagementActive()` instead.
 */

import type { EngagementStatus } from '@/lib/types';

/** PRD §5.6: active means status ACTIVE *and* activity in the last 30 days. */
export const ACTIVE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The narrowest row shape the definition needs. Any query may widen it.
 *
 * `orgId` arrived in Phase 9. It is optional on the *type* so that a row set a
 * caller has already scoped to one organization still satisfies it, and it is
 * required by the org-scoped call form below — which is the only form `src/`
 * uses. See `countActiveEngagements` for why that asymmetry exists.
 */
export interface ActivityRow {
  readonly status: EngagementStatus;
  readonly lastActivityAt: Date;
  readonly orgId?: string | undefined;
}

/** An `ActivityRow` that knows which organization it belongs to. */
export interface OrgScopedActivityRow extends ActivityRow {
  readonly orgId: string;
}

/**
 * The status half of the definition, on its own, so that no second file has to
 * spell the literal. The retention sweep needs "running but gone quiet", which
 * is this predicate minus `isEngagementActive`.
 */
export function isRunning(row: ActivityRow): boolean {
  return row.status === 'active';
}

export function activeWindowStart(now: Date, windowDays = ACTIVE_WINDOW_DAYS): Date {
  return new Date(now.getTime() - windowDays * DAY_MS);
}

/**
 * An engagement is active when it is running and someone has touched it inside
 * the window. A workspace nobody has opened in six weeks is not costing the
 * agency a slot, and it is also the one the retention clock is coming for —
 * one predicate, two consumers, by design.
 */
export function isEngagementActive(
  row: ActivityRow,
  now: Date,
  windowDays = ACTIVE_WINDOW_DAYS,
): boolean {
  if (!isRunning(row)) return false;
  return row.lastActivityAt.getTime() > activeWindowStart(now, windowDays).getTime();
}

/**
 * How many of an organization's engagements are active.
 *
 * ## Why the org id is a parameter (ADR-021)
 *
 * v1 had one organization per person, so "the rows the caller loaded" and "one
 * organization's rows" were the same set and the distinction cost nothing.
 * Under the v1.1 graph an account can belong to several organizations, and the
 * plan limit is a property of the **organization**, not of the person: an
 * account in five orgs consumes none of its own quota. A counter that trusts
 * whatever rows it was handed is one mis-scoped query away from billing one
 * tenant for another tenant's workspaces.
 *
 * So the org id is named at the call site and the filter happens *here*. A
 * caller that loads too much gets the right answer anyway, which is the only
 * kind of safety worth having in a billing path.
 *
 * This is still the one definition of active (INV-8). There is one loop, one
 * predicate, and one window, and both call forms below reach the same three.
 *
 * ## The second signature
 *
 * The positional `(rows, now)` form is v1's and is **deprecated**. It exists so
 * that the signature change does not have to land in the same commit as the
 * test files that call it, which belong to another agent this round. It counts
 * exactly the rows it is given — v1's behaviour, unchanged — and throws rather
 * than guess if those rows span more than one organization, so it cannot become
 * the quiet cross-tenant count it is being retired for. It goes at ADR-021 step
 * 4, alongside the old permission checks.
 */
export function countActiveEngagements(
  orgId: string,
  rows: readonly OrgScopedActivityRow[],
  now: Date,
  windowDays?: number,
): number;
/** @deprecated Phase 9 shim — pass the organization id. Removed at step 4. */
export function countActiveEngagements(
  rows: readonly ActivityRow[],
  now: Date,
  windowDays?: number,
): number;
export function countActiveEngagements(
  a: string | readonly ActivityRow[],
  b: readonly OrgScopedActivityRow[] | Date,
  c?: Date | number,
  d?: number,
): number {
  if (typeof a === 'string') {
    const rows = b as readonly OrgScopedActivityRow[];
    const now = c as Date;
    return tally(
      rows.filter((row) => row.orgId === a),
      now,
      d ?? ACTIVE_WINDOW_DAYS,
    );
  }

  const rows = a;
  const now = b as Date;
  const orgs = new Set(rows.map((row) => row.orgId).filter((id) => id !== undefined));
  if (orgs.size > 1) {
    throw new Error(
      'countActiveEngagements: rows span more than one organization. The plan ' +
        'limit is per organization (ADR-021) — pass the org id as the first argument.',
    );
  }
  return tally(rows, now, (c as number | undefined) ?? ACTIVE_WINDOW_DAYS);
}

function tally(rows: readonly ActivityRow[], now: Date, windowDays: number): number {
  let count = 0;
  for (const row of rows) {
    if (isEngagementActive(row, now, windowDays)) count += 1;
  }
  return count;
}
