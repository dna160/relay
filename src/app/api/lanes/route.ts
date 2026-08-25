/**
 * `POST /api/lanes`.
 *
 * `visibility` is optional and is *not* defaulted here. Omitting it lets the
 * column's `DEFAULT 'published'` decide (ADR-006), so the product's answer to
 * "what happens when nobody says" lives in one place.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { createLane } from '@/domain/lane/mutate';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency } from '../_guards';
import { shadowed } from '../_shadow';

const schema = z.object({
  engagementId: z.string().uuid(),
  name: z.string().min(1).max(120),
  position: z.number().int().min(0).optional(),
  visibility: z.enum(['published', 'private']).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const body = schema.parse(await request.json());
    const now = new Date();

    const engagement = await shadowed('POST /api/lanes', session, body.engagementId, () =>
      loadEngagementDetail(db, body.engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    const lane = await createLane(
      db,
      {
        engagementId: engagement.id,
        name: body.name,
        ...(body.position === undefined ? {} : { position: body.position }),
        ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
      },
      now,
    );

    return NextResponse.json({ lane }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
