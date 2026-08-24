/** `PATCH /api/lanes/:id` — rename, reposition, or change visibility. */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { updateLane } from '@/domain/lane/mutate';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../_guards';

const schema = z.object({
  engagementId: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  position: z.number().int().min(0).optional(),
  visibility: z.enum(['published', 'private']).optional(),
});

export async function PATCH(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const body = schema.parse(await request.json());
    const now = new Date();

    const engagement = await loadEngagementDetail(db, body.engagementId, session.orgId, now);
    assertWritable(engagement);

    const { engagementId: _engagementId, ...patch } = body;
    const lane = await updateLane(db, engagement.id, id, patch);

    return NextResponse.json({ lane });
  } catch (error) {
    return toErrorResponse(error);
  }
}
