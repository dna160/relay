/**
 * `GET /api/attention` — the agency portfolio's primary content.
 *
 * Named in API-CONTRACT amendment A7 as Phase 5's, pulled forward because the
 * portfolio is the home screen and without this route its main panel renders an
 * error.
 *
 * Returns `{ items: AttentionItem[] }`, already ranked. The ordering is the
 * product decision (PRD §5.5) and it is made once, server-side, so that two
 * people looking at the same agency see the same list in the same order — and
 * so that a front-end re-sort cannot quietly turn it back into a deadline list.
 *
 * The list is personal: "blocked on you" means the signed-in user, so the
 * response is per-session and must not be cached across them.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadAttention, ATTENTION_LIMIT } from '@/db/queries/attention';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency } from '../_guards';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { searchParams } = new URL(request.url);
    const { limit } = querySchema.parse({
      limit: searchParams.get('limit') ?? undefined,
    });

    const items = await loadAttention(
      db,
      session.orgId,
      session.userId,
      new Date(),
      limit ?? ATTENTION_LIMIT,
    );

    return NextResponse.json({ items }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
