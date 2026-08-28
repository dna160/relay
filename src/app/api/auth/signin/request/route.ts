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
import { requestOrigin } from '../../../_guards';

export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().email().max(320) }).strict();

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
      const linkUrl = `${base}/signin/confirm?email=${encodeURIComponent(email)}&code=${issued.code}`;
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
