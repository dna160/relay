/**
 * `DELETE /api/orgs/:id/invites/:inviteId` — withdraw an unredeemed invitation.
 *
 * The undo for the expensive mistake. An invitation sent to the wrong address is
 * live for seven days, and "wait a week" is not a remedy when the wrong address
 * belongs to the client whose boards it would have opened.
 *
 * Authority is `resolveInviter()`: whoever may create an invitation for this
 * organisation may withdraw one. Splitting the two would mean an admin could
 * open a door they could not close.
 *
 * Revocation never touches a *consumed* invitation — see `revokeInvite()`.
 * Removing somebody who has already joined is a different operation on a
 * different table, and Phase 11's.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { resolveInviter } from '@/domain/access/org-admin';
import { revokeInvite } from '@/domain/auth/invite';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../../../_guards';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  context: RouteContext<{ id: string; inviteId: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id: orgId, inviteId } = await context.params;
    const now = new Date();

    await resolveInviter(
      db,
      { legacyUserId: session.userId, legacyOrgId: session.orgId, legacyRole: session.role },
      orgId,
      now,
    );

    const revoked = await revokeInvite(db, orgId, inviteId, now);
    return NextResponse.json({ revoked });
  } catch (error) {
    return toErrorResponse(error);
  }
}
