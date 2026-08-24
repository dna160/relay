/**
 * `GET /api/events?engagementId=` — the **agency** stream (amendment A1).
 *
 * The parameter survives here and only here. An agency member legitimately has
 * many engagements and has to say which board they are looking at; the id is
 * then authorised against their org before a single frame is written, so the
 * parameter selects among things they may already see rather than granting
 * access to anything.
 *
 * Its client counterpart, `GET /api/client/events`, takes no parameter at all.
 * The frozen contract had one stream for both, which for a client session is an
 * INV-6 violation on its face — that is the whole of amendment A1.
 */

import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { toErrorResponse } from '@/lib/errors';
import { validationFailed } from '@/domain/errors';
import { requireAgency } from '../_guards';
import { eventStreamResponse } from '../_stream';

/** A stream is never static and never cached. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({ engagementId: z.string().uuid() });

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireAgency();
    const { searchParams } = new URL(request.url);

    const parsed = querySchema.safeParse({
      engagementId: searchParams.get('engagementId') ?? undefined,
    });
    if (!parsed.success) {
      throw validationFailed('engagementId is required', parsed.error.flatten());
    }

    // Authorisation before subscription. `loadEngagementDetail` is org-scoped
    // and throws NOT_VISIBLE — a 404, never a 403, because a 403 would confirm
    // that another agency's engagement exists.
    const engagement = await loadEngagementDetail(
      db,
      parsed.data.engagementId,
      session.orgId,
      new Date(),
    );

    /**
     * The agency projection has no visibility question to ask beyond the
     * engagement: backstage sees private lanes, draft cards and unpublished
     * versions already, so an engagement match is the whole filter.
     */
    return eventStreamResponse(request, async (envelope) => {
      return envelope.engagementId === engagement.id;
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
