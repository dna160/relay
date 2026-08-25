/**
 * Engagements at every lifecycle stage, plus the client contacts hanging off
 * them.
 *
 * Two things are encoded here that are easy to get wrong and expensive to get
 * wrong late:
 *
 * 1. **Active is two clauses, not one.** PRD §5.6: an engagement is active if
 *    `status = 'active'` AND it has had activity in the last 30 days. The free
 *    org below holds four rows with `status = 'active'` of which only three are
 *    active. A `countActiveEngagements()` that counts status alone passes a
 *    naive fixture and fails this one. That is the point (INV-8).
 *
 * 2. **Retention dates are arithmetic, not policy.** `archive_at` is
 *    `last_activity_at + 30d`, `purge_at` is `last_activity_at + 60d`, and the
 *    four warnings fall at archive, +14d, +23d, +29d (DATA-MODEL retention
 *    timeline). A retaining plan nulls both dates out rather than moving them.
 *
 * 3. **Every instant here is on the live clock, not the frozen one.** These
 *    rows are seeded into a real Postgres and then read by `countActive`,
 *    the archive sweep and the wrap slate, all of which call `new Date()`.
 *    Offsets are fixed (`now - 5 days`, `now - 39 days`); the calendar date
 *    they hang off is not. `clock.ts` explains what happened the one time it
 *    was, and `tests/unit/fixtures.spec.ts` holds the guard against a relapse.
 */

import { CONTACT, ENGAGEMENT, ORG, USER } from './ids';
import { days, liveIso, LIVE_ORIGIN, LIVE_SPAN_DAYS } from './clock';

/**
 * The instant every expectation in this file is evaluated at: 100 days into the
 * live timeline, which by construction is the instant `clock.ts` was loaded.
 * A test that needs "now" for an engagement question uses this rather than
 * `new Date()`, so that a suite which takes a minute to run still evaluates
 * every expectation against one instant.
 *
 * It is deliberately *not* frozen to a calendar date. Every row below is
 * inserted into a real Postgres by `src/db/test-support.ts` and read back by
 * code that calls `new Date()`; a fixture anchored to an absolute origin is
 * correct for a few weeks and then silently wrong forever. See `clock.ts`.
 */
export const EVAL_NOW = new Date(LIVE_ORIGIN.getTime() + days(LIVE_SPAN_DAYS));

/** PRD §5.6 — the activity window that makes an engagement active. */
export const ACTIVE_WINDOW_DAYS = 30;

/** DATA-MODEL retention timeline. */
export const RETENTION = {
  archiveDays: 30,
  purgeDays: 60,
  /** Days after `archive_at` at which each of the four warnings is sent. */
  warningOffsetDays: [0, 14, 23, 29] as const,
} as const;

export type EngagementStatus = 'draft' | 'active' | 'archived' | 'purged';

export interface EngagementRow {
  id: string;
  orgId: string;
  clientOrgName: string;
  title: string;
  status: EngagementStatus;
  templateId: string | null;
  startedAt: string | null;
  wrappedAt: string | null;
  lastActivityAt: string;
  /** Null on a retaining plan. */
  archiveAt: string | null;
  /** Null on a retaining plan. */
  purgeAt: string | null;
  contractedRoundsDefault: number;
  createdAt: string;
}

/**
 * The retention arithmetic, expressed against an *instant* rather than an
 * offset from a named origin.
 *
 * These used to take "milliseconds after T0", which quietly assumed that every
 * caller shared one frozen origin. They no longer do: the rows below live on
 * the live timeline and `tests/unit/retention-dates.spec.ts` checks the same
 * arithmetic against `T0`. Taking the instant makes the helper origin-agnostic
 * and makes a caller that mixes the two clocks impossible to write by accident.
 */

/** `archive_at` for a free-plan engagement with this last activity. */
export function archiveAtFor(lastActivity: Date): string {
  return new Date(lastActivity.getTime() + days(RETENTION.archiveDays)).toISOString();
}

/** `purge_at` for a free-plan engagement with this last activity. */
export function purgeAtFor(lastActivity: Date): string {
  return new Date(lastActivity.getTime() + days(RETENTION.purgeDays)).toISOString();
}

/** The four warning instants for a free-plan engagement, in order. */
export function warningsFor(lastActivity: Date): string[] {
  const archive = lastActivity.getTime() + days(RETENTION.archiveDays);
  return RETENTION.warningOffsetDays.map((d) => new Date(archive + days(d)).toISOString());
}

/**
 * Last activity for each engagement, as a fixed offset into the live timeline.
 *
 * Read these against `EVAL_NOW`, which sits at day 100. `active` is 5 days ago
 * and inside the window; `stale` is 39 days ago and outside it. Those two
 * numbers are the fixture's whole argument about INV-8 and they are stated as
 * durations, never as dates.
 */
