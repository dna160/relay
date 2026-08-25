/**
 * `POST /api/cards/reorder` — the batch a drag produces.
 *
 * Writes `position` and `lane_id`. Nothing else, ever (ADR-003). Not in
 * API-CONTRACT.md; added because the board sends a whole ordering at once and
 * N sequential PATCHes would let a refresh land mid-sequence. Flagged in the
 * handover for the contract to absorb.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { reorderCards } from '@/domain/card/mutate';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency } from '../../_guards';
import { shadowed } from '../../_shadow';

const schema = z
  .object({
    engagementId: z.string().uuid(),
    items: z
      .array(
        z
          .object({
            cardId: z.string().uuid(),
            laneId: z.string().uuid(),
            position: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const body = schema.parse(await request.json());
    const now = new Date();

    const engagement = await shadowed('POST /api/cards/reorder', session, body.engagementId, () =>
      loadEngagementDetail(db, body.engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    await reorderCards(db, engagement.id, body.items, now);
    return NextResponse.json({ reordered: body.items.length });
  } catch (error) {
    return toErrorResponse(error);
  }
}
