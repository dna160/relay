/**
 * `POST /api/onboarding/org` — create an agency and join it as admin.
 *
 * The only agency route that does not call `requireAgency()`, because
 * `requireAgency()` needs an org and this is where the org comes from. It reads
 * the Auth.js session directly.
 *
 * Not in API-CONTRACT.md — flagged in the handover.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { onboardOrganization } from '@/domain/organization/onboard';
import { unauthenticated } from '@/domain/errors';
import { auth } from '@/lib/auth';
import { toErrorResponse } from '@/lib/errors';

const schema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z.string().min(2).max(60),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw unauthenticated();

    const body = schema.parse(await request.json());
    const result = await onboardOrganization(db, { userId, ...body }, new Date());

    return NextResponse.json({ organization: result }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
