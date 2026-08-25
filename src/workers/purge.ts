/**
 * THE PURGE WORKER — the one file in this repository permitted to delete an
 * `asset_version` (INV-4's sanctioned exception, PHASE-6 INVARIANTS). The
 * invariant suite scans every other file for a delete against that table and
 * fails the build on one, so this must stay the only place it happens.
 *
 * ## What INV-7 requires, and where each part lives
 *
 *   "Purge destroys all object bytes and content rows for an engagement and
 *    leaves exactly one `purge_certificate`."
 *
 * - *All content rows* — enumerated by `TABLE_DISPOSITION`, which classifies
 *   every table in the schema, so a table added in a later phase cannot quietly
 *   escape the purge.
 * - *All object bytes* — the manifest is built from the database keys **and**
 *   the bucket listing, so an orphaned object with no row still gets deleted.
 * - *Exactly one certificate* — a UNIQUE index on `purge_certificates
 *   (engagement_id)`, plus an `ON CONFLICT DO NOTHING` insert and a count
 *   assertion inside the same transaction. Never zero, never two, on any retry
 *   path, without the worker having to remember.
 *
 * ## Idempotent and resumable, because the alternative is worse
 *
 * RUNBOOK §6 is unambiguous: **rerunning a half-finished purge is the correct
 * response.** The failure mode this design exists to prevent is not "it ran
 * twice" — it is someone at 3am deciding a rerun is too dangerous and leaving an
 * engagement with its objects deleted and no certificate. Content gone with no
 * certificate is the only unrecoverable outcome.
 *
 * Four checkpointed steps, each recorded before it acts:
 *
 *   1. `manifest`  — enumerate. Destroys nothing; safe to repeat. Stored, so a
 *                    resume after step 3 still knows what was there.
 *   2. `objects`   — delete bytes. A key already gone is success, not an error.
 *   3. `content`   — delete rows **and** write the certificate, one transaction.
 *                    Either both happened or neither did; there is no window.
 *   4. `finalize`  — mark the engagement `purged`. The tombstone (ADR-007).
 *
 * ## No purge runs without four warnings on record
 *
 * `assertWarned()` is checked twice: once before any step, and again *inside*
 * the step-3 transaction, immediately before the first DELETE. The second check
 * is not redundant — it is the one that cannot be bypassed by a future caller
 * that reaches step 3 by some path the first check does not guard. A silent
 * purge manufactures a contract breach for the agency with its own client, and
 * that is the failure this whole subsystem exists to prevent.
 */

import { and, eq, inArray, like, sql } from 'drizzle-orm';
import type { Database, Executor } from '@/db/types';
import {
  approvals,
  assetVersions,
  auditLog,
  authVerificationTokens,
  cards,
  clientContacts,
  comments,
  engagements,
  lanes,
  purgeCertificates,
  purgeManifest,
  referenceFiles,
  revisionNotes,
  stateTransitions,
  type PurgeStep,
  type PurgeStepStatus,
} from '@/db/schema';
import { clientTokenIdentifierPrefixes } from '@/domain/engagement/client-token-identity';
import {
  canSignCertificates,
  signCertificate,
  CERTIFICATE_STATEMENT,
  type CertificatePayload,
} from '@/domain/retention/certificate';
import {
  buildPurgeManifest,
  manifestSha256,
  RETAINED_AUDIT_ACTIONS_SQL,
  type ManifestEngagementRow,
  type PurgeManifestValue,
} from '@/domain/retention/manifest';
import { REQUIRED_WARNINGS } from '@/domain/retention/schedule';
import {
  countCertificates,
  countWarningsOnRecord,
  loadCertificate,
  loadManifestEngagement,
  loadPurgeSteps,
  type CertificateRow,
} from '@/db/queries/retention';
import { log, errorText } from './logger';

/* --------------------------------------------------------------- refusals */

export type PurgeRefusalReason =
  | 'not_found'
  | 'not_warned'
  | 'not_due'
  | 'no_signing_key'
  | 'wrong_status';

