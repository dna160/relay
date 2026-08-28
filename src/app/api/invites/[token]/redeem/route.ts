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
 * Each refusal has its own `ErrorCode`, and `reason` travels in `details`
 * alongside it. Two carriers for one fact looks redundant and is not: a status
 * code is the thing a proxy or a fetch wrapper can flatten, and a log line
 * reading `reason: address_mismatch` is worth more than one reading `409`. The
 * front-end reads the code first and falls back to the reason.
 *
 * Both are safe to reveal: the caller is authenticated, holds the token
 * already, and every one of these is a fact about the invitation rather than
 * about anybody else's account.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { InviteRefused, redeemInvite, type RefusalReason } from '@/domain/auth/invite';
import {
  inviteAddressMismatch,
  inviteConsumed,
  inviteExpired,
  notVisible,
  type DomainError,
} from '@/domain/errors';
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
    if (error instanceof InviteRefused) return toErrorResponse(asDomainError(error));
    return toErrorResponse(error);
  }
}

/**
 * One refusal reason, one code. A `switch` rather than a lookup object, so a
 * sixth `RefusalReason` is a compile error here instead of falling through to
 * whatever the default was.
 *
 * `unknown_token` and `target_gone` are 404s and not invite-specific codes:
 * both mean "there is nothing here", which is the answer `GET
 * /api/invites/:token` already gives for the same input. A caller must not be
 * able to tell a token that never existed from one whose organisation was
 * deleted.
 */
function asDomainError(error: InviteRefused): DomainError {
  const reason: RefusalReason = error.reason;
  const details = { reason };
  switch (reason) {
    case 'address_mismatch':
      return inviteAddressMismatch(error.message, details);
    case 'expired':
      return inviteExpired(error.message, details);
    case 'not_redeemable':
      return inviteConsumed(error.message, details);
    case 'unknown_token':
    case 'target_gone':
      return notVisible(error.message);
  }
}
