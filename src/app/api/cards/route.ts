/**
 * `POST /api/cards`.
 *
 * A new card starts in `draft`, which is the column default and therefore not a
 * field here. State never arrives from a request (INV-2); it arrives from the
 * state machine or not at all.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { createCard } from '@/domain/card/mutate';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency } from '../_guards';
import { shadowed } from '../_shadow';

const schema = z.object({
  engagementId: z.string().uuid(),
  laneId: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).nullish(),
  assigneeId: z.string().uuid().nullish(),
  dueAt: z.coerce.date().nullish(),
  contractedRounds: z.number().int().min(0).max(99).nullish(),
  internalNotes: z.string().max(20_000).nullish(),
  effortEstimate: z.number().int().min(0).nullish(),
  visibilityOverride: z.enum(['inherit', 'private']).optional(),
  position: z.number().int().min(0).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const body = schema.parse(await request.json());
    const now = new Date();

    const engagement = await shadowed('POST /api/cards', session, body.engagementId, () =>
      loadEngagementDetail(db, body.engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    const card = await createCard(
      db,
      {
        engagementId: engagement.id,
        laneId: body.laneId,
        title: body.title,
        description: body.description ?? null,
        assigneeId: body.assigneeId ?? null,
        dueAt: body.dueAt ?? null,
        contractedRounds: body.contractedRounds ?? engagement.contractedRoundsDefault,
        internalNotes: body.internalNotes ?? null,
        effortEstimate: body.effortEstimate ?? null,
        ...(body.visibilityOverride === undefined
          ? {}
          : { visibilityOverride: body.visibilityOverride }),
        ...(body.position === undefined ? {} : { position: body.position }),
      },
      now,
    );

    return NextResponse.json({ card }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
