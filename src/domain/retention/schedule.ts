/**
 * The expiry scheduler's arithmetic. Phase 6 builds the worker that acts on it;
 * this file exists now because the columns it computes are written from the
 * moment an engagement is created, and because INV-8 requires the scheduler and
 * the billing gate to share one definition of "active" — which they do, by
 * importing the same function rather than by agreeing to be careful.
 */

import type { Plan } from '@/lib/types';
import { isEngagementActive, isRunning, type ActivityRow } from '../engagement/count-active';
import { limitsFor } from '../plan/limits';

const DAY_MS = 24 * 60 * 60 * 1000;

/** DATA-MODEL.md retention timeline. Overridable only so tests can run it. */
export const RETENTION_ARCHIVE_DAYS = 30;
export const RETENTION_PURGE_DAYS = 60;

/** Warnings at archive, then +14d, +23d, +29d. */
export const WARNING_OFFSETS_DAYS = [0, 14, 23, 29] as const;

export interface RetentionWindow {
  readonly archiveAt: Date | null;
  readonly purgeAt: Date | null;
}

export interface RetentionPolicy {
  readonly archiveDays: number;
  readonly purgeDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  archiveDays: RETENTION_ARCHIVE_DAYS,
  purgeDays: RETENTION_PURGE_DAYS,
};

/**
 * A retaining plan nulls the countdown out entirely rather than pushing it far
 * into the future: a date that exists is a date some later bug can act on.
 */
export function retentionWindow(
  plan: Plan,
  lastActivityAt: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): RetentionWindow {
  if (limitsFor(plan).retainsIndefinitely) return { archiveAt: null, purgeAt: null };
  return {
    archiveAt: new Date(lastActivityAt.getTime() + policy.archiveDays * DAY_MS),
    purgeAt: new Date(lastActivityAt.getTime() + policy.purgeDays * DAY_MS),
  };
}

export function warningDates(archiveAt: Date): Date[] {
  return WARNING_OFFSETS_DAYS.map((d) => new Date(archiveAt.getTime() + d * DAY_MS));
}

export function daysToPurge(purgeAt: Date | null, now: Date): number | null {
  if (purgeAt === null) return null;
  return Math.max(0, Math.ceil((purgeAt.getTime() - now.getTime()) / DAY_MS));
}

/**
 * The engagements the archive sweep should take. Uses the same predicate the
 * billing gate uses — an engagement that stopped counting against the plan is
 * exactly the one whose countdown has started (INV-8).
 */
export function selectForArchive<T extends ActivityRow>(rows: readonly T[], now: Date): T[] {
  return rows.filter((row) => isRunning(row) && !isEngagementActive(row, now));
}
