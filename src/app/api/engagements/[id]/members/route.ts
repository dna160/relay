/**
 * `GET /api/engagements/:id/members` — who can be assigned a card here.
 *
 * The read that was missing. `assigneeId` has been accepted by `POST
 * /api/cards` and `PATCH /api/cards/:id` since Phase 2 and `AgencyCard` has
 * carried `assignee` for just as long, but nothing enumerated the candidates,
 * so the front-end had no way to build a picker and assignment was reachable
 * only by typing a uuid.
 *
 * ## What "who" means, and why there are two answers today
 *
 * Phase 9 changed the answer. There is now an account/membership graph, and
 * `resolveAccess()` is the sole authority (INV-11) — so assignability follows
 * from membership, not from a second notion of who belongs to a project.
 * `listAssignableAccounts()` in `src/domain/access/` is that definition, and it
 * runs on every request to this route.
 *
 * It is not what this route *returns*, and the reason is the same one that
 * governs every other permission surface in the product right now (ADR-023).
 * Phase 9 is in its shadow window: every check runs both paths and returns the
 * shipped one, because the graph is "probably right" and only "agreed with
 * production for seven days" is checkable. Returning the graph's answer here
 * would go further than any other endpoint does, and it would fail in a
 * specific and visible way — on a deployment whose backfill has not run, the
 * membership tables are empty and every picker in the product renders nobody,
 * while the write path goes on accepting the ids the picker no longer offers.
 *
 * So the shipped answer is `listAssignableUsers()`, which shares its predicate
 * with the write path's own `assertAssigneeInOrg()`, and the graph's answer is
 * compared against it and any difference logged. When the streak reaches seven
 * days and step 4 deletes the old checks, this route drops the legacy read and
 * returns `listAssignableAccounts()` — including the `role` and `via` it
 * already computes, which is why they are not in the response yet: a role
 * attached to a list the graph did not produce would be a fact about nothing.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { listAssignableAccounts } from '@/domain/access/assignable';
import { listAssignableUsers } from '@/domain/card/mutate';
import { assertReadable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../../_guards';
import { shadowAssignable, shadowed } from '../../../_shadow';

const ENDPOINT = 'GET /api/engagements/[id]/members';

export async function GET(
  _request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const now = new Date();

    const engagement = await shadowed(ENDPOINT, session, id, () =>
      loadEngagementDetail(db, id, session.orgId, now),
    );
    // Readable, not writable. An archived engagement is read-only and its board
    // still renders assignee names; a picker that 423s on it would make the
    // read-only board unopenable.
    assertReadable(engagement);

    const members = await listAssignableUsers(db, engagement.id);

    /**
     * The graph's answer, computed and compared and not returned. Failing to
     * compute it must not fail the request — the harness rule everywhere else
     * (ADR-023 rule 2), applied here at the call site because the read itself
     * throws where `compareAssignableMembers` swallows.
     */
    const graph = await listAssignableAccounts(db, engagement.id).catch(() => []);
    await shadowAssignable(
      ENDPOINT,
      session,
      engagement.id,
      members.map((m) => m.id),
      graph
        .map((a) => a.legacyUserId)
        .filter((legacyUserId): legacyUserId is string => legacyUserId !== null),
    );

    return NextResponse.json({
      members: members.map((m) => ({
        /** The value to send as `assigneeId`. A `users.id` — see the header. */
        id: m.id,
        name: m.name,
        email: m.email,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
