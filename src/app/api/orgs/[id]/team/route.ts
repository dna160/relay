/**
 * `GET /api/orgs/:id/team` — the organisation, its people, and its outstanding
 * invitations.
 *
 * One read rather than three because the page is one answer: a roster whose
 * pending invitations arrive in a second request renders, for a moment, an
 * organisation that appears not to have invited anybody — and *did that invite
 * send?* is the exact question this surface exists to answer.
 *
 * `viewerCanInvite` is a capability rather than a role, and that is INV-11
 * rather than a style preference: a page handed an `OrgRole` and deciding for
 * itself whether it outranks `member` is a second place that knows how the
 * roles rank, and therefore a second place that can disagree with the resolver.
 *
 * ## Scope note
 *
 * PHASE-10's brief puts the teams UI in Phase 11 and this route is the read
 * behind it. It is here because `POST /api/orgs/:id/invites` without it ships an
 * invitation nobody can see, withdraw, or confirm was sent — and the front-end
 * had already built `/team` against this shape. Flagged in the handover rather
 * than slipped in.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { loadOrgSummary } from '@/db/queries/orgs';
import { listOrgMembers, viewerCanInvite } from '@/domain/access/org-team';
import { listPendingInvites } from '@/domain/auth/invite';
import { notVisible } from '@/domain/errors';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../../_guards';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id: orgId } = await context.params;

    /**
     * The one scope check, and it is the shipped one: during the shadow window
     * a person belongs to exactly one organisation and it is the one on their
     * session. 404 rather than 403, as everywhere — which organisation ids
     * exist is not a fact a caller outside them is entitled to.
     */
    if (orgId !== session.orgId) throw notVisible('Not found');

    const now = new Date();
    const organization = await loadOrgSummary(db, orgId);
    const members = await listOrgMembers(db, orgId);
    const invites = await listPendingInvites(db, orgId, now);

    return NextResponse.json({
      organization,
      viewerCanInvite: viewerCanInvite(session.role),
      members,
      invites,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
