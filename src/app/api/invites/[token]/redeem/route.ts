/**
 * `POST /api/invites/:token/redeem` — the one route that turns an invitation
 * into membership, and INV-12's right-hand side.
 *
 * Two lines matter:
 *
 * ```ts
 * const actor = await requireVerifiedAccount();
 * await redeemInvite(tx, token, actor.accountId, now);
 * ```
 *
 * The account id comes from the **session**, never from the token, and the
 * guard that produced it insisted on a non-null `users.email_verified` — a
 * column written only by Auth.js's magic-link callback and by
 * `consumeSignin()`. There is no expression in this handler that could put a
 * value from the URL into that argument, and `redeemInvite` would refuse it
 * anyway: it re-reads the account's verified addresses out of `identities` and
 * requires the invited one to be among them.
 *
 * ## Failures, and what each one leaves behind
 *
 * `address_mismatch` is the forwarded-invite case. It is a 400 and it leaves
 * the invitation **unconsumed** — burning it would turn a forwarded email into
 * a denial of service against the person it was actually for. `expired` and
 * `not_redeemable` likewise write nothing. Only a successful redemption
 * consumes, and it does so atomically in the same transaction as the grant.
 *
 * `reason` travels in `details` so the front-end can render four different
 * sentences without parsing prose. It is safe to reveal: the caller is
 * authenticated, holds the token already, and every one of these is a fact
 * about the invitation rather than about anybody else's account.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { InviteRefused, redeemInvite } from '@/domain/auth/invite';
import { validationFailed } from '@/domain/errors';
import { toErrorResponse } from '@/lib/errors';
import { requireVerifiedAccount, type RouteContext } from '../../../_guards';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: RouteContext<{ token: string }>,
): Promise<NextResponse> {
  try {
    const actor = await requireVerifiedAccount();
    const { token } = await context.params;
    const now = new Date();

    const redemption = await db.transaction((tx) =>
      redeemInvite(tx, token, actor.accountId, now),
    );

    return NextResponse.json({ redemption });
  } catch (error) {
    if (error instanceof InviteRefused) {
      return toErrorResponse(validationFailed(error.message, { reason: error.reason }));
    }
    return toErrorResponse(error);
  }
}