/**
 * A refusal is not a failure. It means the purge decided not to destroy
 * anything, which is always the safe outcome and always worth saying out loud.
 */
export class PurgeRefused extends Error {
  readonly reason: PurgeRefusalReason;
  readonly engagementId: string;

  constructor(reason: PurgeRefusalReason, engagementId: string, message: string) {
    super(message);
    this.name = 'PurgeRefused';
    this.reason = reason;
    this.engagementId = engagementId;
  }
}

/**
 * The guard PHASE-6 asks for in the worker rather than in a comment.
 *
 * Counts `retention.warned` rows in `audit_log` — the same query RUNBOOK §6
 * tells an operator to run, so the guard and the triage procedure can never
 * disagree about whether someone was warned.
 */
export async function assertWarned(exec: Executor, engagementId: string): Promise<number> {
  const warnings = await countWarningsOnRecord(exec, engagementId);
  if (warnings < REQUIRED_WARNINGS) {
    throw new PurgeRefused(
      'not_warned',
      engagementId,
      `refusing to purge: ${String(warnings)} of ${String(REQUIRED_WARNINGS)} retention warnings ` +
        'are on record. A purge nobody was warned about manufactures a contract breach ' +
        'for the agency with its own client (RUNBOOK §6).',
    );
  }
  return warnings;
}

/* ------------------------------------------------------------ dependencies */

/**
 * Object storage, injected. The worker is testable against a fake bucket, and
 * — the reason that matters — a plan run with no object-store credentials still
 * produces a manifest from the database keys instead of dying.
 */
export interface ObjectStore {
  list(engagementId: string): Promise<{ keys: string[]; listed: boolean }>;
  remove(keys: readonly string[]): Promise<number>;
}

export interface PurgeDeps {
  readonly db: Database;
  readonly store: ObjectStore;
  readonly env: NodeJS.ProcessEnv;
  /** Sends the certificate to both sides. Optional: a CLI run may not want to. */
  readonly onCertificate?: (
    certificate: CertificateRow,
    engagement: ManifestEngagementRow,
  ) => Promise<void>;
}

/* -------------------------------------------------------------- checkpoints */

async function markStep(
  exec: Executor,
  engagementId: string,
  step: PurgeStep,
  status: PurgeStepStatus,
  extra: {
    manifestSha256?: string;
    manifest?: PurgeManifestValue;
    objectCount?: number;
    totalBytes?: number;
    error?: string | null;
    now: Date;
  },
): Promise<void> {
  await exec
    .insert(purgeManifest)
    .values({
      engagementId,
      step,
      status,
      manifestSha256: extra.manifestSha256 ?? null,
      manifest: extra.manifest ?? null,
      objectCount: extra.objectCount ?? null,
      totalBytes: extra.totalBytes ?? null,
      startedAt: extra.now,
      finishedAt: status === 'running' ? null : extra.now,
      error: extra.error ?? null,
    })
    .onConflictDoUpdate({
      target: [purgeManifest.engagementId, purgeManifest.step],
      set: {
        status,
        ...(extra.manifestSha256 === undefined ? {} : { manifestSha256: extra.manifestSha256 }),
        ...(extra.manifest === undefined ? {} : { manifest: extra.manifest }),
        ...(extra.objectCount === undefined ? {} : { objectCount: extra.objectCount }),
        ...(extra.totalBytes === undefined ? {} : { totalBytes: extra.totalBytes }),
        finishedAt: status === 'running' ? null : extra.now,
        error: extra.error ?? null,
      },
    });
}

async function completedSteps(exec: Executor, engagementId: string): Promise<Set<PurgeStep>> {
  const rows = await loadPurgeSteps(exec, engagementId);
  return new Set(rows.filter((r) => r.status === 'done').map((r) => r.step));
}

