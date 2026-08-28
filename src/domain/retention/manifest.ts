/**
 * The purge manifest — what a purge is about to destroy, enumerated before it
 * destroys anything.
 *
 * ARCHITECTURE's non-functional requirement: "all destructive jobs are
 * dry-runnable with `--plan` and log a manifest first". This module is that
 * manifest. It is deliberately a *value*: `npm run purge:plan` prints it and
 * writes nothing, and the real purge stores the same value as its step-1
 * checkpoint so that a resume after the content is gone still knows what was
 * there (RUNBOOK §6).
 *
 * ## Every table has a disposition
 *
 * INV-7 is "purge destroys all object bytes and content rows for an
 * engagement". "All" needs a definition that cannot rot as tables are added, so
 * every table in the schema is classified here and the invariant suite checks
 * the classification against the schema rather than against a memory of it. A
 * new table with no entry is a build failure, which is the point — the failure
 * mode this guards against is a Phase 7 table that nobody remembered to purge.
 */

import type { Executor } from '@/db/types';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  approvals,
  assetVersions,
  auditLog,
  cards,
  clientContacts,
  comments,
  lanes,
  referenceFiles,
  revisionNotes,
  stateTransitions,
} from '@/db/schema';
import { countProjectAccessRows } from '../access/purge-project-access';
import { sha256Hex } from './certificate';

/**
 * What happens to each table when an engagement is purged.
 *
 * - `content` — rows are destroyed. This is what INV-7 means by "all content".
 * - `tombstone` — the row survives with `status = 'purged'` for the 30-day
 *   tombstone window (ADR-007). Scheduling its removal is blocked on PRD §9.
 * - `retained` — rows survive on purpose, because they are the evidence that
 *   the purge happened. Deleting these is the one unrecoverable outcome.
 * - `partial` — some rows go, some stay. `audit_log`: retention actions outlive
 *   the engagement, everything else goes with it (DATA-MODEL).
 *   `auth_verification_tokens`: the rows keyed to this engagement's client
 *   contacts go, because their identifiers contain those contacts' email
 *   addresses; every other row in that table belongs to an agency magic link
 *   and has nothing to do with any engagement.
 * - `unscoped` — the table has no engagement, so a purge has nothing to do here.
 */
export type TableDisposition = 'content' | 'tombstone' | 'retained' | 'partial' | 'unscoped';

