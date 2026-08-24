/**
 * `GET /api/test/last-code` — reads a magic-link code out of band.
 *
 * TEST ONLY. Double-gated by `requireTestGate()`: absent in production, absent
 * without `E2E_SEED_TOKEN`, and 404 rather than 403 either way.
 *
 * The e2e suite cannot open an inbox. `src/lib/email.ts` captures the last code
 * it issued per (engagement, address) when the same two conditions hold, and
 * this route hands it back. The code is never read from the database: only its
 * sha256 is stored there, deliberately, so that a database dump is not a set of
 * live magic links (`src/lib/auth.ts`).
 *
 * Takes the engagement as a signed link token rather than a bare id — the same
 * value the client's own flow uses — so this route cannot be used to enumerate
 * engagements even by someone holding the seed token.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readEngagementToken } from '@/lib/auth';
import { lastClientCode } from '@/lib/email';
import { toErrorResponse } from '@/lib/errors';
import { notVisible, validationFailed } from '@/domain/errors';
import { requireTestGate } from '../_gate';

export const dynamic = 'force-dynamic';

const schema = z.object({
  engagementToken: z.string().min(1),
  email: z.string().email(),
});

export async function GET(request: Request): Promise<NextResponse> {
  try {
    requireTestGate(request);
    const { searchParams } = new URL(request.url);
    const parsed = schema.safeParse({
      engagementToken: searchParams.get('engagementToken') ?? undefined,
      email: searchParams.get('email') ?? undefined,
    });
    if (!parsed.success) {
      throw validationFailed('engagementToken and email are required', parsed.error.flatten());
    }

    const engagementId = readEngagementToken(parsed.data.engagementToken);
    if (!engagementId) throw notVisible('Not found');

    const code = lastClientCode(engagementId, parsed.data.email);
    if (code === null) throw notVisible('No code has been issued for that address');

    return NextResponse.json({ code });
  } catch (error) {
    return toErrorResponse(error);
  }
}
