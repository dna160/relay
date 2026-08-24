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
 */

import { CONTACT, ENGAGEMENT, ORG, USER } from './ids';
import { days, iso, T0 } from './clock';

/**
 * The instant every expectation in this file is evaluated at: T0 + 100 days.
 * A test that needs "now" for an engagement question uses this and never
 * `new Date()`.
 */
export const EVAL_NOW = new Date(T0.getTime() + days(100));

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

/** `archive_at` for a free-plan engagement with this last activity. */
export function archiveAtFor(lastActivityMs: number): string {
  return iso(lastActivityMs + days(RETENTION.archiveDays));
}

/** `purge_at` for a free-plan engagement with this last activity. */
export function purgeAtFor(lastActivityMs: number): string {
  return iso(lastActivityMs + days(RETENTION.purgeDays));
}

/** The four warning instants for a free-plan engagement, in order. */
export function warningsFor(lastActivityMs: number): string[] {
  const archive = lastActivityMs + days(RETENTION.archiveDays);
  return RETENTION.warningOffsetDays.map((d) => iso(archive + days(d)));
}

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
    lastActivityAt: iso(LAST_ACTIVITY.draft),
    archiveAt: archiveAtFor(LAST_ACTIVITY.draft),
    purgeAt: purgeAtFor(LAST_ACTIVITY.draft),
    contractedRoundsDefault: 2,
    createdAt: iso(days(99)),
  },
  {
    id: ENGAGEMENT.active,
    orgId: ORG.free,
    clientOrgName: 'Bellweather Foods',
    title: 'Spring campaign',
    status: 'active',
    templateId: null,
    startedAt: iso(0),
    wrappedAt: null,
    lastActivityAt: iso(LAST_ACTIVITY.active),
    archiveAt: archiveAtFor(LAST_ACTIVITY.active),
    purgeAt: purgeAtFor(LAST_ACTIVITY.active),
    contractedRoundsDefault: 2,
    createdAt: iso(0),
  },
  {
    id: ENGAGEMENT.activeSecond,
    orgId: ORG.free,
    clientOrgName: 'Bellweather Foods',
    title: 'Packaging refresh',
    status: 'active',
    templateId: null,
    startedAt: iso(days(30)),
    wrappedAt: null,
    lastActivityAt: iso(LAST_ACTIVITY.activeSecond),
    archiveAt: archiveAtFor(LAST_ACTIVITY.activeSecond),
    purgeAt: purgeAtFor(LAST_ACTIVITY.activeSecond),
    contractedRoundsDefault: 3,
    createdAt: iso(days(30)),
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
    startedAt: iso(days(10)),
    wrappedAt: iso(LAST_ACTIVITY.wrapped),
    lastActivityAt: iso(LAST_ACTIVITY.wrapped),
    archiveAt: archiveAtFor(LAST_ACTIVITY.wrapped),
    purgeAt: purgeAtFor(LAST_ACTIVITY.wrapped),
    contractedRoundsDefault: 2,
    createdAt: iso(days(10)),
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
    startedAt: iso(days(40)),
    wrappedAt: null,
    lastActivityAt: iso(LAST_ACTIVITY.stale),
    archiveAt: archiveAtFor(LAST_ACTIVITY.stale),
    purgeAt: purgeAtFor(LAST_ACTIVITY.stale),
    contractedRoundsDefault: 2,
    createdAt: iso(days(40)),
  },
  {
    // Read-only. Any mutation must return 423 ENGAGEMENT_ARCHIVED.
    // Warnings fall at T0+75d, +89d, +98d, +104d; three are due at EVAL_NOW.
    id: ENGAGEMENT.archived,
    orgId: ORG.free,
    clientOrgName: 'Fennwick & Co',
    title: 'Annual report',
    status: 'archived',
    templateId: null,
    startedAt: iso(days(5)),
    wrappedAt: iso(days(44)),
    lastActivityAt: iso(LAST_ACTIVITY.archived),
    archiveAt: archiveAtFor(LAST_ACTIVITY.archived),
    purgeAt: purgeAtFor(LAST_ACTIVITY.archived),
    contractedRoundsDefault: 2,
    createdAt: iso(days(5)),
  },
  {
    // Gone. Reads return 410 ENGAGEMENT_PURGED and point at the certificate.
    id: ENGAGEMENT.purged,
    orgId: ORG.free,
    clientOrgName: 'Lantern Press',
    title: 'Cover artwork',
    status: 'purged',
    templateId: null,
    startedAt: iso(0),
    wrappedAt: iso(days(15)),
    lastActivityAt: iso(LAST_ACTIVITY.purged),
    archiveAt: archiveAtFor(LAST_ACTIVITY.purged),
    purgeAt: purgeAtFor(LAST_ACTIVITY.purged),
    contractedRoundsDefault: 2,
    createdAt: iso(0),
  },
  {
    // Pro org. A retaining plan nulls the countdown out; it does not push it.
    id: ENGAGEMENT.retained,
    orgId: ORG.pro,
    clientOrgName: 'Adelheid Group',
    title: 'Brand system',
    status: 'active',
    templateId: null,
    startedAt: iso(days(20)),
    wrappedAt: null,
    lastActivityAt: iso(LAST_ACTIVITY.retained),
    archiveAt: null,
    purgeAt: null,
    contractedRoundsDefault: 4,
    createdAt: iso(days(20)),
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
    verifiedAt: iso(days(2)),
    lastSeenAt: iso(days(94)),
    invitedBy: USER.freeAdmin,
    createdAt: iso(days(1)),
  },
  {
    id: CONTACT.activeSecond,
    engagementId: ENGAGEMENT.activeSecond,
    email: 'rowan@bellweather.test',
    name: 'Rowan Vance',
    verifiedAt: iso(days(31)),
    lastSeenAt: iso(days(79)),
    invitedBy: USER.freeAdmin,
    createdAt: iso(days(30)),
  },
  {
    id: CONTACT.unverified,
    engagementId: ENGAGEMENT.active,
    email: 'jules@bellweather.test',
    name: null,
    verifiedAt: null,
    lastSeenAt: null,
    invitedBy: USER.freeAdmin,
    createdAt: iso(days(90)),
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
