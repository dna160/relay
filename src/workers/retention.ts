/**
 * The retention sweeps: archive, warn, and enqueue purges.
 *
 * Three jobs, deliberately separate. The archive sweep decides *status*; the
 * warning sweep decides *notices*; the purge sweep decides *what is due*. A
 * single job doing all three would mean a failure in the mail provider stopping
 * archiving, or worse, a failure in archiving being the thing that let a purge
 * proceed unwarned.
 *
 * The order they run in is the order they are defined here, and the guard that
 * makes the order not matter is in the purge worker: four warnings on record or
 * it refuses.
 */

import { db } from '@/db/client';
import { auditLog } from '@/db/schema';
import type { Executor } from '@/db/types';
import {
  countWarningsOnRecord,
  loadArchiveCandidates,
  loadPurgeCandidates,
  loadRetentionRow,
  loadWarnableEngagements,
  loadWarningAudience,
  loadWarningsOnRecord,
  warningSubjectType,
  RETENTION_WARNED_ACTION,
  type RetentionRow,
} from '@/db/queries/retention';
import { archiveEngagement } from '@/domain/engagement/lifecycle';
import {
  daysToPurge,
  retentionPolicyFrom,
  selectForArchive,
  warningsDue,
  REQUIRED_WARNINGS,
} from '@/domain/retention/schedule';
import { composeBothWarnings, composeCertificateNotice } from '@/domain/retention/warn';
import type { ManifestEngagementRow } from '@/domain/retention/manifest';
import type { CertificateRow } from '@/db/queries/retention';
import { sendMail } from '@/lib/email';
import { clientExportUrl, agencyWorkspaceUrl } from '@/lib/links';
import { QUEUES, getBoss } from './queue';
import { log, errorText } from './logger';

/** Dev-only overrides, read once. RUNBOOK §2 says so twice, and means it. */
export function retentionPolicy() {
  return retentionPolicyFrom(process.env);
}

/* ------------------------------------------------------------- the archive */

/**
 * `last_activity_at + 30d -> archived`, read-only thereafter.
 *
 * The status decision is `selectForArchive()`, which is `isRunning()` minus
 * `isEngagementActive()` — the same pair the billing gate calls. There is no
 * `status = 'active'` predicate in this file or in the query it uses (INV-8);
 * an engagement that stopped counting against the plan is exactly the one whose
 * countdown has started, and that is one fact with one implementation.
 */
export async function runArchiveSweep(now = new Date()): Promise<{ archived: number; warned: number }> {
  const candidates = await loadArchiveCandidates(db, now);
  const due = selectForArchive(candidates, now);

  let archived = 0;
  let warned = 0;

  for (const row of due) {
    try {
      await db.transaction(async (tx) => {
        await archiveEngagement(tx, row.id, now);
      });
      archived += 1;
      log.info('retention.archived', {
        engagementId: row.id,
        orgId: row.orgId,
        purgeAt: row.purgeAt?.toISOString() ?? null,
      });
      // The first of the four notices goes out with the archive itself, not on
      // the next sweep — "your workspace is now read-only" and "it will be
      // deleted in 30 days" are the same piece of news.
      const sent = await warnEngagement({ ...row, status: 'archived' }, now);
      warned += sent;
    } catch (error) {
      log.error('retention.archive_failed', { engagementId: row.id, error: errorText(error) });
    }
  }

  return { archived, warned };
}

/* ------------------------------------------------------------- the warnings */

/**
 * Sends every notice that is due and not yet on record, to **both** sides.
 *
 * Idempotent twice over: the sweep skips offsets already in `audit_log`, and a
 * partial unique index on `(engagement_id, subject_type) WHERE action =
 * 'retention.warned'` makes a duplicate impossible even if two sweeps overlap.
 * That matters because the purge guard counts these rows — a retry that could
 * write the same notice twice could make two warnings look like four.
 */
export async function runWarningSweep(now = new Date()): Promise<{ warned: number }> {
  const rows = await loadWarnableEngagements(db);
  let warned = 0;
  for (const row of rows) {
    try {
      warned += await warnEngagement(row, now);
    } catch (error) {
      log.error('retention.warn_failed', { engagementId: row.id, error: errorText(error) });
    }
  }
  return { warned };
}

