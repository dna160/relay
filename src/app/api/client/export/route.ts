/**
 * `GET /api/client/export` — everything the contact can see, as one file.
 *
 * **Never paywalled** (PRD §5.6). The agency's contract with its client almost
 * certainly obliges it to retain deliverables; a purge the client could not
 * export ahead of manufactures a breach and destroys the account. This route is
 * the thing that makes the retention model defensible rather than hostile, so
 * it stays reachable on an archived engagement — archived is read-only, and
 * export is a read.
 *
 * The engagement comes from the session. No parameter, no query string, no
 * body (INV-6).
 *
 * INV-1 holds here without a second visibility rule: the bundle is built from
 * the client projection, so it cannot contain a private lane, a draft card or
 * an unpublished version. An export that re-derived visibility would be exactly
 * the kind of second path INV-1 exists to forbid.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import {
  loadClientBoard,
  loadClientEngagementHeader,
  loadClientShelf,
} from '@/db/queries/client-board';
import { clientScope } from '@/db/queries/client-scope';
import { buildClientExport } from '@/domain/export/bundle';
import { toErrorResponse } from '@/lib/errors';
import { requireClient } from '../../_guards';

/** Bytes are fetched from these, one presigned GET at a time (INV-10). */
function downloadPath(versionId: string): string {
  return `/api/client/download/${versionId}`;
}

function filename(title: string, now: Date): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'engagement';
  return `relay-${slug}-${now.toISOString().slice(0, 10)}.json`;
}

export async function GET(): Promise<NextResponse> {
  try {
    const session = await requireClient();
    const scope = clientScope(session);
    const now = new Date();

    const [header, board, shelf] = await Promise.all([
      loadClientEngagementHeader(db, scope, now),
      loadClientBoard(db, scope),
      loadClientShelf(db, scope),
    ]);

    const bundle = buildClientExport({
      engagement: {
        id: scope.engagementId,
        title: header.title,
        clientOrgName: header.agencyName,
        status: header.status,
      },
      board,
      shelf: shelf.map((file) => ({
        id: file.id,
        filename: file.filename,
        sizeBytes: file.sizeBytes,
        groupLabel: file.groupLabel,
        downloadUrl: downloadPath(file.id),
      })),
      daysToPurge: header.daysToPurge,
      downloadPath,
      now,
    });

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename(header.title, now)}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
