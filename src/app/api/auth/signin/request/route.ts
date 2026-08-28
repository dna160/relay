/**
 * `POST /api/auth/signin/request` — an address, and out goes a six-digit code.
 *
 * ## The response is the same for every address
 *
 * Not "the same for a known and an unknown address" as a matter of care — the
 * same because there is no such distinction to make. On this product email
 * sign-in is also sign-up: the account is created when the address is *proved*,
 * at `/confirm`, not when the code is requested. So this route does identical
 * work whatever it is given, and there is no branch on the address for a timing
 * measurement to find.
 *
 * The one branch is the rate limit, and it answers identically too: over budget
 * is `{ sent: true }` with nothing sent. Telling an anonymous caller they hit a
 * limit tells them the limit exists and that this address reached it, and a
 * person who genuinely pressed the button five times does not need telling off.
 * That is the same shape `POST /api/auth/client/request` already has.
 *
 * ## The destination goes in the link
 *
 * `callbackUrl` is optional, validated by `safeCallback()`, and appended to the
 * emailed link so the mail is as useful as the tab. See below.
 *
 * ## There is no GET here
 *
 * Deliberately, and it is half of the mail-scanner property. The other half is
 * that `/confirm` is POST-only. A prescanner following the link in the email
 * reaches a *page*, which reads nothing from this API.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { issueSignin } from '@/domain/auth/signin';
import { sendSigninCode } from '@/lib/email';
import { toErrorResponse } from '@/lib/errors';
import { DEFAULT_CALLBACK, safeCallback } from '@/lib/links';
import { requestOrigin } from '../../../_guards';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    email: z.string().email().max(320),
    /**
     * Where to land after the code is confirmed. Optional, and **not trusted**:
     * `safeCallback()` reduces anything that is not a single-leading-slash path
     * to the default, so a caller cannot turn this into an open redirect and
     * cannot turn the emailed link into one either.
     *
     * Bounded before validation as well as after. The value is interpolated
     * into an email, and an unbounded string in an email body is a payload
     * regardless of whether the redirect itself is safe.
     */
    callbackUrl: z.string().max(512).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = schema.parse(await request.json());
    const email = body.email.toLowerCase();
    const now = new Date();

    // The per-source bucket, so one address is not the only thing bounded. A
    // caller behind no proxy at all shares the `unknown` bucket rather than
    // getting a free pass out of it.
    const { ip } = requestOrigin(request);
    const issued = await issueSignin(db, email, ip ?? 'unknown', now);

    if (issued.code) {
      const base = process.env.AUTH_URL ?? 'http://localhost:3000';
      /**
       * The destination travels **in the emailed link**, not only in the tab
       * that asked for the code.
       *
       * The in-tab path already worked: `/signin/confirm` reads `callbackUrl`
       * from its own query string and the invitation flow rides through it. The
       * emailed link is the path that did not — and it is the one a person
       * takes when they start on a laptop and open the mail on their phone.
       * Landing them on `/onboarding` is the wrong door specifically for an
       * invitee, who has no organisation and is about to be handed one.
       *
       * Omitted from the URL when it is the default, so the common link stays
       * short and the parameter's presence means something.
       */
      const callback = safeCallback(body.callbackUrl);
      const query = new URLSearchParams({ email, code: issued.code });
      if (callback !== DEFAULT_CALLBACK) query.set('callbackUrl', callback);
      const linkUrl = `${base}/signin/confirm?${query.toString()}`;
      await sendSigninCode({
        to: email,
        code: issued.code,
        expiresInMinutes: issued.expiresInMinutes,
        linkUrl,
      });
    }

    return NextResponse.json({ sent: true, expiresInMinutes: issued.expiresInMinutes });
  } catch (error) {
    return toErrorResponse(error);
  }
}