const LAST_ACTIVITY = {
  draft: days(99),
  active: days(95),
  activeSecond: days(80),
  wrapped: days(92),
  stale: days(61),
  archived: days(45),
  purged: days(20),
  retained: days(85),
} as const;

/** The instant `LAST_ACTIVITY.x` names, on the live timeline. */
function lastActivity(offsetMs: number): Date {
  return new Date(LIVE_ORIGIN.getTime() + offsetMs);
}

export const engagements: readonly EngagementRow[] = [
  {
    id: ENGAGEMENT.draft,
    orgId: ORG.free,
    clientOrgName: 'Hallmoor Cider',
    title: 'Rebrand — discovery',
    status: 'draft',
    templateId: null,
    startedAt: null,
    wrappedAt: null,
    lastActivityAt: liveIso(LAST_ACTIVITY.draft),
    archiveAt: archiveAtFor(lastActivity(LAST_ACTIVITY.draft)),
    purgeAt: purgeAtFor(lastActivity(LAST_ACTIVITY.draft)),
    contractedRoundsDefault: 2,
    createdAt: liveIso(days(99)),
  },
  {
    id: ENGAGEMENT.active,
    orgId: ORG.free,
    clientOrgName: 'Bellweather Foods',
    title: 'Spring campaign',
    status: 'active',
    templateId: null,
    startedAt: liveIso(0),
    wrappedAt: null,
    lastActivityAt: liveIso(LAST_ACTIVITY.active),
    archiveAt: archiveAtFor(lastActivity(LAST_ACTIVITY.active)),
    purgeAt: purgeAtFor(lastActivity(LAST_ACTIVITY.active)),
    contractedRoundsDefault: 2,
    createdAt: liveIso(0),
  },
  {
    id: ENGAGEMENT.activeSecond,
    orgId: ORG.free,
    clientOrgName: 'Bellweather Foods',
    title: 'Packaging refresh',
    status: 'active',
    templateId: null,
    startedAt: liveIso(days(30)),
    wrappedAt: null,
    lastActivityAt: liveIso(LAST_ACTIVITY.activeSecond),
    archiveAt: archiveAtFor(lastActivity(LAST_ACTIVITY.activeSecond)),
    purgeAt: purgeAtFor(lastActivity(LAST_ACTIVITY.activeSecond)),
    contractedRoundsDefault: 3,
    createdAt: liveIso(days(30)),
  },
  {
    // Wrapped means delivered and counting down. It is still `active` and it
    // still occupies a plan slot until the activity window closes on it.
    id: ENGAGEMENT.wrapped,
    orgId: ORG.free,
    clientOrgName: 'Tessellate',
    title: 'Site build',
    status: 'active',
    templateId: null,
    startedAt: liveIso(days(10)),
    wrappedAt: liveIso(LAST_ACTIVITY.wrapped),
    lastActivityAt: liveIso(LAST_ACTIVITY.wrapped),
    archiveAt: archiveAtFor(lastActivity(LAST_ACTIVITY.wrapped)),
    purgeAt: purgeAtFor(lastActivity(LAST_ACTIVITY.wrapped)),
    contractedRoundsDefault: 2,
    createdAt: liveIso(days(10)),
  },
  {
    // 39 days idle. `status` says active; the counter must say otherwise, and
    // the archive sweep owes it an archive — `archive_at` elapsed 9 days ago.
    id: ENGAGEMENT.stale,
    orgId: ORG.free,
    clientOrgName: 'Orrery Labs',
    title: 'Pitch deck',
    status: 'active',
    templateId: null,
    startedAt: liveIso(days(40)),
    wrappedAt: null,
    lastActivityAt: liveIso(LAST_ACTIVITY.stale),
    archiveAt: archiveAtFor(lastActivity(LAST_ACTIVITY.stale)),
    purgeAt: purgeAtFor(lastActivity(LAST_ACTIVITY.stale)),
    contractedRoundsDefault: 2,
    createdAt: liveIso(days(40)),
  },
  {
    // Read-only. Any mutation must return 423 ENGAGEMENT_ARCHIVED.
    // Last activity is day 45, so archive fell on day 75 and purge falls on
    // day 105 — five days after EVAL_NOW, which is what the wrap slate counts
    // down. Warnings fall at day 75, 89, 98 and 104; three are due by now.
    id: ENGAGEMENT.archived,
    orgId: ORG.free,
    clientOrgName: 'Fennwick & Co',
    title: 'Annual report',
    status: 'archived',
    templateId: null,
    startedAt: liveIso(days(5)),
    wrappedAt: liveIso(days(44)),
    lastActivityAt: liveIso(LAST_ACTIVITY.archived),
    archiveAt: archiveAtFor(lastActivity(LAST_ACTIVITY.archived)),
    purgeAt: purgeAtFor(lastActivity(LAST_ACTIVITY.archived)),
    contractedRoundsDefault: 2,
    createdAt: liveIso(days(5)),
  },
  {
    // Gone. Reads return 410 ENGAGEMENT_PURGED and point at the certificate.
    id: ENGAGEMENT.purged,
    orgId: ORG.free,
    clientOrgName: 'Lantern Press',
    title: 'Cover artwork',
    status: 'purged',
    templateId: null,
    startedAt: liveIso(0),
    wrappedAt: liveIso(days(15)),
    lastActivityAt: liveIso(LAST_ACTIVITY.purged),
    archiveAt: archiveAtFor(lastActivity(LAST_ACTIVITY.purged)),
    purgeAt: purgeAtFor(lastActivity(LAST_ACTIVITY.purged)),
    contractedRoundsDefault: 2,
    createdAt: liveIso(0),
  },
  {
    // Pro org. A retaining plan nulls the countdown out; it does not push it.
    id: ENGAGEMENT.retained,
    orgId: ORG.pro,
    clientOrgName: 'Adelheid Group',
    title: 'Brand system',
    status: 'active',
    templateId: null,
    startedAt: liveIso(days(20)),
    wrappedAt: null,
    lastActivityAt: liveIso(LAST_ACTIVITY.retained),
    archiveAt: null,
    purgeAt: null,
    contractedRoundsDefault: 4,
    createdAt: liveIso(days(20)),
  },
];

