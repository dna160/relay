/**
 * The agency half of the export.
 *
 * Split from `bundle.ts` on purpose. `bundle.ts` is pure — it imports no schema
 * and touches no database — which is what lets the client export route reach it
 * without also pulling an agency-scoped read one import away from a client
 * entry point. INV-1's reachability guard enumerates `src/db/queries/**`, and a
 * read that lives here rather than there would slip past it; keeping the two
 * audiences in separate modules means the client route cannot reach this one at
 * all, which is a stronger property than a guard that happens not to look.
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { assetVersions, cards, engagements, lanes, referenceFiles } from '@/db/schema';
import type { Executor } from '@/db/types';
import { totals, EXPORT_FORMAT, type ExportBundle, type ExportedFile } from './bundle';

const AGENCY_NOTICE =
  'A complete inventory of this engagement, including files not published to the ' +
  'client. Each link is a time-limited direct download. Sizes and hashes are the ' +
  'ones recorded at upload time and are what a purge certificate will account for.';



export interface AgencyExportRow {
  readonly cardId: string | null;
  readonly cardTitle: string | null;
  readonly versionId: string | null;
  readonly versionNo: number | null;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly sha256: string | null;
  readonly storageKey: string;
  readonly groupLabel: string | null;
  readonly kind: 'deliverable' | 'reference';
}

/**
 * Every file in the engagement, published or not, with its storage key.
 *
 * Scoped by org at the call site, not here: the route has already resolved the
 * engagement against the session's org before it queues the job, and the job
 * carries the engagement id it was given.
 */
export async function loadAgencyExportRows(
  exec: Executor,
  engagementId: string,
): Promise<AgencyExportRow[]> {
  const versions = await exec
    .select({
      cardId: cards.id,
      cardTitle: cards.title,
      versionId: assetVersions.id,
      versionNo: assetVersions.versionNo,
      filename: assetVersions.filename,
      sizeBytes: assetVersions.sizeBytes,
      sha256: assetVersions.sha256,
      storageKey: assetVersions.storageKey,
    })
    .from(assetVersions)
    .innerJoin(cards, eq(cards.id, assetVersions.cardId))
    .where(eq(cards.engagementId, engagementId))
    .orderBy(cards.position, assetVersions.versionNo);

  const shelf = await exec
    .select({
      filename: referenceFiles.filename,
      sizeBytes: referenceFiles.sizeBytes,
      storageKey: referenceFiles.storageKey,
      groupLabel: referenceFiles.groupLabel,
    })
    .from(referenceFiles)
    .where(eq(referenceFiles.engagementId, engagementId));

  return [
    ...versions.map(
      (v): AgencyExportRow => ({
        kind: 'deliverable',
        cardId: v.cardId,
        cardTitle: v.cardTitle,
        versionId: v.versionId,
        versionNo: v.versionNo,
        filename: v.filename,
        sizeBytes: v.sizeBytes,
        sha256: v.sha256,
        storageKey: v.storageKey,
        groupLabel: null,
      }),
    ),
    ...shelf.map(
      (s): AgencyExportRow => ({
        kind: 'reference',
        cardId: null,
        cardTitle: null,
        versionId: null,
        versionNo: null,
        filename: s.filename,
        sizeBytes: s.sizeBytes,
        sha256: null,
        storageKey: s.storageKey,
        groupLabel: s.groupLabel,
      }),
    ),
  ];
}

export function buildAgencyExport(input: {
  engagement: { id: string; title: string; clientOrgName: string; status: string };
  rows: readonly AgencyExportRow[];
  /** Already-presigned, one per row, in the same order. */
  urls: readonly string[];
  daysToPurge: number | null;
  now: Date;
}): ExportBundle {
  const files = input.rows.map(
    (row, i): ExportedFile => ({
      kind: row.kind,
      cardId: row.cardId,
      cardTitle: row.cardTitle,
      versionId: row.versionId,
      versionNo: row.versionNo,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      groupLabel: row.groupLabel,
      downloadUrl: input.urls[i] ?? '',
    }),
  );

  return {
    format: EXPORT_FORMAT,
    generatedAt: input.now.toISOString(),
    audience: 'agency',
    engagement: input.engagement,
    files,
    ...totals(files),
    daysToPurge: input.daysToPurge,
    notice: AGENCY_NOTICE,
  };
}

/**
 * A sanity read for the export job: the engagement, by id, with no org filter.
 * The route authorises before queueing; the job trusts the id it was handed and
 * nothing else about the request that produced it.
 */
export async function loadExportEngagement(
  exec: Executor,
  engagementId: string,
): Promise<{ id: string; title: string; clientOrgName: string; status: string; purgeAt: Date | null } | null> {
  const rows = await exec
    .select({
      id: engagements.id,
      title: engagements.title,
      clientOrgName: engagements.clientOrgName,
      status: engagements.status,
      purgeAt: engagements.purgeAt,
    })
    .from(engagements)
    .where(eq(engagements.id, engagementId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Published version ids for an engagement, used by nothing on the client path —
 * kept here so the agency export can state how much of what it lists the client
 * would also get, which is the number an agency wants before it downgrades.
 */
export async function countClientVisibleVersions(
  exec: Executor,
  engagementId: string,
): Promise<number> {
  const rows = await exec
    .select({ id: assetVersions.id })
    .from(assetVersions)
    .innerJoin(cards, eq(cards.id, assetVersions.cardId))
    .innerJoin(lanes, eq(lanes.id, cards.laneId))
    .where(
      and(
        eq(cards.engagementId, engagementId),
        eq(lanes.visibility, 'published'),
        isNotNull(assetVersions.publishedToClientAt),
        inArray(cards.visibilityOverride, ['inherit']),
      ),
    );
  return rows.length;
}