/**
 * The stored manifest, if step 1 already completed.
 *
 * Reusing it rather than rebuilding is a correctness requirement, not an
 * optimisation: after step 3 the rows it counted are gone, so a rebuild would
 * produce an empty manifest and a certificate claiming nothing was destroyed.
 */
async function storedManifest(
  exec: Executor,
  engagementId: string,
): Promise<PurgeManifestValue | null> {
  const rows = await loadPurgeSteps(exec, engagementId);
  const step = rows.find((r) => r.step === 'manifest' && r.status === 'done');
  if (!step || step.manifest === null || typeof step.manifest !== 'object') return null;
  return step.manifest as PurgeManifestValue;
}

/* -------------------------------------------------------------------- plan */

export interface PurgePlan {
  readonly engagement: ManifestEngagementRow;
  readonly manifest: PurgeManifestValue;
  readonly warningsOnRecord: number;
  readonly warningsRequired: number;
  readonly wouldRefuse: PurgeRefusalReason | null;
  readonly alreadyCertified: boolean;
  readonly resumeFrom: PurgeStep | null;
}

/**
 * The dry run. **Destroys nothing and writes nothing** — not even a checkpoint
 * row, because CI diffs every table's row count across a `purge:plan` and a
 * bookkeeping insert would fail that check for the right reason.
 */
export async function planPurge(
  deps: PurgeDeps,
  engagementId: string,
  now: Date,
): Promise<PurgePlan> {
  const engagement = await loadManifestEngagement(deps.db, engagementId);
  if (!engagement) {
    throw new PurgeRefused('not_found', engagementId, 'no such engagement');
  }

  const bucket = await deps.store.list(engagementId);
  const stored = await storedManifest(deps.db, engagementId);
  const manifest = stored ?? (await buildPurgeManifest(deps.db, engagement, bucket, now));

  const warningsOnRecord = await countWarningsOnRecord(deps.db, engagementId);
  const certificate = await loadCertificate(deps.db, engagementId);
  const done = await completedSteps(deps.db, engagementId);

  let wouldRefuse: PurgeRefusalReason | null = null;
  if (warningsOnRecord < REQUIRED_WARNINGS) wouldRefuse = 'not_warned';
  else if (!canSignCertificates(deps.env)) wouldRefuse = 'no_signing_key';
  else if (engagement.status !== 'archived' && engagement.status !== 'purged') {
    wouldRefuse = 'wrong_status';
  }

  const order: PurgeStep[] = ['manifest', 'objects', 'content', 'finalize'];
  const resumeFrom = order.find((step) => !done.has(step)) ?? null;

  log.info('purge.planned', {
    engagementId,
    objectCount: manifest.objectCount,
    totalBytes: manifest.totalBytes,
    contentRows: manifest.contentRowTotal,
    warningsOnRecord,
    wouldRefuse,
  });

  return {
    engagement,
    manifest,
    warningsOnRecord,
    warningsRequired: REQUIRED_WARNINGS,
    wouldRefuse,
    alreadyCertified: certificate !== null,
    resumeFrom,
  };
}

/* --------------------------------------------------------------- the purge */

export interface PurgeResult {
  readonly engagementId: string;
  readonly outcome: 'purged' | 'already_purged';
  readonly certificate: CertificateRow;
  readonly objectsDeleted: number;
  readonly resumedFrom: PurgeStep | null;
}

export interface PurgeOptions {
  /**
   * Skip the "is it due?" check. The sweep never sets it; the CLI does, because
   * an operator resuming a half-finished purge at 3am is acting on an
   * engagement whose date has already passed and whose status may already be
   * `purged`.
   */
  readonly resume?: boolean;
}

