/**
 * `POST /api/uploads/presign` — hands back a URL, never accepts a file.
 *
 * INV-10 / ADR-009: no byte of user content traverses the app server. This
 * route reads a small JSON body describing an intended upload and returns
 * presigned URLs the browser PUTs to directly. It does not, and must never,
 * call `formData()`, `arrayBuffer()`, or `blob()` — a single one of those is
 * how a 5 GB upload starts flowing through a container with 512 MB of memory.
 *
 * Above 100 MB the response is multipart: part URLs plus presigned complete and
 * abort URLs, so a long upload survives an app restart.
 *
 * ## Two ways this fails, and they are not the same failure
 *
 * A deployment with no `S3_*` variables cannot presign at all — not now, not on
 * a retry, not for anybody. A deployment whose bucket is briefly unreachable
 * will work again shortly. Both used to leave here as an unhandled 500, which
 * the agency surface renders as *"Could not reach the workspace — the
 * connection dropped or the service is restarting. Try again in a moment."*
 * That sentence is false in the first case in every particular: nothing
 * dropped, nothing is restarting, and trying again in a moment will fail
 * identically until somebody sets four environment variables. It shipped to
 * production and a user hit it.
 *
 * So the two now answer differently — `STORAGE_NOT_CONFIGURED` and
 * `STORAGE_UNREACHABLE`, both 503 and both in `ERROR_CODES`, so the front-end
 * branches on the code rather than falling to a default. Neither body names a
 * variable, a bucket, an endpoint or an SDK error. The operator's half of the story goes to
 * the server log, where the caller cannot read it, and `GET /api/health`
 * reports the same distinction so this state is visible before a user finds it.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { cardBelongsToEngagement } from '@/db/queries/agency-board';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { notVisible, validationFailed } from '@/domain/errors';
import { apiError, toErrorResponse } from '@/lib/errors';
import {
  MAX_UPLOAD_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  StorageNotConfiguredError,
  presignUpload,
  shelfKey,
  versionKey,
} from '@/lib/storage';
import { requireAgency } from '../../_guards';
import { shadowed } from '../../_shadow';

const schema = z
  .object({
    engagementId: z.string().uuid(),
    /** Absent for a reference-shelf upload, present for a card version. */
    cardId: z.string().uuid().optional(),
    filename: z.string().min(1).max(400),
    mime: z.string().min(1).max(200),
    size: z.number().int().positive(),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const body = schema.parse(await request.json());
    const now = new Date();

    if (body.size > MAX_UPLOAD_BYTES) {
      throw validationFailed('That file is larger than the 5 GB limit', {
        maxBytes: MAX_UPLOAD_BYTES,
      });
    }

    const engagement = await shadowed('POST /api/uploads/presign', session, body.engagementId, () =>
      loadEngagementDetail(db, body.engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    if (body.cardId && !(await cardBelongsToEngagement(db, body.cardId, engagement.id))) {
      throw notVisible('Card not found');
    }

    const key = body.cardId
      ? versionKey(engagement.id, body.cardId, body.filename)
      : shelfKey(engagement.id, body.filename);

    let presign;
    try {
      presign = await presignUpload({ key, mime: body.mime, sizeBytes: body.size });
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) {
        // The missing variable names go to the log and nowhere near the body.
        console.error('[presign] object storage is not configured', {
          missing: error.missing,
        });
        return apiError(
          'STORAGE_NOT_CONFIGURED',
          'File storage is not set up on this deployment, so uploads are unavailable. ' +
            'This will not resolve by retrying — it needs an administrator.',
        );
      }
      console.error('[presign] object storage did not respond', error);
      return apiError(
        'STORAGE_UNREACHABLE',
        'File storage did not respond. Nothing was uploaded; try again in a moment.',
      );
    }

    return NextResponse.json({
      presign,
      multipartThresholdBytes: MULTIPART_THRESHOLD_BYTES,
      maxBytes: MAX_UPLOAD_BYTES,
      /**
       * The uploader computes sha256 over the same bytes it sends and posts it
       * to /api/versions once the upload completes. The server never sees the
       * content, so it cannot compute the hash itself — which is the trade
       * ADR-009 makes deliberately.
       */
      hashAlgorithm: 'sha256',
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
