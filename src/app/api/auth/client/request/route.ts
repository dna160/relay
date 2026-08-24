/**
 * `POST /api/auth/client/request` — engagement token + email, out goes a code.
 *
 * The response is the same whether or not the email is on the engagement's
 * contact list. Telling an anonymous caller "that address is not on this
 * project" turns a shared link into an address-enumeration oracle for the
 * client's own staff list.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { findContact, loadLinkableEngagement } from '@/db/queries/client-auth';
import {
  CLIENT_CODE_TTL_MINUTES,
  newClientCode,
  readEngagementToken,
  storeClientCode,
} from '@/lib/auth';
import { sendClientCode } from '@/lib/email';
import { toErrorResponse } from '@/lib/errors';
import { notVisible } from '@/domain/errors';

const schema = z.object({
  engagementToken: z.string().min(1),
  email: z.string().email(),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = schema.parse(await request.json());

    const engagementId = readEngagementToken(body.engagementToken);
    if (!engagementId) throw notVisible('Not found');

    const engagement = await loadLinkableEngagement(db, engagementId);
    if (!engagement || engagement.status === 'purged') throw notVisible('Not found');

    const contact = await findContact(db, engagementId, body.email);

    // An uninvited address falls through to the same response, having sent
    // nothing. The caller cannot tell the two cases apart.
    if (contact) {
      const now = new Date();
      const code = newClientCode();
      await storeClientCode(engagementId, body.email, code, now);
      await sendClientCode({
        to: body.email,
        engagementId,
        engagementTitle: engagement.title,
        code,
        expiresInMinutes: CLIENT_CODE_TTL_MINUTES,
      });
    }

    return NextResponse.json({ sent: true, expiresInMinutes: CLIENT_CODE_TTL_MINUTES });
  } catch (error) {
    return toErrorResponse(error);
  }
}
