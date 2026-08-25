/**
 * Phase 6 — the two tables that outlive the thing they describe.
 *
 * `purge_certificates` proves absence. It carries **no foreign key** to the
 * engagement: the whole point is that it is still readable and still verifiable
 * after the engagement's content — and, at the end of the tombstone window, the
 * engagement row itself — has been destroyed. A foreign key here would be a
 * cascade waiting to delete the only evidence that the deletion happened.
 *
 * `purge_manifest` is the checkpoint log. Purge runs in four steps and records
 * each one before it acts, so a run killed anywhere is resumable rather than
 * unrecoverable (RUNBOOK §6). It has no foreign key for the same reason.
 *
 * The `UNIQUE (engagement_id)` on the certificate is the mechanism behind
 * INV-7's "exactly one, never zero and never two". It is a database property,
 * not a discipline the worker has to remember on every retry path.
 */

import {
  bigint,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, tstz, tstzNow } from './_shared';

/** The four checkpoints of a purge, in order. See `docs/RUNBOOK.md` §6. */
export const PURGE_STEPS = ['manifest', 'objects', 'content', 'finalize'] as const;
export type PurgeStep = (typeof PURGE_STEPS)[number];

export const PURGE_STEP_STATUSES = ['running', 'done', 'failed'] as const;
export type PurgeStepStatus = (typeof PURGE_STEP_STATUSES)[number];

/**
 * Survives the purge. Proves absence, not content (DATA-MODEL).
 *
 * `statement` is the exact wording emitted at the time. It is stored rather
 * than rendered from a constant at read time because this row is a compliance
 * artifact an agency forwards to its client's legal team: if the product later
 * changes what a purge claims — PRD §9's tombstone-vs-certified-destruction
 * question is still open — a certificate already in someone's inbox must not
 * silently start saying something else.
 */
export const purgeCertificates = pgTable(
  'purge_certificates',
  {
    id: primaryId(),
    /** No FK. The row this points at is gone, or will be. */
    engagementId: uuid('engagement_id').notNull(),
    /** No FK either: an agency that closes its account does not erase its history. */
    orgId: uuid('org_id').notNull(),
    engagementTitle: text('engagement_title').notNull(),
    clientOrgName: text('client_org_name').notNull(),
    objectCount: integer('object_count').notNull(),
    totalBytes: bigint('total_bytes', { mode: 'number' }).notNull(),
    /** sha256 of the canonical manifest. Ties the certificate to what it destroyed. */
    manifestSha256: char('manifest_sha256', { length: 64 }).notNull(),
    /** The claim this certificate makes, frozen at issue time. */
    statement: text('statement').notNull(),
    purgedAt: tstzNow('purged_at'),
    /** HMAC-SHA256 over the canonical payload, `v1.<base64url>`. */
    certificateSignature: text('certificate_signature').notNull(),
  },
  (t) => ({
    /** INV-7: exactly one. Never zero, never two — enforced by the database. */
    oneCertificatePerEngagement: uniqueIndex('purge_certificates_engagement_key').on(
      t.engagementId,
    ),
    byOrg: index('purge_certificates_org_idx').on(t.orgId, t.purgedAt),
  }),
);

/**
 * One row per purge step per engagement. Written before the step acts and
 * completed after it, which is what makes "where did it stop?" a query rather
 * than an archaeology exercise.
 *
 * The step-1 row carries the manifest itself, so a resume after step 3 — when
 * the content rows it counted no longer exist — still knows what was there.
 * Rebuilding the manifest at that point would produce an empty one and a
 * certificate that claims nothing was destroyed.
 */
export const purgeManifest = pgTable(
  'purge_manifest',
  {
    id: primaryId(),
    /** No FK: the checkpoint log outlives the engagement row. */
    engagementId: uuid('engagement_id').notNull(),
    step: text('step', { enum: PURGE_STEPS }).notNull(),
    status: text('status', { enum: PURGE_STEP_STATUSES }).notNull(),
    /** Populated on the `manifest` step and read by every later step. */
    manifestSha256: char('manifest_sha256', { length: 64 }),
    manifest: jsonb('manifest'),
    objectCount: integer('object_count'),
    totalBytes: bigint('total_bytes', { mode: 'number' }),
    startedAt: tstzNow('started_at'),
    finishedAt: tstz('finished_at'),
    error: text('error'),
  },
  (t) => ({
    /** A step is attempted once per engagement and then updated in place. */
    oneRowPerStep: uniqueIndex('purge_manifest_engagement_step_key').on(t.engagementId, t.step),
    byEngagement: index('purge_manifest_engagement_idx').on(t.engagementId, t.startedAt),
  }),
);
