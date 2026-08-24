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

/** The narrowest row shape the definition needs. Any query may widen it. */
export interface ActivityRow {
  readonly status: EngagementStatus;
  readonly lastActivityAt: Date;
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

export function countActiveEngagements(
  rows: readonly ActivityRow[],
  now: Date,
  windowDays = ACTIVE_WINDOW_DAYS,
): number {
  let count = 0;
  for (const row of rows) {
    if (isEngagementActive(row, now, windowDays)) count += 1;
  }
  return count;
}
