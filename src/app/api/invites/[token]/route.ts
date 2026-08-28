/**
 * `GET /api/invites/:token` — what this invitation is, and nothing else.
 *
 * No session required, because requiring one would defeat the purpose: the
 * person reading this has not signed in yet and is deciding whether to. It
 * reveals the target and the inviter (ADR-021 §5) and grants nothing.
 *
 * ## This handler writes nothing, and that is the point
 *
 * `resolveInvite()` is a `SELECT` and a `SELECT`. It does not consume, it does
 * not count an attempt, it does not stamp a "seen at". A corporate link
 * prescanner will fetch this URL before the recipient does, possibly several
 * times, and must leave the invitation exactly as it found it — so there is
 * nothing on this path that could be spent.
 *
 * The token is 32 random bytes, so there is no guessing budget to protect
 * either: an unknown token is a 404, which is also what an expired-and-deleted
 * one looks like, and 404 rather than 403 because which tokens are real is not
 * a fact an anonymous caller is entitled to.
 *
 * ## Why the address comes back masked
 *
 * Anyone holding a forwarded link can read this response. The intended
 * recipient needs to recognise their own address in it — otherwise "sign in as
 * the invited address" names nothing — and nobody else should be able to
 * harvest it. `a•••@studio.com` does the first and not the second.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { resolveInvite } from '@/domain/auth/invite';
import { toErrorResponse } from '@/lib/errors';
import type { RouteContext } from '../../_guards';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: RouteContext<{ token: string }>,
): Promise<NextResponse> {
  try {
    const { token } = await context.params;
    const invite = await resolveInvite(db, token, new Date());
    return NextResponse.json({ invite });
  } catch (error) {
    return toErrorResponse(error);
  }
}
