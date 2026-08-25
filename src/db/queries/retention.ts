/**
 * Retention reads. Nothing here is reachable by a client contact — the worker
 * and the purge CLI are the only callers, and neither serves a request.
 *
 * The one rule this file obeys that is easy to miss: **no `status = 'active'`
 * predicate appears anywhere in it** (INV-8). The archive sweep loads rows and
 * asks `selectForArchive()`, which asks `isRunning()`/`isEngagementActive()`,
 * which is the same pair the billing gate asks. A `WHERE status = 'active'`
 * here would be a second definition of active wearing a query's clothes, and
 * the two would drift into billing someone for a workspace they also deleted.
 */

import { and, count, desc, eq, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import {
  auditLog,
  clientContacts,
  engagements,
  organizations,
  purgeCertificates,
  purgeManifest,
  users,
  type PurgeStep,
} from '@/db/schema';
import type { Executor } from '@/db/types';
import type { EngagementStatus, Plan } from '@/lib/types';
import type { ManifestEngagementRow } from '@/domain/retention/manifest';

/** Everything the retention machinery needs to decide and to write an email. */
export interface RetentionRow {
  readonly id: string;
  readonly orgId: string;
  readonly title: string;
  readonly clientOrgName: string;
  readonly status: EngagementStatus;
  readonly lastActivityAt: Date;
  readonly archiveAt: Date | null;
  readonly purgeAt: Date | null;
  readonly plan: Plan;
  readonly agencyName: string;
}

const retentionColumns = {
  id: engagements.id,
  orgId: engagements.orgId,
  title: engagements.title,
  clientOrgName: engagements.clientOrgName,
  status: engagements.status,
  lastActivityAt: engagements.lastActivityAt,
  archiveAt: engagements.archiveAt,
  purgeAt: engagements.purgeAt,
  plan: organizations.plan,
  agencyName: organizations.name,
};

/**
 * Candidates for the archive sweep, narrowed only by dates.
 *
 * `archive_at IS NOT NULL` is what excludes retaining plans — a paid plan nulls
 * the countdown out entirely rather than pushing it into the future, so there is
 * no date here for a later bug to act on. The status half of the decision is
 * left to `selectForArchive()` on purpose.
 */
export async function loadArchiveCandidates(exec: Executor, now: Date): Promise<RetentionRow[]> {
  return exec
    .select(retentionColumns)
    .from(engagements)
    .innerJoin(organizations, eq(organizations.id, engagements.orgId))
    .where(
      and(
        ne(engagements.status, 'purged'),
        isNotNull(engagements.archiveAt),
        lte(engagements.archiveAt, now),
      ),
    );
}

/** Archived engagements still inside the countdown, for the warning sweep. */
export async function loadWarnableEngagements(exec: Executor): Promise<RetentionRow[]> {
  return exec
    .select(retentionColumns)
    .from(engagements)
    .innerJoin(organizations, eq(organizations.id, engagements.orgId))
    .where(
      and(
        eq(engagements.status, 'archived'),
        isNotNull(engagements.archiveAt),
        isNotNull(engagements.purgeAt),
      ),
    );
}

export async function loadRetentionRow(
  exec: Executor,
  engagementId: string,
): Promise<RetentionRow | null> {
  const rows = await exec
    .select(retentionColumns)
    .from(engagements)
    .innerJoin(organizations, eq(organizations.id, engagements.orgId))
    .where(eq(engagements.id, engagementId))
    .limit(1);
  return rows[0] ?? null;
}

/** Every engagement of an org that is not already purged — the downgrade sweep. */
export async function loadOrgRetentionRows(exec: Executor, orgId: string): Promise<RetentionRow[]> {
  return exec
    .select(retentionColumns)
    .from(engagements)
    .innerJoin(organizations, eq(organizations.id, engagements.orgId))
    .where(and(eq(engagements.orgId, orgId), ne(engagements.status, 'purged')));
}

/* ----------------------------------------------------------------- audience */

export interface WarningAudience {
  readonly agency: readonly { email: string; name: string | null }[];
  readonly client: readonly { email: string; name: string | null }[];
}

/**
 * Both sides, every time.
 *
 * The agency's contract with its client almost certainly obliges it to retain
 * deliverables, so a notice that reaches only one party is the notice that
 * manufactures a breach. If either list comes back empty that is a fact the
 * caller has to handle, not a reason to skip the send to the other.
 */
export async function loadWarningAudience(
  exec: Executor,
  engagementId: string,
  orgId: string,
): Promise<WarningAudience> {
  const agency = await exec
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.orgId, orgId));

  const client = await exec
    .select({ email: clientContacts.email, name: clientContacts.name })
    .from(clientContacts)
    .where(eq(clientContacts.engagementId, engagementId));

  return { agency, client };
}

/* ------------------------------------------------------- warnings on record */

/** `subject_type` for the warning at this offset. One notice per offset. */
export function warningSubjectType(offsetDays: number): string {
  return `retention_warning:${String(offsetDays)}`;
}

export const RETENTION_WARNED_ACTION = 'retention.warned';

/** The offsets already warned for, read back from the audit log. */
export async function loadWarningsOnRecord(
  exec: Executor,
  engagementId: string,
): Promise<Set<string>> {
  const rows = await exec
    .select({ subjectType: auditLog.subjectType })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.engagementId, engagementId),
        eq(auditLog.action, RETENTION_WARNED_ACTION),
      ),
    );
  return new Set(rows.map((r) => r.subjectType ?? '').filter((s) => s.length > 0));
}

