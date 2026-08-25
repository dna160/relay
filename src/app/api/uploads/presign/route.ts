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
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { cardBelongsToEngagement } from '@/db/queries/agency-board';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { notVisible, validationFailed } from '@/domain/errors';
import { toErrorResponse } from '@/lib/errors';
import {
  MAX_UPLOAD_BYTES,
  MULTIPART_THRESHOLD_BYTES,
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

    const presign = await presignUpload({ key, mime: body.mime, sizeBytes: body.size });

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