export const TABLE_DISPOSITION: Readonly<Record<string, TableDisposition>> = {
  /* Destroyed. */
  approvals: 'content',
  /**
   * Phase 9. DELIVERY-PLAN §IV: "`project_memberships` rows are deleted;
   * `accounts` are not — the person outlasts the project." Membership in a
   * project that no longer exists is not a fact about a person worth keeping,
   * and leaving the rows would mean the purge left behind a list of exactly who
   * had access to the workspace it claims to have destroyed.
   */
  project_memberships: 'content',
  /**
   * Phase 9's shadow harness ledger, and the one disposition here that was a
   * judgement rather than a transcription.
   *
   * It is `content` because of what a row actually holds: `project_id`,
   * `account_id`, `legacy_user_id`, `legacy_org_id`, and a `jsonb` copy of the
   * full decision input carrying the same ids. That is a per-project record of
   * who tried to reach what, which is engagement-scoped personal data by any
   * reading — and a table that survives a purge holding the ids of a purged
   * project is precisely the thing ADR-022's certificate should never have to
   * explain. Diagnostics do not get an exemption from a deletion promise.
   *
   * The counts the dashboard needs survive anyway: a purged project's rows are
   * gone, and so is any disagreement they represented. If the streak needs to
   * be provable across a purge later, that is an aggregate to write down, not a
   * reason to keep the identifiers.
   */
  access_shadow_disagreements: 'content',
  asset_versions: 'content',
  cards: 'content',
  client_contacts: 'content',
  comments: 'content',
  lanes: 'content',
  reference_files: 'content',
  revision_notes: 'content',
  state_transitions: 'content',

  /* Survives as a tombstone, marked purged. */
  engagements: 'tombstone',

  /* Retention rows survive; everything else about the engagement goes. */
  audit_log: 'partial',

  /* The evidence. */
  purge_certificates: 'retained',
  purge_manifest: 'retained',

  /**
   * Client one-time codes and their rate-limit counters are keyed by
   * `client:{engagementId}:{email}` and go with the engagement; agency
   * magic-link rows in the same table do not.
   */
  auth_verification_tokens: 'partial',
  /**
   * Phase 10. An invitation is scoped to whatever it names: an org invite
   * outlives every project in the org, and a project invite must not outlive the
   * project it offers access to — it is an unredeemed key to a workspace the
   * certificate says was destroyed, and it carries the invited person's address.
   *
   * `partial` rather than `content` because the two kinds have to be told apart
   * by `target_kind`, which is a predicate rather than a scope. `destroyContent`
   * in the purge worker holds the predicate.
   */
  invites: 'partial',

  /* Not engagement-scoped; a purge has no business here. */
  auth_accounts: 'unscoped',
  /**
   * Phase 9's identity graph. The person outlasts the project (ADR-021 §1):
   * an account is never owned by an organization, let alone by one engagement,
   * and destroying it would take with it every *other* project that person is
   * still working on. `identities` and `org_memberships` follow the account for
   * the same reason, and `teams`/`team_members` belong to the organization —
   * a team survives the projects it was granted to, and the grants themselves
   * are `project_memberships` rows, which do not.
   */
  accounts: 'unscoped',
  identities: 'unscoped',
  org_memberships: 'unscoped',
  teams: 'unscoped',
  team_members: 'unscoped',
  auth_sessions: 'unscoped',
  /**
   * Phase 10. A sign-in token proves control of an *address*; it names no
   * engagement and never can — there is no column on it that could. DELIVERY-PLAN
   * §IV's phrase is "`invites`, and `signin_tokens` scoped to the project", and
   * for this table the qualifier selects nothing, which is the honest reading
   * rather than an omission. It expires in fifteen minutes and is swept by the
   * next issuance for the same address.
   */
  signin_tokens: 'unscoped',
  organizations: 'unscoped',
  templates: 'unscoped',
  users: 'unscoped',
};

/**
 * `audit_log` actions that outlive the engagement they describe.
 *
 * DATA-MODEL: "purged with the engagement except for retention actions". These
 * are what RUNBOOK §6 triages against, so they have to still be there after the
 * purge that they are the record of.
 */
export function isRetentionAction(action: string): boolean {
  return (
    action.startsWith('retention.') || action.startsWith('purge.') || action === 'engagement.archived'
  );
}

/** SQL form of `isRetentionAction`, for the one DELETE that has to exclude them. */
export const RETAINED_AUDIT_ACTIONS_SQL = sql`(
  "audit_log"."action" LIKE 'retention.%'
  OR "audit_log"."action" LIKE 'purge.%'
  OR "audit_log"."action" = 'engagement.archived'
)`;

/** One object in storage, as the manifest records it. */
export interface ManifestObject {
  readonly key: string;
  readonly sizeBytes: number;
  /** Where the key came from: a version, a shelf file, or the bucket listing. */
  readonly source: 'asset_version' | 'reference_file' | 'bucket';
}

export interface ManifestRowCount {
  readonly table: string;
  readonly rows: number;
}

export interface PurgeManifestValue {
  readonly engagementId: string;
  readonly orgId: string;
  readonly engagementTitle: string;
  readonly clientOrgName: string;
  readonly status: string;
  readonly builtAt: string;
  readonly objects: readonly ManifestObject[];
  readonly objectCount: number;
  readonly totalBytes: number;
  readonly rowCounts: readonly ManifestRowCount[];
  readonly contentRowTotal: number;
  /** True when the bucket could not be listed and keys came from the database only. */
  readonly bucketListed: boolean;
}