/**
 * How many distinct warnings this engagement has on record.
 *
 * This is the number the purge guard refuses on. It counts rows in `audit_log`,
 * which is the same query RUNBOOK §6 tells a tired operator to run — one source
 * of truth for "were they warned?", not two that can disagree.
 */
export async function countWarningsOnRecord(
  exec: Executor,
  engagementId: string,
): Promise<number> {
  const rows = await exec
    .select({ n: count() })
    .from(auditLog)
    .where(
      and(eq(auditLog.engagementId, engagementId), eq(auditLog.action, RETENTION_WARNED_ACTION)),
    );
  return rows[0]?.n ?? 0;
}

/* ------------------------------------------------------ certificates & steps */

export interface CertificateRow {
  id: string;
  engagementId: string;
  orgId: string;
  engagementTitle: string;
  clientOrgName: string;
  objectCount: number;
  totalBytes: number;
  manifestSha256: string;
  statement: string;
  purgedAt: Date;
  certificateSignature: string;
}

export async function loadCertificate(
  exec: Executor,
  engagementId: string,
): Promise<CertificateRow | null> {
  const rows = await exec
    .select()
    .from(purgeCertificates)
    .where(eq(purgeCertificates.engagementId, engagementId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * INV-7 says exactly one. A unique index makes that true; this read is what
 * lets the worker and the CLI *say* so rather than assume it.
 */
export async function countCertificates(exec: Executor, engagementId: string): Promise<number> {
  const rows = await exec
    .select({ n: count() })
    .from(purgeCertificates)
    .where(eq(purgeCertificates.engagementId, engagementId));
  return rows[0]?.n ?? 0;
}

export interface PurgeStepRow {
  id: string;
  engagementId: string;
  step: PurgeStep;
  status: 'running' | 'done' | 'failed';
  manifestSha256: string | null;
  manifest: unknown;
  objectCount: number | null;
  totalBytes: number | null;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

export async function loadPurgeSteps(
  exec: Executor,
  engagementId: string,
): Promise<PurgeStepRow[]> {
  return exec
    .select()
    .from(purgeManifest)
    .where(eq(purgeManifest.engagementId, engagementId))
    .orderBy(purgeManifest.startedAt);
}

/* -------------------------------------------------------- purge sweep reads */

const manifestColumns = {
  id: engagements.id,
  orgId: engagements.orgId,
  title: engagements.title,
  clientOrgName: engagements.clientOrgName,
  status: engagements.status,
};

/**
 * The purge sweep's candidates. `status = 'archived'` here is not a second
 * definition of active — it is the DATA-MODEL index
 * `engagements (purge_at) WHERE status = 'archived'` doing its job.
 */
export async function loadPurgeCandidates(
  exec: Executor,
  now: Date,
): Promise<ManifestEngagementRow[]> {
  return exec
    .select(manifestColumns)
    .from(engagements)
    .where(
      and(
        eq(engagements.status, 'archived'),
        isNotNull(engagements.purgeAt),
        lte(engagements.purgeAt, now),
      ),
    );
}

/** Everything not already purged, for a plan-everything dry run. */
export async function loadUnpurgedEngagements(
  exec: Executor,
): Promise<ManifestEngagementRow[]> {
  return exec
    .select(manifestColumns)
    .from(engagements)
    .where(ne(engagements.status, 'purged'))
    .orderBy(desc(engagements.lastActivityAt));
}

export async function loadManifestEngagement(
  exec: Executor,
  engagementId: string,
): Promise<ManifestEngagementRow | null> {
  const rows = await exec
    .select(manifestColumns)
    .from(engagements)
    .where(eq(engagements.id, engagementId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * A live count of the content rows still attached to an engagement, used only
 * to verify a purge after the fact. Deliberately a single scalar: it answers
 * "is anything left?" and nothing else.
 */
export async function countRemainingContentRows(
  exec: Executor,
  engagementId: string,
): Promise<number> {
  const rows = await exec.execute<{ n: number }>(sql`
    SELECT (
      (SELECT count(*) FROM "lanes" WHERE "engagement_id" = ${engagementId})
    + (SELECT count(*) FROM "cards" WHERE "engagement_id" = ${engagementId})
    + (SELECT count(*) FROM "reference_files" WHERE "engagement_id" = ${engagementId})
    + (SELECT count(*) FROM "client_contacts" WHERE "engagement_id" = ${engagementId})
    )::int AS n
  `);
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: { n: number }[] }).rows ?? []);
  return list[0]?.n ?? 0;
}

/** Contacts on an engagement, by id — the client export needs no more than this. */
export async function loadContactEmails(
  exec: Executor,
  engagementIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (engagementIds.length === 0) return new Map();
  const rows = await exec
    .select({ engagementId: clientContacts.engagementId, email: clientContacts.email })
    .from(clientContacts)
    .where(inArray(clientContacts.engagementId, [...engagementIds]));
  const out = new Map<string, string[]>();
  for (const row of rows) {
    const list = out.get(row.engagementId) ?? [];
    list.push(row.email);
    out.set(row.engagementId, list);
  }
  return out;
}