export async function purgeEngagement(
  deps: PurgeDeps,
  engagementId: string,
  now: Date,
  options: PurgeOptions = {},
): Promise<PurgeResult> {
  const engagement = await loadManifestEngagement(deps.db, engagementId);
  if (!engagement) throw new PurgeRefused('not_found', engagementId, 'no such engagement');

  /* --- guards, before anything is touched ------------------------------- */

  // Warnings first, always. This is the check PHASE-6 asks for in the worker.
  const warnings = await assertWarned(deps.db, engagementId);

  if (!canSignCertificates(deps.env)) {
    throw new PurgeRefused(
      'no_signing_key',
      engagementId,
      'CERTIFICATE_SIGNING_KEY is not set. A purge that cannot sign its certificate ' +
        'must not run — content gone with no verifiable certificate is the one ' +
        'unrecoverable outcome (RUNBOOK §6).',
    );
  }

  if (engagement.status !== 'archived' && engagement.status !== 'purged') {
    throw new PurgeRefused(
      'wrong_status',
      engagementId,
      `refusing to purge an engagement whose status is '${engagement.status}'. ` +
        'Purge follows archive; it does not replace it.',
    );
  }

  if (!options.resume) {
    const due = await isDue(deps.db, engagementId, now);
    if (!due) {
      throw new PurgeRefused(
        'not_due',
        engagementId,
        'purge_at is null or in the future. Pass --resume to act on an engagement ' +
          'whose purge is already in progress.',
      );
    }
  }

  /* --- already done? ---------------------------------------------------- */

  const existing = await loadCertificate(deps.db, engagementId);
  const done = await completedSteps(deps.db, engagementId);
  if (existing && done.has('finalize')) {
    log.info('purge.completed', {
      engagementId,
      outcome: 'already_purged',
      certificateId: existing.id,
    });
    return {
      engagementId,
      outcome: 'already_purged',
      certificate: existing,
      objectsDeleted: 0,
      resumedFrom: null,
    };
  }

  const order: PurgeStep[] = ['manifest', 'objects', 'content', 'finalize'];
  const resumedFrom = order.find((step) => !done.has(step)) ?? null;

  log.info('purge.started', {
    engagementId,
    resumedFrom,
    warningsOnRecord: warnings,
    resume: options.resume === true,
  });

  try {
    /* --- step 1: manifest ----------------------------------------------- */

    let manifest = await storedManifest(deps.db, engagementId);
    if (!manifest) {
      await markStep(deps.db, engagementId, 'manifest', 'running', { now });
      const bucket = await deps.store.list(engagementId);
      manifest = await buildPurgeManifest(deps.db, engagement, bucket, now);
      await markStep(deps.db, engagementId, 'manifest', 'done', {
        manifestSha256: manifestSha256(manifest),
        manifest,
        objectCount: manifest.objectCount,
        totalBytes: manifest.totalBytes,
        now,
      });
      log.info('purge.manifest', {
        engagementId,
        objectCount: manifest.objectCount,
        totalBytes: manifest.totalBytes,
        bucketListed: manifest.bucketListed,
      });
    }
    const sha = manifestSha256(manifest);

    /* --- step 2: object bytes -------------------------------------------- */

    let objectsDeleted = 0;
    if (!done.has('objects')) {
      await markStep(deps.db, engagementId, 'objects', 'running', { now });
      // Keys already gone count as success: this step is rerun by design, and a
      // second pass over a bucket it already emptied must not look like failure.
      objectsDeleted = await deps.store.remove(manifest.objects.map((o) => o.key));
      await markStep(deps.db, engagementId, 'objects', 'done', {
        objectCount: objectsDeleted,
        now,
      });
      log.info('purge.objects_deleted', {
        engagementId,
        requested: manifest.objectCount,
        deleted: objectsDeleted,
      });
    }

    /* --- step 3: content rows and the certificate, one transaction -------- */

    if (!done.has('content')) {
      await markStep(deps.db, engagementId, 'content', 'running', { now });
      await deps.db.transaction(async (tx) => {
        /**
         * Checked again, inside the transaction, immediately before the first
         * DELETE. Not redundant: this is the check a future caller that reaches
         * step 3 by some other path cannot get past.
         */
        await assertWarned(tx, engagementId);

        await destroyContent(tx, engagementId);

        const payload: CertificatePayload = {
          engagementId,
          orgId: engagement.orgId,
          engagementTitle: engagement.title,
          clientOrgName: engagement.clientOrgName,
          objectCount: manifest.objectCount,
          totalBytes: manifest.totalBytes,
          manifestSha256: sha,
          purgedAt: now,
          statement: CERTIFICATE_STATEMENT,
        };

        await tx
          .insert(purgeCertificates)
          .values({
            engagementId,
            orgId: payload.orgId,
            engagementTitle: payload.engagementTitle,
            clientOrgName: payload.clientOrgName,
            objectCount: payload.objectCount,
            totalBytes: payload.totalBytes,
            manifestSha256: payload.manifestSha256,
            statement: payload.statement,
            purgedAt: payload.purgedAt,
            certificateSignature: signCertificate(payload, deps.env),
          })
          // A rerun that reaches here with a certificate already written must
          // not create a second one. The unique index would reject it; this
          // makes the rerun succeed rather than error.
          .onConflictDoNothing({ target: purgeCertificates.engagementId });

        const count = await countCertificates(tx, engagementId);
        if (count !== 1) {
          // Rolls the whole transaction back, content included. INV-7 is not a
          // thing to repair afterwards.
          throw new Error(
            `INV-7: expected exactly one purge certificate, found ${String(count)}. ` +
              'Rolled back; nothing was destroyed.',
          );
        }

        await markStep(tx, engagementId, 'content', 'done', { now });
      });
      log.info('purge.content_deleted', { engagementId, manifestSha256: sha });
    }

    /* --- step 4: the tombstone -------------------------------------------- */

    if (!done.has('finalize')) {
      await markStep(deps.db, engagementId, 'finalize', 'running', { now });
      await deps.db
        .update(engagements)
        .set({ status: 'purged' })
        .where(eq(engagements.id, engagementId));
      await deps.db.insert(auditLog).values({
        orgId: engagement.orgId,
        engagementId,
        actor: 'system',
        action: 'purge.completed',
        subjectType: 'engagement',
        subjectId: engagementId,
        metadata: {
          objectCount: manifest.objectCount,
          totalBytes: manifest.totalBytes,
          manifestSha256: sha,
        },
        occurredAt: now,
      });
      await markStep(deps.db, engagementId, 'finalize', 'done', { now });
    }

    const certificate = await loadCertificate(deps.db, engagementId);
    if (!certificate) {
      throw new Error(
        'INV-7: purge finished with no certificate. Do not rerun blindly — read RUNBOOK §6.',
      );
    }

    if (deps.onCertificate) {
      try {
        await deps.onCertificate(certificate, engagement);
      } catch (error) {
        // The certificate exists and is the artifact; a failed send is a
        // resend, not a failed purge.
        log.warn('purge.certificate_send_failed', { engagementId, error: errorText(error) });
      }
    }

    log.info('purge.completed', {
      engagementId,
      outcome: 'purged',
      certificateId: certificate.id,
      objectCount: manifest.objectCount,
      totalBytes: manifest.totalBytes,
      objectsDeleted,
      manifestSha256: sha,
      resumedFrom,
    });

    return { engagementId, outcome: 'purged', certificate, objectsDeleted, resumedFrom };
  } catch (error) {
    const message = errorText(error);
    log.error('purge.failed', { engagementId, error: message, resumedFrom });
    await recordFailure(deps.db, engagementId, message, now);
    throw error;
  }
}

