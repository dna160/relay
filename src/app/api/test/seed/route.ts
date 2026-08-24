/**
 * `POST /api/test/seed` — resets the database to `tests/fixtures`.
 *
 * TEST ONLY. Double-gated by `requireTestGate()`: it does not exist when
 * `NODE_ENV === 'production'`, it does not exist without `E2E_SEED_TOKEN`, and
 * it answers 404 rather than 403 in either case. This endpoint truncates every
 * content table in the database; there is no version of "reachable in
 * production" that is survivable.
 *
 * The route is four lines of work, as INV-9 requires: gate, call, serialise.
 * Everything it does lives in `src/db/test-support.ts`, including the rule that
 * a seed inserts cards in `draft` and replays their transition scripts rather
 * than writing `cards.state` (INV-2).
 *
 * The client link tokens are derived here rather than stored, the same way the
 * real invite derives them (ADR-012), so the e2e suite exercises the signature
 * path rather than a shortcut around it.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { resetToFixtures } from '@/db/test-support';
import { engagementToken } from '@/lib/auth';
import { toErrorResponse } from '@/lib/errors';
import { requireTestGate } from '../_gate';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    requireTestGate(request);
    const seed = await resetToFixtures(db, new Date());

    return NextResponse.json({
      ...seed,
      engagementToken: engagementToken(seed.engagementId),
      // A second engagement carrying the same contact email, for the INV-6
      // widening test.
      otherEngagementToken: engagementToken(seed.otherEngagementId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