/**
 * Deterministic manifest text. The certificate's `manifest_sha256` is taken
 * over exactly this, which is what makes the certificate falsifiable: anyone
 * holding the manifest can recompute the hash and check it against the
 * certificate they were sent.
 */
export function canonicalManifest(manifest: PurgeManifestValue): string {
  const lines: string[] = [
    `engagement\t${manifest.engagementId}`,
    `org\t${manifest.orgId}`,
    `title\t${manifest.engagementTitle}`,
    `client\t${manifest.clientOrgName}`,
    `objects\t${String(manifest.objectCount)}`,
    `bytes\t${String(manifest.totalBytes)}`,
  ];
  for (const object of [...manifest.objects].sort((a, b) => a.key.localeCompare(b.key))) {
    lines.push(`object\t${object.key}\t${String(object.sizeBytes)}`);
  }
  for (const row of [...manifest.rowCounts].sort((a, b) => a.table.localeCompare(b.table))) {
    lines.push(`rows\t${row.table}\t${String(row.rows)}`);
  }
  return lines.join('\n');
}

export function manifestSha256(manifest: PurgeManifestValue): string {
  return sha256Hex(canonicalManifest(manifest));
}

/** The tables a manifest counts, in the order the purge deletes them. */
export const CONTENT_TABLES_IN_DELETE_ORDER = [
  'approvals',
  'revision_notes',
  'comments',
  'state_transitions',
  'asset_versions',
  'cards',
  'lanes',
  'reference_files',
  'client_contacts',
  'audit_log',
] as const;

export interface ManifestEngagementRow {
  readonly id: string;
  readonly orgId: string;
  readonly title: string;
  readonly clientOrgName: string;
  readonly status: string;
}

/**
 * Builds the manifest. Reads only — this function is what `--plan` runs, and
 * `--plan` destroys nothing, so nothing here may write.
 *
 * `bucketKeys` is passed in rather than fetched: listing the bucket is
 * infrastructure and the domain layer does not reach for it (INV-9). It is also
 * the half that can legitimately be unavailable — a plan run in CI has no
 * object-store credentials — and a manifest built from database keys alone is
 * still worth printing, provided it says so.
 */
export async function buildPurgeManifest(
  exec: Executor,
  engagement: ManifestEngagementRow,
  bucketKeys: { keys: readonly string[]; listed: boolean },
  now: Date,
): Promise<PurgeManifestValue> {
  const cardIds = (
    await exec.select({ id: cards.id }).from(cards).where(eq(cards.engagementId, engagement.id))
  ).map((r) => r.id);

  const versionRows =
    cardIds.length === 0
      ? []
      : await exec
          .select({
            id: assetVersions.id,
            storageKey: assetVersions.storageKey,
            sizeBytes: assetVersions.sizeBytes,
          })
          .from(assetVersions)
          .where(inArray(assetVersions.cardId, cardIds));

  const shelfRows = await exec
    .select({ storageKey: referenceFiles.storageKey, sizeBytes: referenceFiles.sizeBytes })
    .from(referenceFiles)
    .where(eq(referenceFiles.engagementId, engagement.id));

  /**
   * Database first, bucket second. A key the database knows about but the
   * bucket listing missed still gets a delete attempt; a key in the bucket that
   * no row points at — an orphan from an interrupted upload — is exactly what a
   * purge must not leave behind, so it is enumerated too.
   */
  const byKey = new Map<string, ManifestObject>();
  for (const row of versionRows) {
    byKey.set(row.storageKey, {
      key: row.storageKey,
      sizeBytes: row.sizeBytes,
      source: 'asset_version',
    });
  }
  for (const row of shelfRows) {
    if (!byKey.has(row.storageKey)) {
      byKey.set(row.storageKey, {
        key: row.storageKey,
        sizeBytes: row.sizeBytes,
        source: 'reference_file',
      });
    }
  }
  for (const key of bucketKeys.keys) {
    if (!byKey.has(key)) byKey.set(key, { key, sizeBytes: 0, source: 'bucket' });
  }

  const objects = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  const totalBytes = objects.reduce((sum, o) => sum + o.sizeBytes, 0);

  const versionIds = versionRows.map((r) => r.id);
  const rowCounts = await contentRowCounts(exec, engagement.id, cardIds, versionIds);

  return {
    engagementId: engagement.id,
    orgId: engagement.orgId,
    engagementTitle: engagement.title,
    clientOrgName: engagement.clientOrgName,
    status: engagement.status,
    builtAt: now.toISOString(),
    objects,
    objectCount: objects.length,
    totalBytes,
    rowCounts,
    contentRowTotal: rowCounts.reduce((sum, r) => sum + r.rows, 0),
    bucketListed: bucketKeys.listed,
  };
}

