/**
 * The route-layer half of the shadow harness (ADR-021 migration step 3).
 *
 * Not a route file — Next ignores anything in `app/` that is not `route.ts` or
 * a page. It sits beside `_guards.ts` for the same reason that file does: it is
 * HTTP-shaped. It knows what an endpoint is called and what a `NOT_VISIBLE`
 * means, and it knows nothing about how permission is computed.
 *
 * ## The whole contract, in one line
 *
 *     const engagement = await shadowed(ENDPOINT, session, id, () => loadEngagementDetail(...));
 *
 * `shadowed()` runs the shipped check, runs `resolveAccess()` beside it,
 * records any difference, and returns **the shipped answer** — or rethrows the
 * shipped error. There is no argument that changes that, and there is no
 * variant that returns the new answer, because a wrapper with a "use the new
 * result" flag is a wrapper someone will eventually flip.
 *
 * ## Do not delete the old checks yet
 *
 * Seven consecutive days at zero disagreements, then step 4 deletes the old
 * path, then INV-11 is unskipped. `npm run access:shadow` prints the streak.
 */

import { db } from '@/db/client';
import { isDomainError } from '@/domain/errors';
import {
  compareVisibleProjects,
  withShadow,
  type ShadowContext,
} from '@/domain/access/shadow';
import { projectIdForCard, projectIdForVersion } from '@/db/queries/access-shadow';
import type { Session } from '@/lib/types';

type AgencySession = Extract<Session, { kind: 'agency' }>;

/**
 * A thrown `NOT_VISIBLE` is how every permission check in this codebase says
 * "denied" — 404, never 403 (API-CONTRACT). Anything else is a real failure and
 * is rethrown untouched, so a database outage does not get recorded as a
 * permission disagreement.
 */
function isDenial(error: unknown): boolean {
  return isDomainError(error) && error.code === 'NOT_VISIBLE';
}

function contextFor(
  endpoint: string,
  decisionPoint: string,
  session: AgencySession,
  projectId: string | null,
  input?: Readonly<Record<string, unknown>>,
): ShadowContext {
  return {
    endpoint,
    decisionPoint,
    legacyUserId: session.userId,
    legacyOrgId: session.orgId,
    projectId,
    input: input ?? {},
  };
}

/**
 * The common case: the endpoint already knows the engagement id, because it
 * arrived in the path or the body.
 */
export async function shadowed<T>(
  endpoint: string,
  session: AgencySession,
  projectId: string,
  run: () => Promise<T>,
  decisionPoint = 'engagement',
  input?: Readonly<Record<string, unknown>>,
): Promise<T> {
  return withShadow(
    db,
    contextFor(endpoint, decisionPoint, session, projectId, input),
    run,
    isDenial,
  );
}

/**
 * The card and version routes, which resolve the engagement *through* the
 * permission check and therefore do not know it up front.
 *
 * The project id is looked up unscoped, by the harness, so that a denial is
 * still comparable. That lookup is why `projectIdForCard` exists and why it is
 * documented as harness-only.
 */
export async function shadowedByCard<T>(
  endpoint: string,
  session: AgencySession,
  cardId: string,
  run: () => Promise<T>,
  decisionPoint = 'card',
): Promise<T> {
  const projectId = await projectIdForCard(db, cardId).catch(() => null);
  return withShadow(
    db,
    contextFor(endpoint, decisionPoint, session, projectId, { cardId }),
    run,
    isDenial,
  );
}

export async function shadowedByVersion<T>(
  endpoint: string,
  session: AgencySession,
  versionId: string,
  run: () => Promise<T>,
  decisionPoint = 'version',
): Promise<T> {
  const projectId = await projectIdForVersion(db, versionId).catch(() => null);
  return withShadow(
    db,
    contextFor(endpoint, decisionPoint, session, projectId, { versionId }),
    run,
    isDenial,
  );
}

/**
 * The list endpoints, where the shipped check is a `WHERE org_id = $session`
 * inside the query rather than a decision about one object.
 *
 * Compares the *sets*. This is where a role mapping that is wrong for one class
 * of user shows up first, because it shows up for every row at once rather than
 * waiting for that user to open the one project that reveals it.
 */
export async function shadowVisible(
  endpoint: string,
  session: AgencySession,
  visibleProjectIds: readonly string[],
  decisionPoint = 'portfolio',
): Promise<void> {
  await compareVisibleProjects(
    db,
    {
      endpoint,
      decisionPoint,
      legacyUserId: session.userId,
      legacyOrgId: session.orgId,
      input: { returned: visibleProjectIds.length },
    },
    visibleProjectIds,
  );
}
