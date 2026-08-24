/**
 * `GET /api/client/events` — the **client** stream (amendment A1).
 *
 * It takes no parameter. Not "it ignores one" and not "it validates one" — the
 * handler reads no query string at all, so there is nothing for a caller to
 * pass and nothing for a future edit to forget to check. The engagement comes
 * from the session, which names exactly one and cannot be widened (INV-6).
 *
 * Every frame is filtered through the same visibility predicate as the REST
 * reads, because a stream that answered a different question would be a side
 * door into the board that `GET /api/client/board` is careful to filter. In
 * practice that means one small query per event, which is the right trade at
 * this event volume: transitions are human-paced.
 */

import { db } from '@/db/client';
import { loadClientDownloadTarget, loadClientVisibleCardId } from '@/db/queries/client-board';
import { clientScope, type ClientScope } from '@/db/queries/client-scope';
import { toErrorResponse } from '@/lib/errors';
import type { EventEnvelope } from '@/lib/sse';
import { requireClient } from '../../_guards';
import { eventStreamResponse } from '../../_stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Both helpers below already exist and are already the board's own predicate.
 * Reusing them rather than writing a stream-specific check is deliberate: a
 * second predicate is a second thing to keep in step with lane visibility, card
 * overrides, draft state and the publish gate, and the day they drift is the
 * day the stream leaks something the board does not.
 *
 * They throw `NOT_VISIBLE` rather than returning false, so the catch is the
 * answer.
 */
async function canSeeCard(scope: ClientScope, cardId: string): Promise<boolean> {
  try {
    await loadClientVisibleCardId(db, scope, cardId);
    return true;
  } catch {
    return false;
  }
}

async function canSeeVersion(scope: ClientScope, versionId: string): Promise<boolean> {
  try {
    await loadClientDownloadTarget(db, scope, versionId);
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireClient();
    const scope = clientScope(session);

    return eventStreamResponse(request, async (envelope: EventEnvelope) => {
      // INV-6 first: one engagement, from the session, and nothing else.
      if (envelope.engagementId !== scope.engagementId) return false;

      // INV-1: an event about a private lane, a private card, a draft, or an
      // unpublished version tells the contact that thing exists. The event
      // carries no such detail itself — but its mere arrival is a signal, and a
      // signal is a leak when the subject is meant to be invisible.
      if (envelope.cardId !== null && !(await canSeeCard(scope, envelope.cardId))) {
        return false;
      }
      if (envelope.versionId !== null && !(await canSeeVersion(scope, envelope.versionId))) {
        return false;
      }
      return true;
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