/**
 * One engagement's due notices.
 *
 * The audit row is written **after** the sends succeed. If the mail provider is
 * down, nothing is recorded, the sweep retries on its next run, and the purge
 * guard still counts fewer than four — which is exactly the behaviour RUNBOOK
 * §5 describes for `retention.warn_failed`: act, because a purge must not
 * proceed without four warnings.
 */
export async function warnEngagement(row: RetentionRow, now: Date): Promise<number> {
  if (row.archiveAt === null || row.purgeAt === null) return 0;

  const onRecord = await loadWarningsOnRecord(db, row.id);
  const alreadyWarned = new Set<number>();
  for (const subject of onRecord) {
    const offset = Number(subject.split(':')[1]);
    if (Number.isInteger(offset)) alreadyWarned.add(offset);
  }

  const due = warningsDue(row.archiveAt, row.purgeAt, alreadyWarned, now);
  if (due.length === 0) return 0;

  const audience = await loadWarningAudience(db, row.id, row.orgId);
  let sent = 0;

  for (const warning of due) {
    const composed = composeBothWarnings({
      engagementTitle: row.title,
      clientOrgName: row.clientOrgName,
      agencyName: row.agencyName,
      daysToPurge: warning.daysToPurge,
      purgeAt: row.purgeAt,
      exportUrl: clientExportUrl(row.id),
      workspaceUrl: agencyWorkspaceUrl(row.id),
    });

    // Both sides, every time. A notice that reaches only one party is the one
    // that manufactures a breach — see domain/retention/warn.ts.
    for (const recipient of audience.agency) {
      await sendMail({ to: recipient.email, ...composed.agency });
    }
    for (const recipient of audience.client) {
      await sendMail({ to: recipient.email, ...composed.client });
    }

    await recordWarning(db, {
      engagementId: row.id,
      orgId: row.orgId,
      offsetDays: warning.offsetDays,
      daysToPurge: warning.daysToPurge,
      agencyRecipients: audience.agency.length,
      clientRecipients: audience.client.length,
      now,
    });

    sent += 1;
    log.info('retention.warned', {
      engagementId: row.id,
      orgId: row.orgId,
      offsetDays: warning.offsetDays,
      daysToPurge: warning.daysToPurge,
      agencyRecipients: audience.agency.length,
      clientRecipients: audience.client.length,
    });

    if (audience.client.length === 0) {
      // Worth a line of its own: the export link had nowhere to go, and the
      // client's copy is the one that survives the purge.
      log.warn('retention.no_client_contact', { engagementId: row.id });
    }
  }

  return sent;
}

async function recordWarning(
  exec: Executor,
  input: {
    engagementId: string;
    orgId: string;
    offsetDays: number;
    daysToPurge: number;
    agencyRecipients: number;
    clientRecipients: number;
    now: Date;
  },
): Promise<void> {
  await exec
    .insert(auditLog)
    .values({
      orgId: input.orgId,
      engagementId: input.engagementId,
      actor: 'system',
      action: RETENTION_WARNED_ACTION,
      subjectType: warningSubjectType(input.offsetDays),
      subjectId: input.engagementId,
      metadata: {
        offsetDays: input.offsetDays,
        daysToPurge: input.daysToPurge,
        agencyRecipients: input.agencyRecipients,
        clientRecipients: input.clientRecipients,
      },
      occurredAt: input.now,
    })
    // Two sweeps overlapping must not write the same notice twice: the purge
    // guard counts these rows.
    .onConflictDoNothing();
}

/**
 * The notice a downgrade owes, immediately.
 *
 * PHASE-6: "downgrade recomputes them and warns immediately — a downgrade never
 * purges silently." `changePlan()` does the recompute; this is the notice, and
 * it goes to **both** sides on the day the plan changed.
 *
 * It is recorded as `retention.downgraded`, **not** as `retention.warned`, and
 * that distinction is load-bearing. The purge guard counts `retention.warned`
 * rows and requires four. If a downgrade notice counted, an engagement could
 * arrive at its purge date having received three scheduled warnings and one
 * billing email, and the guard would wave it through. The downgrade notice is
 * additional to the four, never part of them.
 */