async function countOf(exec: Executor, query: Promise<{ n: number }[]>): Promise<number> {
  const rows = await query;
  return rows[0]?.n ?? 0;
}

/**
 * Row counts per content table, in delete order. Counted rather than estimated:
 * these numbers end up on a certificate that says what was destroyed.
 */
async function contentRowCounts(
  exec: Executor,
  engagementId: string,
  cardIds: readonly string[],
  versionIds: readonly string[],
): Promise<ManifestRowCount[]> {
  const n = sql<number>`count(*)::int`;
  // Counted through the access domain: INV-11 reserves every membership table
  // for `src/domain/access/`, and a manifest is a reader like any other.
  const graph = await countProjectAccessRows(exec, engagementId);
  const none = cardIds.length === 0;
  const noVersions = versionIds.length === 0;

  const counts: ManifestRowCount[] = [
    {
      table: 'approvals',
      rows: noVersions
        ? 0
        : await countOf(
            exec,
            exec
              .select({ n })
              .from(approvals)
              .where(inArray(approvals.assetVersionId, [...versionIds])),
          ),
    },
    {
      table: 'revision_notes',
      rows: noVersions
        ? 0
        : await countOf(
            exec,
            exec
              .select({ n })
              .from(revisionNotes)
              .where(inArray(revisionNotes.assetVersionId, [...versionIds])),
          ),
    },
    {
      table: 'comments',
      rows: none
        ? 0
        : await countOf(
            exec,
            exec
              .select({ n })
              .from(comments)
              .where(inArray(comments.cardId, [...cardIds])),
          ),
    },
    {
      table: 'state_transitions',
      rows: none
        ? 0
        : await countOf(
            exec,
            exec
              .select({ n })
              .from(stateTransitions)
              .where(inArray(stateTransitions.cardId, [...cardIds])),
          ),
    },
    { table: 'asset_versions', rows: versionIds.length },
    { table: 'cards', rows: cardIds.length },
    {
      table: 'lanes',
      rows: await countOf(
        exec,
        exec.select({ n }).from(lanes).where(eq(lanes.engagementId, engagementId)),
      ),
    },
    {
      table: 'reference_files',
      rows: await countOf(
        exec,
        exec
          .select({ n })
          .from(referenceFiles)
          .where(eq(referenceFiles.engagementId, engagementId)),
      ),
    },
    {
      table: 'client_contacts',
      rows: await countOf(
        exec,
        exec
          .select({ n })
          .from(clientContacts)
          .where(eq(clientContacts.engagementId, engagementId)),
      ),
    },
    { table: 'project_memberships', rows: graph.projectMemberships },
    { table: 'access_shadow_disagreements', rows: graph.accessShadowDisagreements },
    {
      table: 'audit_log',
      rows: await countOf(
        exec,
        exec
          .select({ n })
          .from(auditLog)
          .where(and(eq(auditLog.engagementId, engagementId), sql`NOT ${RETAINED_AUDIT_ACTIONS_SQL}`)),
      ),
    },
  ];

  return counts;
}
