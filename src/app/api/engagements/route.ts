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
import { shadowVisible } from '../_shadow';

export async function GET(): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const engagements = await loadPortfolio(db, session.orgId, new Date());

    /**
     * The set-valued comparison. A list endpoint's shipped check is a
     * `WHERE org_id = $session` inside the query rather than a decision about
     * one object, so the harness compares the *sets* — which is where a role
     * mapping that is wrong for a whole class of user shows up first.
     */
    await shadowVisible(
      'GET /api/engagements',
      session,
      engagements.map((e) => e.id),
    );

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
