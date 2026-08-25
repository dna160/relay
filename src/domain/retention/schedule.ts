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

/* ------------------------------------------------------------- the warnings */

/** One scheduled notice: when it is due, and how much time it says is left. */
export interface WarningSchedule {
  readonly offsetDays: number;
  readonly dueAt: Date;
  readonly daysToPurge: number;
}

/**
 * The four notices, as dates and as the number each one has to say out loud.
 *
 * `daysToPurge` is computed from the *schedule*, not from the wall clock, so
 * that a sweep which runs six hours late still sends "14 days left" rather than
 * "13 days and 18 hours, rounded". The number in the email and the number in
 * the database are the same number.
 */
export function warningSchedule(archiveAt: Date, purgeAt: Date): WarningSchedule[] {
  return WARNING_OFFSETS_DAYS.map((offsetDays) => {
    const dueAt = new Date(archiveAt.getTime() + offsetDays * DAY_MS);
    return { offsetDays, dueAt, daysToPurge: daysToPurge(purgeAt, dueAt) ?? 0 };
  });
}

/**
 * The notices that are due and not yet on record.
 *
 * Every overdue notice is returned, not just the latest. A worker that was down
 * for a fortnight owes both the +14d and the +23d notice, and the purge guard
 * counts four — skipping the ones that "would have" gone out is how an
 * engagement reaches its purge date with two warnings and a defensible-looking
 * log.
 */
export function warningsDue(
  archiveAt: Date,
  purgeAt: Date,
  alreadyWarned: ReadonlySet<number>,
  now: Date,
): WarningSchedule[] {
  return warningSchedule(archiveAt, purgeAt).filter(
    (w) => w.dueAt.getTime() <= now.getTime() && !alreadyWarned.has(w.offsetDays),
  );
}

/** How many notices an engagement must have on record before it may be purged. */
export const REQUIRED_WARNINGS = WARNING_OFFSETS_DAYS.length;

/* ------------------------------------------------------------- the downgrade */

/**
 * Recomputing the countdown when an agency drops off a retaining plan.
 *
 * A naive recompute is a data-loss bug with a straight face: an engagement that
 * has been quiet for a year has `last_activity_at + 60 days` somewhere in the
 * distant past, so the plain window would hand the purge sweep an engagement
 * that is already overdue — and it would be destroyed within the hour, having
 * received none of its four warnings, on the day the customer downgraded.
 *
 * So the downgrade window is clamped: archive no earlier than now, purge no
 * earlier than a full warning cycle from now. The customer loses nothing they
 * were promised — they were on a plan that retained indefinitely until this
 * moment — and the four notices have somewhere to happen.
 */
export function downgradeWindow(
  plan: Plan,
  lastActivityAt: Date,
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): RetentionWindow {
  const natural = retentionWindow(plan, lastActivityAt, policy);
  if (natural.archiveAt === null || natural.purgeAt === null) return natural;

  const warningCycleDays = Math.max(...WARNING_OFFSETS_DAYS) + 1;
  const floorPurge = new Date(now.getTime() + warningCycleDays * DAY_MS);

  return {
    archiveAt: new Date(Math.max(natural.archiveAt.getTime(), now.getTime())),
    purgeAt: new Date(Math.max(natural.purgeAt.getTime(), floorPurge.getTime())),
  };
}

/** True when moving between these plans removes indefinite retention. */
export function isDowngrade(from: Plan, to: Plan): boolean {
  return limitsFor(from).retainsIndefinitely && !limitsFor(to).retainsIndefinitely;
}

/**
 * Reads the two retention overrides. Dev only, by contract — RUNBOOK §2 says so
 * twice, and setting either in production changes when customer data is
 * destroyed. Lives in the domain layer as a pure function over an env object so
 * that nothing here reaches for `process` itself (INV-9).
 */
export function retentionPolicyFrom(env: Readonly<Record<string, string | undefined>>): RetentionPolicy {
  const archiveDays = positiveInt(env.RETENTION_ARCHIVE_DAYS) ?? RETENTION_ARCHIVE_DAYS;
  const purgeDays = positiveInt(env.RETENTION_PURGE_DAYS) ?? RETENTION_PURGE_DAYS;
  // A purge date at or before the archive date would leave no window for the
  // warnings, which is the one configuration the guard could not survive.
  if (purgeDays <= archiveDays) return DEFAULT_RETENTION;
  return { archiveDays, purgeDays };
}

function positiveInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}
