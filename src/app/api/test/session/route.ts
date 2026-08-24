/**
 * `POST /api/test/session` — signs in an agency user without the email round
 * trip.
 *
 * TEST ONLY. Double-gated by `requireTestGate()`.
 *
 * Auth.js is configured for database sessions, so this writes a real
 * `auth_sessions` row and sets the cookie that names it. It does not invent a
 * provider, add a credentials flow, or introduce a second way to authenticate —
 * there is one session shape and this creates one of those, which is why an e2e
 * run then exercises the same `getSession()` path a real request does.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { createTestSession } from '@/db/test-support';
import { toErrorResponse } from '@/lib/errors';
import { requireTestGate } from '../_gate';

export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().email() }).strict();

/**
 * Auth.js v5's cookie names. The `__Secure-` prefix is what it looks for over
 * HTTPS. This route cannot run in production, so the plain name is the one that
 * matters — both are set so that a developer running behind an https proxy does
 * not get a silent authentication failure.
 */
const SESSION_COOKIE = 'authjs.session-token';
const SECURE_SESSION_COOKIE = '__Secure-authjs.session-token';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    requireTestGate(request);
    const { email } = schema.parse(await request.json());
    const session = await createTestSession(db, email, new Date());

    const response = NextResponse.json({
      userId: session.userId,
      expires: session.expires.toISOString(),
    });
    const options = {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      expires: session.expires,
    };
    response.cookies.set(SESSION_COOKIE, session.sessionToken, { ...options, secure: false });
    response.cookies.set(SECURE_SESSION_COOKIE, session.sessionToken, {
      ...options,
      secure: true,
    });
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
