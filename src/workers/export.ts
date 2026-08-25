/**
 * The export job.
 *
 * `POST /api/engagements/:id/export` queues this and returns a job id, which is
 * the shape the front-end already calls (`agencyApi.requestExport`). What lands
 * in storage is a signed inventory rather than a zip — the reasoning is in
 * `src/domain/export/bundle.ts` and ADR-020, and it comes down to INV-10: a zip
 * means every byte of a 5 GB file passing through a Relay process, which is
 * precisely what ADR-009 exists to prevent.
 *
 * The bundle is written **under the engagement's own key prefix**, so a purge
 * enumerates and destroys it along with everything else. An export that
 * outlived the purge of the thing it exports would make the certificate a lie.
 */

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { uuidv7 } from 'uuidv7';
import { db } from '@/db/client';
import type { ExportBundle } from '@/domain/export/bundle';
import {
  buildAgencyExport,
  loadAgencyExportRows,
  loadExportEngagement,
} from '@/domain/export/agency';
import { daysToPurge } from '@/domain/retention/schedule';
import { bucket, presignDownload, storageClient } from '@/lib/storage';
import { log, errorText } from './logger';

export interface ExportJobData {
  readonly engagementId: string;
  readonly requestedByUserId: string;
}

export interface ExportJobResult {
  readonly engagementId: string;
  readonly key: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

/** Long enough for an agency to work through a large export in one sitting. */
const EXPORT_LINK_EXPIRY_SECONDS = 24 * 60 * 60;

export function exportKey(engagementId: string, jobId: string): string {
  return `engagements/${engagementId}/exports/${jobId}/relay-export.json`;
}

export async function runExportJob(
  data: ExportJobData,
  jobId: string,
  now = new Date(),
): Promise<ExportJobResult> {
  const engagement = await loadExportEngagement(db, data.engagementId);
  if (!engagement) throw new Error(`no such engagement: ${data.engagementId}`);

  const rows = await loadAgencyExportRows(db, data.engagementId);

  // Presigned per file, at build time. The alternative — a route that presigns
  // on demand — would mean holding the inventory somewhere the app can read it
  // back, which is a second copy of the same list.
  const urls = await Promise.all(
    rows.map(async (row) => {
      const signed = await presignDownload({
        key: row.storageKey,
        filename: row.filename,
        expiresIn: EXPORT_LINK_EXPIRY_SECONDS,
      });
      return signed.url;
    }),
  );

  const bundle = buildAgencyExport({
    engagement: {
      id: engagement.id,
      title: engagement.title,
      clientOrgName: engagement.clientOrgName,
      status: engagement.status,
    },
    rows,
    urls,
    daysToPurge: daysToPurge(engagement.purgeAt, now),
    now,
  });

  const key = exportKey(data.engagementId, jobId);
  await putBundle(key, bundle);

  log.info('export.built', {
    engagementId: data.engagementId,
    jobId,
    key,
    fileCount: bundle.fileCount,
    totalBytes: bundle.totalBytes,
  });

  return {
    engagementId: data.engagementId,
    key,
    fileCount: bundle.fileCount,
    totalBytes: bundle.totalBytes,
  };
}

/**
 * The bundle is a few kilobytes of JSON this process generated. It is not user
 * file content, so writing it directly is not the thing INV-10 forbids — the
 * invariant is about the 5 GB deliverable, not about a manifest describing it.
 */
async function putBundle(key: string, bundle: ExportBundle): Promise<void> {
  await storageClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: JSON.stringify(bundle, null, 2),
      ContentType: 'application/json',
    }),
  );
}

/** A presigned GET for a finished export, for the route that reports on it. */
export async function presignExport(key: string): Promise<{ url: string; expiresIn: number }> {
  return presignDownload({
    key,
    filename: 'relay-export.json',
    expiresIn: EXPORT_LINK_EXPIRY_SECONDS,
  });
}

export function newExportJobId(): string {
  return uuidv7();
}

export function exportFailure(error: unknown): string {
  return errorText(error);
}
