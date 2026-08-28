/**
 * `POST /api/orgs/:id/invites` — invite a colleague into the agency.
 *
 * The route the product owner went looking for and did not find. Until now
 * `POST /api/engagements/:id/invite` was the only invite in the product and it
 * invites a **client contact**; nothing wrote `org_memberships`, nothing created
 * a `users` row for anybody but the person who signed up, and a teammate who
 * signed in got their own empty organization. An agency org could therefore only
 * ever have one member, which is why the assignee picker collapses to "assign to
 * me" — an honest rendering of a one-member org rather than a placeholder.
 *
 * ## Organization, not project
 *
 * `invites.target_kind` has two legal values and `redeemInvite()` handles both,
 * but this is the only issuing surface this phase ships. A direct project grant
 * to an account with no org membership is access the *graph* has and the shipped
 * v1 check does not, so every request that person made would land in the shadow
 * ledger as a real disagreement — manufactured by a feature, during the window
 * whose only job is to reach zero of them. Project invites are for after
 * ADR-021's step 4.
 *
 * ## Authority
 *
 * `resolveInviter()` in `src/domain/access/` makes the decision. This handler
 * parses, calls, and serialises (INV-9), and it does not compare an id to a
 * membership row or branch on a role literal — INV-11's static scan would catch
 * either, and would be right to.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadInviteContext } from '@/db/queries/orgs';
import { resolveInviter } from '@/domain/access/org-admin';
import { INVITABLE_ORG_ROLES } from '@/domain/access/roles';
import { issueInvite } from '@/domain/auth/invite';
import { INVITE_TTL_DAYS } from '@/domain/auth/tokens';
import { sendOrgInvite } from '@/lib/email';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../../_guards';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    email: z.string().email().max(320),
    /**
     * `owner` is absent from `INVITABLE_ORG_ROLES` deliberately — see
     * `src/domain/access/roles.ts`. Taking the list from there rather than
     * spelling it here is also what keeps this file clear of a role literal.
     */
    role: z.enum(INVITABLE_ORG_ROLES),
  })
  .strict();

export async function POST(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id: orgId } = await context.params;
    const body = schema.parse(await request.json());
    const email = body.email.toLowerCase();
    const now = new Date();

    const inviter = await resolveInviter(
      db,
      {
        legacyUserId: session.userId,
        legacyOrgId: session.orgId,
        legacyRole: session.role,
      },
      orgId,
      now,
    );

    const { token, expiresAt } = await issueInvite(
      db,
      {
        targetKind: 'org',
        targetId: orgId,
        orgId,
        email,
        role: body.role,
        invitedByAccountId: inviter.accountId,
      },
      now,
    );

    const display = await loadInviteContext(db, orgId, session.userId);
    const base = process.env.AUTH_URL ?? 'http://localhost:3000';
    const inviteUrl = `${base}/invite/${token}`;

    await sendOrgInvite({
      to: email,
      orgName: display.orgName,
      invitedBy: display.inviterLabel,
      role: body.role,
      linkUrl: inviteUrl,
      expiresInDays: INVITE_TTL_DAYS,
    });

    return NextResponse.json(
      {
        invite: {
          email,
          role: body.role,
          expiresAt: expiresAt.toISOString(),
        },
        /**
         * Returned so the agency can copy the link rather than depending on
         * mail delivery, the same way `POST /api/engagements/:id/invite`
         * returns `linkUrl`. It goes to the person who just created it, who
         * already holds the token by definition.
         */
        inviteUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
