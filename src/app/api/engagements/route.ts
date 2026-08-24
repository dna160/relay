/**
 * `GET  /api/engagements` — the portfolio.
 * `POST /api/engagements` — 402 `PLAN_LIMIT_REACHED` when the cap is met.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadPortfolio } from '@/db/queries/engagements';
import { openEngagement } from '@/domain/engagement/open';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency } from '../_guards';

export async function GET(): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const engagements = await loadPortfolio(db, session.orgId, new Date());
    return NextResponse.json({ engagements });
  } catch (error) {
    return toErrorResponse(error);
  }
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  clientOrgName: z.string().min(1).max(200),
  templateId: z.string().uuid().nullish(),
  contractedRoundsDefault: z.number().int().min(0).max(99).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const body = createSchema.parse(await request.json());

    const { engagement, gate } = await openEngagement(
      db,
      {
        orgId: session.orgId,
        title: body.title,
        clientOrgName: body.clientOrgName,
        templateId: body.templateId ?? null,
        ...(body.contractedRoundsDefault === undefined
          ? {}
          : { contractedRoundsDefault: body.contractedRoundsDefault }),
      },
      new Date(),
    );

    return NextResponse.json(
      {
        engagement: {
          id: engagement.id,
          title: engagement.title,
          clientOrgName: engagement.clientOrgName,
          status: engagement.status,
          lastActivityAt: engagement.lastActivityAt.toISOString(),
        },
        plan: { activeCount: gate.activeCount, limit: gate.limit, remaining: gate.remaining },
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
