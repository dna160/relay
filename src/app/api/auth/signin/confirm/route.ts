/**
 * `POST /api/auth/signin/confirm` — six digits in, a session cookie out.
 *
 * ## POST, and only POST
 *
 * This file exports one handler and it is not a `GET`. That is the whole of the
 * mail-scanner defence, and it is structural rather than careful: Next mounts
 * exactly the methods a route file exports, so a `GET` on this path is a 405
 * from the framework, not a branch inside a handler that somebody could later
 * relax.
 *
 * Outlook Safe Links and Proofpoint fetch every URL in an inbound message
 * before a human sees it. The emailed link points at `/signin/confirm`, a page
 * with a confirm button — prefetching it renders HTML and consumes nothing,
 * because the only thing that consumes is this POST and a prescanner does not
 * issue one. Auth.js's own email callback is a GET that consumes, which is
 * exactly why this phase owns the token half (ADR-027).
 *
 * ## The three steps, in three files
 *
 * `consumeSignin()` proves the address. `ensureAccountForVerifiedEmail()` turns
 * a proven address into an account. `establishAccountSession()` turns an account
 * into a session. No invite is an input to any of them, and this handler cannot
 * assemble one from a token because it never sees a token.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { ensureAccountForVerifiedEmail } from '@/domain/access/provision-account';
import { consumeSignin } from '@/domain/auth/signin';
import { establishAccountSession } from '@/domain/auth/session';
import { validationFailed } from '@/domain/errors';
import { accountCookieOptions, accountSessionCookie } from '@/lib/auth';
import { toErrorResponse } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    email: z.string().email().max(320),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = schema.parse(await request.json());
    const email = body.email.toLowerCase();
    const now = new Date();

    /**
     * One transaction: the token is consumed, the person is provisioned, and
     * the session row is written together or not at all. A crash between the
     * consumption and the session would otherwise burn a code and sign nobody
     * in, which is the failure that makes people press the button twice.
     */
    const result = await db.transaction(async (tx) => {
      const verified = await consumeSignin(tx, email, body.code, now);
      if (!verified) return null;

      const account = await ensureAccountForVerifiedEmail(tx, verified, null, now);
      const session = await establishAccountSession(tx, verified, account.legacyUserId, now);
      return { account, session };
    });

    // One message for an expired code, a wrong code, an address with no
    // outstanding code, and an exhausted attempt budget. Four different facts,
    // and telling them apart is telling an anonymous caller which of them is
    // true about an address they named.
    if (!result) throw validationFailed('That code is not valid or has expired');

    const cookie = accountSessionCookie();
    const response = NextResponse.json({
      /** No org yet — the front-end sends them to onboarding, or to an invite. */
      needsOnboarding: result.account.legacyOrgId === null,
    });
    response.cookies.set(
      cookie.name,
      result.session.sessionToken,
      accountCookieOptions(result.session.expires, cookie.secure),
    );
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
