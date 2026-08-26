/**
 * The portfolio's attention list. Agency sessions only — a client contact sees
 * one engagement through `client-board.ts` and never a cross-engagement list,
 * so nothing in this file calls `clientScope()` and nothing in it is reachable
 * from a client route.
 *
 * Scoped to the org's **running** engagements — `isRunning()`, not PRD §5.6's
 * *active*. An archived engagement is read-only and a purged one is gone;
 * neither can be acted on, and an attention list you cannot act on is a to-do
 * list of regrets. Deliberately *not* `isEngagementActive()`, which also
 * requires activity inside the 30-day window: scoping this list that way would
 * hide the engagement nobody has touched in six weeks, which is precisely the
 * one it exists to surface.
 *
 * That distinction is real, and it is also how this file came to carry three
 * hand-written `status = 'active'` predicates for six phases (DEFECT-16). The
 * behaviour was defensible and the spelling was not: a second place that says
 * what "running" means is the drift ADR-008 predicts. It now filters on
 * `RUNNING_STATUSES`, which `count-active.ts` computes by running its own
 * `isRunningStatus()` over the status enum — so the definition is still in one
 * file, and this one names no status at all.
 *
 * Why not retention.ts's approach — load a wider set and ask `isRunning()` in
 * JavaScript? Because the filter here rides a join over every unfinished card
 * in the organisation. Widening it means reading every archived engagement's
 * finished cards in order to discard them, and the read below is already the
 * expensive one.
 */

import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { cards, engagements, stateTransitions } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { AttentionItem } from '@/lib/types';
import { RUNNING_STATUSES } from '@/domain/engagement/count-active';
import { rankAttention, type AttentionCardRow } from '@/domain/attention/rank';
import type { TransitionRow } from '@/domain/card/possession';

/**
 * One expression, reused by all three reads in this file, so that the question
 * "which engagements does the attention list consider?" has one answer here and
 * its definition lives somewhere else entirely. A drizzle predicate is an
 * immutable descriptor, so sharing it across statements is free.
 */
const RUNNING_ENGAGEMENT = inArray(engagements.status, [...RUNNING_STATUSES]);

/**
 * The portfolio renders a list, not a ledger. A cap keeps one agency with four
 * hundred open cards from turning the home screen into a slow query; the tail
 * of a list ranked by actionability is by construction the part nobody acts on.
 */
export const ATTENTION_LIMIT = 50;

export async function loadAttention(
  exec: Executor,
  orgId: string,
  viewerUserId: string,
  now: Date,
  limit: number = ATTENTION_LIMIT,
): Promise<AttentionItem[]> {
  const engagementRows = await exec
    .select({ id: engagements.id, title: engagements.title })
    .from(engagements)
    .where(and(eq(engagements.orgId, orgId), RUNNING_ENGAGEMENT));

  if (engagementRows.length === 0) return [];
  const titleById = new Map(engagementRows.map((e) => [e.id, e.title]));

  /**
   * Both reads below select the org's cards through a **join**, not through an
   * `IN` list built in JavaScript from the previous result.
   *
   * They used to. `EXPLAIN ANALYZE` against a 120-engagement agency showed the
   * card read shipping 121 bound parameters and the transition read shipping
   * **4,320** — one per card — to fetch 25,920 rows. That is slow, but slow is
   * the smaller half. `pg` speaks a wire protocol with a hard ceiling of 65,535
   * bound parameters per statement, so an agency that crosses roughly 65,000
   * unfinished cards does not get a slower portfolio: `GET /api/attention`
   * starts throwing a protocol error and the home screen stops rendering, with
   * nothing in the code saying a limit was ever approached.
   *
   * The join produces exactly the same rows — this is a rewrite, not a change
   * of meaning — with one bound parameter and a plan the planner can index.
   *
   * What it does **not** fix is the shape: this still reads every unfinished
   * card and every one of its transitions to return `limit` of them, because
   * the possession clock is derived from the whole transition history per card
   * (ADR-010) and the ranking is over the whole set (PRD §5.5). Bounding that
   * changes which cards appear, which is a product decision and not one to make
   * inside a query file. Raised in the handover.
   */
  const orgRunningCards = and(eq(engagements.orgId, orgId), RUNNING_ENGAGEMENT);

  const cardRows = await exec
    .select({
      cardId: cards.id,
      engagementId: cards.engagementId,
      cardTitle: cards.title,
      state: cards.state,
      assigneeId: cards.assigneeId,
      dueAt: cards.dueAt,
      roundsUsed: cards.roundsUsed,
      contractedRounds: cards.contractedRounds,
      createdAt: cards.createdAt,
    })
    .from(cards)
    .innerJoin(engagements, eq(engagements.id, cards.engagementId))
    // A signed-off card is finished; the ranker drops it too, but not reading
    // it is cheaper than reading it to throw it away.
    .where(and(orgRunningCards, ne(cards.state, 'signed_off'), isNull(cards.archivedAt)));

  if (cardRows.length === 0) return [];

  const transitions: TransitionRow[] = await exec
    .select({
      cardId: stateTransitions.cardId,
      toState: stateTransitions.toState,
      possession: stateTransitions.possession,
      occurredAt: stateTransitions.occurredAt,
    })
    .from(stateTransitions)
    .innerJoin(cards, eq(cards.id, stateTransitions.cardId))
    .innerJoin(engagements, eq(engagements.id, cards.engagementId))
    .where(and(orgRunningCards, ne(cards.state, 'signed_off'), isNull(cards.archivedAt)));

  /**
   * The last movement per card, for the "silently rotting" bucket. Computed
   * from the transitions already in hand rather than with a second grouped
   * query — the set is the same rows and the arithmetic is a max().
   */
  const lastMoved = new Map<string, Date>();
  for (const t of transitions) {
    const current = lastMoved.get(t.cardId);
    if (!current || t.occurredAt.getTime() > current.getTime()) {
      lastMoved.set(t.cardId, t.occurredAt);
    }
  }

  const rows: AttentionCardRow[] = cardRows.map((c) => ({
    cardId: c.cardId,
    engagementId: c.engagementId,
    engagementTitle: titleById.get(c.engagementId) ?? '',
    cardTitle: c.cardTitle,
    state: c.state,
    assigneeId: c.assigneeId,
    dueAt: c.dueAt,
    roundsUsed: c.roundsUsed,
    contractedRounds: c.contractedRounds,
    // Never moved: the card has been sitting since it was created, and that is
    // exactly the silence the rot bucket is looking for.
    lastMovedAt: lastMoved.get(c.cardId) ?? c.createdAt,
  }));

  return rankAttention({ cards: rows, transitions, viewerUserId, now }).slice(0, limit);
}

/**
 * A cheap count for a badge, without ranking or serialising anything. Kept in
 * this file so that the definition of "needs attention" cannot drift from the
 * list — it is the same `WHERE`.
 */
export async function countAttentionCandidates(
  exec: Executor,
  orgId: string,
): Promise<number> {
  const rows = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(engagements, eq(engagements.id, cards.engagementId))
    .where(
      and(
        eq(engagements.orgId, orgId),
        RUNNING_ENGAGEMENT,
        ne(cards.state, 'signed_off'),
        isNull(cards.archivedAt),
      ),
    );
  return rows[0]?.total ?? 0;
}
