/**
 * `GET /api/client/download/:versionId` — 302 to a presigned GET.
 *
 * INV-10: the body never passes through here. The route resolves the version
 * through `clientScope()`, signs a short-lived GET, and redirects. Streaming
 * the object back instead would put every client download through the app's
 * egress and its memory, which is the bill ADR-009 exists to avoid.
 *
 * A version the contact cannot see is 404, never 403.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { loadClientDownloadTarget } from '@/db/queries/client-board';
import { clientScope } from '@/db/queries/client-scope';
import { toErrorResponse } from '@/lib/errors';
import { presignDownload } from '@/lib/storage';
import { requireClient, type RouteContext } from '../../../_guards';

export async function GET(
  _request: Request,
  context: RouteContext<{ versionId: string }>,
): Promise<NextResponse> {
  try {
    const scope = clientScope(await requireClient());
    const { versionId } = await context.params;

    const target = await loadClientDownloadTarget(db, scope, versionId);
    const signed = await presignDownload({ key: target.storageKey, filename: target.filename });

    return NextResponse.redirect(signed.url, 302);
  } catch (error) {
    return toErrorResponse(error);
  }
}
