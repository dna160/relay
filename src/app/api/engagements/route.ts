/**
 * `GET  /api/engagements` — the portfolio.
 * `POST /api/engagements` — 402 `PLAN_LIMIT_REACHED` when the cap is met.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadPortfolio } from '@/db/queries/engagements';
import { loadTemplate } from '@/db/queries/templates';
import { openEngagement } from '@/domain/engagement/open';
import { notVisible } from '@/domain/errors';
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

    /**
     * Resolved before the create, org-scoped, and 404 rather than 403 when the
     * id belongs to another agency — the same shape as every other route that
     * loads its subject first (INV-9). Doing it here rather than inside
     * `openEngagement()` also means the failure is about the template, which is
     * what the caller asked about, and that no engagement row was ever written
     * on the way to it.
     */
    const template = body.templateId
      ? await loadTemplate(db, body.templateId, session.orgId)
      : null;
    if (body.templateId && !template) throw notVisible('Template not found');

    const { engagement, gate, stamped } = await openEngagement(
      db,
      {
        orgId: session.orgId,
        title: body.title,
        clientOrgName: body.clientOrgName,
        template: template && { id: template.id, definition: template.definition },
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
        /**
         * Null when no template was named. It is reported rather than left to
         * be discovered on the board because the stamp is the reason creation
         * is cheap (PRD §5.7), and a create that silently stamped nothing —
         * an empty template, a definition with no lanes — should say so here
         * rather than look like a board that failed to load.
         */
        stamped,
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