/**
 * Records where it stopped so `SELECT step, status, ... FROM purge_manifest` —
 * the query RUNBOOK §6 opens with — has something to say.
 */
async function recordFailure(
  db: Database,
  engagementId: string,
  message: string,
  now: Date,
): Promise<void> {
  try {
    const rows = await loadPurgeSteps(db, engagementId);
    const running = rows.find((r) => r.status === 'running');
    if (running) {
      await markStep(db, engagementId, running.step, 'failed', { error: message, now });
    }
  } catch (error) {
    log.error('purge.checkpoint_write_failed', { engagementId, error: errorText(error) });
  }
}

async function isDue(exec: Executor, engagementId: string, now: Date): Promise<boolean> {
  const rows = await exec
    .select({ purgeAt: engagements.purgeAt })
    .from(engagements)
    .where(eq(engagements.id, engagementId))
    .limit(1);
  const purgeAt = rows[0]?.purgeAt ?? null;
  return purgeAt !== null && purgeAt.getTime() <= now.getTime();
}

/* ------------------------------------------------------------ the deletion */

/**
 * Every content row for one engagement, in foreign-key order.
 *
 * Deleted explicitly rather than left to `ON DELETE CASCADE`. Cascades would
 * work, and they would also make the set of destroyed tables invisible: what a
 * purge takes would be a property of the schema's foreign keys rather than
 * something written down, reviewable, and checkable against
 * `TABLE_DISPOSITION`. For the one operation in this product that cannot be
 * undone, the list is worth spelling out.
 *
 * The engagement row itself is **not** deleted. It survives as the tombstone
 * (ADR-007), which is what a customer's "we should not have let that expire"
 * call has to work from. Removing it at +30d is Phase 6's out-of-scope half and
 * is blocked on PRD §9.
 */
