/**
 * `POST /api/versions` — records a completed upload.
 *
 * Called after the browser has finished PUTting to the presigned URL. Carries
 * metadata and the sha256 the uploader computed over the bytes it sent. The
 * version number is allocated inside the transaction (INV-4).
 *
 * The new version does not become visible to the client here. That takes the
 * internal gate, `POST /api/cards/:id/publish`.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { cardBelongsToEngagement } from '@/db/queries/agency-board';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { notVisible } from '@/domain/errors';
import { recordVersion } from '@/domain/version/record-version';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency } from '../_guards';
import { shadowed } from '../_shadow';

const schema = z
  .object({
    engagementId: z.string().uuid(),
    cardId: z.string().uuid(),
    storageKey: z.string().min(1).max(1024),
    filename: z.string().min(1).max(400),
    mime: z.string().min(1).max(200),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const body = schema.parse(await request.json());
    const now = new Date();

    const engagement = await shadowed('POST /api/versions', session, body.engagementId, () =>
      loadEngagementDetail(db, body.engagementId, session.orgId, now),
    );
    assertWritable(engagement);
    if (!(await cardBelongsToEngagement(db, body.cardId, engagement.id))) {
      throw notVisible('Card not found');
    }

    const version = await recordVersion(
      db,
      {
        cardId: body.cardId,
        engagementId: engagement.id,
        storageKey: body.storageKey,
        filename: body.filename,
        mime: body.mime,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
        uploadedByUserId: session.userId,
      },
      now,
    );

    return NextResponse.json(
      {
        version: {
          id: version.id,
          cardId: version.cardId,
          versionNo: version.versionNo,
          filename: version.filename,
          mime: version.mime,
          sizeBytes: version.sizeBytes,
          sha256: version.sha256,
          uploadedAt: version.uploadedAt.toISOString(),
          publishedToClientAt: null,
          supersededBy: version.supersededBy,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
