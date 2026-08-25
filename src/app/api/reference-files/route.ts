/**
 * `POST /api/reference-files` — records a completed shelf upload.
 *
 * The counterpart to `POST /api/versions` for the other class of file.
 * `POST /api/uploads/presign` already accepts a body without a `cardId` and
 * signs a shelf key; without this route that branch would hand out a URL for
 * bytes nothing ever records.
 *
 * Not in API-CONTRACT.md — flagged in the handover.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { addReferenceFile } from '@/domain/reference/add-file';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency } from '../_guards';
import { shadowed } from '../_shadow';

const schema = z
  .object({
    engagementId: z.string().uuid(),
    groupLabel: z.string().max(120).nullish(),
    storageKey: z.string().min(1).max(1024),
    filename: z.string().min(1).max(400),
    mime: z.string().min(1).max(200),
    sizeBytes: z.number().int().positive(),
    clientVisible: z.boolean().optional(),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const body = schema.parse(await request.json());
    const now = new Date();

    const engagement = await shadowed('POST /api/reference-files', session, body.engagementId, () =>
      loadEngagementDetail(db, body.engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    const file = await addReferenceFile(
      db,
      {
        engagementId: engagement.id,
        groupLabel: body.groupLabel ?? null,
        storageKey: body.storageKey,
        filename: body.filename,
        mime: body.mime,
        sizeBytes: body.sizeBytes,
        uploadedByUserId: session.userId,
        ...(body.clientVisible === undefined ? {} : { clientVisible: body.clientVisible }),
      },
      now,
    );

    return NextResponse.json(
      { file: { ...file, createdAt: file.createdAt.toISOString() } },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