/**
 * The answer `countActiveEngagements(orgId, EVAL_NOW)` must produce.
 *
 * Billing and the expiry scheduler both call that one function (INV-8). If
 * these numbers and the implementation disagree, the implementation is wrong.
 */
export const EXPECTED_ACTIVE_AT_EVAL_NOW: Readonly<Record<string, number>> = {
  [ORG.free]: 3, // active, activeSecond, wrapped. Not: stale, draft, archived, purged.
  [ORG.pro]: 1,
  [ORG.studio]: 0,
};

/** Engagements the archive sweep owes an archive at EVAL_NOW. */
export const EXPECTED_DUE_FOR_ARCHIVE: readonly string[] = [ENGAGEMENT.stale];

/** Engagements the purge sweep owes a purge at EVAL_NOW. */
export const EXPECTED_DUE_FOR_PURGE: readonly string[] = [];

export interface ClientContactRow {
  id: string;
  engagementId: string;
  email: string;
  name: string | null;
  verifiedAt: string | null;
  lastSeenAt: string | null;
  invitedBy: string;
  createdAt: string;
}

/**
 * `CONTACT.active` and `CONTACT.activeSecond` share an email address across two
 * engagements and are deliberately unrelated rows. There is no cross-engagement
 * client identity (INV-6, ADR-005) — `UNIQUE (engagement_id, email)`, not
 * `UNIQUE (email)`.
 */
export const clientContacts: readonly ClientContactRow[] = [
  {
    id: CONTACT.active,
    engagementId: ENGAGEMENT.active,
    email: 'rowan@bellweather.test',
    name: 'Rowan Vance',
    verifiedAt: liveIso(days(2)),
    lastSeenAt: liveIso(days(94)),
    invitedBy: USER.freeAdmin,
    createdAt: liveIso(days(1)),
  },
  {
    id: CONTACT.activeSecond,
    engagementId: ENGAGEMENT.activeSecond,
    email: 'rowan@bellweather.test',
    name: 'Rowan Vance',
    verifiedAt: liveIso(days(31)),
    lastSeenAt: liveIso(days(79)),
    invitedBy: USER.freeAdmin,
    createdAt: liveIso(days(30)),
  },
  {
    id: CONTACT.unverified,
    engagementId: ENGAGEMENT.active,
    email: 'jules@bellweather.test',
    name: null,
    verifiedAt: null,
    lastSeenAt: null,
    invitedBy: USER.freeAdmin,
    createdAt: liveIso(days(90)),
  },
];

/**
 * The narrow row shape `countActiveEngagements()` and the retention sweep both
 * take. Deliberately structural — the fixture does not import the domain type,
 * so a change to that type shows up as a compile error at the call site rather
 * than as a fixture that quietly followed it.
 */
export function activityRows(orgId?: string): Array<{
  id: string;
  status: EngagementStatus;
  lastActivityAt: Date;
}> {
  return engagements
    .filter((e) => orgId === undefined || e.orgId === orgId)
    .map((e) => ({ id: e.id, status: e.status, lastActivityAt: new Date(e.lastActivityAt) }));
}

export function engagementById(id: string): EngagementRow {
  const found = engagements.find((e) => e.id === id);
  if (!found) throw new Error(`fixture: no engagement ${id}`);
  return found;
}
