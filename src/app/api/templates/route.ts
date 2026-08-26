/**
 * `GET  /api/templates` → `{ templates: TemplateSummary[] }`
 * `POST /api/templates` → `201 { template }`
 *
 * Agency only, and org-scoped through the existing access path: the session
 * names the organisation, `listTemplates`/`loadEngagementDetail` filter on it,
 * and another organisation's row is absent rather than forbidden. A 403 on a
 * template id confirms the id exists, which is the leak the 404-not-403 rule
 * (API-CONTRACT, `NOT_VISIBLE`) exists to close.
 *
 * A route handler parses input, calls a domain function, and serialises output
 * (INV-9). Every decision in this file's POST — what a definition may contain,
 * how a live board becomes one, what a due date turns into — is in
 * `src/domain/template/`.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { listTemplates, loadTemplateSource } from '@/db/queries/templates';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { templateDefinitionShape, TEMPLATE_LIMITS } from '@/domain/template/definition';
import { saveTemplate, saveTemplateFromBoard } from '@/domain/template/save';
import { validationFailed } from '@/domain/errors';
import type { TemplateSummary } from '@/lib/types';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency } from '../_guards';
import { shadowed } from '../_shadow';

export async function GET(): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const templates = await listTemplates(db, session.orgId);
    return NextResponse.json({ templates });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Two bodies, one endpoint, and the union is not a convenience.
 *
 * `fromEngagementId` is the only one the product has a surface for today; the
 * explicit `definition` form is what a template editor posts and what Phase 12
 * posts once a human has confirmed an extraction. Having both arrive here
 * means there is one place a definition is validated before it is stored, and
 * INV-13's "a human confirms, then `applyTemplate()` creates" does not need a
 * second write path built alongside it.
 *
 * Naming both is a 400. Silently preferring one would make the other's absence
 * a mystery to whoever sent it.
 */
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(TEMPLATE_LIMITS.NAME_MAX),
    fromEngagementId: z.string().uuid().optional(),
    definition: templateDefinitionShape.optional(),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const body = createSchema.parse(await request.json());
    const now = new Date();

    if (body.fromEngagementId && body.definition) {
      throw validationFailed(
        'Send either `fromEngagementId` or `definition`, not both. They are two ways to say ' +
          'what the template holds, and there is no rule for merging them.',
      );
    }

    const saved = body.fromEngagementId
      ? await (async () => {
          const engagementId = body.fromEngagementId as string;
          /**
           * The same authorisation any other agency read of this engagement
           * takes — including the shadow comparison, so "save as template"
           * shows up in the Phase 9 window like every other decision point
           * rather than being the one route the harness never saw.
           *
           * A purged or archived engagement is deliberately still saveable:
           * the shape of a finished job is exactly what an agency wants to
           * keep, and a definition holds no content — no files, no versions, no
           * decisions, no notes. Nothing here can resurrect a purged byte.
           */
          await shadowed('POST /api/templates', session, engagementId, () =>
            loadEngagementDetail(db, engagementId, session.orgId, now),
          );
          const source = await loadTemplateSource(db, engagementId);
          return saveTemplateFromBoard(db, { orgId: session.orgId, name: body.name, source }, now);
        })()
      : await saveTemplate(
          db,
          {
            orgId: session.orgId,
            name: body.name,
            definition:
              body.definition ??
              // Neither field: an empty template. A named blank shape is a
              // legitimate thing to save, and rejecting it would make "start
              // from nothing, then edit" impossible for no gain.
              { version: 1, lanes: [], shelfGroups: [], contractedRoundsDefault: null },
          },
          now,
        );

    return NextResponse.json(
      {
        template: {
          id: saved.id,
          name: saved.name,
          createdAt: saved.createdAt.toISOString(),
          laneCount: saved.laneCount,
          cardCount: saved.cardCount,
        } satisfies TemplateSummary,
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