async function destroyContent(tx: Executor, engagementId: string): Promise<void> {
  const cardRows = await tx
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.engagementId, engagementId));
  const cardIds = cardRows.map((r) => r.id);

  const versionRows =
    cardIds.length === 0
      ? []
      : await tx
          .select({ id: assetVersions.id })
          .from(assetVersions)
          .where(inArray(assetVersions.cardId, cardIds));
  const versionIds = versionRows.map((r) => r.id);

  if (versionIds.length > 0) {
    await tx.delete(approvals).where(inArray(approvals.assetVersionId, versionIds));
    await tx.delete(revisionNotes).where(inArray(revisionNotes.assetVersionId, versionIds));
  }

  if (cardIds.length > 0) {
    await tx.delete(comments).where(inArray(comments.cardId, cardIds));
    await tx.delete(stateTransitions).where(inArray(stateTransitions.cardId, cardIds));
    /**
     * INV-4's one sanctioned exception. `asset_versions` is append-only
     * everywhere else in the tree and the invariant suite proves it by scanning
     * every other file for exactly this call.
     */
    await tx.delete(assetVersions).where(inArray(assetVersions.cardId, cardIds));
    await tx.delete(cards).where(inArray(cards.id, cardIds));
  }

  await tx.delete(lanes).where(eq(lanes.engagementId, engagementId));
  await tx.delete(referenceFiles).where(eq(referenceFiles.engagementId, engagementId));
  await tx.delete(clientContacts).where(eq(clientContacts.engagementId, engagementId));

  /**
   * The client contact's email address survives in `auth_verification_tokens`
   * otherwise — the identifier of an outstanding one-time code, or of a
   * rate-limit counter, is literally `client:{engagementId}:{email}`.
   *
   * `client_contacts` is destroyed two lines above and the certificate says
   * every trace of the engagement is gone, so leaving these makes the
   * certificate false in the most sensitive column available. It is not a
   * fifteen-minute window either: rows for one identifier are swept only when
   * that same identifier is used again, and after a purge it never is, so an
   * abandoned code outlives the engagement for as long as the table does.
   */
  for (const prefix of clientTokenIdentifierPrefixes(engagementId)) {
    await tx
      .delete(authVerificationTokens)
      .where(like(authVerificationTokens.identifier, `${prefix}%`));
  }

  /**
   * The audit log goes with the engagement **except for retention actions**
   * (DATA-MODEL). Those are the four warnings and the purge's own record: they
   * are the evidence the purge was warned about and happened, and RUNBOOK §6
   * triages against them after the fact.
   */
  await tx
    .delete(auditLog)
    .where(and(eq(auditLog.engagementId, engagementId), sql`NOT ${RETAINED_AUDIT_ACTIONS_SQL}`));
}
