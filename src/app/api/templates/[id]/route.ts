/**
 * `GET /api/templates/:id` → `{ template: TemplateSummary, definition }`.
 *
 * The second read, and the list route's own doc comment is the reason it
 * exists: `TemplateSummary` carries counts "for the picker, so choosing one
 * does not require fetching it" — the counts answer *how big*, and a preview
 * shown before someone spends a plan slot has to answer *what*. Lane names,
 * which of them are private, and the deliverables under each.
 *
 * Org-scoped, and a template belonging to another agency is a 404 rather than a
 * 403: a 403 on an id confirms the id is real, which is the probe the
 * 404-not-403 rule exists to close.
 *
 * A row whose stored definition will not parse is a **400**, not a 404 and not
 * a half-rendered preview. The list route omits that row entirely; this one is
 * reached by asking for it by id, and the honest answer to "show me this
 * template" when the definition is unreadable is to say so.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { loadTemplate } from '@/db/queries/templates';
import { countTemplate } from '@/domain/template/definition';
import { notVisible } from '@/domain/errors';
import type { TemplateSummary } from '@/lib/types';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../_guards';

export async function GET(
  _request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    // `null` is "no such template for this organisation". The 404 is minted
    // here, at the HTTP boundary, rather than thrown from the query — which is
    // what keeps `src/db/queries/` free of status codes.
    const template = await loadTemplate(db, id, session.orgId);
    if (!template) throw notVisible('Template not found');

    /**
     * Counted from the same parsed definition this response ships, so the
     * summary in the header and the lanes in the body cannot disagree — one
     * fact, one source. The list route counts the same way from its own read.
     */
    const { laneCount, cardCount } = countTemplate(template.definition);

    return NextResponse.json({
      template: {
        id: template.id,
        name: template.name,
        createdAt: template.createdAt.toISOString(),
        laneCount,
        cardCount,
      } satisfies TemplateSummary,
      definition: template.definition,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