export async function sendDowngradeNotice(
  engagementIds: readonly string[],
  now: Date,
): Promise<number> {
  let sent = 0;
  for (const engagementId of engagementIds) {
    try {
      const row = await loadRetentionRow(db, engagementId);
      if (!row || row.purgeAt === null) continue;

      const days = daysToPurge(row.purgeAt, now) ?? 0;
      const composed = composeBothWarnings({
        engagementTitle: row.title,
        clientOrgName: row.clientOrgName,
        agencyName: row.agencyName,
        daysToPurge: days,
        purgeAt: row.purgeAt,
        exportUrl: clientExportUrl(row.id),
        workspaceUrl: agencyWorkspaceUrl(row.id),
      });

      const audience = await loadWarningAudience(db, row.id, row.orgId);
      for (const recipient of audience.agency) {
        await sendMail({ to: recipient.email, ...composed.agency });
      }
      for (const recipient of audience.client) {
        await sendMail({ to: recipient.email, ...composed.client });
      }

      await db.insert(auditLog).values({
        orgId: row.orgId,
        engagementId: row.id,
        actor: 'system',
        action: 'retention.downgraded',
        subjectType: 'engagement',
        subjectId: row.id,
        metadata: {
          daysToPurge: days,
          archiveAt: row.archiveAt?.toISOString() ?? null,
          purgeAt: row.purgeAt.toISOString(),
        },
        occurredAt: now,
      });

      sent += 1;
      log.info('retention.downgraded', {
        engagementId: row.id,
        orgId: row.orgId,
        daysToPurge: days,
        purgeAt: row.purgeAt.toISOString(),
      });
    } catch (error) {
      log.error('retention.warn_failed', { engagementId, error: errorText(error) });
    }
  }
  return sent;
}

/* ------------------------------------------------------------ the purge sweep */

/**
 * Enqueues one purge job per engagement that is due. It does not purge: the
 * sweep's only job is to notice, and the destructive work happens in a job with
 * its own singleton key so that a slow purge cannot be started twice.
 */
export async function runPurgeSweep(now = new Date()): Promise<{ queued: number; skipped: number }> {
  const candidates = await loadPurgeCandidates(db, now);
  const boss = await getBoss();

  let queued = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const warnings = await countWarningsOnRecord(db, candidate.id);
    if (warnings < REQUIRED_WARNINGS) {
      // The purge worker would refuse anyway. Refusing here as well means the
      // log line names the engagement before a job exists to fail.
      skipped += 1;
      log.warn('retention.purge_skipped_unwarned', {
        engagementId: candidate.id,
        warningsOnRecord: warnings,
        warningsRequired: REQUIRED_WARNINGS,
      });
      continue;
    }
    await boss.send(
      QUEUES.purgeEngagement,
      { engagementId: candidate.id },
      { singletonKey: candidate.id, retryLimit: 2, retryDelay: 300 },
    );
    queued += 1;
  }

  return { queued, skipped };
}

/* -------------------------------------------------------- certificate notice */

/**
 * The certificate, to both sides, immediately after the purge.
 *
 * The client contacts have been deleted by this point — they were content — so
 * the recipient list is captured before the purge runs and passed in. The
 * agency's own members are still there.
 */
export async function sendCertificate(
  certificate: CertificateRow,
  engagement: ManifestEngagementRow,
  recipients: readonly string[],
): Promise<void> {
  const notice = composeCertificateNotice({
    engagementTitle: certificate.engagementTitle,
    clientOrgName: certificate.clientOrgName,
    objectCount: certificate.objectCount,
    totalBytes: certificate.totalBytes,
    manifestSha256: certificate.manifestSha256,
    purgedAt: certificate.purgedAt,
    statement: certificate.statement,
    signature: certificate.certificateSignature,
  });

  for (const to of new Set(recipients)) {
    await sendMail({ to, ...notice });
  }
  log.info('purge.certificate_sent', {
    engagementId: engagement.id,
    recipients: new Set(recipients).size,
  });
}

/** Everyone who should receive the certificate, read *before* the purge. */
export async function certificateRecipients(engagementId: string, orgId: string): Promise<string[]> {
  const audience = await loadWarningAudience(db, engagementId, orgId);
  return [...audience.agency.map((a) => a.email), ...audience.client.map((c) => c.email)];
}
