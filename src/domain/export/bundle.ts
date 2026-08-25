/**
 * The export bundle — "everything you can see, in one click".
 *
 * PRD §5.6 gives the client contact a **free** export of everything visible to
 * them, and PHASE-6 states plainly that it is never paywalled. That is not
 * generosity: it is the thing that makes an irreversible purge defensible. The
 * client's copy is the copy that survives, and RUNBOOK §6's recovery section
 * says so — after a purge the object bytes are gone and are not recoverable, so
 * the export has to have happened *before*.
 *
 * ## Why this is an inventory and not a zip file
 *
 * The contract says "queues a zip". This produces a signed inventory plus one
 * download link per file instead, for three reasons that all point the same way:
 *
 *  1. **INV-10.** Assembling a zip means every byte of every file passing
 *     through a Relay process. The ceiling is 5 GB per file. That is exactly
 *     what ADR-009 exists to prevent, and the runbook states it as "file bytes
 *     never traverse either service".
 *  2. **No zip dependency.** CLAUDE.md: no dependency without an ADR, and the
 *     build has added exactly one in six rounds.
 *  3. **ZIP entries need a CRC-32 per file.** We store sha256, not CRC-32, so
 *     even a store-only container could not be assembled without reading every
 *     byte back — which is (1) again.
 *
 * Recorded as ADR-020. The API shape the front-end already calls is unchanged:
 * the agency route still queues a job and returns a job id.
 */

import type { ClientLane } from '@/lib/types';

/** What the export says about itself, so the file is legible on its own. */
export const EXPORT_FORMAT = 'relay.export.v1' as const;

export interface ExportedFile {
  readonly kind: 'deliverable' | 'reference';
  readonly cardId: string | null;
  readonly cardTitle: string | null;
  readonly versionId: string | null;
  readonly versionNo: number | null;
  readonly filename: string;
  readonly sizeBytes: number;
  /** Null for reference files, which carry no hash (DATA-MODEL: no versioning). */
  readonly sha256: string | null;
  readonly groupLabel: string | null;
  /**
   * Where to fetch it. A path on this app for the client bundle — the session
   * is the authorisation, and the app 302s to a presigned GET (INV-10). An
   * absolute presigned URL for the agency bundle, which is a file the agency
   * downloads once and keeps.
   */
  readonly downloadUrl: string;
}

export interface ExportBundle {
  readonly format: typeof EXPORT_FORMAT;
  readonly generatedAt: string;
  readonly audience: 'agency' | 'client';
  readonly engagement: {
    readonly id: string;
    readonly title: string;
    readonly clientOrgName: string;
    readonly status: string;
  };
  readonly files: readonly ExportedFile[];
  readonly fileCount: number;
  readonly totalBytes: number;
  /** Null on a retaining plan. Present so the export states its own deadline. */
  readonly daysToPurge: number | null;
  readonly notice: string;
}

const CLIENT_NOTICE =
  'This is a complete copy of everything you can see in this workspace. Each file ' +
  'downloads directly from Relay’s object storage. If this engagement is on a ' +
  'retention countdown, take these files before the date above — deletion is ' +
  'irreversible and Relay cannot restore them afterwards.';

/** Shared by both audiences, so the two bundles cannot disagree on a count. */
export function totals(files: readonly ExportedFile[]): { fileCount: number; totalBytes: number } {
  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
  };
}

/* ------------------------------------------------------------------ client */

export interface ClientExportInput {
  readonly engagement: { id: string; title: string; clientOrgName: string; status: string };
  readonly board: readonly ClientLane[];
  readonly shelf: readonly {
    id: string;
    filename: string;
    sizeBytes: number;
    groupLabel: string | null;
    downloadUrl: string;
  }[];
  readonly daysToPurge: number | null;
  readonly downloadPath: (versionId: string) => string;
  readonly now: Date;
}

/**
 * Built from the client projection, never from raw rows.
 *
 * That is the INV-1 property: the export cannot contain a private lane, a draft
 * card or an unpublished version, because the only thing it is given is the
 * board the client already sees. There is no second visibility rule here to
 * drift from the first one — an export that re-derived visibility would be
 * exactly the kind of second path INV-1 exists to forbid.
 */
export function buildClientExport(input: ClientExportInput): ExportBundle {
  const files: ExportedFile[] = [];

  for (const lane of input.board) {
    for (const card of lane.cards) {
      for (const version of card.versions) {
        files.push({
          kind: 'deliverable',
          cardId: card.id,
          cardTitle: card.title,
          versionId: version.id,
          versionNo: version.versionNo,
          filename: version.filename,
          sizeBytes: version.sizeBytes,
          sha256: version.sha256,
          groupLabel: null,
          downloadUrl: input.downloadPath(version.id),
        });
      }
    }
  }

  for (const item of input.shelf) {
    files.push({
      kind: 'reference',
      cardId: null,
      cardTitle: null,
      versionId: null,
      versionNo: null,
      filename: item.filename,
      sizeBytes: item.sizeBytes,
      sha256: null,
      groupLabel: item.groupLabel,
      downloadUrl: item.downloadUrl,
    });
  }

  return {
    format: EXPORT_FORMAT,
    generatedAt: input.now.toISOString(),
    audience: 'client',
    engagement: input.engagement,
    files,
    ...totals(files),
    daysToPurge: input.daysToPurge,
    notice: CLIENT_NOTICE,
  };
}
