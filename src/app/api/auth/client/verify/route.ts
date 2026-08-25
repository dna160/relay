/**
 * `POST /api/auth/client/verify` — code in, session cookie out.
 *
 * The cookie names exactly one engagement and is signed with
 * `CLIENT_LINK_SECRET` (INV-6). Verifying a link for a second engagement
 * replaces the cookie with a second, separate session; it never merges them,
 * because there is no shape in which a client session holds two engagements.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { findContact, loadLinkableEngagement } from '@/db/queries/client-auth';
import { markContactVerified } from '@/domain/engagement/verify-contact';
import {
  chargeVerifyAttempt,
  clearVerifyAttempts,
  clientCookieName,
  clientCookieOptions,
  consumeClientCode,
  readEngagementToken,
  signClientSession,
} from '@/lib/auth';
import { toErrorResponse } from '@/lib/errors';
import { notVisible, validationFailed } from '@/domain/errors';

const schema = z.object({
  engagementToken: z.string().min(1),
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = schema.parse(await request.json());
    const now = new Date();

    const engagementId = readEngagementToken(body.engagementToken);
    if (!engagementId) throw notVisible('Not found');

    const engagement = await loadLinkableEngagement(db, engagementId);
    if (!engagement || engagement.status === 'purged') throw notVisible('Not found');

    /**
     * The rate limit, charged before the code is tested.
     *
     * Six digits is 10^6 and a code lives fifteen minutes; an attacker who can
     * reach this route a thousand times a second exhausts the space inside one
     * code's lifetime, and a client workspace has no password behind it to fall
     * back on. Over budget the code is *not* consumed and *not* compared — the
     * attempt buys nothing at all.
     */
    if (!(await chargeVerifyAttempt(engagementId, body.email, now))) {
      throw validationFailed(
        'Too many attempts. Request a new code and try again in a few minutes.',
      );
    }

    const contact = await findContact(db, engagementId, body.email);
    // The code is consumed either way, so a wrong address cannot be used to
    // keep a valid code alive for another attempt.
    const ok = await consumeClientCode(engagementId, body.email, body.code, now);
    if (!contact || !ok) throw validationFailed('That code is not valid or has expired');

    // Only a success returns the budget. A failed guess stays charged.
    await clearVerifyAttempts(engagementId, body.email);

    await markContactVerified(db, contact.id, now);

    const session = signClientSession(contact.id, engagementId, now);
    const response = NextResponse.json({
      engagementTitle: engagement.title,
      contactId: contact.id,
    });
    response.cookies.set(clientCookieName, session.value, clientCookieOptions(session.maxAge));
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
