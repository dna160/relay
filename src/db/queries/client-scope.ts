/**
 * ADR-006 / INV-1 — the mechanical guard.
 *
 * Lane visibility defaults to published, which is a real safety cost, so the
 * guard is mechanical rather than procedural: every client-reachable read in
 * `src/db/queries/` goes through `clientScope()`, and a new query that bypasses
 * it fails `tests/invariants/visibility.spec.ts`.
 *
 * The scope is built from the *session* and nothing else. It is not possible to
 * construct one from a request parameter, which is what makes "a client route
 * that accepts an engagementId is a bug" enforceable rather than aspirational
 * (INV-6).
 */

import { and, eq, isNotNull, isNull, ne, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { assetVersions, cards, lanes } from '@/db/schema';
import type { Session } from '@/lib/types';

export interface ClientScope {
  /** Exactly one, taken from the session. */
  readonly engagementId: string;
  readonly contactId: string;

  /** `<column> = <the session's engagement>`, for any table carrying one. */
  onEngagement(column: PgColumn): SQL;

  /** `lanes.visibility = 'published'`. */
  readonly publishedLanes: SQL;

  /**
   * `lanes.archived_at IS NULL` (ADR-026).
   *
   * Kept separate from `publishedLanes` rather than folded into it, because the
   * two say different things and a predicate whose name stops describing it is
   * how a reader stops checking. Every read that wants published lanes wants
   * live ones too, so `visibleBoard` carries both and `visibleLanes()` names
   * both explicitly.
   */
  readonly liveLanes: SQL;

  /**
   * A card is visible when its lane is published, it is not archived, it is not
   * overridden to private, and it is not a draft. Combine with
   * `publishedLanes` and `liveLanes` on the join.
   */
  readonly visibleCards: SQL;

  /** `asset_versions.published_to_client_at IS NOT NULL`. */
  readonly publishedVersions: SQL;

  /** Lane + card + engagement, the predicate a board read wants whole. */
  readonly visibleBoard: SQL;
}

/**
 * @throws when handed an agency session. The type system already prevents it
 * at every call site inside this repo; the runtime check is for the day someone
 * passes a session through a wider type on the way here.
 */
export function clientScope(session: Session): ClientScope {
  if (session.kind !== 'client') {
    throw new Error('clientScope() requires a client session');
  }

  const { engagementId, contactId } = session;

  const publishedLanes = eq(lanes.visibility, 'published');
  const liveLanes = isNull(lanes.archivedAt);
  const visibleCards = and(
    isNull(cards.archivedAt),
    ne(cards.visibilityOverride, 'private'),
    ne(cards.state, 'draft'),
  ) as SQL;
  const publishedVersions = isNotNull(assetVersions.publishedToClientAt);

  return {
    engagementId,
    contactId,
    onEngagement: (column: PgColumn) => eq(column, engagementId),
    publishedLanes,
    liveLanes,
    visibleCards,
    publishedVersions,
    visibleBoard: and(
      eq(cards.engagementId, engagementId),
      publishedLanes,
      liveLanes,
      visibleCards,
    ) as SQL,
  };
}
